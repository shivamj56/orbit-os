/// LG (webOS): the TV's own remote-control service, SSAP over WebSocket, the one LG's phone app uses.
///
/// The protocol was learned from aiowebostv (home-assistant-libs, Apache-2.0); this is a fresh implementation in Dart.
/// The phone opens `wss://TV:3001/` (older sets only have `ws://TV:3000/`), registers once (the TV shows an Accept
/// prompt and hands back a client key to keep), then sends requests (`ssap://…`). Arrows and the pointer travel on a
/// second socket the TV hands out on request (the "pointer input socket"), as plain text frames.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'brand.dart';

/// LG's registration manifest, copied unchanged from aiowebostv (aiowebostv/handshake.py, Apache-2.0; the signature is
/// LG's own test-signing one, which is what every third-party remote uses). The TV shows "LG Remote App" in its
/// prompt. Newer firmware refuses the signed form; [LgTv] then sends the same manifest unsigned, as aiowebostv does.
const String _signature =
    'eyJhbGdvcml0aG0iOiJSU0EtU0hBMjU2Iiwia2V5SWQiOiJ0ZXN0LXNpZ25pbm'
    'ctY2VydCIsInNpZ25hdHVyZVZlcnNpb24iOjF9.hrVRgjCwXVvE2OOSpDZ58hR'
    '+59aFNwYDyjQgKk3auukd7pcegmE2CzPCa0bJ0ZsRAcKkCTJrWo5iDzNhMBWRy'
    'aMOv5zWSrthlf7G128qvIlpMT0YNY+n/FaOHE73uLrS/g7swl3/qH/BGFG2Hu4'
    'RlL48eb3lLKqTt2xKHdCs6Cd4RMfJPYnzgvI4BNrFUKsjkcu+WD4OO2A27Pq1n'
    '50cMchmcaXadJhGrOqH5YmHdOCj5NSHzJYrsW0HPlpuAx/ECMeIZYDh6RMqaFM'
    '2DXzdKX9NmmyqzJ3o/0lkk/N97gfVRLW5hA29yeAwaCViZNCP8iC9aO0q9fQoj'
    'oa7NQnAtw==';

const List<String> _manifestPermissions = [
  'LAUNCH',
  'LAUNCH_WEBAPP',
  'APP_TO_APP',
  'CLOSE',
  'TEST_OPEN',
  'TEST_PROTECTED',
  'CONTROL_AUDIO',
  'CONTROL_DISPLAY',
  'CONTROL_INPUT_JOYSTICK',
  'CONTROL_INPUT_MEDIA_RECORDING',
  'CONTROL_INPUT_MEDIA_PLAYBACK',
  'CONTROL_INPUT_TV',
  'CONTROL_POWER',
  'CONTROL_TV_SCREEN',
  'READ_APP_STATUS',
  'READ_CURRENT_CHANNEL',
  'READ_INPUT_DEVICE_LIST',
  'READ_NETWORK_STATE',
  'READ_RUNNING_APPS',
  'READ_TV_CHANNEL_LIST',
  'WRITE_NOTIFICATION_TOAST',
  'READ_POWER_STATE',
  'READ_COUNTRY_INFO',
  'CONTROL_INPUT_TEXT',
  'CONTROL_MOUSE_AND_KEYBOARD',
  'READ_INSTALLED_APPS',
  'READ_SETTINGS',
];

const List<String> _signedPermissions = [
  'TEST_SECURE',
  'CONTROL_INPUT_TEXT',
  'CONTROL_MOUSE_AND_KEYBOARD',
  'READ_INSTALLED_APPS',
  'READ_LGE_SDX',
  'READ_NOTIFICATIONS',
  'SEARCH',
  'WRITE_SETTINGS',
  'WRITE_NOTIFICATION_ALERT',
  'CONTROL_POWER',
  'READ_CURRENT_CHANNEL',
  'READ_RUNNING_APPS',
  'READ_UPDATE_INFO',
  'UPDATE_FROM_REMOTE_APP',
  'READ_LGE_TV_INPUT_EVENTS',
  'READ_TV_CURRENT_TIME',
];

