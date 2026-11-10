import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';

import '../cloud/account.dart';
import '../cloud/backend.dart';
import '../cloud/cloud_tv.dart';
import 'help_mode.dart';
import 'models.dart';
import 'tv_link.dart';

/// The TV as the page sees it: the home Wi-Fi door when it answers, otherwise the cloud (phone/SPEC.md, "From anywhere:
/// Firebase"), behind one set of ops and one status.
///
/// Which way, in this order:
/// 1. Wi-Fi `connected`;
/// 2. Wi-Fi `needsPairing`/`pairing`: a TV the person chose answers on the Wi-Fi, so it is paired there;
/// 3. the cloud: signed in, a TV linked and `tv/online` within 3 minutes, the phone online:
///    `{"state":"connected","via":"cloud","tv":{"name":…,"address":"cloud","port":0,"udp":null}}`;
/// 4. Wi-Fi `found`;
/// 5. signed in with a TV linked but not online: `{"state":"offline","via":"cloud","tv":{…"address":"cloud"…},
///    "error":"Family room is not online. Is it on?"}` (or "No internet on the phone.");
/// 6. the Wi-Fi status as it is.
class TvRemote {
  TvRemote({required this.wifi, this._helpTimings = const HelpTimings()}) {
    wifi.onStatus = (_) => _refresh();
    wifi.onTvState = (state) {
      if (!onCloud) onTvState?.call(state);
    };
    wifi.onConnectedChanged = (_) => _refresh();
  }

  final TvLink wifi;
  CloudAccount? _account;
  CloudTv? _cloud;
  final Completer<void> _cloudSettled = Completer<void>();
  final HelpTimings _helpTimings;

  /// Help mode (the `help` op): the TV's screen on the phone while the page's Help page is open.
  late final HelpMode help = HelpMode(this, timings: _helpTimings);

  /// Each change of [status].
  void Function(LinkStatus status)? onStatus;

  /// Each TV state, from whichever way is in use.
  void Function(Map<String, Object?> state)? onTvState;

  /// [isConnected] changed (the phone's volume keys follow it).
  void Function(bool connected)? onConnectedChanged;

  /// Each change of [accountJson].
  void Function(Map<String, Object?> account)? onAccount;

  String? _statusText;
  String? _accountText;
  bool _connectedSent = false;
  bool _inFront = true;

  /// Completes once Firebase has started or failed (the account ops wait for it).
  Future<void> get cloudReady => _cloudSettled.future;

  /// Firebase started: the account and its TV join.
  void attachCloud(CloudAccount account, CloudTv cloud) {
    _account = account;
    _cloud = cloud;
    account.onChange = () {
      cloud.follow(account.uid);
      _refresh();
    };
    cloud
      ..onChange = _refresh
      ..onTvState = (state) {
        if (onCloud) onTvState?.call(state);
      }
      ..inFront = _inFront;
    account.start();
    cloud.start();
    if (!_cloudSettled.isCompleted) _cloudSettled.complete();
    _refresh();
  }

  /// Firebase did not start: the Wi-Fi path only.
  void cloudUnavailable() {
    if (!_cloudSettled.isCompleted) _cloudSettled.complete();
  }

  bool get cloudAvailable => _cloud != null;

  /// The cloud path, once Firebase has started.
  CloudTv? get cloud => _cloud;

  /// The TV is reached through the cloud now.
  bool get onCloud {
    final cloud = _cloud;
    if (cloud == null || wifi.isConnected || _wifiAnswersUnpaired) return false;
    return cloud.usable;
  }

  bool get _wifiAnswersUnpaired {
    final state = wifi.status.state;
    return state == LinkState.needsPairing || state == LinkState.pairing;
  }

  bool get isConnected => wifi.isConnected || onCloud;

  LinkStatus get status {
    final w = wifi.status;
    final cloud = _cloud;
    final account = _account;
    if (wifi.isConnected || _wifiAnswersUnpaired || cloud == null || account == null || !account.signedIn) return w;
    if (!cloud.linked) return w;
    final tv = SavedTv(name: cloud.name ?? 'TV', address: 'cloud', port: 0, udp: null);
    if (cloud.usable) return LinkStatus(state: LinkState.connected, tv: tv, found: w.found, via: 'cloud');
    if (w.state == LinkState.found) return w;
    return LinkStatus(
      state: LinkState.offline,
      tv: tv,
      found: w.found,
      via: 'cloud',
      error: cloud.connected
          ? '${tv.name == 'TV' ? 'The TV' : tv.name} is not online. Is it on?'
          : 'No internet on the phone.',
    );
  }

  /// `account`: `{"signedIn","email","tvLinked","tvOnline","tvName"}` (all false/null without Firebase).
  Map<String, Object?> get accountJson =>
      _cloud?.accountJson() ??
      const {'signedIn': false, 'email': null, 'tvLinked': false, 'tvOnline': false, 'tvName': null};

  /// The last TV state from the way in use (for a page that loads again).
  Map<String, Object?>? get tvState => onCloud ? _cloud?.lastState : wifi.tvState;

  // ---- what the page asks for ----

  Future<LinkStatus> hello() async {
    await wifi.hello();
    _refresh();
    return status;
  }

  Future<LinkStatus> connect(String address, int port) async {
    await wifi.connect(address, port);
    _refresh();
    return status;
  }

