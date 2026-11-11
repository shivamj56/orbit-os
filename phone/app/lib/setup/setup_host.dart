import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import '../tv/models.dart';
import 'adb.dart';
import 'setup_scan.dart';

/// Why a setup op failed, in the words phone/SPEC.md's `setupConnect` uses: `{"ok":false,"reason":…}`. The bridge
/// turns it into that reply (unlike [OpError], which carries a `status`).
class SetupError implements Exception {
  const SetupError(this.reason, this.message);

  /// One of `unreachable`, `refused`, `timeout`, `tls`.
  final String reason;
  final String message;

  @override
  String toString() => 'SetupError($reason, $message)';
}

/// What Orbit Setup needs from the phone: find TVs, open the TV's debugging connection, move files, and remember one
/// record per TV (phone/SPEC.md, "Orbit Setup"). One ADB connection at a time.
///
/// Behind an interface so the bridge can be tested with a fake, the way [NativeHost] is.
abstract interface class SetupHost {
  /// The TV is waiting for the person to press "Allow USB debugging?" (emit `setupAuth {"state":"waiting"}`).
  set onAuthWaiting(void Function()? handler);

  /// A line of output from [run] (emit `setupLine {"line":…}`).
  set onLine(void Function(String line)? handler);

  /// `setupScan`: the merged TVs, `{"tvs":[…]}`.
  Future<Map<String, Object?>> scan(Duration window);

  /// `setupProbe`: a TCP connect, closed at once, `{"open":bool}`.
  Future<Map<String, Object?>> probe(String address, int port);

  /// `setupConnect`: open ADB and read `getprop`. Throws [SetupError] on failure.
  Future<Map<String, Object?>> connect(String address, int port);

  /// `setupShell`: one command, `{"out":…}`.
  Future<Map<String, Object?>> shell(String cmd, Duration timeout);

  /// `setupPush` from a bundled asset, `{"bytes":n}`.
  Future<Map<String, Object?>> pushAsset(String asset, String to);

  /// `setupPush` from text, `{"bytes":n}`.
  Future<Map<String, Object?>> pushText(String text, String to);

  /// `setupRun`: stream lines, `{"exit":code}`.
  Future<Map<String, Object?>> run(String cmd);

  /// `setupClose`: close the connection.
  Future<Map<String, Object?>> close();

  /// `setupRecord` load, `{"record":{…}|null}`.
  Future<Map<String, Object?>> recordLoad(String key);

  /// `setupRecord` save, `{"record":{…}}`.
  Future<Map<String, Object?>> recordSave(String key, Map<String, Object?> record);
}

/// The bundled files `setupPush` may send (phone/SPEC.md, "Bundled files").
const Set<String> kSetupAssets = {'orbit-home.apk', 'orbit-live.apk', 'orbit-setup.sh', 'orbit-undo.sh'};

/// The `setupConnect` reply read from `getprop` output (`[key]: [value]` lines).
Map<String, Object?> parseGetprop(String out) {
  final props = <String, String>{};
  final line = RegExp(r'^\[(.+?)\]:\s*\[(.*)\]$');
  for (final raw in out.split('\n')) {
    final match = line.firstMatch(raw.trim());
    if (match != null) props[match.group(1)!] = match.group(2)!;
  }
  String? at(String key) {
    final value = props[key];
    return value != null && value.trim().isNotEmpty ? value.trim() : null;
  }

  return {
    'model': at('ro.product.model'),
    'manufacturer': at('ro.product.manufacturer'),
    'brand': at('ro.product.brand'),
    'device': at('ro.product.device'),
    'sdk': int.tryParse(props['ro.build.version.sdk'] ?? ''),
    'release': at('ro.build.version.release'),
  };
}

/// [SetupHost] on a real phone: a Socket for ADB, package:nsd for the scan, the app's assets for push, a file in app
/// storage for records, and platform crypto for the RSA key.
class PlatformSetupHost implements SetupHost {
  PlatformSetupHost({
    this.scanner = const PluginSetupScanner(),
    AdbCrypto? crypto,
    AssetBundle? assets,
    Future<Directory> Function()? storage,
  }) : _crypto = crypto ?? const PlatformAdbCrypto(),
       _assets = assets ?? rootBundle,
       _storage = storage ?? getApplicationSupportDirectory;

  final SetupScanner scanner;
  final AdbCrypto _crypto;
  final AssetBundle _assets;
  final Future<Directory> Function() _storage;

  void Function()? _onAuthWaiting;
  void Function(String line)? _onLine;
  AdbConnection? _connection;
  Future<void> _records = Future<void>.value();

  @override
  set onAuthWaiting(void Function()? handler) => _onAuthWaiting = handler;

  @override
  set onLine(void Function(String line)? handler) => _onLine = handler;

  @override
  Future<Map<String, Object?>> scan(Duration window) async {
    final services = await scanner.scan(window);
    return {'tvs': mergeScan(services)};
  }

  @override
  Future<Map<String, Object?>> probe(String address, int port) async {
    try {
      final socket = await Socket.connect(address, port, timeout: const Duration(milliseconds: 1500));
      socket.destroy();
      return {'open': true};
    } on Object {
      return {'open': false};
    }
  }