Map<String, Object?> _manifest({required bool signed}) => {
  'appVersion': '1.1',
  'manifestVersion': 1,
  'permissions': signed ? _manifestPermissions : ({..._manifestPermissions, ..._signedPermissions}.toList()..sort()),
  if (signed) ...{
    'signatures': [
      {'signature': _signature, 'signatureVersion': 1},
    ],
    'signed': {
      'appId': 'com.lge.test',
      'created': '20140509',
      'localizedAppNames': {'': 'LG Remote App', 'ko-KR': '리모컨 앱', 'zxx-XX': 'ЛГ Rэмotэ AПП'},
      'localizedVendorNames': {'': 'LG Electronics'},
      'permissions': _signedPermissions,
      'serial': '2f930e2d2cfe083771f68e4fe7bb07',
      'vendorId': 'com.lge',
    },
  },
};

// The only sentences this file shows a person. The page translates them by exact text, so none holds a value.
const String _msgAccept = 'Press Accept on the TV to let Orbit control it.';
const String _msgDenied = 'The TV said no. To try again, choose it again and accept on the TV.';
const String _msgFailed = 'The TV could not do that.';
const String _msgSilent = 'The TV did not answer.';

/// The pointer socket's name for each remote key. `MENU` is the one LG's own remote sends for its settings/quick menu.
const Map<String, String> _buttons = {
  RemoteKey.up: 'UP',
  RemoteKey.down: 'DOWN',
  RemoteKey.left: 'LEFT',
  RemoteKey.right: 'RIGHT',
  RemoteKey.ok: 'ENTER',
  RemoteKey.back: 'BACK',
  RemoteKey.home: 'HOME',
  RemoteKey.settings: 'MENU',
};

/// An LG webOS TV at [address].
///
/// [secret] is LG's client key (kept after the first Accept on the TV). The ports are parameters so tests can run a
/// fake TV on loopback; the TV's own are 3001 (wss) and 3000 (ws).
class LgTv extends BrandTv {
  LgTv({
    required this.address,
    String? secret,
    this.securePort = 3001,
    this.plainPort = 3000,
    this.allowWait = const Duration(seconds: 40),
    this.timeout = const Duration(seconds: 4),
    // ignore: prefer_initializing_formals
  }) : _secret = secret;

  @override
  final String address;

  final int securePort;
  final int plainPort;

  /// How long the TV's Accept prompt is waited for.
  final Duration allowWait;

  /// How long one connection attempt or one answer is waited for.
  final Duration timeout;

  String? _secret;
  String? _mac;

  WebSocket? _ws;
  bool _ready = false;
  bool _closing = false;
  Future<void>? _connecting;
  int _nextId = 1;
  final Map<String, Completer<Map<String, Object?>>> _pending = {};
  final Map<String, void Function(Map<String, Object?>)> _subs = {};
  final Set<String> _subSeen = {};
  final List<Map<String, Object?>> _regQueue = [];
  Completer<Map<String, Object?>>? _regWaiter;

  WebSocket? _input;
  Future<WebSocket>? _inputOpening;

  final Map<String, String> _labels = {};
  final Map<String, String> _iconUrls = {};
  bool _playing = true;

  @override
  TvKind get kind => TvKind.lg;

  @override
  PairingWay get pairingWay => PairingWay.allow;

  @override
  Set<String> get caps => const {
    Cap.keys,
    Cap.volume,
    Cap.mute,
    Cap.volumeLevel,
    Cap.media,
    Cap.type,
    Cap.apps,
    Cap.launch,
    Cap.power,
    Cap.pointer,
    Cap.settings,
    Cap.nowPlaying,
  };

