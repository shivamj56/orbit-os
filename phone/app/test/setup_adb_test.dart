// The classic ADB client (lib/setup/adb.dart) driven against a fake device over an in-memory transport: no sockets,
// no RSA (the crypto is faked), so the CNXN/AUTH handshake, the "waiting for Allow" moment, the failure reasons,
// legacy shell output, line streaming with the exit code, and the sync push are all exercised here.
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/setup/adb.dart';

/// A two-way byte pipe: what the client writes reaches [FakeAdbDevice], what the device sends reaches the client.
class Pipe implements AdbTransport {
  final StreamController<Uint8List> _incoming = StreamController<Uint8List>();
  void Function(Uint8List bytes)? toDevice;

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  void add(List<int> bytes) => toDevice?.call(Uint8List.fromList(bytes));

  @override
  Future<void> close() async {
    if (!_incoming.isClosed) await _incoming.close();
  }

  void fromDevice(Uint8List bytes) {
    if (!_incoming.isClosed) _incoming.add(bytes);
  }

  void deviceClosed() {
    if (!_incoming.isClosed) _incoming.close();
  }
}

/// The RSA key, faked: fixed bytes, no maths. The fake device does not verify it.
class FakeAdbCrypto implements AdbCrypto {
  int signs = 0;
  int pubKeyReads = 0;

  @override
  Future<Uint8List> signToken(Uint8List token) async {
    signs++;
    return Uint8List(256)..fillRange(0, 256, 0x5a);
  }

  @override
  Future<String> publicKey() async {
    pubKeyReads++;
    return 'QAAAAfakepublickey orbit@phone\u0000';
  }
}

/// The device half of the classic ADB protocol, enough to answer the client.
class FakeAdbDevice {
  FakeAdbDevice(this._pipe, {this.auth = 'none', Map<String, List<String>>? shell})
    : _shell = shell ?? const {} {
    _pipe.toDevice = _onHostBytes;
  }

  final Pipe _pipe;

  /// 'none' (no auth), 'acceptSignature', 'allowAfterKey', 'cancelAfterKey', 'hangAfterKey', 'tls'.
  final String auth;

  /// Shell command -> the output chunks to send, each as its own WRTE (so line streaming across chunks is tested).
  final Map<String, List<String>> _shell;

  /// What a sync push delivered.
  final BytesBuilder pushed = BytesBuilder(copy: false);
  String? pushPath;
  int? pushMode;

  final BytesBuilder _buffer = BytesBuilder(copy: false);
  int _nextRemote = 100;
  int? _syncHostId;
  int? _syncRemote;

  static const int _cnxn = 0x4e584e43;
  static const int _auth = 0x48545541;
  static const int _open = 0x4e45504f;
  static const int _okay = 0x59414b4f;
  static const int _wrte = 0x45545257;
  static const int _clse = 0x45534c43;

  void _onHostBytes(Uint8List chunk) {
    _buffer.add(chunk);
    final data = _buffer.takeBytes();
    var offset = 0;
    while (data.length - offset >= 24) {
      final view = ByteData.sublistView(data, offset);
      final command = view.getUint32(0, Endian.little);
      final arg0 = view.getUint32(4, Endian.little);
      final arg1 = view.getUint32(8, Endian.little);
      final length = view.getUint32(12, Endian.little);
      if (data.length - offset - 24 < length) break;
      final payload = Uint8List.sublistView(data, offset + 24, offset + 24 + length);
      offset += 24 + length;
      _handle(command, arg0, arg1, payload);
    }
    if (offset > 0) _buffer.add(Uint8List.sublistView(data, offset));
  }

  void _send(int command, int arg0, int arg1, [Uint8List? payload]) =>
      _pipe.fromDevice(AdbMessage(command, arg0, arg1, payload ?? Uint8List(0)).toBytes());

  void _sendCnxn() =>
      _send(_cnxn, 0x01000000, 256 * 1024, Uint8List.fromList(utf8.encode('device::fake\u0000')));

  void _sendToken() => _send(_auth, 1, 0, Uint8List(20)..fillRange(0, 20, 0x11));

