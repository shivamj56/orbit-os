/// Samsung TVs (Tizen, about 2016 and newer): the TV's own remote-control service on the home Wi-Fi, the one
/// Samsung's SmartThings and remote apps use.
///
/// Three doors, each used for what it is good at:
/// - REST on 8001 (`/api/v2/`): who the TV is, whether it wants a token, whether it is on; and a plain app launch.
/// - A WebSocket (wss on 8002 when the TV wants tokens, ws on 8001 otherwise): keys, typing, the app list and icons.
///   The first time, the TV shows "Allow?" and the answer comes down this socket with a token to keep.
/// - UPnP RenderingControl on 9197: the volume level, which the socket cannot tell. Optional: many sets answer.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'brand.dart';

/// One thing the code is waiting for from the TV: [test] looks at each decoded message, [done] completes with the
/// match, or with null when the socket closes first.
class _Waiter {
  _Waiter(this.test);

  final bool Function(Map<String, Object?> message) test;
  final Completer<Map<String, Object?>?> done = Completer<Map<String, Object?>?>();
}

class SamsungTv extends BrandTv {
  SamsungTv({
    required this.address,
    String? secret,
    this.appName = 'Orbit',
    this.port = 8002,
    this.restPort = 8001,
    this.upnpPort = 9197,
    this.allowWait = const Duration(seconds: 30),
    this.timeout = const Duration(seconds: 4),
    // A named parameter cannot be private, so the field is set here.
  }) : _secret = secret; // ignore: prefer_initializing_formals

  // The words the person reads. Static on purpose: the page translates them by their exact text.
  static const String _msgAllow = 'Press Allow on the TV to let Orbit control it.';
  static const String _msgDenied = 'The TV said no. To try again, choose it again and press Allow.';
  static const String _msgUnsupported = 'Samsung TVs cannot do that from a phone.';
  static const String _msgSetting =
      'The TV blocks phones. Allow them in its settings under General, External Device Manager.';
  static const String _msgOdd = 'The TV did not answer as Orbit expected.';

  static const String _upnpService = 'urn:schemas-upnp-org:service:RenderingControl:1';

  @override
  final String address;

  /// The name the TV shows in its "Allow?" prompt and in its list of phones.
  final String appName;

  /// The secure socket's port (used when the TV wants tokens).
  final int port;

  /// The REST door, and the plain socket of older sets.
  final int restPort;

  /// The UPnP door (volume level).
  final int upnpPort;

  /// How long the person has to press Allow on the TV.
  final Duration allowWait;

  /// How long one answer from the TV may take.
  final Duration timeout;

  String? _secret;
  String? _model;
  String? _mac;
  String? _name;
  bool? _powerOn;
  bool _frame = false;
  bool _hasLevel = false;
  bool _open = false;
  bool _closedForGood = false;
  bool _pauseNext = true;

  WebSocket? _ws;
  StreamSubscription<Object?>? _sub;
  Future<void>? _reopening;
  final List<_Waiter> _waiters = [];

  /// Samsung's own id → app_type and icon path, learned from [apps]: launching needs the type, icons need the path.
  final Map<String, String> _appType = {};
  final Map<String, String> _appIcon = {};

  @override
  TvKind get kind => TvKind.samsung;

  @override
  PairingWay get pairingWay => PairingWay.allow;

  @override
  String? get secret => _secret;

  @override
  bool get isOpen => _open;

  /// The model the TV reported ("QE55Q70AATXXU"), once [connect] has read it.
  @override
  String? get model => _model;

  /// The TV's Wi-Fi MAC address, for waking it with Wake-on-LAN.
  @override
  String? get mac => _mac;

  /// The name the TV gives itself.
  String? get name => _name;

  @override
  Set<String> get caps => {
    Cap.keys,
    Cap.volume,
    Cap.mute,
    Cap.media,
    Cap.type,
    Cap.apps,
    Cap.launch,
    Cap.power,
    Cap.settings,
    if (_hasLevel) Cap.volumeLevel,
  };

  // ---- connecting ----