  Future<LinkStatus> pair(String code) async {
    await wifi.pair(code);
    _refresh();
    return status;
  }

  Future<LinkStatus> forget() async {
    await wifi.forget();
    _refresh();
    return status;
  }

  /// GET /api/state, or the `/api/state` command; the state also goes out as a `tvstate` event.
  Future<Object?> fetchState() async {
    if (_useCloud()) {
      final state = await _cloud!.command('/api/state', const {});
      if (state is Map<String, Object?>) onTvState?.call(state);
      return state;
    }
    return wifi.fetchState();
  }

  /// A read route (`/api/apps`).
  Future<Object?> getJson(String path) async =>
      _useCloud() ? await _cloud!.command(path, const {}) : await wifi.getJson(path);

  /// A POST route of the door.
  Future<Object?> postJson(String path, Map<String, Object?> body) async =>
      _useCloud() ? await _cloud!.command(path, body) : await wifi.postJson(path, body);

  /// An app's picture: (media type, bytes). Over the cloud the TV answers `{"png":"<base64>"}`.
  Future<(String, Uint8List)> icon(String pkg) async {
    if (_useCloud()) {
      final answer = await _cloud!.command('/api/icon', {'pkg': pkg});
      final png = answer is Map ? answer['png'] : null;
      if (png is! String || png.isEmpty) throw const OpError(502, 'The TV did not send a picture.');
      try {
        return ('image/png', base64Decode(png));
      } on FormatException {
        throw const OpError(502, 'The TV did not send a picture.');
      }
    }
    final reply = await wifi.getRaw('/api/icon', query: {'pkg': pkg});
    return (reply.contentType, reply.bytes);
  }

  /// A pointer move ('m') or scroll ('s'): a datagram on the Wi-Fi, a summed command (≤ 10 a second) over the cloud.
  void pointer(String kind, double dx, double dy) {
    if (onCloud) {
      _cloud!.pointer(kind == 'm' ? 'move' : 'scroll', dx, dy);
    } else {
      wifi.pointer(kind, dx, dy);
    }
  }

  /// A fresh state soon after an action (over the cloud the TV writes one after each command by itself).
  void pollSoon() {
    if (!onCloud) wifi.pollSoon();
  }

  /// The app came to the front or left it: polls, the heartbeat and help mode follow (help ends in the background).
  void setForeground(bool inFront) {
    _inFront = inFront;
    wifi.setForeground(inFront);
    _cloud?.inFront = inFront;
    _refresh();
    help.inFront = inFront;
  }

  // ---- the account ----

  Future<Map<String, Object?>> account() async {
    await cloudReady;
    return accountJson;
  }

  Future<Map<String, Object?>> signIn() async {
    final account = await _cloudAccount();
    try {
      await account.signIn();
    } on SignInFailed catch (e) {
      throw OpError(e.cancelled ? 499 : (e.offline ? 0 : 401), e.words);
    } on Object catch (e) {
      debugPrint('orbit: sign-in: $e');
      throw const OpError(401, 'Google could not sign you in. Try again.');
    }
    _refresh();
    return accountJson;
  }

  Future<Map<String, Object?>> signOut() async {
    final account = await _cloudAccount();
    await account.signOut();
    _refresh();
    return accountJson;
  }

  Future<Map<String, Object?>> linkTv(String code) async {
    await _cloudAccount();
    try {
      await _cloud!.link(code);
    } on SignInFailed catch (e) {
      throw OpError(e.cancelled ? 499 : (e.offline ? 0 : 401), e.words);
    }
    _refresh();
    return accountJson;
  }

  Future<Map<String, Object?>> unlinkTv() async {
    await _cloudAccount();
    await _cloud!.unlink();
    _refresh();
    return accountJson;
  }

  Future<CloudAccount> _cloudAccount() async {
    await cloudReady;
    final account = _account;
    if (account == null) throw const OpError(503, 'Signing in is not available on this phone right now.');
    return account;
  }

  /// Ops go through the cloud when it carries the TV; with no Wi-Fi TV chosen and a linked TV that is not online, the
  /// error says that instead of "Choose your TV first".
  bool _useCloud() {
    if (onCloud) return true;
    final cloud = _cloud;
    if (!wifi.isConnected && wifi.status.tv == null && cloud != null && (_account?.signedIn ?? false) && cloud.linked) {
      throw OpError(0, status.error ?? 'The TV is not online. Is it on?');
    }
    return false;
  }

  void _refresh() {
    final cloud = _cloud;
    final carried = onCloud;
    cloud?.active = carried;
    wifi.quietSearch = carried;
    final now = status;
    final text = jsonEncode(now.toJson());
    if (text != _statusText) {
      _statusText = text;
      onStatus?.call(now);
    }
    final account = accountJson;
    final accountText = jsonEncode(account);
    if (accountText != _accountText) {
      _accountText = accountText;
      onAccount?.call(account);
    }
    final connected = isConnected;
    if (connected != _connectedSent) {
      _connectedSent = connected;
      onConnectedChanged?.call(connected);
    }
    help.wayChanged();
  }

  void dispose() {
    help.dispose();
    wifi.dispose();
    _cloud?.dispose();
    _account?.dispose();
    debugPrint('orbit: remote closed');
  }
}