  void _handle(int command, int arg0, int arg1, Uint8List payload) {
    switch (command) {
      case _cnxn:
        if (auth == 'tls') {
          _pipe.fromDevice(Uint8List.fromList([0x16, 0x03, 0x01, 0x00, 0x05, 1, 2, 3, 4, 5]));
        } else if (auth == 'none') {
          _sendCnxn();
        } else {
          _sendToken();
        }
      case _auth:
        if (arg0 == 2) {
          // The host signed the token. Accept it, or reject and ask again (then the host sends its public key).
          if (auth == 'acceptSignature') {
            _sendCnxn();
          } else {
            _sendToken();
          }
        } else if (arg0 == 3) {
          // The host sent its public key: this is the "Allow USB debugging?" moment.
          switch (auth) {
            case 'allowAfterKey':
              _sendCnxn();
            case 'cancelAfterKey':
              _pipe.deviceClosed();
            case 'hangAfterKey':
              break; // never answer
          }
        }
      case _open:
        final service = utf8.decode(payload).replaceAll('\u0000', '');
        final remote = _nextRemote++;
        _send(_okay, remote, arg0);
        if (service.startsWith('shell:')) {
          _runShell(service.substring('shell:'.length), remote, arg0);
        } else if (service.startsWith('sync:')) {
          _syncHostId = arg0;
          _syncRemote = remote;
        }
      case _wrte:
        // Flow-control OKAY back to the host (arg0 = device remote, arg1 = host local).
        _send(_okay, arg1, arg0);
        if (_syncHostId == arg0) _onSync(payload);
      case _clse:
        // The host closed its stream; nothing more to do.
        break;
    }
  }

  void _runShell(String cmd, int remote, int hostLocal) {
    final chunks = _shell[cmd] ?? const [''];
    for (final chunk in chunks) {
      _send(_wrte, remote, hostLocal, Uint8List.fromList(utf8.encode(chunk)));
    }
    _send(_clse, remote, hostLocal);
  }

  void _onSync(Uint8List payload) {
    if (payload.length < 8) return;
    final id = ascii.decode(payload.sublist(0, 4));
    final len = ByteData.sublistView(payload, 4, 8).getUint32(0, Endian.little);
    switch (id) {
      case 'SEND':
        final target = utf8.decode(payload.sublist(8, 8 + len));
        final comma = target.lastIndexOf(',');
        pushPath = target.substring(0, comma);
        pushMode = int.tryParse(target.substring(comma + 1));
      case 'DATA':
        pushed.add(payload.sublist(8, 8 + len));
      case 'DONE':
        final okay = BytesBuilder()
          ..add(ascii.encode('OKAY'))
          ..add(Uint8List(4));
        _send(_wrte, _syncRemote!, _syncHostId!, okay.toBytes());
    }
  }
}

