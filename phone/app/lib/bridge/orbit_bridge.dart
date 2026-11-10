import 'dart:async';
import 'dart:collection';

import 'package:flutter/foundation.dart';

import '../native/native_host.dart';
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
  OrbitBridge({required this.remote, required this.native, required this.icons}) {
    _events = EventQueue(_send);
    remote.onStatus = (status) => _events.push('status', status.toJson());
    remote.onTvState = (state) => _events.push('tvstate', state);
    remote.onConnectedChanged = (_) => _applyVolumeKeys();
    remote.onAccount = (account) => _events.push('account', account);
    remote.help.onFrame = (frame) => _events.push('screen', frame);
    native.onVolumeKey = _onVolumeKey;
  }

  /// The TV over the home Wi-Fi or the cloud.
  final TvRemote remote;
  final NativeHost native;
  final IconCache icons;
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
      default:
        throw OpError(400, op.isEmpty ? 'The message has no op.' : 'Orbit has no "$op".');
    }
  }

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
    _events.push('volumeKey', {'dir': dir});
    // Held down, a key repeats faster than the TV answers: past three waiting steps the rest are let go.
    if (_volume.pending >= 3) return;
    unawaited(_volumeStep(dir).then<void>((_) {}, onError: (Object _) {}));
  }

  Future<void> _volumeStep(String dir) async {
    await _volume.run(() => remote.postJson('/api/key', {'key': dir == 'up' ? 'volup' : 'voldown'}));
    remote.pollSoon();
  }

  void _applyVolumeKeys() => unawaited(native.setVolumeKeys(remote.wifi.volumeKeys && remote.isConnected));

  void _send(Map<String, Object?> message) {
    final run = _run;
    if (run == null) return;
    unawaited(
      run(receiveScript(message)).catchError((Object e) {
        debugPrint('orbit: the page did not take a message: $e');
      }),
    );
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