  @override
  Future<void> connect() async {
    _closedForGood = false;
    await _drop();

    // Reachability first, and which socket to use: sets with token support only talk wss.
    final info = await _readInfo();
    final tokens = info['TokenAuthSupport']?.toString() == 'true';

    final WebSocket ws;
    final client = HttpClient()..badCertificateCallback = (cert, host, port) => host == address;
    try {
      // The TV's certificate is self-signed, so a bad certificate is accepted for this one address and nowhere else.
      ws = await WebSocket.connect(_socketUrl(tokens), customClient: client).timeout(timeout);
    } on SocketException catch (e) {
      throw BrandUnreachable(e);
    } on TimeoutException catch (e) {
      throw BrandUnreachable(e);
    } on WebSocketException {
      // The REST door answered but the socket door says no: the TV's external-device setting.
      throw const BrandRefused(BrandRefused.setting, _msgSetting);
    } on HandshakeException {
      throw const BrandRefused(BrandRefused.setting, _msgSetting);
    } finally {
      client.close();
    }

    _ws = ws;
    // The answer to the prompt (or the token's welcome) is the first thing the TV says that matters.
    final first = _expect((m) {
      final event = m['event'];
      return event == 'ms.channel.connect' || event == 'ms.channel.unauthorized' || event == 'ms.channel.timeOut';
    });
    _sub = ws.listen(
      _onData,
      onDone: () => _onSocketDone(ws),
      onError: (Object _) => _onSocketDone(ws),
      cancelOnError: true,
    );

    final hadToken = _secret != null && _secret!.isNotEmpty;
    final answer = await _await(first, allowWait);
    final event = answer?['event'];
    if (event != 'ms.channel.connect') {
      final alive = identical(_ws, ws);
      await _drop();
      if (answer == null && !alive) throw const BrandUnreachable('closed');
      if (event == 'ms.channel.unauthorized') throw const BrandRefused(BrandRefused.denied, _msgDenied);
      // With a token the TV already took, a timeOut is a TV that is asleep (Home Assistant's samsungtv reads it so),
      // not a prompt nobody answered: no new pairing is asked for.
      if (hadToken && event == 'ms.channel.timeOut') throw const BrandUnreachable('asleep');
      throw const BrandRefused(BrandRefused.timeout, _msgAllow);
    }

    final data = _map(answer?['data']);
    final token = data?['token'];
    if (token != null && token.toString().isNotEmpty) _secret = token.toString();
    _open = true;
    await _probeVolume();
  }

  /// Device info over REST. Throws [BrandUnreachable] when nothing answers, [BrandError] when it is not a Samsung.
  Future<Map<String, Object?>> _readInfo() async {
    final (status, body) = await _http('GET', Uri(scheme: 'http', host: address, port: restPort, path: '/api/v2/'));
    final decoded = _tryJson(body);
    final device = _map(_map(decoded)?['device']);
    if (status != 200 || device == null) throw const BrandError(_msgOdd);
    _name = device['name']?.toString() ?? _name;
    _model = device['modelName']?.toString() ?? _model;
    _mac = device['wifiMac']?.toString() ?? _mac;
    final power = device['PowerState']?.toString();
    _powerOn = power == null ? null : power == 'on';
    _frame = device['FrameTVSupport']?.toString() == 'true';
    return device;
  }

  String _socketUrl(bool tokens) {
    // Base64 of the name; "+" must not turn into a space on the TV's side, "=" and "/" are fine in a query.
    final name = base64.encode(utf8.encode(appName)).replaceAll('+', '%2B');
    final token = _secret;
    final tokenPart = tokens && token != null && token.isNotEmpty ? '&token=${Uri.encodeQueryComponent(token)}' : '';
    const path = '/api/v2/channels/samsung.remote.control';
    return tokens ? 'wss://$address:$port$path?name=$name$tokenPart' : 'ws://$address:$restPort$path?name=$name';
  }

  @override
  Future<void> startPairing() async => throw const BrandError(_msgUnsupported, unsupported: true);

  @override
  Future<void> finishPairing(String code) async => throw const BrandError(_msgUnsupported, unsupported: true);

  // ---- the socket ----

  void _onData(Object? raw) {
    if (raw is! String) return;
    final message = _map(_tryJson(raw));
    if (message == null) return;
    for (final waiter in List<_Waiter>.of(_waiters)) {
      if (waiter.done.isCompleted || !waiter.test(message)) continue;
      _waiters.remove(waiter);
      waiter.done.complete(message);
    }
  }

