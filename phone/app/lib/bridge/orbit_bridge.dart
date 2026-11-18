import 'dart:async';
import 'dart:collection';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../app/demo_store.dart';
import '../cloud/drive.dart';
import '../native/native_host.dart';
import '../setup/setup_host.dart';
import '../tv/icon_cache.dart';
import '../tv/models.dart';
import '../tv/remote.dart';
import 'event_queue.dart';
import 'js_message.dart';
import 'request.dart';

/// Runs a script in the page.
typedef ScriptRunner = Future<void> Function(String script);

/// The page's side of Orbit (phone/SPEC.md, "The bridge"): messages from the `OrbitNative` channel in, replies and
/// events out through `window.orbitReceive(...)`.
///
/// A request with a non-zero id gets exactly one reply, `{"id","ok":true,"data"}` or `{"id","ok":false,"error",
/// "status"}`; id 0 gets none. Events are held until the page's `hello` (and again from the moment a new page starts
/// loading), then flushed after hello's reply.
class OrbitBridge {
  OrbitBridge({
    required this.remote,
    required this.native,
    required this.icons,
    SetupHost? setup,
    this.drive,
    this.demoStore,
    Future<String> Function(String key)? loadAsset,
  })  : setup = setup ?? const _NoSetup(),
        _loadAsset = loadAsset ?? rootBundle.loadString {
    _events = EventQueue(_send);
    remote.onStatus = (status) => _events.push('status', status.toJson());
    remote.onTvState = (state) => _events.push('tvstate', state);
    remote.onConnectedChanged = (_) => _applyVolumeKeys();
    remote.onAccount = (account) => _events.push('account', account);
    remote.help.onFrame = (frame) => _events.push('screen', frame);
    native.onVolumeKey = _onVolumeKey;
    this.setup
      ..onAuthWaiting = (() => _events.push('setupAuth', {'state': 'waiting'}))
      ..onLine = ((line) => _events.push('setupLine', {'line': line}));
  }

  /// The TV over the home Wi-Fi or the cloud.
  final TvRemote remote;
  final NativeHost native;
  final IconCache icons;

  /// Orbit Setup: finding TVs, the TV's debugging connection, moving files (phone/SPEC.md, "Orbit Setup").
  final SetupHost setup;

  /// Backups in the person's own Google Drive (phone/SPEC.md, "Backups in Google Drive"); null in a build without.
  final DriveBackups? drive;

  /// Where demo mode is kept between starts of the app (phone/SPEC.md, "Demo mode").
  final DemoStore? demoStore;

  /// Reads one of the app's assets: the page's translations live in assets/ui/locales/ (phone/SPEC.md, "Languages").
  final Future<String> Function(String key) _loadAsset;

  /// The page shows the opening intro's first frame (`intro` op): the screen's own copy of the mark can go.
  void Function()? onIntro;

  /// Ops the phone answers itself even in demo mode; every other op is about the real TV, and is refused meanwhile.
  static const Set<String> phoneOps = {'demo', 'intro', 'haptic', 'keepAwake', 'openUrl', 'language'};

  /// A language file's name: a plain BCP 47 tag ("hi", "pt-BR", "sr-Latn", "es-419"), never a path.
  static final RegExp languageTag = RegExp(r'^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$');

  /// Where `openUrl` may go: Orbit's public pages (privacy policy, account deletion, issues), nowhere else.
  static bool isPublicLink(String url) {
    final uri = Uri.tryParse(url.trim());
    if (uri == null || uri.scheme != 'https' || uri.hasPort || uri.userInfo.isNotEmpty) return false;
    final path = uri.path;
    return (uri.host == 'shivamj56.github.io' && path.startsWith('/orbit-os-site/')) ||
        (uri.host == 'github.com' && (path == '/shivamj56/orbit-os-site' || path.startsWith('/shivamj56/orbit-os-site/')));
  }
  late final EventQueue _events;
  ScriptRunner? _run;
  bool _keepAwake = false;
  bool _inFront = true;
  final _Serial _volume = _Serial();
  final _Slots _iconSlots = _Slots(2);

  /// Run just before hello's reply goes out (the screen sets the page's inset variables there).
  void Function()? beforeHelloReply;

  /// The events not yet delivered (until hello).
  EventQueue get events => _events;

  /// Where replies and events go. Until this is set they are dropped (events are held until hello anyway).
  void attach(ScriptRunner run) => _run = run;

  /// One message from `OrbitNative.postMessage`.
  void handleMessage(String raw) => unawaited(handle(raw));

