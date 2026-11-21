import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import 'discovery.dart';
import 'models.dart';
import 'pointer_udp.dart';
import 'tv_client.dart';
import 'tv_store.dart';

/// How often the link looks again. The defaults are phone/SPEC.md's; tests shorten them.
class LinkTimings {
  const LinkTimings({
    this.poll = const Duration(seconds: 2),
    this.retry = const Duration(seconds: 3),
    this.codeShown = const Duration(minutes: 3),
    this.searchAgain = const [
      Duration(seconds: 5),
      Duration(seconds: 10),
      Duration(seconds: 20),
      Duration(seconds: 30),
    ],
    this.afterAction = const Duration(milliseconds: 200),
    this.quietSearch = const Duration(seconds: 60),
    this.adoptWindow = const Duration(seconds: 30),
    this.relocate = const Duration(seconds: 15),
  });

  /// GET /api/state while connected and on screen.
  final Duration poll;

  /// The chosen TV again while offline and on screen.
  final Duration retry;

  /// How long the TV shows a pairing code.
  final Duration codeShown;

  /// Another discovery run while nothing has been found (one delay per round, the last one repeats).
  final List<Duration> searchAgain;

  /// A state fetch this soon after a volume, media or key action, so the page sees its effect at once.
  final Duration afterAction;

  /// The search by itself while the TV is reached through the cloud (mDNS only).
  final Duration quietSearch;

  /// How long `setupAdopt` keeps checking GET /api/state while Orbit Home starts (phone/SPEC.md, `setupAdopt`).
  final Duration adoptWindow;

  /// While a paired TV is offline and on screen, a discovery run this often looks for it at another address: a router
  /// can give the TV a new address (DHCP, often after a restart), and the saved one then never answers again.
  final Duration relocate;
}

/// The phone's link to one TV: finding it, pairing, the token, the state machine of phone/SPEC.md's status
/// (`searching` → `found` → `needsPairing` → `pairing` → `connected`, and `offline`), polling and retrying.
///
/// Every request that fails says what to show; a 401 to a request that carried the token drops the token and moves
/// to `needsPairing`; a poll or check that gets no answer moves to `offline`, which retries every 3 s while the app is
/// in front. Work started for one TV never changes the link after another TV was chosen or the TV forgotten (each
/// such change starts a new "epoch").
class TvLink {
  TvLink({
    required this._store,
    required this._client,
    required this._discovery,
    PointerSender? pointer,
    this.timings = const LinkTimings(),
  }) : assert(timings.searchAgain.isNotEmpty, 'searchAgain needs at least one delay'),
       _pointer = pointer ?? PointerSender();

  final TvStore _store;
  final TvClient _client;
  final TvDiscovery _discovery;
  final PointerSender _pointer;
  final LinkTimings timings;

  /// Each change of [status].
  void Function(LinkStatus status)? onStatus;

  /// Each TV state the TV sent (GET /api/state: every poll, every check, the `state` op).
  void Function(Map<String, Object?> state)? onTvState;

  /// Whether a paired TV is answering ([isConnected]) changed.
  void Function(bool connected)? onConnectedChanged;

  static final RegExp _tokenPattern = RegExp(r'^[A-Za-z0-9._~-]{16,256}$');
  static const String _forgottenText = 'The TV no longer knows this phone. Pair it again.';

  LinkState _state = LinkState.searching;
  SavedTv? _tv;
  String? _token;
  List<FoundTv> _found = const [];
  String? _error;
  bool _foreground = true;
  bool _helloSeen = false;
  bool _quietSearch = false;
  bool _volumeKeys = true;
  bool _disposed = false;
  int _epoch = 0;
  DateTime? _codeUntil;
  Map<String, Object?>? _tvState;
  String? _statusText;
  bool _connectedSent = false;

  Timer? _pollTimer;
  Timer? _retryTimer;
  Timer? _relocateTimer;
  Timer? _searchTimer;
  Timer? _codeTimer;
  bool _polling = false;
  bool _pollAgain = false;
  int? _checkingEpoch;
  Future<DiscoveryResult>? _discovering;
  int _searchRound = 0;
  Future<void> _saving = Future<void>.value();
  Future<void>? _ready;