  void _onSocketDone(WebSocket ws) {
    if (!identical(_ws, ws)) return; // dropped on purpose, or replaced
    final wasOpen = _open;
    _ws = null;
    _open = false;
    unawaited(_sub?.cancel());
    _sub = null;
    _failWaiters();
    if (wasOpen && !_closedForGood) onClosed?.call();
  }

  /// Ends the current socket without telling anyone: the callers know.
  Future<void> _drop() async {
    final ws = _ws;
    final sub = _sub;
    _ws = null;
    _sub = null;
    _open = false;
    _failWaiters();
    await sub?.cancel();
    if (ws != null) unawaited(ws.close().catchError((Object _) => null));
  }

  void _failWaiters() {
    for (final waiter in List<_Waiter>.of(_waiters)) {
      if (!waiter.done.isCompleted) waiter.done.complete(null);
    }
    _waiters.clear();
  }

  _Waiter _expect(bool Function(Map<String, Object?> message) test) {
    final waiter = _Waiter(test);
    _waiters.add(waiter);
    return waiter;
  }

  /// The matching message, or null after [wait] or when the socket closed.
  Future<Map<String, Object?>?> _await(_Waiter waiter, Duration wait) async {
    try {
      return await waiter.done.future.timeout(wait);
    } on TimeoutException {
      return null;
    } finally {
      _waiters.remove(waiter);
    }
  }

  /// A command sent while the socket is closed opens it again once, with the kept token (no prompt is expected).
  Future<void> _ensureOpen() async {
    if (_open && _ws != null) return;
    if (_closedForGood) throw const BrandUnreachable('closed');
    final running = _reopening ??= _reopen().whenComplete(() => _reopening = null);
    await running;
  }

  Future<void> _reopen() async {
    try {
      await connect();
    } on BrandRefused {
      throw const BrandNeedsPairing(_msgAllow);
    } on BrandError catch (e) {
      throw BrandUnreachable(e);
    }
  }

  Future<void> _send(Map<String, Object?> message) async {
    await _ensureOpen();
    try {
      _ws!.add(jsonEncode(message));
    } on Object catch (e) {
      throw BrandUnreachable(e);
    }
  }

  // ---- keys, typing, power ----

  static const Map<String, String> _keys = {
    RemoteKey.up: 'KEY_UP',
    RemoteKey.down: 'KEY_DOWN',
    RemoteKey.left: 'KEY_LEFT',
    RemoteKey.right: 'KEY_RIGHT',
    RemoteKey.ok: 'KEY_ENTER',
    RemoteKey.back: 'KEY_RETURN',
    RemoteKey.home: 'KEY_HOME',
    RemoteKey.settings: 'KEY_MENU',
    RemoteKey.mute: 'KEY_MUTE',
    RemoteKey.volumeUp: 'KEY_VOLUP',
    RemoteKey.volumeDown: 'KEY_VOLDOWN',
    RemoteKey.forward: 'KEY_FF',
    RemoteKey.rewind: 'KEY_REWIND',
  };

  /// A Frame is switched off the way its own remote does it: the power key held, one Press every 100 ms for about 4 s,
  /// then Release (Home Assistant's samsungtv, FRAME_POWER_OFF_PRESSES). A short press only flips TV and Art Mode.
  static const int _framePresses = 40;
  static const Duration _framePressGap = Duration(milliseconds: 100);

  /// [cmd] is Click, or Press and Release for a held key.
  Future<void> _sendKey(String samsungKey, {String cmd = 'Click'}) => _send({
    'method': 'ms.remote.control',
    'params': {'Cmd': cmd, 'DataOfCmd': samsungKey, 'Option': 'false', 'TypeOfRemote': 'SendRemoteKey'},
  });

  @override
  Future<void> key(String key) async {
    if (key == RemoteKey.playPause) {
      // The TV has no toggle and does not say whether it plays: alternate, starting with pause (the usual first
      // press is on something that is playing).
      final word = _pauseNext ? 'KEY_PAUSE' : 'KEY_PLAY';
      await _sendKey(word);
      _pauseNext = !_pauseNext;
      return;
    }
    final mapped = _keys[key];
    if (mapped == null) throw const BrandError(_msgUnsupported, unsupported: true);
    await _sendKey(mapped);
  }

