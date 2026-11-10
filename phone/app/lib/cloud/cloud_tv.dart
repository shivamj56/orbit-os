import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../tv/models.dart';
import '../tv/tv_client.dart';
import 'account.dart';
import 'backend.dart';

/// How long the cloud path waits. The defaults are phone/SPEC.md's; tests shorten them.
class CloudTimings {
  const CloudTimings({
    this.answer = const Duration(seconds: 7),
    this.linkWait = const Duration(seconds: 25),
    this.onlineWindow = const Duration(minutes: 3),
    this.heartbeat = const Duration(seconds: 10),
    this.pointerGap = const Duration(milliseconds: 100),
    this.lateAnswer = const Duration(seconds: 30),
    this.staleScreen = const Duration(seconds: 30),
  });

  /// A command's answer (`res`), from the moment it is written. The SPEC's "gives up after 8 s", a second early, so these
  /// words reach the page before the page's own 8 s timer for a request runs out.
  final Duration answer;

  /// The TV's first `tv/online` after the link token is written.
  final Duration linkWait;

  /// `tv/online` this recent means the TV is on.
  final Duration onlineWindow;

  /// `watch` while the phone uses the cloud and is in front.
  final Duration heartbeat;

  /// At most one pointer command per gap (10 a second).
  final Duration pointerGap;

  /// How long an answer that came too late is still waited for, to delete it.
  final Duration lateAnswer;

  /// A `screen` picture older than this (by the database's clock) is left over from an earlier help, not shown.
  final Duration staleScreen;
}

/// The account's TV in the Realtime Database (phone/SPEC.md, "From anywhere: Firebase"): whether one is linked and
/// online, linking and unlinking it, and commands to it (`cmd` out, `res` back), the `watch` heartbeat and the
/// `tv/state` stream while the phone uses this path, and the TV's `screen` pictures while help mode wants them.
class CloudTv {
  CloudTv({required this._db, required this._account, this.timings = const CloudTimings(), DateTime Function()? clock})
    : _clock = clock ?? DateTime.now;

  final CloudDb _db;
  final CloudAccount _account;
  final DateTime Function() _clock;
  final CloudTimings timings;

  /// [linked], [online], [name] or [connected] changed.
  void Function()? onChange;

  /// Each `tv/state` while [active] and in front.
  void Function(Map<String, Object?> state)? onTvState;

  /// Each new picture of the TV's screen while [watchScreen] is on and in front: the page's `screen` event.
  void Function(Map<String, Object?> frame)? onScreen;

  String? _uid;
  String? _name;
  int? _onlineAt;
  bool _connected = false;
  int _offset = 0;
  Map<String, Object?>? _state;
  bool _active = false;
  bool _inFront = true;
  bool _screenOn = false;
  bool _started = false;
  final List<StreamSubscription<Object?>> _presence = [];
  StreamSubscription<bool>? _connectedSub;
  StreamSubscription<int>? _offsetSub;
  StreamSubscription<Object?>? _stateSub;
  StreamSubscription<Object?>? _screenSub;
  Timer? _heartbeat;
  Timer? _expiry;
  final Map<String, (double, double)> _pointer = {};
  Timer? _pointerTimer;
  DateTime? _lastPointer;

  /// A TV has linked to this account (`tv/name` is there).
  bool get linked => _uid != null && _name != null;

  /// Linked, and `tv/online` within [CloudTimings.onlineWindow].
  bool get online {
    final at = _onlineAt;
    return linked && at != null && serverNow - at <= timings.onlineWindow.inMilliseconds;
  }

  /// The phone reaches the database.
  bool get connected => _connected;

  /// Commands can go this way: signed in, the TV online, the phone connected.
  bool get usable => _account.signedIn && online && _connected;

  String? get name => _name;

  Map<String, Object?>? get lastState => _state;

  /// The database's clock, as far as this phone can tell.
  int get serverNow => _clock().millisecondsSinceEpoch + _offset;

  /// `account` op / event: `{"signedIn","email","tvLinked","tvOnline","tvName"}`.
  Map<String, Object?> accountJson() => {
    'signedIn': _account.signedIn,
    'email': _account.email,
    'tvLinked': linked,
    'tvOnline': online,
    'tvName': linked ? _name : null,
  };

  void start() {
    if (_started) return;
    _started = true;
    _connectedSub = _db.connected().listen((on) {
      if (on == _connected) return;
      _connected = on;
      _changed();
    }, onError: _ignore);
    _offsetSub = _db.serverTimeOffset().listen((offset) {
      _offset = offset;
      _scheduleExpiry();
      _changed();
    }, onError: _ignore);
    follow(_account.uid);
  }

