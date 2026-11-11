/// The classic (unencrypted) ADB wire protocol over a byte stream, the part Orbit Setup needs: the CNXN/AUTH
/// handshake with an RSA key, shell commands (legacy, combined stdout+stderr), and a sync push.
///
/// The TV's own debugging connection on port 5555 speaks this. The 2048-bit RSA key is the app's, made once and kept
/// in the phone's private storage; signing and the public-key blob come from [AdbCrypto] (platform crypto on the
/// phone, a fake in tests), so this file never does RSA maths and stays testable against a fake device on a socket.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

/// The four-letter ADB commands, little-endian on the wire.
class AdbCommand {
  static const int cnxn = 0x4e584e43; // CNXN
  static const int auth = 0x48545541; // AUTH
  static const int open = 0x4e45504f; // OPEN
  static const int okay = 0x59414b4f; // OKAY
  static const int wrte = 0x45545257; // WRTE
  static const int clse = 0x45534c43; // CLSE
}

/// AUTH message types (arg0).
class _AdbAuth {
  static const int token = 1;
  static const int signature = 2;
  static const int rsaPublicKey = 3;
}

/// Our side's protocol version and the most we take in one message.
const int _adbVersion = 0x01000000;
const int _adbMaxData = 256 * 1024;

/// The app's RSA key, used only through these two operations so the protocol code holds no key material.
abstract interface class AdbCrypto {
  /// The 20-byte AUTH token signed as ADB expects: PKCS#1 v1.5 over the SHA-1 DigestInfo of the token (256 bytes for
  /// a 2048-bit key).
  Future<Uint8List> signToken(Uint8List token);

  /// The public key in ADB's `android_pubkey` base64 form, with a trailing ` name\u0000` as adb sends it.
  Future<String> publicKey();
}

/// Why opening the ADB connection did not work, in the words phone/SPEC.md's `setupConnect` uses.
class AdbFailure implements Exception {
  const AdbFailure(this.reason, this.message);

  /// One of `unreachable`, `refused`, `timeout`, `tls`.
  final String reason;
  final String message;

  @override
  String toString() => 'AdbFailure($reason, $message)';
}

/// A byte stream to the device and back (a socket on the phone; a loopback pair in tests).
abstract interface class AdbTransport {
  Stream<Uint8List> get incoming;

  void add(List<int> bytes);

  Future<void> close();
}

/// One ADB message: a 24-byte header and a payload.
class AdbMessage {
  AdbMessage(this.command, this.arg0, this.arg1, this.payload);

  final int command;
  final int arg0;
  final int arg1;
  final Uint8List payload;

  /// The 24-byte header followed by the payload.
  Uint8List toBytes() {
    final out = Uint8List(24 + payload.length);
    final view = ByteData.sublistView(out);
    view.setUint32(0, command, Endian.little);
    view.setUint32(4, arg0, Endian.little);
    view.setUint32(8, arg1, Endian.little);
    view.setUint32(12, payload.length, Endian.little);
    view.setUint32(16, _checksum(payload), Endian.little);
    view.setUint32(20, (command ^ 0xffffffff) & 0xffffffff, Endian.little);
    out.setRange(24, out.length, payload);
    return out;
  }

  /// The payload bytes summed, the `data_check` field (modern adbd ignores it; older ones verified it).
  static int _checksum(Uint8List payload) {
    var sum = 0;
    for (final b in payload) {
      sum = (sum + b) & 0xffffffff;
    }
    return sum;
  }
}

/// Reads whole ADB messages out of a byte stream, holding a partial header or payload until the rest arrives.
class _AdbReader {
  final BytesBuilder _buffer = BytesBuilder(copy: false);
  Uint8List _held = Uint8List(0);