  /// [handleMessage], for tests: completes when the reply (if any) has been sent.
  Future<void> handle(String raw) async {
    final request = BridgeRequest.parse(raw);
    if (request == null) {
      debugPrint('orbit: a message from the page could not be read');
      return;
    }
    Map<String, Object?> reply;
    try {
      final data = await _dispatch(request.op, request.args);
      reply = {'id': request.id, 'ok': true, 'data': data ?? const <String, Object?>{}};
    } on SetupError catch (e) {
      // phone/SPEC.md's setup failures carry a `reason`, not a `status`.
      reply = {'id': request.id, 'ok': false, 'reason': e.reason, 'error': e.message};
    } on DriveError catch (e) {
      // Drive's too: the page chooses its way out (sign in, try again) by it.
      reply = {'id': request.id, 'ok': false, 'reason': e.reason, 'error': e.message, 'status': _driveStatus(e.reason)};
    } on OpError catch (e) {
      reply = {'id': request.id, 'ok': false, 'error': e.message, 'status': e.status};
    } on Object catch (e, stack) {
      debugPrint('orbit: ${request.op} failed: $e\n$stack');
      reply = {'id': request.id, 'ok': false, 'error': 'Something went wrong in Orbit.', 'status': 0};
    }
    final hello = request.op == 'hello';
    if (hello) beforeHelloReply?.call();
    if (request.id != 0) _send(reply);
    if (hello) _events.open();
  }

  /// A new page started loading: hold events for it, starting with where things stand now. Help mode ends (the new
  /// page starts on the remote, not on its Help page).
  void pageStarted() {
    remote.help.stop();
    _events.close();
    _events.push('status', remote.status.toJson());
    _events.push('account', remote.accountJson);
    final state = remote.tvState;
    if (state != null) _events.push('tvstate', state);
  }

  /// The app came to the front (resumed) or left it (paused).
  void lifecycle({required bool resumed}) {
    if (_inFront == resumed) return;
    _inFront = resumed;
    remote.setForeground(resumed);
    unawaited(native.setKeepAwake(_keepAwake && resumed));
    _events.push('lifecycle', {'state': resumed ? 'resumed' : 'paused'});
    if (resumed) _applyVolumeKeys();
  }