  @override
  Future<Map<String, Object?>> connect(String address, int port) async {
    await close();
    final Socket socket;
    try {
      socket = await Socket.connect(address, port, timeout: const Duration(seconds: 5));
    } on Object {
      throw const SetupError('unreachable', 'The TV is not answering on its debugging connection. Is it on?');
    }
    socket.setOption(SocketOption.tcpNoDelay, true);
    final transport = _SocketTransport(socket);
    final AdbConnection connection;
    try {
      connection = await AdbConnection.open(transport, _crypto, onAuthWaiting: () => _onAuthWaiting?.call());
    } on SetupError {
      await transport.close();
      rethrow;
    } on AdbFailure catch (e) {
      await transport.close();
      throw SetupError(e.reason, e.message);
    } on Object catch (e) {
      await transport.close();
      throw SetupError('refused', 'The debugging connection failed: $e');
    }
    _connection = connection;
    try {
      return await _readProps(connection);
    } on Object {
      await close();
      rethrow;
    }
  }

  Future<Map<String, Object?>> _readProps(AdbConnection connection) async =>
      parseGetprop(await connection.shell('getprop', timeout: const Duration(seconds: 15)));

  @override
  Future<Map<String, Object?>> shell(String cmd, Duration timeout) async {
    final out = await _require().shell(cmd, timeout: timeout);
    return {'out': out};
  }

  @override
  Future<Map<String, Object?>> pushAsset(String asset, String to) async {
    if (!kSetupAssets.contains(asset)) throw const OpError(400, 'That is not a file Orbit can install.');
    final ByteData data;
    try {
      data = await _assets.load('assets/setup/$asset');
    } on Object {
      throw OpError(500, 'Orbit is missing $asset. Rebuild the app with tool/sync_setup.sh.');
    }
    return _push(data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes), to);
  }

  @override
  Future<Map<String, Object?>> pushText(String text, String to) => _push(Uint8List.fromList(utf8.encode(text)), to);

  Future<Map<String, Object?>> _push(Uint8List bytes, String to) async {
    final bytesWritten = await _require().push(bytes, to);
    return {'bytes': bytesWritten};
  }

  @override
  Future<Map<String, Object?>> run(String cmd) async {
    final exit = await _require().run(cmd, (line) => _onLine?.call(line));
    return {'exit': exit};
  }

  @override
  Future<Map<String, Object?>> close() async {
    final connection = _connection;
    _connection = null;
    if (connection != null) {
      try {
        await connection.close();
      } on Object catch (e) {
        debugPrint('orbit: setup close: $e');
      }
    }
    return const <String, Object?>{};
  }

  @override
  Future<Map<String, Object?>> recordLoad(String key) async {
    final all = await _loadRecords();
    final record = all[key];
    return {'record': record is Map ? record : null};
  }

  @override
  Future<Map<String, Object?>> recordSave(String key, Map<String, Object?> record) async {
    final result = <String, Object?>{'record': record};
    _records = _records.then((_) async {
      final all = await _loadRecords();
      all[key] = record;
      final dir = await _storage();
      final file = File('${dir.path}/orbit-setup-records.json');
      await file.writeAsString(jsonEncode(all), flush: true);
    }).catchError((Object e) => debugPrint('orbit: setup record not saved: $e'));
    await _records;
    return result;
  }

  Future<Map<String, Object?>> _loadRecords() async {
    try {
      final dir = await _storage();
      final file = File('${dir.path}/orbit-setup-records.json');
      if (!file.existsSync()) return {};
      final decoded = jsonDecode(await file.readAsString());
      return decoded is Map ? {for (final e in decoded.entries) '${e.key}': e.value} : {};
    } on Object catch (e) {
      debugPrint('orbit: setup records unreadable: $e');
      return {};
    }
  }

  AdbConnection _require() {
    final connection = _connection;
    if (connection == null) throw const OpError(409, 'Connect to the TV first.');
    return connection;
  }
}

/// An [AdbTransport] over a real TCP socket.
class _SocketTransport implements AdbTransport {
  _SocketTransport(this._socket);

  final Socket _socket;

  @override
  Stream<Uint8List> get incoming => _socket;

  @override
  void add(List<int> bytes) => _socket.add(bytes);

  @override
  Future<void> close() async {
    try {
      _socket.destroy();
    } on Object {
      // already gone
    }
  }
}

/// [AdbCrypto] through a MethodChannel to the Android side, which makes and keeps the 2048-bit RSA key in the app's
/// private storage and does the signing with the platform's own crypto (so no key material crosses into Dart).
class PlatformAdbCrypto implements AdbCrypto {
  const PlatformAdbCrypto();

  static const MethodChannel _channel = MethodChannel('dev.shiv.orbit/adbkey');

  @override
  Future<Uint8List> signToken(Uint8List token) async {
    final signature = await _channel.invokeMethod<Uint8List>('sign', token);
    if (signature == null) throw const AdbFailure('refused', 'The phone could not sign the debugging token.');
    return signature;
  }

  @override
  Future<String> publicKey() async {
    final key = await _channel.invokeMethod<String>('publicKey');
    if (key == null || key.isEmpty) throw const AdbFailure('refused', 'The phone has no debugging key.');
    return key;
  }
}