  /// Completes once the saved TV and token are read.
  Future<void> get ready => _ready ??= _load();

  LinkStatus get status => LinkStatus(state: _state, tv: _tv, found: _found, error: _error);

  /// The last state the TV sent, or null.
  Map<String, Object?>? get tvState => _tvState;

  /// A paired TV is answering.
  bool get isConnected => _state == LinkState.connected && _token != null && _tv != null;

  /// The `settings` op's volumeKeys.
  bool get volumeKeys => _volumeKeys;

  bool get inFront => _foreground;

  /// Writes to storage finish in order; tests wait for them here.
  Future<void> get saved => _saving;

  /// Reads the saved TV and, when there is one, starts checking it (before the page has even loaded).
  Future<void> start() => ready;

  Future<void> _load() async {
    final stored = await _store.load();
    _tv = stored.tv;
    _token = stored.token;
    _volumeKeys = stored.volumeKeys;
    _emit();
    if (_tv != null) unawaited(_check());
  }

  // ---- what the page asks for ----

  /// `hello`: the status, and discovery starts when no TV is chosen.
  Future<LinkStatus> hello() async {
    await ready;
    _helloSeen = true;
    if (_tv == null) unawaited(_discover(scan: !_quietSearch));
    _reconcile();
    return status;
  }

  /// `discover`: one run of mDNS and the /24 scan (joins a run already going).
  Future<List<FoundTv>> discover() async {
    await ready;
    _searchRound = 0;
    return (await _discover()).found;
  }

  /// `connect` and `manualAddress`: choose the TV at [address]:[port] and keep it.
  ///
  /// The address is asked first, and nothing changes unless it answers like the TV's door (or not at all: a TV that is
  /// off is still chosen, and the link waits for it as `offline`). With a token kept, the token is checked: the same
  /// TV answers 200 (connected), another TV 401 (the token is dropped: needsPairing).
  Future<LinkStatus> connect(String address, int port) async {
    await ready;
    final token = _token;
    Object? answer;
    TvHttpException? refused;
    var unreachable = false;
    try {
      answer = (await _client.request('GET', address, port, '/api/state', token: token)).json;
    } on TvHttpException catch (e) {
      refused = e;
    } on TvUnreachableException {
      unreachable = true;
    }
    if (!unreachable) {
      final ok = refused == null && answer is Map && answer['ok'] == true;
      final unpaired = refused != null && refused.status == 401 && refused.fromDoor;
      if (!ok && !unpaired) {
        if (refused != null && refused.fromDoor) throw OpError(refused.status, refused.message);
        throw OpError(refused?.status ?? 502, 'Something answered at $address, but it is not the TV.');
      }
    }

    final previous = _tv;
    final same = previous != null && previous.address == address && previous.port == port;
    final tv = SavedTv(
      name: _nameFor(address, port, answer),
      address: address,
      port: port,
      udp: same ? previous.udp : kPointerPort,
    );
    _epoch++;
    _stopLinkTimers();
    if (!same) {
      _endCode();
      _tvState = null;
    }
    _tv = tv;
    _save(() => _store.saveTv(tv));
    if (unreachable) {
      _toOffline();
    } else if (refused == null && token != null) {
      _applyTvState(answer);
      _set(LinkState.connected);
    } else {
      // 401: this TV does not know the token kept (another TV, or this one forgot the phone).
      if (token != null && token == _token) _clearToken();
      _toUnpaired();
    }
    return status;
  }

  /// Whether Orbit's door answers at [address]:[port] (a TV with Orbit OS: 200, or its own 401), without choosing it.
  /// A typed address that is not one is asked which other make it is (TvRemote.connectTyped).
  Future<bool> answersAsDoor(String address, int port) async {
    try {
      final answer = (await _client.request('GET', address, port, '/api/state')).json;
      return answer is Map && answer['ok'] == true;
    } on TvHttpException catch (e) {
      return e.fromDoor;
    } on TvUnreachableException {
      return false;
    }
  }