  /// LG's client key, once the TV has given one.
  @override
  String? get secret => _secret;

  /// The TV's MAC address, read after [connect], for waking it with Wake-on-LAN later. Null until known.
  @override
  String? get mac => _mac;

  @override
  bool get isOpen => _ready && _ws != null;

  // ---- connection ----

  @override
  Future<void> connect() {
    if (isOpen) return Future.value();
    return _connecting ??= _connect().whenComplete(() => _connecting = null);
  }

  Future<void> _connect() async {
    _closing = false;
    await _teardown();
    final ws = await _openMain();
    _ws = ws;
    ws.listen(
      (data) => _onMessage(ws, data),
      onDone: () => _onMainDone(ws),
      onError: (Object _) {},
      cancelOnError: false,
    );
    try {
      await _register();
    } catch (_) {
      await _teardown();
      rethrow;
    }
    _ready = true;
    await _learn();
  }

  /// wss first (every webOS 4+ set), then plain ws. The certificate is the TV's own and self-signed, so it is accepted
  /// here and only for this address.
  Future<WebSocket> _openMain() async {
    Object? last;
    for (final url in ['wss://$address:$securePort/', 'ws://$address:$plainPort/']) {
      try {
        return await _dial(url);
      } catch (e) {
        last = e;
      }
    }
    throw BrandUnreachable(last);
  }

  Future<WebSocket> _dial(String url) async {
    final client = HttpClient()..badCertificateCallback = (cert, host, port) => host == address;
    try {
      return await WebSocket.connect(url, customClient: client).timeout(timeout);
    } finally {
      client.close();
    }
  }

  Future<void> _register() async {
    var signed = true;
    _sendRegister(signed: signed);
    var reply = await _nextRegister(timeout, silent: () => const BrandUnreachable('no answer'));
    if (reply['type'] == 'error' && signed) {
      // Newer firmware refuses LG's signed manifest: the same one unsigned is accepted.
      signed = false;
      _sendRegister(signed: signed);
      reply = await _nextRegister(timeout, silent: () => const BrandUnreachable('no answer'));
    }
    if (reply['type'] == 'response' && _map(reply['payload'])?['pairingType'] == 'PROMPT') {
      // The TV is showing its prompt; the person has to press Accept with the TV's own remote.
      reply = await _nextRegister(allowWait, silent: () => const BrandRefused(BrandRefused.timeout, _msgAccept));
    }
    if (reply['type'] == 'registered') {
      final key = _map(reply['payload'])?['client-key'];
      if (key is String && key.isNotEmpty) _secret = key;
      if (_secret != null) return;
    }
    throw const BrandRefused(BrandRefused.denied, _msgDenied);
  }

  void _sendRegister({required bool signed}) {
    _ws!.add(
      jsonEncode({
        'type': 'register',
        'id': 'register_0',
        'payload': {
          'forcePairing': false,
          'pairingType': 'PROMPT',
          if (_secret != null) 'client-key': _secret,
          'manifest': _manifest(signed: signed),
        },
      }),
    );
  }

  Future<Map<String, Object?>> _nextRegister(Duration wait, {required Object Function() silent}) async {
    if (_regQueue.isNotEmpty) return _regQueue.removeAt(0);
    final waiter = _regWaiter = Completer<Map<String, Object?>>();
    try {
      return await waiter.future.timeout(wait);
    } on TimeoutException {
      throw silent();
    } finally {
      if (identical(_regWaiter, waiter)) _regWaiter = null;
    }
  }

  /// What is read right after connecting; none of it may fail the connection.
  Future<void> _learn() async {
    try {
      final info = await _request('ssap://com.webos.service.connectionmanager/getinfo', reconnect: false);
      _mac = _macFrom(info) ?? _mac;
    } on Object {
      // Older sets lack the service; Wake-on-LAN then just is not offered.
    }
    _subscribe('ssap://audio/getVolume');
    _subscribe('ssap://com.webos.applicationManager/getForegroundAppInfo');
  }