  Future<Object?> _dispatch(String op, Args a) async {
    final link = remote.wifi;
    // Demo mode: the page talks to its pretend TV, and nothing of the page's reaches a real one.
    if (remote.demo && !phoneOps.contains(op)) {
      throw const OpError(409, 'Orbit is showing its demo. Leave the demo to use your TV.');
    }
    switch (op) {
      case 'hello':
        return (await remote.hello()).toJson();
      case 'status':
        await link.ready;
        return remote.status.toJson();
      case 'discover':
        return {
          'found': [for (final tv in await link.discover()) tv.toJson()],
        };
      case 'connect':
        return (await remote.connect(checkedHost(a.text('address', max: 253)), a.port('port'))).toJson();
      case 'manualAddress':
        final (host, port) = parseTypedAddress(a.text('address', max: 300));
        return (await remote.connect(host, port)).toJson();
      case 'askCode':
        await link.askCode();
        return const <String, Object?>{};
      case 'pair':
        return (await remote.pair(_code(a))).toJson();
      case 'forget':
        return (await remote.forget()).toJson();
      case 'state':
        return remote.fetchState();
      case 'apps':
        return remote.getJson('/api/apps');
      case 'icon':
        return _icon(a.text('pkg', max: 255).trim());
      case 'key':
        await remote.postJson('/api/key', {'key': a.word('key')});
        remote.pollSoon();
        return const <String, Object?>{};
      case 'media':
        await remote.postJson('/api/media', {'action': a.word('action')});
        remote.pollSoon();
        return const <String, Object?>{};
      case 'volume':
        final level = a.number('level');
        final answer = await remote.postJson('/api/volume', {'level': level});
        remote.pollSoon();
        final volume = answer is Map ? answer['volume'] : null;
        final max = answer is Map ? answer['max'] : null;
        return {'volume': volume is num ? volume : level, 'max': max is num ? max : 100};
      case 'volumeStep':
        await _volumeStep(_dir(a));
        return const <String, Object?>{};
      case 'type':
        return remote.postJson('/api/type', {
          'text': a.text('text', max: 4000, allowEmpty: true),
          'submit': a.flag('submit', fallback: false),
        });
      case 'open':
        return remote.postJson('/api/open', {'url': a.text('url', max: 4096).trim()});
      case 'launch':
        final pkg = a.text('pkg', max: 255).trim();
        if (!IconCache.packageName.hasMatch(pkg)) throw const OpError(400, 'That is not an app.');
        final answer = await remote.postJson('/api/launch', {'pkg': pkg});
        remote.pollSoon();
        return answer;
      case 'sleep':
        await remote.postJson('/api/sleep', const <String, Object?>{});
        return const <String, Object?>{};
      case 'pointer':
        return _pointer(a);
      case 'help':
        return remote.help.set(a.flag('on'));
      case 'tapAt':
        return remote.postJson('/api/pointer', {
          'action': 'tap',
          'x': _tvPixel(a, 'x', 1280),
          'y': _tvPixel(a, 'y', 720),
        });
      case 'haptic':
        final kind = a.text('kind', max: 16).trim();
        if (!NativeHost.hapticKinds.contains(kind)) throw OpError(400, 'No haptic called "$kind".');
        unawaited(native.haptic(kind));
        return null;
      case 'keepAwake':
        _keepAwake = a.flag('on');
        unawaited(native.setKeepAwake(_keepAwake && _inFront));
        return const <String, Object?>{};
      case 'settings':
        if (a.has('volumeKeys')) {
          final on = a.flag('volumeKeys');
          // After the saved settings are read, so the page's word is the one that stays.
          await link.ready;
          link.setVolumeKeys(on);
          _applyVolumeKeys();
        }
        return const <String, Object?>{};
      case 'account':
        return remote.account();
      case 'signIn':
        return remote.signIn();
      case 'signOut':
        return remote.signOut();
      case 'linkTv':
        return remote.linkTv(_linkCode(a));
      case 'unlinkTv':
        return remote.unlinkTv();
      case 'deleteAccount':
        return remote.deleteAccount(backups: a.flag('backups', fallback: true), drive: drive);
      case 'backupSave':
        final email = await remote.backupEmail();
        final upload = BackupUpload.fromPage(
          text: a.text('text', max: BackupUpload.maxBytes),
          tv: a.text('tv', max: 256, allowEmpty: true),
          address: a.text('address', max: 256, allowEmpty: true),
          model: a.has('model') ? a.text('model', max: 256, allowEmpty: true) : null,
          at: a.has('at') ? a.number('at').round() : DateTime.now().millisecondsSinceEpoch,
        );
        return _drive().save(email, upload);
      case 'backupList':
        final email = await remote.backupEmail();
        return {'backups': await _drive().list(email), 'email': email};
      case 'backupLoad':
        final email = await remote.backupEmail();
        return {'text': await _drive().load(email, a.text('id', max: 256).trim())};
      case 'backupDelete':
        final email = await remote.backupEmail();
        await _drive().delete(email, a.text('id', max: 256).trim());
        return const <String, Object?>{};
      case 'demo':
        if (a.has('on')) {
          final on = a.flag('on');
          remote.setDemo(on);
          unawaited(demoStore?.save(on));
          _applyVolumeKeys();
        }
        return {'on': remote.demo};
      case 'intro':
        onIntro?.call();
        return null;
      case 'language':
        return {'texts': await _languageTexts(a.text('code', max: 24).trim())};
      case 'openUrl':
        final url = a.text('url', max: 512).trim();
        if (!isPublicLink(url)) throw const OpError(400, 'Orbit only opens its own pages.');
        return {'opened': await native.openUrl(url)};
      case 'setupScan':
        return setup.scan(_seconds(a));
      case 'setupProbe':
        return setup.probe(checkedHost(a.text('address', max: 253)), _setupPort(a));
      case 'setupConnect':
        return setup.connect(checkedHost(a.text('address', max: 253)), _setupPort(a));
      case 'setupShell':
        return setup.shell(a.text('cmd', max: 8192), _timeout(a));
      case 'setupPush':
        return _setupPush(a);
      case 'setupRun':
        return setup.run(a.text('cmd', max: 8192));
      case 'setupClose':
        return setup.close();
      case 'setupRecord':
        return _setupRecord(a);
      case 'setupAdopt':
        return (await remote.adopt(
          checkedHost(a.text('address', max: 253)),
          a.port('port'),
          _setupToken(a),
          a.text('name', max: 128, allowEmpty: true),
        )).toJson();
      default:
        throw OpError(400, op.isEmpty ? 'The message has no op.' : 'Orbit has no "$op".');
    }
  }

  DriveBackups _drive() =>
      drive ?? (throw const DriveError('auth', 'Google Drive backups are not available in this build of Orbit.'));

  /// A Drive failure's HTTP-like status, for pages that read `status` only.
  static int _driveStatus(String reason) => switch (reason) {
    'noAccount' => 401,
    'refused' || 'notAllowed' => 403,
    'notFound' => 404,
    'full' => 507,
    'offline' => 0,
    'bad' => 400,
    _ => 502,
  };