  /// Adds [chunk] and returns every complete message it now has. Throws [AdbFailure] with reason `tls` when the first
  /// bytes are a TLS record (the device only offers Wireless debugging), and `refused` for anything else that is not
  /// ADB.
  List<AdbMessage> add(Uint8List chunk, {required bool anyMessageYet}) {
    if (_held.isEmpty) {
      _held = chunk;
    } else {
      _buffer
        ..add(_held)
        ..add(chunk);
      _held = _buffer.takeBytes();
    }
    final messages = <AdbMessage>[];
    final data = _held;
    // A TLS record is only a few bytes, fewer than one ADB header, so catch it before the header loop.
    if (!anyMessageYet && _AdbReader._looksLikeTls(data)) {
      throw const AdbFailure('tls', 'The TV offers only Wireless debugging, which Orbit cannot use yet.');
    }
    var offset = 0;
    while (data.length - offset >= 24) {
      final view = ByteData.sublistView(data, offset);
      final command = view.getUint32(0, Endian.little);
      final length = view.getUint32(12, Endian.little);
      final magic = view.getUint32(20, Endian.little);
      if (((command ^ 0xffffffff) & 0xffffffff) != magic) {
        throw const AdbFailure('refused', 'The TV did not answer like a debugging connection.');
      }
      if (length > _adbMaxData) {
        throw const AdbFailure('refused', 'The TV sent more than Orbit takes.');
      }
      if (data.length - offset - 24 < length) break;
      final payload = Uint8List.sublistView(data, offset + 24, offset + 24 + length);
      messages.add(AdbMessage(command, view.getUint32(4, Endian.little), view.getUint32(8, Endian.little), payload));
      offset += 24 + length;
    }
    _held = offset == 0 ? data : Uint8List.sublistView(data, offset);
    return messages;
  }

  static bool _looksLikeTls(Uint8List data) =>
      data.length >= 2 && (data[0] == 0x16 || data[0] == 0x15) && data[1] == 0x03;
}

/// A live classic-ADB connection: the handshake is done when [open] returns.
class AdbConnection {
  AdbConnection._(this._transport, this.maxData);

  final AdbTransport _transport;

  /// The most the device takes in one message (its CNXN arg1); writes are chunked to it.
  final int maxData;

  final _AdbReader _reader = _AdbReader();
  final Map<int, _AdbStream> _streams = {};
  int _nextLocalId = 1;
  bool _closed = false;
  StreamSubscription<Uint8List>? _subscription;