  /// `askCode`: the TV shows a 6-digit code for 3 minutes; the state is `pairing` meanwhile.
  Future<void> askCode() async {
    await ready;
    final tv = _requireTv();
    final epoch = _epoch;
    try {
      await _client.postJson(tv.address, tv.port, '/api/askcode', const <String, Object?>{});
    } on TvHttpException catch (e) {
      if (epoch == _epoch) _noteAnswered();
      throw OpError(e.status, e.message);
    } on TvUnreachableException {
      if (epoch == _epoch) _noteUnanswered(orOffline: !isConnected);
      throw OpError(0, _unreachableText(tv));
    }
    if (epoch != _epoch) return;
    _startCode();
    if (isConnected) {
      _emit();
    } else {
      _set(LinkState.pairing);
    }
  }

  /// `pair`: the code from the TV's screen for a token, kept in secure storage; then `connected`.
  Future<LinkStatus> pair(String code) async {
    await ready;
    final tv = _requireTv();
    final epoch = _epoch;
    if (!isConnected) _set(LinkState.pairing);
    Object? answer;
    try {
      answer = await _client.postJson(tv.address, tv.port, '/api/pair', {'code': code});
    } on TvHttpException catch (e) {
      if (epoch == _epoch && !isConnected) {
        if (e.status == 403) {
          // A wrong code: the code stays on the TV (with fewer tries left).
          if (_codeUntil == null) _startCode();
          _set(LinkState.pairing);
        } else if (e.status == 409 || e.status == 429) {
          // No code on the TV any more: never asked for, timed out, or too many wrong ones.
          _endCode();
          _set(LinkState.needsPairing, error: e.message);
        } else {
          _toUnpaired();
        }
      }
      throw OpError(e.status, e.message);
    } on TvUnreachableException {
      if (epoch == _epoch) _noteUnanswered(orOffline: !isConnected);
      throw OpError(0, _unreachableText(tv));
    }
    if (epoch != _epoch) throw const OpError(409, 'Another TV was chosen meanwhile.');
    final token = answer is Map ? answer['token'] : null;
    if (token is! String || !_tokenPattern.hasMatch(token)) {
      if (!isConnected) _toUnpaired();
      throw const OpError(502, 'The TV did not send a pairing key Orbit can use.');
    }
    _token = token;
    _save(() => _store.saveToken(token));
    _endCode();
    _set(LinkState.connected);
    // The TV's own name, its pointer port and the first state, before the reply (but never holding the reply long:
    // the page gives a request 8 s, and the pair itself may have taken 4).
    _pollTimer?.cancel();
    _pollTimer = null;
    await _poll().timeout(const Duration(milliseconds: 1500), onTimeout: () {});
    return status;
  }

  /// `setupAdopt`: save this TV and token as a finished `pair` would, go `connected`, then confirm with GET
  /// /api/state, retrying for [LinkTimings.adoptWindow] while Orbit Home starts (phone/SPEC.md, `setupAdopt`).
  ///
  /// A door that answers ok → connected; a door that says 401 (the token was not taken) → the token is dropped and
  /// needsPairing; a TV that never answers in the window → offline (the TV and token stay saved, so the normal retry
  /// reconnects once Home is up).
  Future<LinkStatus> adopt(String address, int port, String token, String name) async {
    await ready;
    _epoch++;
    final epoch = _epoch;
    _stopLinkTimers();
    _endCode();
    final tv = SavedTv(name: name.trim().isEmpty ? 'TV' : name.trim(), address: address, port: port);
    _tv = tv;
    _token = token;
    _tvState = null;
    _save(() async {
      await _store.saveTv(tv);
      await _store.saveToken(token);
    });
    _set(LinkState.connected);
    final deadline = DateTime.now().add(timings.adoptWindow);
    while (epoch == _epoch) {
      try {
        final answer = await _client.getJson(address, port, '/api/state', token: token);
        if (epoch != _epoch) break;
        if (answer is Map && answer['ok'] == true) {
          _applyTvState(answer);
          _set(LinkState.connected);
          return status;
        }
      } on TvHttpException catch (e) {
        if (epoch != _epoch) break;
        if (e.status == 401 && e.fromDoor) {
          _clearToken();
          _toUnpaired(error: _forgottenText);
          return status;
        }
        // Any other door answer (it is there, starting up): keep trying.
      } on TvUnreachableException {
        // Not up yet: keep trying.
      }
      if (DateTime.now().isAfter(deadline)) {
        if (epoch == _epoch) _toOffline();
        return status;
      }
      await Future<void>.delayed(timings.retry);
    }
    return status;
  }