  /// The TV's link code: eight digits ("1234 5678" and "1234-5678" are fine).
  static String _linkCode(Args a) {
    final value = a.raw('code');
    final text = switch (value) {
      final String s when s.length <= 32 => s,
      final int n when n >= 0 && n <= 99999999 => '$n'.padLeft(8, '0'),
      _ => '',
    };
    final code = text.replaceAll(RegExp(r'[\s-]'), '');
    if (!RegExp(r'^[0-9]{8}$').hasMatch(code)) throw const OpError(400, 'Type the 8 digits shown on the TV.');
    return code;
  }

  /// Six digits; spaces and dashes are let go ("123 456"), and a number keeps its leading zeros.
  static String _code(Args a) {
    final value = a.raw('code');
    final text = switch (value) {
      final String s when s.length <= 32 => s,
      final int n when n >= 0 && n <= 999999 => '$n'.padLeft(6, '0'),
      _ => '',
    };
    final code = text.replaceAll(RegExp(r'[\s-]'), '');
    if (!RegExp(r'^[0-9]{6}$').hasMatch(code)) throw const OpError(400, 'Type the 6 digits shown on the TV.');
    return code;
  }

  /// A spot on the TV's screen in its pixels (1280 x 720), rounded and kept on the screen.
  static int _tvPixel(Args a, String key, int size) => a.number(key).round().clamp(0, size - 1);

  static String _dir(Args a) {
    final dir = a.text('dir', max: 8).trim();
    if (dir != 'up' && dir != 'down') throw const OpError(400, 'The direction is "up" or "down".');
    return dir;
  }

  /// `setupScan` window: 1 to 20 seconds, 4 by default.
  static Duration _seconds(Args a) {
    final value = a.raw('seconds');
    final seconds = value is num && value.isFinite ? value.round().clamp(1, 20) : 4;
    return Duration(seconds: seconds);
  }

  /// The TV's debugging port, 5555 by default (unlike the door's 8090).
  static int _setupPort(Args a) => a.has('port') ? a.port('port') : 5555;

  /// `setupShell` timeout: 1 to 120 seconds, 20 by default.
  static Duration _timeout(Args a) {
    final value = a.raw('timeoutMs');
    final ms = value is num && value.isFinite ? value.round().clamp(1000, 120000) : 20000;
    return Duration(milliseconds: ms);
  }

  /// The 32 hex characters of `token.txt`, which the TV's door takes as an already paired phone.
  static String _setupToken(Args a) {
    final token = a.text('token', max: 64).trim();
    if (!RegExp(r'^[0-9a-fA-F]{32}$').hasMatch(token)) throw const OpError(400, 'That is not a 32-character key.');
    return token.toLowerCase();
  }

  /// A device path for `setupPush`: absolute, one line, nothing surprising.
  static String _setupTo(Args a) {
    final to = a.text('to', max: 512).trim();
    if (!RegExp(r'^/[^\n\r\x00]+$').hasMatch(to)) throw const OpError(400, 'That is not a place on the TV.');
    return to;
  }

  Future<Object?> _setupPush(Args a) {
    final to = _setupTo(a);
    if (a.has('asset')) return setup.pushAsset(a.text('asset', max: 64).trim(), to);
    if (a.has('text')) return setup.pushText(a.text('text', max: 256 * 1024, allowEmpty: true), to);
    throw const OpError(400, 'Nothing to push: give "asset" or "text".');
  }

  Future<Object?> _setupRecord(Args a) {
    final key = a.text('key', max: 253).trim();
    if (!a.has('record')) return setup.recordLoad(key);
    final record = a.raw('record');
    if (record is! Map) throw const OpError(400, 'The record must be an object.');
    return setup.recordSave(key, {for (final e in record.entries) '${e.key}': e.value});
  }

  Future<Object?> _pointer(Args a) async {
    final type = a.text('type', max: 16).trim();
    switch (type) {
      case 'move' || 'scroll':
        remote.pointer(type == 'move' ? 'm' : 's', a.delta('dx'), a.delta('dy'));
        return null;
      case 'click' || 'longpress' || 'hide':
        return remote.postJson('/api/pointer', {'action': type});
      default:
        throw OpError(400, 'No pointer action called "$type".');
    }
  }