  /// Opens and hands back a connected ADB connection, or throws [AdbFailure].
  ///
  /// When the device does not know the key it asks again after the signature; the public key is then sent, which is
  /// what makes the TV show "Allow USB debugging?" — [onAuthWaiting] fires at that moment. The wait for the person to
  /// press Allow is given [allowTimeout]; the handshake as a whole is given [handshakeTimeout].
  static Future<AdbConnection> open(
    AdbTransport transport,
    AdbCrypto crypto, {
    void Function()? onAuthWaiting,
    Duration allowTimeout = const Duration(seconds: 90),
    Duration handshakeTimeout = const Duration(seconds: 10),
  }) async {
    final done = Completer<AdbConnection>();
    final reader = _AdbReader();
    var sentSignature = false;
    var sentPublicKey = false;
    var sawAnyMessage = false;
    AdbConnection? connection;
    Timer? allowTimer;

    void fail(AdbFailure failure) {
      if (!done.isCompleted) done.completeError(failure);
    }

    late StreamSubscription<Uint8List> subscription;

    Future<void> onMessage(AdbMessage message) async {
      switch (message.command) {
        case AdbCommand.auth when message.arg0 == _AdbAuth.token:
          if (!sentSignature) {
            sentSignature = true;
            final signature = await crypto.signToken(message.payload);
            if (done.isCompleted) return;
            transport.add(AdbMessage(AdbCommand.auth, _AdbAuth.signature, 0, signature).toBytes());
          } else if (!sentPublicKey) {
            sentPublicKey = true;
            final key = await crypto.publicKey();
            if (done.isCompleted) return;
            transport.add(
              AdbMessage(AdbCommand.auth, _AdbAuth.rsaPublicKey, 0, Uint8List.fromList(utf8.encode(key))).toBytes(),
            );
            allowTimer = Timer(allowTimeout, () {
              fail(const AdbFailure('timeout', 'The TV did not get a Yes in time. Try again.'));
            });
            onAuthWaiting?.call();
          }
        case AdbCommand.cnxn:
          allowTimer?.cancel();
          final device = AdbConnection._(transport, _maxDataOf(message.arg1));
          device._adopt(subscription);
          connection = device;
          if (!done.isCompleted) done.complete(device);
        default:
          // Anything else during the handshake is not something to act on.
          break;
      }
    }

    subscription = transport.incoming.listen(
      (chunk) {
        if (done.isCompleted) return;
        final List<AdbMessage> messages;
        try {
          messages = reader.add(chunk, anyMessageYet: sawAnyMessage);
        } on AdbFailure catch (failure) {
          fail(failure);
          return;
        }
        if (messages.isNotEmpty) sawAnyMessage = true;
        for (final message in messages) {
          unawaited(onMessage(message).catchError((Object e) {
            fail(AdbFailure('refused', 'The debugging connection failed: $e'));
          }));
        }
      },
      onError: (Object e) =>
          fail(const AdbFailure('unreachable', 'The TV is not answering on its debugging connection.')),
      onDone: () {
        allowTimer?.cancel();
        if (done.isCompleted) return;
        // The device closed the socket: after the public key, that is the person pressing Cancel.
        fail(
          sentPublicKey
              ? const AdbFailure('refused', 'The TV was told not to allow this phone.')
              : const AdbFailure('refused', 'The TV closed the debugging connection.'),
        );
      },
      cancelOnError: true,
    );

    transport.add(AdbMessage(AdbCommand.cnxn, _adbVersion, _adbMaxData, _banner()).toBytes());

    try {
      return await done.future.timeout(
        handshakeTimeout + allowTimeout,
        onTimeout: () => throw const AdbFailure('timeout', 'The TV did not answer its debugging connection in time.'),
      );
    } on AdbFailure {
      allowTimer?.cancel();
      if (connection == null) await subscription.cancel();
      rethrow;
    }
  }

  static Uint8List _banner() => Uint8List.fromList(utf8.encode('host::\u0000'));

  static int _maxDataOf(int fromDevice) {
    if (fromDevice <= 0 || fromDevice > _adbMaxData) return _adbMaxData;
    return fromDevice;
  }

  void _adopt(StreamSubscription<Uint8List> subscription) {
    _subscription = subscription;
    subscription.onData(_onData);
    subscription.onDone(_onDone);
    subscription.onError((Object _) => _onDone());
  }

  void _onData(Uint8List chunk) {
    if (_closed) return;
    final List<AdbMessage> messages;
    try {
      messages = _reader.add(chunk, anyMessageYet: true);
    } on AdbFailure {
      _onDone();
      return;
    }
    for (final message in messages) {
      _dispatch(message);
    }
  }

  void _onDone() {
    if (_closed) return;
    _closed = true;
    for (final stream in _streams.values.toList()) {
      stream._remoteClosed();
    }
    _streams.clear();
  }

  void _dispatch(AdbMessage message) {
    final stream = _streams[message.arg1];
    switch (message.command) {
      case AdbCommand.okay:
        stream?._onOkay(message.arg0);
      case AdbCommand.wrte:
        if (stream != null) {
          stream._received(message.payload);
          _send(AdbCommand.okay, stream.localId, stream.remoteId);
        }
      case AdbCommand.clse:
        stream?._remoteClosed();
    }
  }

  void _send(int command, int arg0, int arg1, [Uint8List? payload]) {
    if (_closed) return;
    _transport.add(AdbMessage(command, arg0, arg1, payload ?? Uint8List(0)).toBytes());
  }

  /// Opens a stream to [service] (for example `shell:pm list packages` or `sync:`) and waits for the device's OKAY.
  Future<_AdbStream> _openStream(String service) async {
    if (_closed) throw const AdbFailure('refused', 'The debugging connection is closed.');
    final localId = _nextLocalId++;
    final stream = _AdbStream(this, localId);
    _streams[localId] = stream;
    _send(AdbCommand.open, localId, 0, Uint8List.fromList([...utf8.encode(service), 0]));
    await stream._openedFuture;
    return stream;
  }