  /// `forget`: drop the token and the chosen TV, and look for TVs again.
  Future<LinkStatus> forget() async {
    await ready;
    _epoch++;
    _stopLinkTimers();
    _endCode();
    _tv = null;
    _token = null;
    _tvState = null;
    _save(() async {
      await _store.saveToken(null);
      await _store.saveTv(null);
    });
    _searchRound = 0;
    _set(LinkState.searching);
    if (_helloSeen && _foreground) unawaited(_discover());
    return status;
  }

  /// `state`: GET /api/state now (the page also gets it as a `tvstate` event when it changed).
  Future<Object?> fetchState() async {
    final epoch = _epoch;
    final answer = await getJson('/api/state');
    if (epoch == _epoch) _applyTvState(answer);
    return answer;
  }

  /// A GET that needs the token; the answer as JSON. [quiet] requests (icons) never move the link to offline.
  Future<Object?> getJson(String path, {Map<String, String>? query, bool quiet = false}) => _authorized(
    (tv, token) => _client.getJson(tv.address, tv.port, path, token: token, query: query),
    quiet: quiet,
  );

  /// A GET that needs the token; the raw answer (an icon).
  Future<TvReply> getRaw(String path, {Map<String, String>? query}) => _authorized(
    (tv, token) => _client.request('GET', tv.address, tv.port, path, token: token, query: query),
    quiet: true,
  );

  /// A POST with a JSON body that needs the token; the answer as JSON.
  Future<Object?> postJson(String path, Object body) =>
      _authorized((tv, token) => _client.postJson(tv.address, tv.port, path, body, token: token));

  /// One pointer datagram ('m' move or 's' scroll); nothing when there is no paired TV or the TV has no pointer.
  void pointer(String kind, double dx, double dy) {
    final tv = _tv;
    final token = _token;
    final port = tv?.udp;
    if (tv == null || token == null || port == null) return;
    unawaited(_pointer.send(address: tv.address, port: port, token: token, kind: kind, dx: dx, dy: dy));
  }

  /// The `settings` op's volumeKeys, kept for the next run.
  void setVolumeKeys(bool on) {
    if (_volumeKeys == on) return;
    _volumeKeys = on;
    _save(() => _store.saveVolumeKeys(on));
  }

  /// On while the TV is reached through the cloud: the search that runs by itself while no TV is chosen then only listens
  /// for the TV's mDNS advert, once a minute, and never scans the /24 (the phone may be on someone else's Wi-Fi).
  /// `discover` still does both.
  set quietSearch(bool on) {
    if (_quietSearch == on) return;
    _quietSearch = on;
    _searchTimer?.cancel();
    _searchTimer = null;
    _reconcile();
  }

  bool get quietSearch => _quietSearch;

  /// Polls and retries run only while the app is in front.
  void setForeground(bool inFront) {
    if (_foreground == inFront || _disposed) return;
    _foreground = inFront;
    if (inFront) {
      if (_tv != null) {
        if (_state == LinkState.connected) {
          _pollTimer?.cancel();
          _pollTimer = null;
          unawaited(_poll());
        } else {
          unawaited(_check());
        }
      } else if (_helloSeen) {
        _searchRound = 0;
        unawaited(_discover(scan: !_quietSearch));
      }
    }
    _reconcile();
  }

  /// A fresh state shortly after an action, so the page sees its effect without waiting for the next poll.
  void pollSoon() {
    if (!isConnected || !_foreground || _disposed) return;
    if (_polling) {
      _pollAgain = true;
      return;
    }
    _pollTimer?.cancel();
    _pollTimer = Timer(timings.afterAction, _onPollTimer);
  }

  void dispose() {
    _disposed = true;
    _stopLinkTimers();
    _endCode();
    _searchTimer?.cancel();
    _searchTimer = null;
    _pointer.close();
    _client.close();
  }

  // ---- the state machine ----