  /// Some sets take text only after a "text received" broadcast, so it goes first (samsungtvws sends it before the
  /// first text for that reason); then the text as base64, and the end marker.
  @override
  Future<void> type(String text, {bool submit = false}) async {
    await _send({
      'method': 'ms.channel.emit',
      'params': {'event': 'custom.remote.textReceived', 'to': 'broadcast'},
    });
    await _send({
      'method': 'ms.remote.control',
      'params': {'Cmd': base64.encode(utf8.encode(text)), 'DataOfCmd': 'base64', 'TypeOfRemote': 'SendInputString'},
    });
    await _send({
      'method': 'ms.remote.control',
      'params': {'TypeOfRemote': 'SendInputEnd'},
    });
    if (submit) await _sendKey('KEY_ENTER');
  }

  /// KEY_POWER; on a Frame (`FrameTVSupport` in the device info) held, since a click there only starts Art Mode.
  @override
  Future<void> sleep() async {
    if (!_frame) return _sendKey('KEY_POWER');
    for (var i = 0; i < _framePresses; i++) {
      await _sendKey('KEY_POWER', cmd: 'Press');
      await Future<void>.delayed(_framePressGap);
    }
    await _sendKey('KEY_POWER', cmd: 'Release');
  }

  // ---- apps ----

  @override
  Future<List<TvApp>> apps() async {
    await _ensureOpen();
    final waiter = _expect((m) => m['event'] == 'ed.installedApp.get');
    try {
      await _send({
        'method': 'ms.channel.emit',
        'params': {'event': 'ed.installedApp.get', 'to': 'host'},
      });
    } on Object {
      _waiters.remove(waiter);
      rethrow;
    }
    final answer = await _await(waiter, timeout);
    if (answer == null) throw const BrandError(_msgOdd);

    final data = _map(answer['data']);
    final list = data?['data'] ?? answer['data'];
    if (list is! List) throw const BrandError(_msgOdd);

    final found = <TvApp>[];
    _appType.clear();
    _appIcon.clear();
    for (final item in list) {
      final app = _map(item);
      final id = app?['appId']?.toString();
      if (app == null || id == null || id.isEmpty) continue;
      final label = app['name']?.toString() ?? id;
      found.add(TvApp(id, label));
      _appType[id] = app['app_type']?.toString() ?? '';
      final icon = app['icon']?.toString();
      if (icon != null && icon.isNotEmpty) _appIcon[id] = icon;
    }
    found.sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return found;
  }

  @override
  Future<void> launch(String id) async {
    if (_appType.isEmpty) {
      // No list yet: the REST launch needs no socket and no app type. If the TV does not take it, fall through.
      try {
        final (status, _) = await _http(
          'POST',
          Uri(scheme: 'http', host: address, port: restPort, path: '/api/v2/applications/${Uri.encodeComponent(id)}'),
        );
        if (status >= 200 && status < 300) return;
      } on BrandUnreachable {
        // The socket path below says so if the TV is really gone.
      }
    }
    // Web apps (app_type 2, nearly all) open as DEEP_LINK, native ones as NATIVE_LAUNCH. An id without a known type
    // goes as DEEP_LINK, the default samsungtvws and Home Assistant send for every launch.
    final type = _appType[id];
    final action = type == null || type.isEmpty || type == '2' ? 'DEEP_LINK' : 'NATIVE_LAUNCH';
    await _send({
      'method': 'ms.channel.emit',
      'params': {
        'event': 'ed.apps.launch',
        'to': 'host',
        'data': {'appId': id, 'action_type': action},
      },
    });
  }