  /// Runs [cmd] through a legacy shell and returns its whole output (stdout and stderr together), at most [maxOut]
  /// bytes.
  Future<String> shell(String cmd, {Duration? timeout, int maxOut = 512 * 1024}) async {
    final stream = await _openStream('shell:$cmd');
    final out = BytesBuilder(copy: false);
    var over = false;
    stream.output.listen((chunk) {
      if (over) return;
      if (out.length + chunk.length > maxOut) {
        out.add(chunk.sublist(0, maxOut - out.length));
        over = true;
      } else {
        out.add(chunk);
      }
    });
    final run = stream.closed;
    await (timeout == null ? run : run.timeout(timeout, onTimeout: () => stream.close()));
    return utf8.decode(out.takeBytes(), allowMalformed: true);
  }

  /// Runs [cmd] through a legacy shell, calling [onLine] for each complete output line as it arrives, and returns the
  /// shell's exit code. The command is sent as `<cmd>; echo @orbit-exit $?`, and the sentinel line gives the code and
  /// is not passed to [onLine].
  Future<int> run(String cmd, void Function(String line) onLine) async {
    final stream = await _openStream('shell:$cmd; echo @orbit-exit \$?');
    var buffer = '';
    var exit = -1;
    void take(String line) {
      const marker = '@orbit-exit ';
      final at = line.indexOf(marker);
      if (at >= 0) {
        exit = int.tryParse(line.substring(at + marker.length).trim()) ?? -1;
        final before = line.substring(0, at).trimRight();
        if (before.isNotEmpty) onLine(before);
        return;
      }
      onLine(line);
    }

    stream.output.listen((chunk) {
      buffer += utf8.decode(chunk, allowMalformed: true);
      while (true) {
        final nl = buffer.indexOf('\n');
        if (nl < 0) break;
        take(buffer.substring(0, nl).replaceAll('\r', ''));
        buffer = buffer.substring(nl + 1);
      }
    });
    await stream.closed;
    if (buffer.trim().isNotEmpty) take(buffer.replaceAll('\r', ''));
    return exit;
  }

  /// Sync-pushes [bytes] to [path] on the device with file mode [mode] (0644), the number of bytes written back.
  Future<int> push(Uint8List bytes, String path, {int mode = 0x1a4}) async {
    final stream = await _openStream('sync:');
    try {
      final target = '$path,$mode';
      await stream.writeAll(_syncPacket('SEND', Uint8List.fromList(utf8.encode(target))));
      const chunkSize = 64 * 1024;
      for (var at = 0; at < bytes.length; at += chunkSize) {
        final end = at + chunkSize < bytes.length ? at + chunkSize : bytes.length;
        await stream.writeAll(_syncPacket('DATA', Uint8List.sublistView(bytes, at, end)));
      }
      final doneAt = ByteData(8);
      doneAt.setUint32(0, _syncId('DONE'), Endian.little);
      doneAt.setUint32(4, DateTime.now().millisecondsSinceEpoch ~/ 1000, Endian.little);
      // Start waiting for the device's sync reply before DONE goes out, so it is never missed in the race.
      final replyFuture = stream.readAtLeast(8);
      await stream.writeAll(doneAt.buffer.asUint8List());
      final reply = await replyFuture;
      final id = ByteData.sublistView(reply, 0, 4).getUint32(0, Endian.little);
      if (id != _syncId('OKAY')) {
        final length = ByteData.sublistView(reply, 4, 8).getUint32(0, Endian.little);
        final text = reply.length >= 8 + length
            ? utf8.decode(reply.sublist(8, 8 + length), allowMalformed: true)
            : 'the push failed';
        throw AdbFailure('refused', 'The TV would not take the file: $text');
      }
      return bytes.length;
    } finally {
      stream.close();
    }
  }