  /// Asks the chosen TV for its state and moves to what the answer says: connected, needsPairing (pairing while a
  /// code is on the TV), or offline.
  Future<void> _check() async {
    final tv = _tv;
    if (tv == null || _disposed || _checkingEpoch == _epoch) return;
    final epoch = _checkingEpoch = _epoch;
    final token = _token;
    try {
      final answer = await _client.getJson(tv.address, tv.port, '/api/state', token: token);
      if (epoch != _epoch) return;
      if (answer is! Map || answer['ok'] != true) {
        // Something else answers at this address (another network, another device): not the TV.
        _toOffline();
      } else if (token == null) {
        _toUnpaired();
      } else {
        _applyTvState(answer);
        _set(LinkState.connected);
      }
    } on TvHttpException catch (e) {
      if (epoch != _epoch) return;
      if (!e.fromDoor) {
        _toOffline();
      } else if (e.status == 401) {
        if (token != null && token == _token) {
          await _dropToken(token);
          if (epoch == _epoch) _toUnpaired(error: _forgottenText);
        } else {
          _toUnpaired();
        }
      } else if (token != null) {
        // Only a token the TV knows gets past the door's 401: the TV is there, and something else went wrong.
        _set(LinkState.connected);
      } else {
        _toUnpaired();
      }
    } on TvUnreachableException {
      if (epoch == _epoch) _toOffline();
    } finally {
      if (_checkingEpoch == epoch) _checkingEpoch = null;
      _reconcile();
    }
  }

  void _onPollTimer() {
    _pollTimer = null;
    unawaited(_poll());
  }

  Future<void> _poll() async {
    final tv = _tv;
    final token = _token;
    if (_disposed || tv == null || token == null || _state != LinkState.connected) return;
    if (_polling) {
      _pollAgain = true;
      return;
    }
    _polling = true;
    final epoch = _epoch;
    try {
      final answer = await _client.getJson(tv.address, tv.port, '/api/state', token: token);
      if (epoch == _epoch && token == _token) {
        if (answer is Map && answer['ok'] == true) {
          _applyTvState(answer);
        } else if (_state == LinkState.connected) {
          _toOffline();
        }
      }
    } on TvHttpException catch (e) {
      if (epoch == _epoch && token == _token && e.status == 401 && e.fromDoor) {
        await _dropToken(token);
        if (epoch == _epoch) _toUnpaired(error: _forgottenText);
      } else if (epoch == _epoch && !e.fromDoor && _state == LinkState.connected) {
        _toOffline();
      }
    } on TvUnreachableException {
      if (epoch == _epoch && _state == LinkState.connected) _toOffline();
    } finally {
      _polling = false;
      if (_pollAgain) {
        _pollAgain = false;
        if (isConnected && _foreground && !_disposed) {
          _pollTimer?.cancel();
          _pollTimer = Timer(timings.afterAction, _onPollTimer);
        }
      }
      _reconcile();
    }
  }

  /// Offline with a paired TV: the router may have given the TV another address. One discovery run, then each TV seen
  /// at another address is asked for its state with the token. Only the TV that gave the token accepts it, so the one
  /// that answers ok is ours: the link moves there and keeps the name, the token and the pointer port.
  Future<void> _relocate() async {
    final tv = _tv;
    final token = _token;
    if (_disposed || tv == null || token == null || _state != LinkState.offline) return;
    final epoch = _epoch;
    bool stale() => _disposed || epoch != _epoch || token != _token || _state != LinkState.offline;
    final result = await _discover(scan: !_quietSearch);
    if (stale()) return;
    for (final found in result.found) {
      if (found.address == tv.address && found.port == tv.port) continue;
      Object? answer;
      try {
        answer = await _client.getJson(found.address, found.port, '/api/state', token: token);
      } on TvHttpException {
        continue; // another TV (401: not our token) or something that is not a TV
      } on TvUnreachableException {
        continue;
      }
      if (stale()) return;
      if (answer is! Map || answer['ok'] != true) continue;
      final moved = SavedTv(name: tv.name, address: found.address, port: found.port, udp: tv.udp);
      debugPrint('orbit: ${tv.name} moved from ${tv.address}:${tv.port} to ${moved.address}:${moved.port}');
      _epoch++;
      _stopLinkTimers();
      _tv = moved;
      _save(() => _store.saveTv(moved));
      _applyTvState(answer);
      _set(LinkState.connected);
      return;
    }
  }