  @override
  Future<(String, Uint8List)?> icon(String id) async {
    final path = _appIcon[id];
    if (path == null) return null;
    final waiter = _expect((m) {
      if (m['event'] != 'ed.apps.icon') return false;
      final said = _map(m['data'])?['iconPath']?.toString();
      return said == null || said == path; // several icons may be asked at once
    });
    try {
      await _send({
        'method': 'ms.channel.emit',
        'params': {
          'event': 'ed.apps.icon',
          'to': 'host',
          'data': {'iconPath': path},
        },
      });
    } on Object {
      _waiters.remove(waiter);
      rethrow;
    }
    final answer = await _await(waiter, timeout);
    final encoded = _map(answer?['data'])?['imageBase64']?.toString();
    if (encoded == null || encoded.isEmpty) return null;
    try {
      return ('image/png', base64.decode(encoded));
    } on FormatException {
      return null;
    }
  }

  // ---- state and volume ----

  @override
  Future<Map<String, Object?>> state() async {
    final out = <String, Object?>{};
    try {
      await _readInfo();
      final on = _powerOn;
      if (on != null) out['on'] = on;
    } on Object {
      // Unknown stays out.
    }
    if (_hasLevel) {
      try {
        out['volume'] = await _getVolume();
        out['max'] = 100;
        out['muted'] = await _getMute();
      } on Object {
        out.remove('volume');
        out.remove('max');
        out.remove('muted');
      }
    }
    return out;
  }

  @override
  Future<void> setVolume(int level) async {
    if (!_hasLevel) throw const BrandError(_msgUnsupported, unsupported: true);
    await _soap('SetVolume', '<DesiredVolume>${level.clamp(0, 100)}</DesiredVolume>');
  }

  /// Asks for the volume once; the TV that answers gets [Cap.volumeLevel].
  Future<void> _probeVolume() async {
    try {
      await _getVolume();
      _hasLevel = true;
    } on Object {
      _hasLevel = false;
    }
  }

  Future<int> _getVolume() async {
    final body = await _soap('GetVolume', '');
    final value = RegExp(r'<CurrentVolume>\s*(\d+)\s*</CurrentVolume>').firstMatch(body)?.group(1);
    if (value == null) throw const BrandError(_msgOdd);
    return int.parse(value);
  }

  Future<bool> _getMute() async {
    final body = await _soap('GetMute', '');
    final value = RegExp(r'<CurrentMute>\s*(\w+)\s*</CurrentMute>').firstMatch(body)?.group(1);
    if (value == null) throw const BrandError(_msgOdd);
    return value == '1' || value.toLowerCase() == 'true';
  }

  Future<String> _soap(String action, String args) async {
    final envelope =
        '<?xml version="1.0" encoding="utf-8"?>'
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
        's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
        '<u:$action xmlns:u="$_upnpService"><InstanceID>0</InstanceID><Channel>Master</Channel>$args</u:$action>'
        '</s:Body></s:Envelope>';
    final (status, body) = await _http(
      'POST',
      Uri(scheme: 'http', host: address, port: upnpPort, path: '/upnp/control/RenderingControl1'),
      headers: {'Content-Type': 'text/xml; charset="utf-8"', 'SOAPAction': '"$_upnpService#$action"'},
      body: envelope,
    );
    if (status != 200) throw const BrandError(_msgOdd);
    return body;
  }

  // ---- plumbing ----

  /// One plain HTTP call. Every way of not getting an answer is [BrandUnreachable].
  Future<(int, String)> _http(String method, Uri uri, {Map<String, String>? headers, String? body}) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      return await () async {
        final request = await client.openUrl(method, uri);
        // Header names as written: some UPnP servers compare `SOAPAction` with its case.
        headers?.forEach((name, value) => request.headers.set(name, value, preserveHeaderCase: true));
        if (body != null) request.add(utf8.encode(body));
        final response = await request.close();
        final text = await utf8.decodeStream(response);
        return (response.statusCode, text);
      }().timeout(timeout);
    } on SocketException catch (e) {
      throw BrandUnreachable(e);
    } on TimeoutException catch (e) {
      throw BrandUnreachable(e);
    } on HttpException catch (e) {
      throw BrandUnreachable(e);
    } finally {
      client.close(force: true);
    }
  }

  static Object? _tryJson(String text) {
    try {
      return jsonDecode(text);
    } on FormatException {
      return null;
    }
  }

  static Map<String, Object?>? _map(Object? value) => value is Map ? Map<String, Object?>.from(value) : null;

  @override
  Future<void> close() async {
    _closedForGood = true;
    await _drop();
  }
}