  /// Prefers the interface that is connected: the wired and the Wi-Fi card have different addresses.
  String? _macFrom(Map<String, Object?> info) {
    final cards = [_map(info['wiredInfo']), _map(info['wifiInfo'])].whereType<Map<String, Object?>>().toList()
      ..sort((a, b) => (b['state'] == 'connected' ? 1 : 0) - (a['state'] == 'connected' ? 1 : 0));
    for (final card in cards) {
      final mac = card['macAddress'];
      if (mac is String && mac.isNotEmpty) return mac;
    }
    return null;
  }

  /// News from the TV (volume, the app in front) makes the page read [state] again. The first answer is the current
  /// value, not news.
  void _subscribe(String uri) {
    final id = 'sub_${_nextId++}';
    _subs[id] = (_) {
      if (_subSeen.add(id)) return;
      onChanged?.call();
    };
    _ws?.add(jsonEncode({'type': 'subscribe', 'id': id, 'uri': uri}));
  }

  void _onMessage(WebSocket ws, Object? data) {
    if (!identical(ws, _ws) || data is! String) return;
    final Object? decoded;
    try {
      decoded = jsonDecode(data);
    } on FormatException {
      return;
    }
    final msg = _map(decoded);
    if (msg == null) return;
    final id = msg['id'];
    final type = msg['type'];
    if (id == 'register_0' || type == 'registered') {
      final waiter = _regWaiter;
      if (waiter != null && !waiter.isCompleted) {
        _regWaiter = null;
        waiter.complete(msg);
      } else {
        _regQueue.add(msg);
      }
      return;
    }
    if (id is! String) return;
    final sub = _subs[id];
    if (sub != null) {
      if (type == 'response') sub(msg);
      return;
    }
    final waiter = _pending.remove(id);
    if (waiter != null && !waiter.isCompleted) waiter.complete(msg);
  }

  void _onMainDone(WebSocket ws) {
    if (!identical(ws, _ws)) return;
    final wasOpen = _ready;
    _ws = null;
    _ready = false;
    _failWaiters();
    unawaited(_closeInput());
    if (wasOpen && !_closing) onClosed?.call();
  }

  void _failWaiters() {
    for (final waiter in _pending.values) {
      if (!waiter.isCompleted) waiter.completeError(const BrandUnreachable('closed'));
    }
    _pending.clear();
    final reg = _regWaiter;
    _regWaiter = null;
    if (reg != null && !reg.isCompleted) reg.completeError(const BrandUnreachable('closed'));
  }

  Future<void> _teardown() async {
    final ws = _ws;
    _ws = null;
    _ready = false;
    _subs.clear();
    _subSeen.clear();
    _regQueue.clear();
    _failWaiters();
    await _closeInput();
    if (ws != null) {
      try {
        await ws.close();
      } on Object {
        // Already gone.
      }
    }
  }

  Future<void> _ensureOpen() async {
    if (isOpen) return;
    try {
      await connect();
    } on BrandRefused {
      rethrow;
    } on BrandUnreachable {
      rethrow;
    } on Object catch (e) {
      throw BrandUnreachable(e);
    }
  }

  // ---- requests ----

  Future<Map<String, Object?>> _request(String uri, {Map<String, Object?>? payload, bool reconnect = true}) async {
    if (reconnect) await _ensureOpen();
    final ws = _ws;
    if (ws == null) throw const BrandUnreachable('closed');
    final id = '${_nextId++}';
    final waiter = _pending[id] = Completer<Map<String, Object?>>();
    try {
      ws.add(jsonEncode({'type': 'request', 'id': id, 'uri': uri, 'payload': ?payload}));
    } on Object catch (e) {
      _pending.remove(id);
      throw BrandUnreachable(e);
    }
    final Map<String, Object?> reply;
    try {
      reply = await waiter.future.timeout(timeout);
    } on TimeoutException {
      _pending.remove(id);
      throw const BrandError(_msgSilent);
    }
    final body = _map(reply['payload']) ?? const <String, Object?>{};
    if (reply['type'] == 'error' || body['returnValue'] == false) throw const BrandError(_msgFailed);
    return body;
  }

