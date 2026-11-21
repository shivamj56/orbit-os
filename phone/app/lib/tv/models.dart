/// The shapes that cross the bridge (phone/SPEC.md, "status event"), and the TV as the phone keeps it.
library;

/// The TV's door: plain HTTP on this port (SPEC: "The TV's door").
const int kDoorPort = 8090;

/// Where pointer datagrams go until the TV's state names its own port (SPEC: "default 8091").
const int kPointerPort = 8091;

/// The `kind` of a TV with Orbit OS: the page shows every control for it (help, the pointer, Orbit Setup's tools).
const String kOrbitKind = 'orbit';

/// The `state` of a status, with the exact words the page reads.
enum LinkState {
  searching('searching'),
  found('found'),
  needsPairing('needsPairing'),
  pairing('pairing'),
  connected('connected'),
  offline('offline');

  const LinkState(this.wire);

  /// The word in `{"state": ...}`.
  final String wire;
}

/// A TV that discovery saw on the Wi-Fi: `{"name","address","port"}` in a status's `found`.
class FoundTv {
  const FoundTv({
    required this.name,
    required this.address,
    this.port = kDoorPort,
    this.named = false,
    this.kind = kOrbitKind,
    this.model,
  });

  /// The TV's own name from its mDNS advert ("Family room"), or "TV" when only the address scan saw it.
  final String name;
  final String address;
  final int port;

  /// True when [name] came from the TV itself.
  final bool named;

  /// [kOrbitKind] for a TV with Orbit OS (its door answered), else the make Orbit drives as a remote
  /// (tv/brands/brand.dart `TvKind.wire`: "samsung", "lg", "roku", "androidtv", "firetv").
  final String kind;

  /// The model, when the TV says it.
  final String? model;

  String get key => '$address:$port';

  /// A TV with Orbit OS keeps the shape it always had; another make adds its `kind` (and `model` when known).
  Map<String, Object?> toJson() => {
    'name': name,
    'address': address,
    'port': port,
    if (kind != kOrbitKind) 'kind': kind,
    if (model != null) 'model': model,
  };

  @override
  bool operator ==(Object other) =>
      other is FoundTv &&
      other.name == name &&
      other.address == address &&
      other.port == port &&
      other.named == named &&
      other.kind == kind &&
      other.model == model;

  @override
  int get hashCode => Object.hash(name, address, port, named, kind, model);

  @override
  String toString() => 'FoundTv($name, $key)';
}

/// The TV this phone has chosen: `{"name","address","port","udp"}` in a status's `tv`, and what is saved.
class SavedTv {
  const SavedTv({
    required this.name,
    required this.address,
    this.port = kDoorPort,
    this.udp = kPointerPort,
    this.kind = kOrbitKind,
    this.model,
    this.caps,
  });

  final String name;
  final String address;
  final int port;

  /// The pointer's datagram port from the TV's state, or null when the TV says it has no pointer.
  final int? udp;

  /// [kOrbitKind], or the make of a TV Orbit drives as a remote ([FoundTv.kind]).
  final String kind;

  /// The model, when the TV says it.
  final String? model;

  /// What the phone can do with a TV of another make (tv/brands/brand.dart `Cap`); null for a TV with Orbit OS, which
  /// can do everything the page offers.
  final List<String>? caps;

  String get key => '$address:$port';

  SavedTv withName(String name) =>
      SavedTv(name: name, address: address, port: port, udp: udp, kind: kind, model: model, caps: caps);

  SavedTv withUdp(int? udp) =>
      SavedTv(name: name, address: address, port: port, udp: udp, kind: kind, model: model, caps: caps);

  /// What the status event carries (and what TvStore keeps for a TV with Orbit OS, in the shape it always had);
  /// another make adds `kind`, `model` and `caps`.
  Map<String, Object?> toJson() => {
    'name': name,
    'address': address,
    'port': port,
    'udp': udp,
    if (kind != kOrbitKind) 'kind': kind,
    if (model != null) 'model': model,
    if (caps != null) 'caps': caps,
  };

  /// Null for anything that is not a saved TV (an older or damaged entry is dropped, never half-read).
  static SavedTv? fromJson(Object? json) {
    if (json is! Map) return null;
    final name = json['name'];
    final address = json['address'];
    final port = json['port'];
    final udp = json['udp'];
    if (name is! String || address is! String || address.isEmpty || port is! int || port < 1 || port > 65535) {
      return null;
    }
    return SavedTv(
      name: name.isEmpty ? 'TV' : name,
      address: address,
      port: port,
      udp: udp is int && udp > 0 && udp <= 65535 ? udp : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is SavedTv &&
      other.name == name &&
      other.address == address &&
      other.port == port &&
      other.udp == udp &&
      other.kind == kind &&
      other.model == model &&
      _sameList(other.caps, caps);

  @override
  int get hashCode => Object.hash(name, address, port, udp, kind, model, caps == null ? null : Object.hashAll(caps!));

  static bool _sameList(List<String>? a, List<String>? b) {
    if (a == null || b == null) return a == b;
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }

  @override
  String toString() => 'SavedTv($name, $key, udp $udp)';
}

/// One status, as `hello`, `status`, `connect`, `pair` and `forget` reply and the `status` event carries.
class LinkStatus {
  const LinkStatus({required this.state, this.tv, this.found = const [], this.error, this.via = 'wifi', this.pairing});

  final LinkState state;
  final SavedTv? tv;
  final List<FoundTv> found;

  /// Text for the person, or null.
  final String? error;

  /// "wifi" (the TV's door on the home Wi-Fi) or "cloud" (Firebase).
  final String via;

  /// How a TV of another make pairs, while it needs to (phone/SPEC.md, "Every TV"): `{"how":"allow"}` (accept on the
  /// TV), `{"how":"code","length":6,"chars":"hex"}` (type the TV's code), `{"how":"setting"}` (a setting on the TV
  /// stops phones; [error] says where). Null for a TV with Orbit OS, whose pairing is the 6 digits as always.
  final Map<String, Object?>? pairing;

  Map<String, Object?> toJson() => {
    'state': state.wire,
    'tv': tv?.toJson(),
    'found': [for (final f in found) f.toJson()],
    'via': via,
    'error': error,
    if (pairing != null) 'pairing': pairing,
  };
}

/// A request the page made that cannot be done: `{"ok":false,"error":message,"status":status}`.
///
/// [status] is the TV's HTTP status when the TV said no, 0 when the TV could not be reached or no TV is chosen,
/// 400 for arguments Orbit could not use, and 401 when the phone is not (or no longer) paired.
class OpError implements Exception {
  const OpError(this.status, this.message);

  final int status;
  final String message;

  @override
  String toString() => 'OpError($status, $message)';
}