  /// `id` + little-endian length + body, the shape of a sync SEND/DATA request.
  static Uint8List _syncPacket(String id, Uint8List body) {
    final out = Uint8List(8 + body.length);
    final view = ByteData.sublistView(out);
    view.setUint32(0, _syncId(id), Endian.little);
    view.setUint32(4, body.length, Endian.little);
    out.setRange(8, out.length, body);
    return out;
  }

  static int _syncId(String id) {
    final b = ascii.encode(id);
    return b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24);
  }

  /// Closes the connection and its streams.
  Future<void> close() async {
    if (_closed) {
      await _subscription?.cancel();
      await _transport.close();
      return;
    }
    _closed = true;
    for (final stream in _streams.values.toList()) {
      stream._remoteClosed();
    }
    _streams.clear();
    await _subscription?.cancel();
    await _transport.close();
  }

  void _removeStream(int localId) => _streams.remove(localId);
}

/// One ADB stream (a shell, a sync). Flow control: the device OKAYs each WRTE it takes, so the next WRTE waits for it.
class _AdbStream {
  _AdbStream(this._connection, this.localId);

  final AdbConnection _connection;
  final int localId;
  int remoteId = 0;

  final Completer<void> _opened = Completer<void>();
  final Completer<void> _closed = Completer<void>();
  final StreamController<Uint8List> _output = StreamController<Uint8List>();
  final BytesBuilder _readBuffer = BytesBuilder(copy: false);
  Completer<void>? _writeAck;
  Completer<void>? _readWaiter;
  int _readWant = 0;
  bool _done = false;

  Future<void> get _openedFuture => _opened.future;

  /// The bytes the device sent on this stream.
  Stream<Uint8List> get output => _output.stream;

  /// Completes when the stream closes (the device's CLSE, or [close]).
  Future<void> get closed => _closed.future;

  void _onOkay(int remote) {
    if (_opened.isCompleted) {
      // A later OKAY is the device acknowledging one of our WRTEs.
      _writeAck?.complete();
      _writeAck = null;
      return;
    }
    remoteId = remote;
    _opened.complete();
  }

  void _received(Uint8List payload) {
    if (_done) return;
    if (_readWaiter != null) {
      _readBuffer.add(payload);
      if (_readBuffer.length >= _readWant && !_readWaiter!.isCompleted) _readWaiter!.complete();
      return;
    }
    if (!_output.isClosed) _output.add(payload);
  }

  /// Writes [bytes] to the device, chunked to its maxData, each chunk waiting for the OKAY before the next.
  Future<void> writeAll(Uint8List bytes) async {
    final max = _connection.maxData;
    for (var at = 0; at < bytes.length || (at == 0 && bytes.isEmpty); at += max) {
      final end = at + max < bytes.length ? at + max : bytes.length;
      final ack = _writeAck = Completer<void>();
      _connection._send(AdbCommand.wrte, localId, remoteId, Uint8List.sublistView(bytes, at, end));
      await ack.future;
      if (bytes.isEmpty) break;
    }
  }

  /// Reads at least [count] bytes the device sends on this stream (used for a sync reply). Returns what it has when
  /// the stream closes first.
  Future<Uint8List> readAtLeast(int count, {Duration timeout = const Duration(seconds: 10)}) async {
    if (_readBuffer.length < count && !_done) {
      _readWant = count;
      final waiter = _readWaiter = Completer<void>();
      try {
        await waiter.future.timeout(timeout, onTimeout: () {});
      } finally {
        _readWaiter = null;
      }
    }
    return _readBuffer.takeBytes();
  }

  void _remoteClosed() {
    if (_done) return;
    _done = true;
    _connection._removeStream(localId);
    if (!_opened.isCompleted) _opened.complete();
    _writeAck?.complete();
    _writeAck = null;
    if (_readWaiter != null && !_readWaiter!.isCompleted) _readWaiter!.complete();
    if (!_output.isClosed) unawaited(_output.close());
    if (!_closed.isCompleted) _closed.complete();
  }

  /// Closes our side of the stream.
  void close() {
    if (_done) return;
    _connection._send(AdbCommand.clse, localId, remoteId);
    _remoteClosed();
  }
}