  /// Watches [uid]'s TV (nothing when signed out).
  void follow(String? uid) {
    if (uid == _uid) return;
    _stopPresence();
    _stopActive();
    _uid = uid;
    _name = null;
    _onlineAt = null;
    _state = null;
    if (uid != null) {
      _presence
        ..add(
          _db.values('orbit/$uid/tv/name').listen((value) {
            final name = value is String && value.trim().isNotEmpty ? value.trim() : null;
            if (name == _name) return;
            _name = name;
            _changed();
          }, onError: _ignore),
        )
        ..add(
          _db.values('orbit/$uid/tv/online').listen((value) {
            final at = value is num ? value.toInt() : null;
            if (at == _onlineAt) return;
            _onlineAt = at;
            _scheduleExpiry();
            _changed();
          }, onError: _ignore),
        );
    }
    _syncActive();
    _changed();
  }

  /// On: the phone is using this path (heartbeat, `tv/state`).
  set active(bool on) {
    if (_active == on) return;
    _active = on;
    _syncActive();
  }

  set inFront(bool on) {
    if (_inFront == on) return;
    _inFront = on;
    _syncActive();
  }

  /// On: help mode wants the TV's screen. `/orbit/{uid}/screen` is followed (each new picture to [onScreen]), and the
  /// `watch` heartbeat runs meanwhile even if this path stopped carrying the TV for a moment: the TV ends help 30 s
  /// after the heartbeat stops.
  set watchScreen(bool on) {
    if (_screenOn == on) return;
    _screenOn = on;
    _syncActive();
  }

  bool get watchScreen => _screenOn;

  // ---- linking ----

