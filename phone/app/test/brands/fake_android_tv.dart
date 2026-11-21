// A fake Google TV for android_tv_test.dart: the Android TV Remote Service's two TLS doors on 127.0.0.1 (pairing and
// remote), speaking atv_proto.dart's wire codec, with certificates the openssl CLI makes for each run. The fake reads
// the RSA numbers from openssl's own output, not from der.dart, so its pairing check is independent of the driver's.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:orbit/tv/brands/android_tv.dart';
import 'package:orbit/tv/brands/atv_proto.dart';

/// A certificate and key made by openssl, with the modulus and exponent openssl read out of it.
class TestCert {
  TestCert({required this.certPem, required this.keyPem, required this.modulus, required this.exponent});

  final String certPem;
  final String keyPem;

  /// Unsigned big-endian, no leading zeros: the form the pairing hash takes.
  final Uint8List modulus;
  final Uint8List exponent;

  RemoteCredentials get credentials => RemoteCredentials(certPem: certPem, keyPem: keyPem);

  /// The certificate's DER, decoded here (not with der.dart).
  Uint8List get der {
    final body = certPem.split('\n').where((line) => line.isNotEmpty && !line.startsWith('-----')).join();
    return base64.decode(body);
  }
}

/// Makes an RSA-2048 key and a self-signed certificate with [commonName] in [dir] with the openssl CLI.
Future<TestCert> makeCert(Directory dir, String name, String commonName) async {
  final config = File('${dir.path}/$name.cnf')
    ..writeAsStringSync('[req]\ndistinguished_name = dn\nprompt = no\n[dn]\nCN = $commonName\n');
  final key = '${dir.path}/$name.key';
  final cert = '${dir.path}/$name.crt';
  await _openssl([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '30',
    '-config',
    config.path,
  ]);
  final modulus = (await _openssl(['x509', '-in', cert, '-noout', '-modulus'])).trim();
  final text = await _openssl(['x509', '-in', cert, '-noout', '-text']);
  final exponent = RegExp(r'Exponent: (\d+)').firstMatch(text);
  if (!modulus.startsWith('Modulus=') || exponent == null) throw StateError('openssl did not show the key');
  return TestCert(
    certPem: File(cert).readAsStringSync(),
    keyPem: File(key).readAsStringSync(),
    modulus: unsignedBytes(BigInt.parse(modulus.substring('Modulus='.length), radix: 16)),
    exponent: unsignedBytes(BigInt.parse(exponent.group(1)!)),
  );
}

Future<String> _openssl(List<String> args) async {
  final result = await Process.run('openssl', args);
  if (result.exitCode != 0) throw StateError('openssl ${args.first} failed: ${result.stderr}');
  return result.stdout as String;
}

/// [value] as unsigned big-endian bytes without leading zeros (Python's int.to_bytes((bit_length + 7) // 8)).
Uint8List unsignedBytes(BigInt value) {
  final hex = value.toRadixString(16);
  final even = hex.length.isOdd ? '0$hex' : hex;
  if (value == BigInt.zero) return Uint8List(0);
  return Uint8List.fromList([for (var i = 0; i < even.length; i += 2) int.parse(even.substring(i, i + 2), radix: 16)]);
}

/// The pairing hash the TV expects, computed here on its own from openssl's numbers.
Uint8List tvSideSecret(TestCert phone, TestCert tv, List<int> nonce) => Uint8List.fromList(
  sha256.convert([...phone.modulus, ...phone.exponent, ...tv.modulus, ...tv.exponent, ...nonce]).bytes,
);

String hex(List<int> bytes) => [for (final b in bytes) b.toRadixString(16).padLeft(2, '0')].join().toUpperCase();

/// Builds a RemoteMessage the TV sends: [field] set to [body].
Uint8List tvMessage(int field, ProtoWriter body) => (ProtoWriter()..message(field, body)).toBytes();

/// Both doors of a Google TV, on loopback.
class FakeAndroidTv {
  FakeAndroidTv._(this.tv, this._canPair, this._remoteContext, this._pairingServer, this._remoteServer);