  // ---- pairing (LG has no code) ----

  @override
  Future<void> startPairing() async => throw const BrandError(_msgFailed, unsupported: true);

  @override
  Future<void> finishPairing(String code) async => throw const BrandError(_msgFailed, unsupported: true);

  // ---- keys ----

  @override
  Future<void> key(String key) async {
    final button = _buttons[key];
    if (button != null) return _sendInput('type:button\nname:$button\n\n');
    switch (key) {
      case RemoteKey.volumeUp:
        await _request('ssap://audio/volumeUp');
      case RemoteKey.volumeDown:
        await _request('ssap://audio/volumeDown');
      case RemoteKey.mute:
        final volume = await _volume();
        await _request('ssap://audio/setMute', payload: {'mute': !(volume.muted ?? false)});
      case RemoteKey.playPause:
        await _request(_playing ? 'ssap://media.controls/pause' : 'ssap://media.controls/play');
        _playing = !_playing;
      case RemoteKey.forward:
        await _request('ssap://media.controls/fastForward');
      case RemoteKey.rewind:
        await _request('ssap://media.controls/rewind');
      default:
        throw const BrandError(_msgFailed, unsupported: true);
    }
  }

  /// The old firmware answers `{volume, muted}`, the new one `{volumeStatus: {volume, muteStatus}}`.
  Future<({int? level, bool? muted})> _volume() async {
    final body = await _request('ssap://audio/getVolume');
    final status = _map(body['volumeStatus']);
    final level = status?['volume'] ?? body['volume'];
    final muted = status?['muteStatus'] ?? body['muted'];
    return (level: level is num ? level.round() : null, muted: muted is bool ? muted : null);
  }

  @override
  Future<void> setVolume(int level) async {
    await _request('ssap://audio/setVolume', payload: {'volume': level.clamp(0, 100)});
  }

  @override
  Future<void> sleep() async {
    await _request('ssap://system/turnOff');
  }

  // ---- the pointer socket ----

  Future<WebSocket> _inputSocket() {
    final open = _input;
    if (open != null && open.readyState == WebSocket.open) return Future.value(open);
    return _inputOpening ??= _openInput().whenComplete(() => _inputOpening = null);
  }

  Future<WebSocket> _openInput() async {
    final body = await _request('ssap://com.webos.service.networkinput/getPointerInputSocket');
    final path = body['socketPath'];
    if (path is! String) throw const BrandError(_msgFailed);
    final Uri uri;
    try {
      uri = Uri.parse(path);
    } on FormatException {
      throw const BrandError(_msgFailed);
    }
    // Only this TV's own address: a socket path that points elsewhere is not followed.
    if ((uri.scheme != 'ws' && uri.scheme != 'wss') || uri.host != address) throw const BrandError(_msgFailed);
    final WebSocket ws;
    try {
      ws = await _dial(path);
    } on Object catch (e) {
      throw BrandUnreachable(e);
    }
    _input = ws;
    ws.listen(
      (_) {},
      onDone: () {
        if (identical(_input, ws)) _input = null;
      },
      onError: (Object _) {},
      cancelOnError: false,
    );
    return ws;
  }

  Future<void> _closeInput() async {
    final ws = _input;
    _input = null;
    if (ws != null) {
      try {
        await ws.close();
      } on Object {
        // Already gone.
      }
    }
  }

  Future<void> _sendInput(String frame) async {
    final ws = await _inputSocket();
    try {
      ws.add(frame);
    } on Object catch (e) {
      _input = null;
      throw BrandUnreachable(e);
    }
  }