  /// `linkTv`: the Google ID token to `/link/{code}/token`, then the TV's first `tv/online` within 25 s.
  Future<void> link(String code) async {
    if (!_account.signedIn) throw const OpError(401, 'Sign in with Google first.');
    if (!_connected) throw const OpError(0, 'No internet on the phone.');
    final token = await _account.freshIdToken();
    final uid = _uid ?? _account.uid;
    if (uid == null) throw const OpError(401, 'Sign in with Google first.');
    follow(uid);
    // Only a stamp written after the token counts (one from an earlier link of the same TV does not).
    final since = serverNow - 2000;
    final online = Completer<void>();
    final watch = _db.values('orbit/$uid/tv/online').listen((value) {
      if (value is num && value.toInt() >= since && !online.isCompleted) online.complete();
    }, onError: _ignore);
    try {
      try {
        await _db.set('link/$code/token', token).timeout(timings.answer);
      } on CloudDenied {
        throw const OpError(403, 'That code is not on the TV.');
      } on TimeoutException {
        throw const OpError(0, 'No internet on the phone.');
      }
      try {
        await online.future.timeout(timings.linkWait);
      } on TimeoutException {
        throw const OpError(0, 'The TV did not answer. Is it on?');
      }
    } finally {
      await watch.cancel();
    }
    // The TV writes its name with the stamp; give it a moment if the stamp came first.
    for (var i = 0; i < 30 && _name == null; i++) {
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  }

  /// `unlinkTv`: `tv/unlink` = true (the TV signs out and shows a link code again); the TV's name, stamp and state go
  /// with it, so the phone no longer counts a TV as linked.
  Future<void> unlink() async {
    final uid = _uid;
    if (uid == null || !_account.signedIn) throw const OpError(401, 'Sign in with Google first.');
    try {
      await _db
          .update('orbit/$uid/tv', {'unlink': true, 'name': null, 'online': null, 'state': null})
          .timeout(const Duration(seconds: 5));
    } on TimeoutException {
      throw const OpError(0, 'No internet on the phone. The TV is unlinked when it is back.');
    } on CloudDenied {
      throw const OpError(403, 'The cloud did not take that. Sign in again.');
    }
    _name = null;
    _onlineAt = null;
    _state = null;
    _changed();
  }

  // ---- commands ----

  /// One command (`cmd/{pushId}` = `{path, body, at}`) and its answer (`res/{pushId}` = `{status, body}`, read once and
  /// deleted). The answer's body, or [OpError] with the TV's status and words.
  Future<Object?> command(String path, Map<String, Object?> body) async {
    final uid = _uid;
    if (uid == null || !_account.signedIn) throw const OpError(401, 'Sign in with Google first.');
    if (!_connected) throw const OpError(0, 'No internet on the phone.');
    final id = _db.pushId('orbit/$uid/cmd');
    final answer = Completer<Object?>();
    final watch = _db
        .values('orbit/$uid/res/$id')
        .listen(
          (value) {
            if (value != null && !answer.isCompleted) answer.complete(value);
          },
          onError: (Object e) {
            if (!answer.isCompleted) answer.completeError(e);
          },
        );
    final clock = Stopwatch()..start();
    var waitLate = false;
    try {
      await _db
          .set('orbit/$uid/cmd/$id', {'path': path, if (body.isNotEmpty) 'body': body, 'at': kServerTimestamp})
          .timeout(timings.answer);
      final left = timings.answer - clock.elapsed;
      final res = await answer.future.timeout(left.isNegative ? Duration.zero : left);
      unawaited(_quietly(_db.remove('orbit/$uid/res/$id')));
      return unwrapAnswer(path, res);
    } on TimeoutException {
      // Asleep or gone: take the command back, and still delete an answer that comes late.
      unawaited(_quietly(_db.remove('orbit/$uid/cmd/$id')));
      waitLate = true;
      unawaited(
        answer.future
            .timeout(timings.lateAnswer)
            .then<void>((_) => _quietly(_db.remove('orbit/$uid/res/$id')), onError: (Object _) {})
            .whenComplete(watch.cancel),
      );
      throw OpError(0, '${_name ?? 'The TV'} is not answering. Is it on?');
    } on CloudDenied {
      throw const OpError(403, 'The cloud did not take that. Sign in again.');
    } on OpError {
      rethrow;
    } on Object catch (e) {
      debugPrint('orbit: cloud command $path: $e');
      throw const OpError(0, 'The cloud did not take that. Try again.');
    } finally {
      if (!waitLate) unawaited(watch.cancel());
    }
  }

  /// A pointer move or scroll ('move' or 'scroll'): summed, and sent as `/api/pointer {action, dx, dy}` at most once
  /// per [CloudTimings.pointerGap].
  void pointer(String action, double dx, double dy) {
    if (!usable || !dx.isFinite || !dy.isFinite) return;
    // Summed in place: the kind that has waited longest goes first.
    final (x, y) = _pointer[action] ?? (0.0, 0.0);
    _pointer[action] = (x + dx, y + dy);
    _schedulePointer();
  }

  void _schedulePointer() {
    if (_pointerTimer != null || _pointer.isEmpty) return;
    final last = _lastPointer;
    var wait = last == null ? Duration.zero : timings.pointerGap - _clock().difference(last);
    if (wait.isNegative) wait = Duration.zero;
    _pointerTimer = Timer(wait, _sendPointer);
  }

  void _sendPointer() {
    _pointerTimer = null;
    if (_pointer.isEmpty) return;
    final action = _pointer.keys.first;
    final (dx, dy) = _pointer.remove(action)!;
    _lastPointer = _clock();
    if (dx != 0 || dy != 0) {
      unawaited(
        command('/api/pointer', {
          'action': action,
          'dx': _round(dx),
          'dy': _round(dy),
        }).then<void>((_) {}, onError: (Object _) {}),
      );
    }
    _schedulePointer();
  }

  static num _round(double v) {
    final r = (v * 100).roundToDouble() / 100;
    return r == r.truncateToDouble() ? r.toInt() : r;
  }

  /// A `res` value: its body for a 2xx, otherwise [OpError] with the status and the TV's words. The state comes in the
  /// shape GET /api/state has on the Wi-Fi path.
  static Object? unwrapAnswer(String path, Object? res) {
    final answer = plainJson(res);
    if (answer is! Map<String, Object?>) throw const OpError(502, 'The TV sent an answer Orbit cannot read.');
    final status = answer['status'];
    final code = status is num ? status.toInt() : 200;
    final body = answer['body'];
    if (code < 200 || code > 299) throw OpError(code, TvClient.errorText(code, body));
    if (path == '/api/state' && body is Map<String, Object?>) return wifiShapedState(body);
    return body;
  }

  /// `tv/state` (or a state answer) in the Wi-Fi shape: `ok:true`, and the fields the database cannot keep as null
  /// (it drops nulls) back as null.
  static Map<String, Object?> wifiShapedState(Map<String, Object?> state) => {
    'ok': true,
    for (final key in const ['tv', 'app', 'pkg', 'player', 'udp']) key: null,
    ...state,
  };

  /// A `screen` value (`{"at":<server ms>,"seq","w","h","jpg"}`) as the page's `screen` event, `at` in this phone's
  /// clock; null when it is not a picture.
  ///
  /// Only the value already there when listening starts ([waiting]) can be left over from an earlier help: it is
  /// dropped when older than [CloudTimings.staleScreen], and its `at` is the TV's, turned into this phone's clock.
  /// Every later value is a picture the TV has just written: its `at` is when it arrived, so a TV whose clock is off
  /// never makes a fresh picture look old (or hides it).
  Map<String, Object?>? screenFrame(Object? value, {bool waiting = false}) {
    final frame = plainJson(value);
    if (frame is! Map<String, Object?>) return null;
    final jpg = frame['jpg'];
    if (jpg is! String || jpg.isEmpty || jpg.length > kMaxScreenChars) return null;
    final phoneNow = _clock().millisecondsSinceEpoch;
    var at = phoneNow;
    if (waiting) {
      final stamp = frame['at'];
      final taken = stamp is num && stamp.isFinite ? stamp.toInt() : serverNow;
      if (serverNow - taken > timings.staleScreen.inMilliseconds) return null;
      at = math.min(taken - _offset, phoneNow);
    }
    final seq = frame['seq'];
    return {
      'jpg': jpg,
      'w': _side(frame['w'], 640),
      'h': _side(frame['h'], 360),
      'seq': seq is num && seq.isFinite ? seq.toInt() : 0,
      'at': at,
    };
  }

  /// A base64 picture longer than this is not handed to the page (the TV's are 20 to 40 KB).
  static const int kMaxScreenChars = 4 << 20;

  static int _side(Object? value, int fallback) =>
      value is num && value.isFinite && value >= 1 && value <= 8192 ? value.toInt() : fallback;

  // ---- internals ----

  void _syncActive() {
    final uid = _uid;
    final watching = _inFront && uid != null;
    if (watching && (_active || _screenOn)) {
      if (_heartbeat == null) {
        _beat();
        _heartbeat = Timer.periodic(timings.heartbeat, (_) => _beat());
      }
    } else {
      _heartbeat?.cancel();
      _heartbeat = null;
    }
    if (watching && _active) {
      _stateSub ??= _db.values('orbit/$uid/tv/state').listen((value) {
        final state = plainJson(value);
        if (state is! Map<String, Object?>) return;
        final shaped = wifiShapedState(state);
        _state = shaped;
        onTvState?.call(shaped);
      }, onError: _ignore);
    } else {
      unawaited(_stateSub?.cancel());
      _stateSub = null;
      _pointerTimer?.cancel();
      _pointerTimer = null;
      _pointer.clear();
    }
    if (watching && _screenOn) {
      if (_screenSub == null) {
        var waiting = true;
        _screenSub = _db.values('orbit/$uid/screen').listen((value) {
          final frame = screenFrame(value, waiting: waiting);
          waiting = false;
          if (frame != null) onScreen?.call(frame);
        }, onError: _ignore);
      }
    } else {
      unawaited(_screenSub?.cancel());
      _screenSub = null;
    }
  }

  void _beat() {
    final uid = _uid;
    if (uid == null) return;
    unawaited(_quietly(_db.set('orbit/$uid/watch', kServerTimestamp)));
  }

  void _stopActive() {
    _heartbeat?.cancel();
    _heartbeat = null;
    unawaited(_stateSub?.cancel());
    _stateSub = null;
    unawaited(_screenSub?.cancel());
    _screenSub = null;
    _pointerTimer?.cancel();
    _pointerTimer = null;
    _pointer.clear();
  }

  void _stopPresence() {
    for (final sub in _presence) {
      unawaited(sub.cancel());
    }
    _presence.clear();
    _expiry?.cancel();
    _expiry = null;
  }

  /// Wakes [onChange] when the newest stamp grows too old.
  void _scheduleExpiry() {
    _expiry?.cancel();
    _expiry = null;
    final at = _onlineAt;
    if (at == null) return;
    final left = at + timings.onlineWindow.inMilliseconds - serverNow;
    if (left <= 0) return;
    _expiry = Timer(Duration(milliseconds: math.min(left + 50, 1 << 31)), () {
      _expiry = null;
      _changed();
    });
  }

  void _changed() => onChange?.call();

  static void _ignore(Object e) => debugPrint('orbit: cloud: $e');

  static Future<void> _quietly(Future<void> write) => write.catchError((Object e) {
    debugPrint('orbit: cloud write: $e');
  });

  void dispose() {
    _stopPresence();
    _stopActive();
    unawaited(_connectedSub?.cancel());
    unawaited(_offsetSub?.cancel());
    _connectedSub = null;
    _offsetSub = null;
  }
}