  /// [canPair]: the phones the pairing door lets in (a real TV takes any; Dart's TLS server must be told whom to
  /// trust). [paired]: phones the remote door takes from the start. [features]: the TV's code1. [silent]: the remote
  /// door completes TLS and then says nothing.
  static Future<FakeAndroidTv> start({
    required TestCert tv,
    required List<TestCert> canPair,
    List<TestCert> paired = const [],
    int features = 623,
    bool on = true,
    bool silent = false,
  }) async {
    SecurityContext context() => SecurityContext(withTrustedRoots: false)
      ..useCertificateChainBytes(utf8.encode(tv.certPem))
      ..usePrivateKeyBytes(utf8.encode(tv.keyPem));
    final pairingContext = context();
    for (final phone in canPair) {
      pairingContext.setTrustedCertificatesBytes(utf8.encode(phone.certPem));
    }
    final remoteContext = context();
    for (final phone in paired) {
      remoteContext.setTrustedCertificatesBytes(utf8.encode(phone.certPem));
    }
    final pairingServer = await SecureServerSocket.bind(
      InternetAddress.loopbackIPv4,
      0,
      pairingContext,
      requestClientCertificate: true,
    );
    final remoteServer = await SecureServerSocket.bind(
      InternetAddress.loopbackIPv4,
      0,
      remoteContext,
      requestClientCertificate: true,
    );
    final fake = FakeAndroidTv._(tv, canPair, remoteContext, pairingServer, remoteServer)
      ..features = features
      ..on = on
      ..silent = silent;
    fake.paired.addAll(paired);
    fake._serve();
    return fake;
  }

  final TestCert tv;
  final List<TestCert> _canPair;
  final SecurityContext _remoteContext;
  final SecureServerSocket _pairingServer;
  final SecureServerSocket _remoteServer;

  int features = 623;
  bool on = true;
  bool silent = false;

  int get pairingPort => _pairingServer.port;
  int get remotePort => _remoteServer.port;

  // ---- pairing ----

  /// The code on the TV's screen, once the configuration came.
  String? code;

  /// Secrets the phone sent, and the ones that matched.
  int secretsReceived = 0;
  final List<TestCert> paired = [];

  /// What went against the protocol on the pairing door (empty when all was right).
  final List<String> pairingProblems = [];

  /// The names in the phone's pairing request.
  String? serviceName;
  String? clientName;

  SecureSocket? _pairingSocket;

  /// The person pressed Cancel on the TV: the pairing connection closes.
  void cancelPairing() => _pairingSocket?.destroy();

  // ---- remote ----

  /// TLS handshakes the remote door turned away (an unpaired certificate).
  int refused = 0;
  int remoteConnections = 0;

  /// The phone's answers inside the handshake, as sent.
  Uint8List? phoneConfigure;
  Uint8List? phoneSetActive;

  SecureSocket? _remoteSocket;
  final List<Uint8List> _fromPhone = [];
  Completer<void>? _arrived;

  /// The next message the phone sent after the handshake, as sent.
  Future<Uint8List> nextFromPhone({Duration within = const Duration(seconds: 2)}) async {
    final deadline = DateTime.now().add(within);
    while (_fromPhone.isEmpty) {
      final left = deadline.difference(DateTime.now());
      if (left <= Duration.zero) throw TimeoutException('the phone sent nothing');
      final arrived = _arrived ??= Completer<void>();
      await arrived.future.timeout(left, onTimeout: () {});
    }
    return _fromPhone.removeAt(0);
  }

  /// Whatever the phone sent after the handshake so far, taken.
  List<Uint8List> takeFromPhone() {
    final all = List<Uint8List>.of(_fromPhone);
    _fromPhone.clear();
    return all;
  }

  void sendToPhone(Uint8List message) => _remoteSocket?.add(frame(message));

  /// The connection drops (the TV went away).
  void dropRemote() => _remoteSocket?.destroy();

  Future<void> close() async {
    _pairingSocket?.destroy();
    _remoteSocket?.destroy();
    await _pairingServer.close();
    await _remoteServer.close();
  }

  void _serve() {
    _pairingServer.listen(_onPairing, onError: (Object _) {});
    _remoteServer.listen(
      _onRemote,
      // A handshake error here is the door turning a certificate away.
      onError: (Object _) => refused++,
    );
  }

  TestCert? _phoneOf(SecureSocket socket) {
    final der = socket.peerCertificate?.der;
    if (der == null) return null;
    for (final phone in _canPair) {
      if (_same(phone.der, der)) return phone;
    }
    return null;
  }