  @override
  void pointer(String kind, double dx, double dy) {
    final x = dx.round();
    final y = dy.round();
    if (x == 0 && y == 0) return;
    final frame = switch (kind) {
      'm' => 'type:move\ndx:$x\ndy:$y\ndown:0\n\n',
      's' => 'type:scroll\ndx:$x\ndy:$y\n\n',
      _ => null,
    };
    if (frame == null) return;
    // Fire and forget: a lost move is harmless, and the next one reopens the socket.
    unawaited(_sendInput(frame).catchError((Object _) {}));
  }

  @override
  Future<void> click() => _sendInput('type:click\n\n');

  // ---- typing ----

  @override
  Future<void> type(String text, {bool submit = false}) async {
    await _request('ssap://com.webos.service.ime/insertText', payload: {'text': text, 'replace': 0});
    if (submit) await _request('ssap://com.webos.service.ime/sendEnterKey');
  }

  // ---- apps ----

  @override
  Future<List<TvApp>> apps() async {
    final body = await _request('ssap://com.webos.applicationManager/listLaunchPoints');
    final points = body['launchPoints'];
    final list = <TvApp>[];
    if (points is List) {
      for (final point in points) {
        final p = _map(point);
        final id = p?['id'];
        if (p == null || id is! String || id.isEmpty) continue;
        final title = p['title'];
        final label = title is String && title.isNotEmpty ? title : id;
        list.add(TvApp(id, label));
        _labels[id] = label;
        final icon = p['icon'] ?? p['largeIcon'];
        if (icon is String && icon.isNotEmpty) _iconUrls[id] = icon;
      }
    }
    list.sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return list;
  }

  @override
  Future<void> launch(String id) async {
    await _request('ssap://system.launcher/launch', payload: {'id': id});
  }

  @override
  Future<(String, Uint8List)?> icon(String id) async {
    final url = _iconUrls[id];
    if (url == null) return null;
    final Uri uri;
    try {
      uri = Uri.parse(url);
    } on FormatException {
      return null;
    }
    // The TV serves its own pictures; an address elsewhere is not fetched.
    if ((uri.scheme != 'http' && uri.scheme != 'https') || uri.host != address) return null;
    final client = HttpClient()
      ..connectionTimeout = timeout
      ..badCertificateCallback = (cert, host, port) => host == address;
    try {
      final request = await client.getUrl(uri).timeout(timeout);
      final response = await request.close().timeout(timeout);
      if (response.statusCode != 200) {
        await response.drain<void>();
        return null;
      }
      final bytes = await response.fold<BytesBuilder>(BytesBuilder(copy: false), (b, chunk) => b..add(chunk));
      final data = bytes.takeBytes();
      if (data.isEmpty) return null;
      return (response.headers.contentType?.mimeType ?? 'image/png', data);
    } on Object {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  // ---- state ----

  @override
  Future<Map<String, Object?>> state() async {
    final out = <String, Object?>{};
    try {
      final body = await _request('ssap://com.webos.applicationManager/getForegroundAppInfo');
      final appId = body['appId'];
      if (appId is String && appId.isNotEmpty) {
        if (_labels.isEmpty) {
          try {
            await apps();
          } on BrandError {
            // Without the list the id stands in for the label.
          }
        }
        out['pkg'] = appId;
        out['app'] = _labels[appId] ?? appId;
      }
    } on BrandError {
      // Not told: left out.
    }
    try {
      final volume = await _volume();
      if (volume.level != null) {
        out['volume'] = volume.level;
        out['max'] = 100;
      }
      if (volume.muted != null) out['muted'] = volume.muted;
    } on BrandError {
      // Not told: left out.
    }
    return out;
  }

  // ---- end ----

  @override
  Future<void> close() async {
    _closing = true;
    await _teardown();
  }

  static Map<String, Object?>? _map(Object? value) =>
      value is Map ? value.map((k, v) => MapEntry(k.toString(), v)) : null;
}