  Future<DiscoveryResult> _discover({bool scan = true}) {
    final running = _discovering;
    if (running != null) return running;
    _searchTimer?.cancel();
    _searchTimer = null;
    final run = _runDiscovery(scan: scan);
    _discovering = run;
    unawaited(
      run.whenComplete(() {
        if (identical(_discovering, run)) _discovering = null;
        _reconcile();
      }),
    );
    return run;
  }

  Future<DiscoveryResult> _runDiscovery({bool scan = true}) async {
    final before = _found;
    DiscoveryResult result;
    try {
      result = await _discovery.run(scan: scan, (sofar) {
        if (_disposed) return;
        final keys = {for (final tv in sofar) tv.key};
        _found = [
          ...sofar,
          for (final tv in before)
            if (!keys.contains(tv.key)) tv,
        ];
        if (_tv == null && _found.isNotEmpty && _state == LinkState.searching) {
          _set(LinkState.found);
        } else {
          _emit();
        }
      });
    } on Object catch (e) {
      debugPrint('orbit: discovery failed: $e');
      result = const DiscoveryResult(found: [], onNetwork: true);
    }
    if (_disposed) return result;
    _found = result.found;
    if (_tv == null) {
      if (result.found.isEmpty) {
        _searchRound++;
        _set(
          LinkState.searching,
          error: result.onNetwork ? 'No TV found on this Wi-Fi yet.' : 'The phone is not on Wi-Fi.',
        );
      } else {
        _searchRound = 0;
        _set(LinkState.found);
      }
    } else {
      _emit();
    }
    return result;
  }

  Future<T> _authorized<T>(Future<T> Function(SavedTv tv, String token) send, {bool quiet = false}) async {
    await ready;
    final tv = _tv;
    if (tv == null) throw const OpError(0, 'Choose your TV first.');
    final token = _token;
    if (token == null) throw const OpError(401, 'Pair this phone with the TV first.');
    final epoch = _epoch;
    try {
      final result = await send(tv, token);
      if (epoch == _epoch) _noteAnswered();
      return result;
    } on TvHttpException catch (e) {
      if (epoch == _epoch) {
        if (e.status == 401 && token == _token) {
          await _dropToken(token);
          if (epoch == _epoch) _toUnpaired(error: _forgottenText);
        } else {
          _noteAnswered();
        }
      }
      throw OpError(e.status, e.message);
    } on TvUnreachableException {
      // One slow answer is not the TV gone: a check of the state decides.
      if (epoch == _epoch && !quiet) _noteUnanswered();
      throw OpError(0, _unreachableText(tv));
    }
  }

  /// The TV answered something: out of offline at once.
  void _noteAnswered() {
    if (_state == LinkState.offline) unawaited(_check());
  }

  /// A request got no answer: check whether the TV is still there ([orOffline]: it is not, without asking).
  void _noteUnanswered({bool orOffline = false}) {
    if (orOffline) {
      _toOffline();
    } else if (_state == LinkState.connected) {
      unawaited(_check());
    }
  }

  void _applyTvState(Object? answer) {
    if (answer is! Map) return;
    final state = <String, Object?>{for (final entry in answer.entries) '${entry.key}': entry.value};
    _tvState = state;
    final tv = _tv;
    if (tv != null) {
      var next = tv;
      final name = state['tv'];
      if (name is String && name.trim().isNotEmpty && name.trim() != tv.name) next = next.withName(name.trim());
      if (state.containsKey('udp')) {
        final udp = state['udp'];
        final port = udp is int && udp > 0 && udp <= 65535 ? udp : null;
        if (port != next.udp) next = next.withUdp(port);
      }
      if (next != tv) {
        _tv = next;
        _save(() => _store.saveTv(next));
        _emit();
      }
    }
    // Every answer goes to the page, changed or not: the page moves its controls ahead of the TV (a slider, play and
    // pause) and counts on the next state to put them right if the TV did not follow.
    onTvState?.call(state);
  }

  Future<void> _dropToken(String used) async {
    if (_token != used) return;
    _clearToken();
    await _saving;
  }