  /// `icon`: memory, then disk, then the TV (two at a time, so a grid of 40 never queues past the 4 s timeout).
  Future<Object?> _icon(String pkg) async {
    if (!IconCache.packageName.hasMatch(pkg)) throw const OpError(400, 'That is not an app.');
    final inMemory = icons.fromMemory(pkg);
    if (inMemory != null) return {'src': inMemory};
    final onDisk = await icons.fromDisk(pkg);
    if (onDisk != null && !onDisk.stale) return {'src': onDisk.src};
    try {
      final (type, bytes) = await _iconSlots.use(() => remote.icon(pkg));
      if (!IconCache.isSupported(type) || bytes.isEmpty) throw const OpError(502, 'The TV did not send a picture.');
      return {'src': await icons.store(pkg, type, bytes)};
    } on OpError {
      if (onDisk != null) return {'src': onDisk.src};
      rethrow;
    }
  }

  void _onVolumeKey(String dir) {
    // In demo mode the keys are not taken (see _applyVolumeKeys); one that slips through never reaches the real TV.
    if (remote.demo) return;
    _events.push('volumeKey', {'dir': dir});
    // Held down, a key repeats faster than the TV answers: past three waiting steps the rest are let go.
    if (_volume.pending >= 3) return;
    unawaited(_volumeStep(dir).then<void>((_) {}, onError: (Object _) {}));
  }

  Future<void> _volumeStep(String dir) async {
    await _volume.run(() => remote.postJson('/api/key', {'key': dir == 'up' ? 'volup' : 'voldown'}));
    remote.pollSoon();
  }

  void _applyVolumeKeys() =>
      unawaited(native.setVolumeKeys(!remote.demo && remote.wifi.volumeKeys && remote.isConnected));

  void _send(Map<String, Object?> message) {
    final run = _run;
    if (run == null) return;
    unawaited(
      run(receiveScript(message)).catchError((Object e) {
        debugPrint('orbit: the page did not take a message: $e');
      }),
    );
  }

  /// The page's texts in one language (the `language` op): assets/ui/locales/<code>.json, copied there by
  /// tool/sync_ui.sh from phone/ui's build. Only the language the page asks for is read.
  Future<Object?> _languageTexts(String code) async {
    if (!languageTag.hasMatch(code)) throw const OpError(400, 'That is not a language.');
    final String text;
    try {
      text = await _loadAsset('assets/ui/locales/$code.json');
    } catch (_) {
      throw const OpError(404, 'Orbit has no texts for that language yet.');
    }
    final texts = jsonDecode(text);
    if (texts is! Map) throw const OpError(500, 'That language file is broken.');
    return texts;
  }
}

/// One task at a time, in order.
class _Serial {
  Future<void> _tail = Future<void>.value();
  int pending = 0;

  Future<T> run<T>(Future<T> Function() task) {
    pending++;
    final result = _tail.then((_) => task());
    _tail = result.then<void>((_) {}, onError: (Object _) {}).whenComplete(() {
      pending--;
    });
    return result;
  }
}

/// The setup host when none is given (the page never sends a setup op in that build): every setup op says so.
class _NoSetup implements SetupHost {
  const _NoSetup();

  @override
  set onAuthWaiting(void Function()? handler) {}

  @override
  set onLine(void Function(String line)? handler) {}

  Never _off() => throw const OpError(501, 'Orbit Setup is not available in this build.');

  @override
  Future<Map<String, Object?>> scan(Duration window) => _off();

  @override
  Future<Map<String, Object?>> probe(String address, int port) => _off();

  @override
  Future<Map<String, Object?>> connect(String address, int port) => _off();

  @override
  Future<Map<String, Object?>> shell(String cmd, Duration timeout) => _off();

  @override
  Future<Map<String, Object?>> pushAsset(String asset, String to) => _off();

  @override
  Future<Map<String, Object?>> pushText(String text, String to) => _off();

  @override
  Future<Map<String, Object?>> run(String cmd) => _off();

  @override
  Future<Map<String, Object?>> close() => _off();

  @override
  Future<Map<String, Object?>> recordLoad(String key) => _off();

  @override
  Future<Map<String, Object?>> recordSave(String key, Map<String, Object?> record) => _off();
}

/// At most [size] tasks at once; the rest wait their turn.
class _Slots {
  _Slots(this.size);

  final int size;
  int _busy = 0;
  final Queue<Completer<void>> _waiting = Queue();

  Future<T> use<T>(Future<T> Function() task) async {
    if (_busy < size) {
      _busy++;
    } else {
      final turn = Completer<void>();
      _waiting.add(turn);
      await turn.future;
    }
    try {
      return await task();
    } finally {
      if (_waiting.isNotEmpty) {
        _waiting.removeFirst().complete();
      } else {
        _busy--;
      }
    }
  }
}
