import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models.dart';
import 'brand.dart';

/// A TV of another make as the phone keeps it: which make, where, and what it said about itself.
class DirectTv {
  const DirectTv({required this.kind, required this.name, required this.address, int? port, this.model, this.mac})
    : port = port ?? 0;

  final TvKind kind;
  final String name;
  final String address;

  /// The remote service's port; 0 means the make's usual one ([TvKind.port]).
  final int port;
  final String? model;

  /// For Wake-on-LAN ("aa:bb:cc:dd:ee:ff"), when the TV said it.
  final String? mac;

  int get effectivePort => port == 0 ? kind.port : port;

  DirectTv copyWith({String? name, String? model, String? mac}) => DirectTv(
    kind: kind,
    name: name ?? this.name,
    address: address,
    port: port,
    model: model ?? this.model,
    mac: mac ?? this.mac,
  );

  Map<String, Object?> toJson() => {
    'kind': kind.wire,
    'name': name,
    'address': address,
    'port': port,
    'model': model,
    'mac': mac,
  };

  /// Null for anything that is not a kept TV of a known make (never half-read).
  static DirectTv? fromJson(Object? json) {
    if (json is! Map) return null;
    final kind = TvKind.parse(json['kind']);
    final name = json['name'];
    final address = json['address'];
    final port = json['port'];
    final model = json['model'];
    final mac = json['mac'];
    if (kind == null || name is! String || address is! String || address.isEmpty) return null;
    return DirectTv(
      kind: kind,
      name: name.trim().isEmpty ? DirectLink.makeName(kind) : name,
      address: address,
      port: port is int && port > 0 && port <= 65535 ? port : 0,
      model: model is String && model.isNotEmpty ? model : null,
      mac: mac is String && DirectLink.macPattern.hasMatch(mac) ? mac.toLowerCase() : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is DirectTv &&
      other.kind == kind &&
      other.name == name &&
      other.address == address &&
      other.port == port &&
      other.model == model &&
      other.mac == mac;

  @override
  int get hashCode => Object.hash(kind, name, address, port, model, mac);

  @override
  String toString() => 'DirectTv(${kind.wire}, $name, $address:$effectivePort)';
}

/// What [DirectStore] keeps between runs.
class StoredDirect {
  const StoredDirect({this.tv, this.secret, this.active = false});

  final DirectTv? tv;

  /// The make's pairing secret (Samsung's token, LG's client key), never shown to the page.
  final String? secret;

  /// The kept TV is the one the phone drives (rather than a TV with Orbit OS, kept by TvStore).
  final bool active;
}

/// Where the kept TV of another make lives.
abstract interface class DirectStore {
  Future<StoredDirect> load();

  Future<void> save(StoredDirect value);
}

/// [DirectStore] in flutter_secure_storage, next to the Orbit TV's own entries (tv/tv_store.dart). A store that cannot
/// be read starts empty: the person chooses the TV again.
class SecureDirectStore implements DirectStore {
  SecureDirectStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const String _kTv = 'orbit.direct.tv';
  static const String _kSecret = 'orbit.direct.secret';
  static const String _kActive = 'orbit.direct.active';

  final FlutterSecureStorage _storage;

  @override
  Future<StoredDirect> load() async {
    try {
      final tvText = await _storage.read(key: _kTv);
      final secret = await _storage.read(key: _kSecret);
      final active = await _storage.read(key: _kActive);
      DirectTv? tv;
      if (tvText != null) {
        try {
          tv = DirectTv.fromJson(jsonDecode(tvText));
        } on FormatException {
          tv = null;
        }
      }
      return StoredDirect(
        tv: tv,
        secret: secret != null && secret.isNotEmpty ? secret : null,
        active: tv != null && active == 'true',
      );
    } on Object catch (e) {
      debugPrint('orbit: the kept TV could not be read, starting fresh: $e');
      return const StoredDirect();
    }
  }

  @override
  Future<void> save(StoredDirect value) async {
    final tv = value.tv;
    await _write(_kTv, tv == null ? null : jsonEncode(tv.toJson()));
    await _write(_kSecret, value.secret);
    await _write(_kActive, value.active && tv != null ? 'true' : null);
  }

  Future<void> _write(String key, String? value) async {
    try {
      if (value == null) {
        await _storage.delete(key: key);
      } else {
        await _storage.write(key: key, value: value);
      }
    } on Object catch (e) {
      debugPrint('orbit: could not save $key: $e');
    }
  }
}

/// [DirectStore] in memory, for tests.
class MemoryDirectStore implements DirectStore {
  MemoryDirectStore([this.value = const StoredDirect()]);

  StoredDirect value;

  @override
  Future<StoredDirect> load() async => value;

  @override
  Future<void> save(StoredDirect value) async => this.value = value;
}

/// Makes the driver for a kept TV, with the secret from an earlier pairing.
typedef MakeBrandTv = BrandTv Function(DirectTv tv, String? secret);

/// Sends Wake-on-LAN's magic packet for a MAC address.
typedef Waker = Future<bool> Function(String mac, String address);

/// How often the link looks again. Tests shorten them.
class DirectTimings {
  const DirectTimings({
    this.poll = const Duration(seconds: 3),
    this.retry = const Duration(seconds: 5),
    this.showPrompt = const Duration(milliseconds: 1200),
    this.reply = const Duration(milliseconds: 1500),
    this.searchAgain = const [
      Duration(seconds: 6),
      Duration(seconds: 12),
      Duration(seconds: 25),
      Duration(seconds: 45),
    ],
  });

  /// The TV's state while connected and on screen.
  final Duration poll;

  /// The chosen TV again while it does not answer and the app is on screen.
  final Duration retry;

  /// A first connection that has not finished after this long is waiting for the person at the TV: the page then
  /// says "Press Allow on the TV".
  final Duration showPrompt;

  /// How long `connect` waits before answering the page (the rest comes as status events; the page gives a request
  /// 8 s, and a prompt on the TV can wait a minute).
  final Duration reply;

  /// Another search for TVs while none is chosen (one delay per round, the last repeats).
  final List<Duration> searchAgain;
}

/// The phone's link to one TV of another make (phone/SPEC.md, "Every TV"): choosing it, pairing (accepting on the TV,
/// or typing the code it shows), reconnecting when it comes back, its state, and the commands the page sends.
///
/// The link speaks the same status as the Orbit TV's (`needsPairing` → `pairing` → `connected`, `offline`) with
/// `tv.kind` and `tv.caps` added, and `pairing` saying how ([LinkStatus.pairing]). It also keeps the TVs of other makes
/// the search found, for the page's list (TvRemote merges them with the Orbit TVs).
///
/// Work started for one TV never changes the link after another TV was chosen or the TV forgotten (each such change
/// starts a new "epoch").
class DirectLink {
  DirectLink({required this._store, required this._make, required this._finder, Waker? waker, this.timings = const DirectTimings()})
    : _waker = waker ?? wakeOnLan;

  final DirectStore _store;
  final MakeBrandTv _make;
  final BrandFinder _finder;
  final Waker _waker;
  final DirectTimings timings;

  /// Each change of [status].
  void Function(LinkStatus status)? onStatus;

  /// Each state of the TV, in the shape of the Orbit TV's (phone/SPEC.md, GET /api/state) with `kind` added.
  void Function(Map<String, Object?> state)? onTvState;

  /// [isConnected] changed.
  void Function(bool connected)? onConnectedChanged;

  /// The TVs the search found changed.
  void Function(List<BrandFound> found)? onFound;

  static final RegExp macPattern = RegExp(r'^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$');

  /// What a TV of each make can do before it said so itself (it may add to this once connected).
  static const Map<TvKind, List<String>> defaultCaps = {
    TvKind.samsung: [Cap.keys, Cap.volume, Cap.mute, Cap.media, Cap.type, Cap.apps, Cap.launch, Cap.power, Cap.settings],
    TvKind.lg: [
      Cap.keys, Cap.volume, Cap.mute, Cap.volumeLevel, Cap.media, Cap.type, Cap.apps, Cap.launch, Cap.power,
      Cap.pointer, Cap.settings, Cap.nowPlaying,
    ],
    TvKind.roku: [Cap.keys, Cap.media, Cap.type, Cap.apps, Cap.launch, Cap.settings, Cap.nowPlaying],
    TvKind.androidtv: [
      Cap.keys, Cap.volume, Cap.mute, Cap.media, Cap.recents, Cap.settings, Cap.power, Cap.launch, Cap.apps,
      Cap.nowPlaying,
    ],
    TvKind.firetv: [
      Cap.keys, Cap.volume, Cap.mute, Cap.media, Cap.type, Cap.apps, Cap.launch, Cap.power, Cap.settings,
      Cap.nowPlaying,
    ],
  };

  /// The make's own name, for a TV that gave none.
  static String makeName(TvKind kind) => switch (kind) {
    TvKind.samsung => 'Samsung TV',
    TvKind.lg => 'LG TV',
    TvKind.roku => 'Roku',
    TvKind.androidtv => 'Google TV',
    TvKind.firetv => 'Fire TV',
  };

  DirectTv? _tv;
  String? _secret;
  bool _active = false;
  BrandTv? _driver;
  LinkState _state = LinkState.searching;
  String? _error;
  Map<String, Object?>? _pairing;
  List<String>? _caps;
  Map<String, Object?>? _tvState;
  List<BrandFound> _found = const [];
  bool _foreground = true;
  bool _searching = false;
  bool _disposed = false;
  int _epoch = 0;
  bool _attempting = false;
  bool _polling = false;
  int _searchRound = 0;
  String? _statusText;
  bool _connectedSent = false;

  Timer? _pollTimer;
  Timer? _retryTimer;
  Timer? _searchTimer;
  Future<List<BrandFound>>? _discovering;
  Future<void> _saving = Future<void>.value();
  Future<void>? _ready;

  /// Completes once the kept TV is read.
  Future<void> get ready => _ready ??= _load();

  /// Writes to storage finish in order; tests wait for them here.
  Future<void> get saved => _saving;

  /// A TV of another make is the one the phone drives.
  bool get active => _active && _tv != null;

  /// The kept TV, active or not.
  DirectTv? get tv => _tv;

  bool get isConnected => active && _state == LinkState.connected && (_driver?.isOpen ?? false);

  /// What the TV can do from the phone (the driver's own list once connected).
  List<String> get caps {
    final tv = _tv;
    if (tv == null) return const [];
    return _caps ?? defaultCaps[tv.kind]!;
  }

  LinkStatus get status {
    final tv = _tv;
    return LinkStatus(
      state: _state,
      tv: tv == null
          ? null
          : SavedTv(
              name: tv.name,
              address: tv.address,
              port: tv.effectivePort,
              udp: null,
              kind: tv.kind.wire,
              model: tv.model,
              caps: caps,
            ),
      error: _error,
      pairing: _pairing,
    );
  }

  /// The TVs of other makes the last search found.
  List<BrandFound> get found => _found;

  /// The last state the TV sent, or null.
  Map<String, Object?>? get tvState => _tvState;

  Future<void> _load() async {
    final stored = await _store.load();
    _tv = stored.tv;
    _secret = stored.secret;
    _active = stored.active && stored.tv != null;
    if (active) {
      _driver = _makeDriver(_tv!, _secret);
      _state = LinkState.offline;
      unawaited(_attempt());
    }
    _emit();
  }

  /// Starts: reads the kept TV and, when it is the active one, connects to it.
  Future<void> start() => ready;

  // ---- what the page asks for ----

  /// `connect` with a make: this TV becomes the one the phone drives, and the link connects to it. Answers within
  /// [DirectTimings.reply] with the status then; the rest (accepting on the TV, which can take a minute) comes as
  /// status events.
  Future<LinkStatus> choose(TvKind kind, String address, {int? port, String? name, String? model, String? mac}) async {
    await ready;
    final previous = _tv;
    final same = previous != null && previous.kind == kind && previous.address == address;
    final seen = _foundAt(address, kind);
    final tv = DirectTv(
      kind: kind,
      name: _nonEmpty(name) ?? seen?.name ?? (same ? previous.name : makeName(kind)),
      address: address,
      port: port ?? seen?.port ?? (same ? previous.port : 0),
      model: _nonEmpty(model) ?? seen?.model ?? (same ? previous.model : null),
      mac: _macOrNull(mac) ?? _macOrNull(seen?.mac) ?? (same ? previous.mac : null),
    );
    _epoch++;
    _stopLinkTimers();
    await _closeDriver();
    if (!same) _secret = null;
    _tv = tv;
    _active = true;
    _tvState = null;
    _caps = null;
    _saveAll();
    _driver = _makeDriver(tv, _secret);
    _set(LinkState.offline, error: null, pairing: null);
    final attempt = _attempt();
    await Future.any<void>([attempt, Future<void>.delayed(timings.reply)]);
    return status;
  }

  /// Another TV (one with Orbit OS) was chosen: this one stops, and is kept for later.
  Future<void> release() async {
    await ready;
    if (!_active) return;
    _epoch++;
    _stopLinkTimers();
    await _closeDriver();
    _active = false;
    _tvState = null;
    _saveAll();
    _set(LinkState.searching, error: null, pairing: null);
  }

  /// `forget`: the kept TV and its secret go.
  Future<LinkStatus> forget() async {
    await ready;
    _epoch++;
    _stopLinkTimers();
    await _closeDriver();
    _tv = null;
    _secret = null;
    _active = false;
    _caps = null;
    _tvState = null;
    _saveAll();
    _searchRound = 0;
    _set(LinkState.searching, error: null, pairing: null);
    return status;
  }

  /// `askCode` (code pairing): the TV shows its code.
  Future<void> askCode() async {
    final driver = _requireDriver();
    final epoch = _epoch;
    if (driver.pairingWay != PairingWay.code) {
      // Accepting on the TV: asking again is choosing the TV again (the prompt shows again).
      await _attemptAgain();
      return;
    }
    try {
      await driver.startPairing();
    } on Object catch (e) {
      throw _opError(e, epoch);
    }
    if (epoch != _epoch) return;
    _set(LinkState.pairing, error: null, pairing: _pairingFor(driver));
  }

  /// `pair` (code pairing): the code the person typed.
  Future<LinkStatus> pair(String code) async {
    final driver = _requireDriver();
    final epoch = _epoch;
    try {
      await driver.finishPairing(code);
    } on BrandRefused catch (e) {
      if (epoch == _epoch && e.reason == BrandRefused.wrongCode) {
        _set(LinkState.pairing, error: null, pairing: _pairingFor(driver));
        throw OpError(403, e.message);
      }
      throw _opError(e, epoch);
    } on Object catch (e) {
      throw _opError(e, epoch);
    }
    if (epoch != _epoch) throw const OpError(409, 'Another TV was chosen meanwhile.');
    _opened(driver);
    return status;
  }

  /// Try the chosen TV again now (after a refusal, a timeout, or a setting the person just changed).
  Future<LinkStatus> again() async {
    await ready;
    if (!active) throw const OpError(0, 'Choose your TV first.');
    await _attemptAgain();
    return status;
  }

  Future<void> _attemptAgain() async {
    _epoch++;
    _stopLinkTimers();
    final attempt = _attempt();
    await Future.any<void>([attempt, Future<void>.delayed(timings.reply)]);
  }

  /// `state`: the TV's state now (also sent as a `tvstate` event).
  Future<Map<String, Object?>> fetchState() => _command((tv) async {
    final state = _stateJson(await tv.state());
    _tvState = state;
    onTvState?.call(state);
    return state;
  });

  Future<void> key(String key) => _command((tv) async {
    await tv.key(key);
    pollSoon();
  });

  Future<void> media(String action) => key(action);

  Future<Object?> type(String text, {bool submit = false}) => _command((tv) async {
    await tv.type(text, submit: submit);
    return <String, Object?>{'ok': true};
  });

  /// `apps`: `[{"pkg": id, "label": …}]`, the shape of the Orbit TV's list.
  Future<List<Map<String, Object?>>> apps() => _command((tv) async => [for (final app in await tv.apps()) app.toJson()]);

  Future<Object?> launch(String id) => _command((tv) async {
    await tv.launch(id);
    pollSoon();
    return <String, Object?>{'ok': true};
  });

  /// An app's picture: (media type, bytes). A make without pictures answers 404 (the page draws the app's letter).
  Future<(String, Uint8List)> icon(String id) => _command((tv) async {
    final icon = await tv.icon(id);
    if (icon == null) throw const OpError(404, 'This TV has no picture for that app.');
    return icon;
  });

  Future<void> sleep() => _command((tv) => tv.sleep());

  /// Puts an app on the TV (only a TV that takes one: [InstallsApps], Fire TV).
  Future<void> install(Uint8List apk, String name) => _command((tv) async {
    if (tv is! InstallsApps) throw const BrandError('This TV cannot take an app from the phone.', unsupported: true);
    await (tv as InstallsApps).installApk(apk, name);
  });

  Future<Map<String, Object?>> volume(int level) => _command((tv) async {
    await tv.setVolume(level);
    pollSoon();
    final max = _tvState?['max'];
    return <String, Object?>{'volume': level, 'max': max is num ? max : 100};
  });

  /// A pointer move ('m') or scroll ('s'): only a TV with a pointer (LG) takes it; nothing otherwise.
  void pointer(String kind, double dx, double dy) {
    final driver = _driver;
    if (!isConnected || driver == null || !caps.contains(Cap.pointer)) return;
    driver.pointer(kind, dx, dy);
  }

  Future<void> click() => _command((tv) => tv.click());

  /// Wakes the TV with Wake-on-LAN when its MAC address is known: `{"sent": bool}`.
  Future<Map<String, Object?>> wake() async {
    await ready;
    final tv = _tv;
    if (tv == null || !active) throw const OpError(0, 'Choose your TV first.');
    final mac = tv.mac ?? _driver?.mac;
    if (mac == null) return {'sent': false};
    final sent = await _waker(mac, tv.address);
    // The TV takes a few seconds to come up: look for it sooner than the usual retry.
    if (sent && _state == LinkState.offline) {
      _retryTimer?.cancel();
      _retryTimer = Timer(const Duration(seconds: 3), _onRetryTimer);
    }
    return {'sent': sent};
  }

  /// One search for TVs of other makes (joins a search already going).
  Future<List<BrandFound>> discover() {
    final running = _discovering;
    if (running != null) return running;
    _searchTimer?.cancel();
    _searchTimer = null;
    final run = _runDiscovery();
    _discovering = run;
    unawaited(
      run.whenComplete(() {
        if (identical(_discovering, run)) _discovering = null;
        _reconcile();
      }),
    );
    return run;
  }

  /// Which make answers at a typed address, or null.
  Future<BrandFound?> probe(String address) async {
    try {
      return await _finder.probe(address);
    } on Object catch (e) {
      debugPrint('orbit: probe of $address failed: $e');
      return null;
    }
  }

  /// On while no TV is chosen and the page is looking (TvRemote decides): the search repeats by itself.
  set searching(bool on) {
    if (_searching == on) return;
    _searching = on;
    if (on) _searchRound = 0;
    _reconcile();
  }

  /// Polls, retries and searches run only while the app is in front.
  void setForeground(bool inFront) {
    if (_foreground == inFront || _disposed) return;
    _foreground = inFront;
    if (inFront && active && _state == LinkState.connected) pollSoon();
    if (inFront && active && _state == LinkState.offline && !_attempting) unawaited(_attempt());
    _reconcile();
  }

  /// A fresh state shortly after an action.
  void pollSoon() {
    if (!isConnected || !_foreground || _disposed) return;
    _pollTimer?.cancel();
    _pollTimer = Timer(const Duration(milliseconds: 250), _onPollTimer);
  }

  void dispose() {
    _disposed = true;
    _stopLinkTimers();
    _searchTimer?.cancel();
    _searchTimer = null;
    final driver = _driver;
    _driver = null;
    if (driver != null) unawaited(driver.close().catchError((Object _) {}));
  }

  // ---- inside ----

  BrandTv _makeDriver(DirectTv tv, String? secret) {
    final driver = _make(tv, secret);
    return driver;
  }

  Future<void> _closeDriver() async {
    final driver = _driver;
    _driver = null;
    if (driver == null) return;
    driver.onClosed = null;
    driver.onChanged = null;
    try {
      await driver.close();
    } on Object catch (e) {
      debugPrint('orbit: closing the TV link: $e');
    }
  }

  /// One try at connecting the chosen TV; the status follows what happened.
  Future<void> _attempt() async {
    final driver = _driver;
    if (driver == null || _disposed || !_active) return;
    final epoch = _epoch;
    _attempting = true;
    Timer? prompt;
    if (driver.pairingWay == PairingWay.allow) {
      prompt = Timer(timings.showPrompt, () {
        if (epoch == _epoch && _state != LinkState.connected) {
          _set(LinkState.pairing, error: null, pairing: _pairingFor(driver));
        }
      });
    }
    try {
      await driver.connect();
      if (epoch != _epoch) return;
      _opened(driver);
    } on BrandNeedsPairing {
      if (epoch == _epoch) _set(LinkState.needsPairing, error: null, pairing: _pairingFor(driver));
    } on BrandRefused catch (e) {
      if (epoch != _epoch) return;
      if (e.reason == BrandRefused.setting) {
        _set(LinkState.needsPairing, error: e.message, pairing: const {'how': 'setting'});
      } else {
        _set(LinkState.needsPairing, error: e.message, pairing: _pairingFor(driver) ?? const {'how': 'allow'});
      }
    } on BrandUnreachable {
      if (epoch == _epoch) _toOffline();
    } on BrandError catch (e) {
      if (epoch == _epoch) _toOffline(error: e.message);
    } on Object catch (e) {
      debugPrint('orbit: connecting ${_tv?.kind.wire} failed: $e');
      if (epoch == _epoch) _toOffline();
    } finally {
      prompt?.cancel();
      if (epoch == _epoch) _attempting = false;
      _reconcile();
    }
  }

  /// The driver is open: keep its secret and what it said, and go connected.
  void _opened(BrandTv driver) {
    if (!identical(driver, _driver)) return;
    final tv = _tv;
    if (tv == null) return;
    var changed = false;
    if (driver.secret != null && driver.secret != _secret) {
      _secret = driver.secret;
      changed = true;
    }
    final model = _nonEmpty(driver.model);
    final mac = _macOrNull(driver.mac);
    if ((model != null && model != tv.model) || (mac != null && mac != tv.mac)) {
      _tv = tv.copyWith(model: model, mac: mac);
      changed = true;
    }
    if (changed) _saveAll();
    final caps = driver.caps.toList()..sort();
    _caps = caps;
    driver.onClosed = () {
      if (identical(driver, _driver) && _active && _state == LinkState.connected) {
        _toOffline();
        _reconcile();
      }
    };
    driver.onChanged = () {
      if (identical(driver, _driver)) pollSoon();
    };
    _set(LinkState.connected, error: null, pairing: null);
    pollSoon();
  }

  Map<String, Object?>? _pairingFor(BrandTv driver) => switch (driver.pairingWay) {
    PairingWay.allow => const {'how': 'allow'},
    PairingWay.code => const {'how': 'code', 'length': 6, 'chars': 'hex'},
    PairingWay.none => null,
  };

  /// A command for the connected TV, its failures in the page's words.
  Future<T> _command<T>(Future<T> Function(BrandTv tv) run) async {
    await ready;
    final driver = _requireDriver();
    if (_state != LinkState.connected) {
      if (_state == LinkState.needsPairing || _state == LinkState.pairing) {
        throw const OpError(401, 'Pair this phone with the TV first.');
      }
      throw OpError(0, _unreachableText());
    }
    final epoch = _epoch;
    try {
      return await run(driver);
    } on OpError {
      rethrow;
    } on Object catch (e) {
      throw _opError(e, epoch);
    }
  }

  /// A driver's failure as the page's error, and the link's state after it.
  OpError _opError(Object e, int epoch) {
    final current = epoch == _epoch;
    switch (e) {
      case BrandUnreachable():
        if (current) _toOffline();
        return OpError(0, _unreachableText());
      case BrandNeedsPairing(:final message):
        final driver = _driver;
        if (current && driver != null) _set(LinkState.needsPairing, error: null, pairing: _pairingFor(driver));
        return OpError(401, message);
      case BrandRefused(:final reason, :final message):
        if (current && reason == BrandRefused.setting) {
          _set(LinkState.needsPairing, error: message, pairing: const {'how': 'setting'});
        }
        return OpError(403, message);
      case BrandError(:final message, :final unsupported):
        return OpError(unsupported ? 501 : 502, message);
      default:
        debugPrint('orbit: TV command failed: $e');
        return const OpError(502, 'The TV did not take that.');
    }
  }

  BrandTv _requireDriver() {
    final driver = _driver;
    if (!active || driver == null) throw const OpError(0, 'Choose your TV first.');
    return driver;
  }

  void _onPollTimer() {
    _pollTimer = null;
    unawaited(_poll());
  }

  Future<void> _poll() async {
    final driver = _driver;
    if (_disposed || driver == null || !isConnected || _polling) return;
    _polling = true;
    final epoch = _epoch;
    try {
      final state = _stateJson(await driver.state());
      if (epoch == _epoch && identical(driver, _driver)) {
        _tvState = state;
        onTvState?.call(state);
      }
    } on BrandUnreachable {
      if (epoch == _epoch) _toOffline();
    } on Object catch (e) {
      // A state the TV could not give this time; the controls still work.
      debugPrint('orbit: TV state: $e');
    } finally {
      _polling = false;
      _reconcile();
    }
  }

  /// The driver's state in the shape the page knows (phone/SPEC.md, GET /api/state), with `kind`, and
  /// `volumeKnown: false` when the make does not tell its volume.
  Map<String, Object?> _stateJson(Map<String, Object?> s) {
    final tv = _tv;
    final volume = s['volume'];
    final max = s['max'];
    final app = s['app'];
    final pkg = s['pkg'];
    return {
      'ok': true,
      'tv': tv?.name,
      'app': app is String && app.isNotEmpty ? app : null,
      'pkg': pkg is String && pkg.isNotEmpty ? pkg : null,
      'title': '',
      'artist': '',
      'playing': false,
      'position': 0,
      'duration': 0,
      'player': null,
      'volume': volume is num ? volume.round() : 0,
      'max': max is num && max > 0 ? max.round() : 100,
      'muted': s['muted'] == true,
      'udp': null,
      'pointer': caps.contains(Cap.pointer),
      'kind': tv?.kind.wire,
      'volumeKnown': volume is num,
      if (s['on'] is bool) 'on': s['on'],
    };
  }

  Future<List<BrandFound>> _runDiscovery() async {
    List<BrandFound> result;
    try {
      result = await _finder.run((sofar) {
        if (_disposed) return;
        _found = sofar;
        onFound?.call(_found);
      });
    } on Object catch (e) {
      debugPrint('orbit: search for TVs failed: $e');
      result = _found;
    }
    if (_disposed) return result;
    _found = result;
    _searchRound = result.isEmpty ? _searchRound + 1 : 0;
    onFound?.call(_found);
    return result;
  }

  BrandFound? _foundAt(String address, TvKind kind) {
    for (final f in _found) {
      if (f.address == address && f.kind == kind) return f;
    }
    return null;
  }

  void _onRetryTimer() {
    _retryTimer = null;
    if (active && _state == LinkState.offline && _foreground && !_attempting) unawaited(_attempt());
  }

  void _toOffline({String? error}) {
    if (_tv == null) return;
    _set(LinkState.offline, error: error ?? _unreachableText(), pairing: null);
  }

  void _set(LinkState state, {required String? error, required Map<String, Object?>? pairing}) {
    _state = state;
    _error = error;
    _pairing = pairing;
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

  /// Starts or stops the timers to match the state: poll (connected), retry (offline), search (looking, none chosen).
  void _reconcile() {
    if (_disposed) return;
    if (_foreground && isConnected) {
      _pollTimer ??= Timer(timings.poll, _onPollTimer);
    } else {
      _pollTimer?.cancel();
      _pollTimer = null;
    }
    if (_foreground && active && _state == LinkState.offline && !_attempting) {
      _retryTimer ??= Timer(timings.retry, _onRetryTimer);
    } else if (!(_state == LinkState.offline && active)) {
      _retryTimer?.cancel();
      _retryTimer = null;
    }
    if (_foreground && _searching && !active && _discovering == null) {
      final delay = timings.searchAgain[math.min(_searchRound, timings.searchAgain.length - 1)];
      _searchTimer ??= Timer(delay, () {
        _searchTimer = null;
        if (_searching && !active) unawaited(discover());
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
  }

  String _unreachableText() {
    final tv = _tv;
    final who = tv == null || tv.name == 'TV' ? 'The TV' : tv.name;
    return '$who is not answering. Is it on, and is the phone on the home Wi-Fi?';
  }

  void _saveAll() {
    final value = StoredDirect(tv: _tv, secret: _secret, active: _active);
    _saving = _saving.then((_) => _store.save(value)).catchError((Object e) {
      debugPrint('orbit: not saved: $e');
    });
  }

  static String? _nonEmpty(String? s) => s == null || s.trim().isEmpty ? null : s.trim();

  static String? _macOrNull(String? mac) => mac != null && macPattern.hasMatch(mac) ? mac.toLowerCase() : null;
}

/// Wake-on-LAN: six 0xFF bytes and the MAC sixteen times, to UDP port 9 on the broadcast address and the TV's own
/// subnet's (a /24 guess from its address). True when a packet left the phone.
Future<bool> wakeOnLan(String mac, String address) async {
  if (!DirectLink.macPattern.hasMatch(mac)) return false;
  final bytes = [for (final part in mac.split(RegExp('[:-]'))) int.parse(part, radix: 16)];
  final packet = Uint8List(102);
  for (var i = 0; i < 6; i++) {
    packet[i] = 0xff;
  }
  for (var r = 0; r < 16; r++) {
    for (var i = 0; i < 6; i++) {
      packet[6 + r * 6 + i] = bytes[i];
    }
  }
  final targets = <InternetAddress>[InternetAddress('255.255.255.255')];
  final parts = address.split('.');
  if (parts.length == 4 && parts.every((p) => int.tryParse(p) != null)) {
    targets.add(InternetAddress('${parts[0]}.${parts[1]}.${parts[2]}.255'));
  }
  RawDatagramSocket? socket;
  try {
    socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
    socket.broadcastEnabled = true;
    var sent = false;
    for (var round = 0; round < 3; round++) {
      for (final target in targets) {
        if (socket.send(packet, target, 9) > 0) sent = true;
      }
    }
    return sent;
  } on Object catch (e) {
    debugPrint('orbit: wake-on-LAN failed: $e');
    return false;
  } finally {
    socket?.close();
  }
}