  void _clearToken() {
    _token = null;
    _tvState = null;
    _save(() => _store.saveToken(null));
  }

  void _toUnpaired({String? error}) {
    final next = _codeShowing ? LinkState.pairing : LinkState.needsPairing;
    _set(next, error: error ?? (next == _state ? _error : null));
  }

  void _toOffline() {
    final tv = _tv;
    if (tv == null) return;
    _set(LinkState.offline, error: _unreachableText(tv));
  }

  void _set(LinkState state, {String? error}) {
    _state = state;
    _error = error;
    _emit();
    _reconcile();
  }

  void _emit() {
    if (_disposed) return;
    final now = status;
    final text = jsonEncode(now.toJson());
    if (text != _statusText) {
      _statusText = text;
      onStatus?.call(now);
    }
    final connected = isConnected;
    if (connected != _connectedSent) {
      _connectedSent = connected;
      onConnectedChanged?.call(connected);
    }
  }

  /// Starts or stops the timers to match the state: poll (connected), retry (offline), search again (nothing found).
  void _reconcile() {
    if (_disposed) return;
    final tv = _tv;
    if (_foreground && _state == LinkState.connected && tv != null && _token != null) {
      if (_pollTimer == null && !_polling) _pollTimer = Timer(timings.poll, _onPollTimer);
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
    if (_foreground && _state == LinkState.offline && tv != null) {
      _retryTimer ??= Timer(timings.retry, () {
        _retryTimer = null;
        if (_state == LinkState.offline && _foreground) unawaited(_check());
      });
    } else {
      _retryTimer?.cancel();
      _retryTimer = null;
    }
    if (_foreground && _state == LinkState.offline && tv != null && _token != null) {
      _relocateTimer ??= Timer(timings.relocate, () {
        _relocateTimer = null;
        if (_state == LinkState.offline && _foreground) unawaited(_relocate());
      });
    } else {
      _relocateTimer?.cancel();
      _relocateTimer = null;
    }
    if (_foreground && _helloSeen && tv == null && _state == LinkState.searching && _discovering == null) {
      final delay = _quietSearch
          ? timings.quietSearch
          : timings.searchAgain[math.min(_searchRound, timings.searchAgain.length - 1)];
      _searchTimer ??= Timer(delay, () {
        _searchTimer = null;
        unawaited(_discover(scan: !_quietSearch));
      });
    } else {
      _searchTimer?.cancel();
      _searchTimer = null;
    }
  }

  void _stopLinkTimers() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _retryTimer?.cancel();
    _retryTimer = null;
    _relocateTimer?.cancel();
    _relocateTimer = null;
    _pollAgain = false;
  }

  bool get _codeShowing {
    final until = _codeUntil;
    return until != null && DateTime.now().isBefore(until);
  }

  void _startCode() {
    _codeUntil = DateTime.now().add(timings.codeShown);
    _codeTimer?.cancel();
    _codeTimer = Timer(timings.codeShown, () {
      _codeTimer = null;
      _codeUntil = null;
      if (_state == LinkState.pairing) _set(LinkState.needsPairing);
    });
  }

  void _endCode() {
    _codeUntil = null;
    _codeTimer?.cancel();
    _codeTimer = null;
  }

  SavedTv _requireTv() {
    final tv = _tv;
    if (tv == null) throw const OpError(0, 'Choose your TV first.');
    return tv;
  }

  String _nameFor(String address, int port, Object? answer) {
    if (answer is Map) {
      final name = answer['tv'];
      if (name is String && name.trim().isNotEmpty) return name.trim();
    }
    for (final tv in _found) {
      if (tv.address == address && tv.port == port && tv.named) return tv.name;
    }
    final previous = _tv;
    if (previous != null && previous.address == address && previous.port == port) return previous.name;
    return 'TV';
  }

  static String _unreachableText(SavedTv tv) {
    final who = tv.name == 'TV' ? 'The TV' : tv.name;
    return '$who is not answering. Is it on, and is the phone on the home Wi-Fi?';
  }

  /// Keeps writes in order without making the link wait for them.
  void _save(Future<void> Function() write) {
    _saving = _saving.then((_) => write()).catchError((Object e) {
      debugPrint('orbit: not saved: $e');
    });
  }
}