void main() {
  group('AdbConnection handshake', () {
    test('a device that accepts the signature connects with no Allow prompt', () async {
      final pipe = Pipe();
      final crypto = FakeAdbCrypto();
      FakeAdbDevice(pipe, auth: 'acceptSignature');
      var waiting = 0;
      final connection = await AdbConnection.open(pipe, crypto, onAuthWaiting: () => waiting++);
      expect(crypto.signs, 1);
      expect(crypto.pubKeyReads, 0, reason: 'the key was known, so no public key was sent');
      expect(waiting, 0, reason: 'no "Allow USB debugging?" needed');
      await connection.close();
    });

    test('an unknown key sends the public key and fires setupAuth waiting, then Allow connects', () async {
      final pipe = Pipe();
      final crypto = FakeAdbCrypto();
      FakeAdbDevice(pipe, auth: 'allowAfterKey');
      var waiting = 0;
      final connection = await AdbConnection.open(pipe, crypto, onAuthWaiting: () => waiting++);
      expect(crypto.signs, 1);
      expect(crypto.pubKeyReads, 1);
      expect(waiting, 1, reason: 'waiting for Allow was announced exactly once');
      await connection.close();
    });

    test('Cancel on the TV is the reason "refused"', () async {
      final pipe = Pipe();
      FakeAdbDevice(pipe, auth: 'cancelAfterKey');
      await expectLater(
        AdbConnection.open(pipe, FakeAdbCrypto()),
        throwsA(isA<AdbFailure>().having((e) => e.reason, 'reason', 'refused')),
      );
    });

    test('no Allow within the window is the reason "timeout", after waiting was announced', () async {
      final pipe = Pipe();
      var waiting = 0;
      FakeAdbDevice(pipe, auth: 'hangAfterKey');
      await expectLater(
        AdbConnection.open(
          pipe,
          FakeAdbCrypto(),
          onAuthWaiting: () => waiting++,
          allowTimeout: const Duration(milliseconds: 150),
          handshakeTimeout: const Duration(milliseconds: 100),
        ),
        throwsA(isA<AdbFailure>().having((e) => e.reason, 'reason', 'timeout')),
      );
      expect(waiting, 1);
    });

    test('a TLS record (Wireless debugging only) is the reason "tls"', () async {
      final pipe = Pipe();
      FakeAdbDevice(pipe, auth: 'tls');
      await expectLater(
        AdbConnection.open(pipe, FakeAdbCrypto()),
        throwsA(isA<AdbFailure>().having((e) => e.reason, 'reason', 'tls')),
      );
    });
  });

  group('AdbConnection streams', () {
    Future<AdbConnection> connected(FakeAdbDevice Function(Pipe) make) async {
      final pipe = Pipe();
      make(pipe);
      return AdbConnection.open(pipe, FakeAdbCrypto());
    }

    test('shell returns the whole output, stdout and stderr together', () async {
      final connection = await connected(
        (p) => FakeAdbDevice(p, shell: {
          'getprop': ['[ro.product.model]: [MiTV-AXFU0]\n[ro.build.version.sdk]: [34]\n'],
        }),
      );
      final out = await connection.shell('getprop');
      expect(out, contains('MiTV-AXFU0'));
      expect(out, contains('[ro.build.version.sdk]: [34]'));
      await connection.close();
    });

    test('run streams each line and parses the exit code, without emitting the @orbit-exit sentinel', () async {
      final connection = await connected(
        (p) => FakeAdbDevice(p, shell: {
          // The run command is "<cmd>; echo @orbit-exit \$?"; the device echoes lines then the sentinel.
          'sh orbit-setup.sh; echo @orbit-exit \$?': ['one\ntw', 'o\nthree\n', '@orbit-exit 7\n'],
        }),
      );
      final lines = <String>[];
      final exit = await connection.run('sh orbit-setup.sh', lines.add);
      expect(lines, ['one', 'two', 'three']);
      expect(exit, 7);
      await connection.close();
    });

    test('a switch run reaches the page line by line, however the TV cuts its output, with the exit code', () async {
      const cmd = 'sh /data/local/tmp/orbit/orbit-setup.sh switch stock';
      final connection = await connected(
        (p) => FakeAdbDevice(p, shell: {
          // switch_stock's lines, cut mid-line and with the shell's \r\n, as a real TV's output arrives.
          '$cmd; echo @orbit-exit \$?': [
            '@orbit step switch st',
            'art\r\non com.google.android.apps.tv.launcherx\r\n@orbit step sw',
            'itch ok\r\n@orbit done ok\r\n',
            '@orbit-exit 0\r\n',
          ],
        }),
      );
      final lines = <String>[];
      final exit = await connection.run(cmd, lines.add);
      expect(lines, ['@orbit step switch start', 'on com.google.android.apps.tv.launcherx', '@orbit step switch ok', '@orbit done ok']);
      expect(exit, 0);
      await connection.close();
    });

    test('a switch that stops says its fail lines, and its exit code comes even without a last newline', () async {
      const cmd = 'sh /data/local/tmp/orbit/orbit-setup.sh switch orbit';
      final connection = await connected(
        (p) => FakeAdbDevice(p, shell: {
          '$cmd; echo @orbit-exit \$?': [
            '@orbit step switch start\n@orbit step switch fail Orbit Home is not on this TV\n',
            '@orbit done fail Orbit Home is not on this TV\n@orbit-exit 1',
          ],
        }),
      );
      final lines = <String>[];
      final exit = await connection.run(cmd, lines.add);
      expect(lines, [
        '@orbit step switch start',
        '@orbit step switch fail Orbit Home is not on this TV',
        '@orbit done fail Orbit Home is not on this TV',
      ]);
      expect(exit, 1);
      await connection.close();
    });

    test('push sends the bytes with mode 0644 and reports how many', () async {
      late FakeAdbDevice device;
      final connection = await connected((p) => device = FakeAdbDevice(p));
      final bytes = Uint8List(200000);
      for (var i = 0; i < bytes.length; i++) {
        bytes[i] = i & 0xff;
      }
      final written = await connection.push(bytes, '/data/local/tmp/orbit/orbit-home.apk');
      expect(written, bytes.length);
      expect(device.pushPath, '/data/local/tmp/orbit/orbit-home.apk');
      expect(device.pushMode, 0x1a4, reason: '0644 octal');
      expect(device.pushed.toBytes(), bytes);
      await connection.close();
    });
  });
}