  void _onPairing(SecureSocket socket) {
    _pairingSocket = socket;
    final phone = _phoneOf(socket);
    final frames = FrameReader();
    Uint8List? expected;
    void reply(int status, [int? step, ProtoWriter? body]) {
      final m = ProtoWriter()
        ..varint(1, 2)
        ..varint(2, status);
      if (step != null) m.message(step, body ?? ProtoWriter());
      socket.add(frame(m.toBytes()));
    }

    // An error answer, then the end of the pairing (close, not destroy: the answer must reach the phone first).
    void fail(String why) {
      pairingProblems.add(why);
      reply(PoloStatus.error);
      unawaited(socket.close());
    }

    socket.listen(
      (data) {
        for (final raw in frames.add(data)) {
          final m = ProtoMessage.decode(raw);
          if (m.uint32(1) != 2 || m.uint32(2) != 200) return fail('version or status');
          if (phone == null) return fail('a certificate the fake does not know');
          if (m.message(10) case final request?) {
            serviceName = request.string(1);
            clientName = request.string(2);
            reply(200, 11, ProtoWriter()..string(1, 'Fake TV'));
          } else if (m.message(20) case final options?) {
            final encodings = options.messages(1);
            if (encodings.length != 1 || encodings.first.uint32(1) != 3 || encodings.first.uint32(2) != 6) {
              return fail('options encoding');
            }
            if (options.uint32(3) != 1) return fail('options role');
            reply(
              200,
              20,
              ProtoWriter()
                ..message(
                  2,
                  ProtoWriter()
                    ..varint(1, 3)
                    ..varint(2, 6),
                )
                ..varint(3, 1),
            );
          } else if (m.message(30) case final configuration?) {
            final encoding = configuration.message(1);
            if (encoding == null || encoding.uint32(1) != 3 || encoding.uint32(2) != 6) {
              return fail('configuration encoding');
            }
            if (configuration.uint32(2) != 1) return fail('configuration role');
            final random = Random.secure();
            final nonce = [random.nextInt(256), random.nextInt(256)];
            expected = tvSideSecret(phone, tv, nonce);
            code = hex([expected![0], ...nonce]);
            reply(200, 31);
          } else if (m.message(40) case final secret?) {
            secretsReceived++;
            final sent = secret.bytes(1);
            final want = expected;
            if (want == null || !_same(sent, want)) {
              reply(PoloStatus.badSecret);
              unawaited(socket.close());
              return;
            }
            paired.add(phone);
            _remoteContext.setTrustedCertificatesBytes(utf8.encode(phone.certPem));
            reply(200, 41, ProtoWriter()..bytes(1, want));
          } else {
            return fail('an unknown pairing message');
          }
        }
      },
      onError: (Object _) {},
      onDone: socket.destroy,
    );
  }

  void _onRemote(SecureSocket socket) {
    remoteConnections++;
    _remoteSocket = socket;
    final frames = FrameReader();
    var stage = 0;
    socket.listen(
      (data) {
        for (final raw in frames.add(data)) {
          final m = ProtoMessage.decode(raw);
          if (stage == 0 && m.has(1)) {
            phoneConfigure = raw;
            stage = 1;
            sendToPhone(tvMessage(2, ProtoWriter()));
          } else if (stage == 1 && m.has(2)) {
            phoneSetActive = raw;
            stage = 2;
            sendToPhone(tvMessage(40, ProtoWriter()..boolean(1, on)));
          } else {
            _fromPhone.add(raw);
            final arrived = _arrived;
            _arrived = null;
            arrived?.complete();
          }
        }
      },
      onError: (Object _) {},
      onDone: socket.destroy,
    );
    if (silent) return;
    sendToPhone(
      tvMessage(
        1,
        ProtoWriter()
          ..varint(1, features)
          ..message(
            2,
            ProtoWriter()
              ..string(1, 'Fake TV')
              ..string(2, 'Orbit tests')
              ..varint(3, 1)
              ..string(4, '1')
              ..string(5, 'androidtv-remote')
              ..string(6, '5.0'),
          ),
      ),
    );
  }
}

bool _same(List<int> a, List<int> b) {
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

/// The phone's identity from files made for the test.
class FileIdentity implements RemoteIdentity {
  FileIdentity(this.cert);

  final TestCert cert;
  int loads = 0;

  @override
  Future<RemoteCredentials> load() async {
    loads++;
    return cert.credentials;
  }
}

/// An identity the platform could not make.
class BrokenIdentity implements RemoteIdentity {
  @override
  Future<RemoteCredentials> load() async => throw StateError('no keystore');
}
