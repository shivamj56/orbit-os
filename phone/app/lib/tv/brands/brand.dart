/// TVs without Orbit OS: the phone talks to the TV's own remote-control service on the home Wi-Fi (phone/SPEC.md,
/// "Every TV"). One [BrandTv] per make; the link that keeps the chosen one is `direct_link.dart`.
///
/// What the phone can do depends on the make, and the page shows only those controls ([BrandTv.caps]). None of these
/// makes lets an app change the home screen or switch apps off (only Android TV / Google TV does, through Orbit
/// Setup), so here Orbit is a remote.
library;

import 'dart:typed_data';

/// The makes Orbit drives as a remote. [wire] is the `kind` the page sees.
enum TvKind {
  /// Samsung (Tizen): WebSocket remote on 8002 (wss) or 8001 (ws), allowed once on the TV.
  samsung('samsung', 8002),

  /// LG (webOS): SSAP over WebSocket on 3001 (wss) or 3000 (ws), accepted once on the TV.
  lg('lg', 3001),

  /// Roku OS (Roku players and Roku TVs): ECP over HTTP on 8060, nothing to pair.
  roku('roku', 8060),

  /// Google TV / Android TV without Orbit OS: Google's own remote protocol (the one the Google TV app uses), TLS on
  /// 6466, paired once with a 6-character code the TV shows.
  androidtv('androidtv', 6466),

  /// Amazon Fire TV (Fire OS): its debugging connection (ADB over Wi-Fi, 5555), allowed once on the TV.
  firetv('firetv', 5555);

  const TvKind(this.wire, this.port);

  /// The word in `{"kind": …}`.
  final String wire;

  /// The port the make's remote service listens on (the one kept with the TV).
  final int port;

  /// The make for a word from the page or from storage; null for anything else.
  static TvKind? parse(Object? word) {
    for (final kind in values) {
      if (kind.wire == word) return kind;
    }
    return null;
  }
}

/// What a TV can do from the phone. The page reads these words from `tv.caps` and shows only those controls.
abstract final class Cap {
  /// Arrows, OK, Back and Home.
  static const String keys = 'keys';

  /// Volume up and down.
  static const String volume = 'volume';

  /// Mute.
  static const String mute = 'mute';

  /// The TV tells its volume level (and takes a level: [BrandTv.setVolume]).
  static const String volumeLevel = 'volumeLevel';

  /// Play, pause, forward, rewind.
  static const String media = 'media';

  /// Typing into the TV ([BrandTv.type]).
  static const String type = 'type';

  /// A list of the TV's apps ([BrandTv.apps]).
  static const String apps = 'apps';

  /// Opening an app ([BrandTv.launch]).
  static const String launch = 'launch';

  /// Turning the TV off or to sleep ([BrandTv.sleep]).
  static const String power = 'power';

  /// A cursor on the TV's screen ([BrandTv.pointer], [BrandTv.click]): LG's Magic Remote pointer.
  static const String pointer = 'pointer';

  /// The recent-apps key.
  static const String recents = 'recents';

  /// The TV's own settings or menu key.
  static const String settings = 'settings';

  /// The TV tells which app is in front ([BrandTv.state] `app`).
  static const String nowPlaying = 'nowPlaying';
}

/// How a TV of a make is paired the first time.
enum PairingWay {
  /// Nothing to pair (Roku: a setting on the TV decides; see [BrandRefused.setting]).
  none('none'),

  /// The TV shows a prompt and the person accepts it with the TV's own remote (Samsung, LG, Fire TV).
  allow('allow'),

  /// The TV shows a code and the person types it on the phone (Android TV: 6 characters, 0-9 and A-F).
  code('code');

  const PairingWay(this.wire);

  final String wire;
}

/// The remote keys the page sends (phone/SPEC.md `key`), plus media and power words. Every make maps what it can and
/// answers [BrandError] for the rest.
abstract final class RemoteKey {
  static const String up = 'up';
  static const String down = 'down';
  static const String left = 'left';
  static const String right = 'right';
  static const String ok = 'ok';
  static const String back = 'back';
  static const String home = 'home';
  static const String recents = 'recents';
  static const String settings = 'settings';
  static const String mute = 'mute';
  static const String volumeUp = 'volup';
  static const String volumeDown = 'voldown';

  /// Media: `media` op actions.
  static const String playPause = 'play_pause';
  static const String next = 'next';
  static const String previous = 'previous';
  static const String forward = 'forward';
  static const String rewind = 'rewind';

  /// Every word [BrandTv.key] may get.
  static const Set<String> all = {
    up, down, left, right, ok, back, home, recents, settings, mute, volumeUp, volumeDown,
    playPause, next, previous, forward, rewind,
  };
}

/// One app on the TV. [id] is the make's own id (Samsung "3201907018807", LG "netflix", Roku "12", an Android
/// package); the page keeps calling it `pkg`.
class TvApp {
  const TvApp(this.id, this.label);

  final String id;
  final String label;

  Map<String, Object?> toJson() => {'pkg': id, 'label': label};

  @override
  bool operator ==(Object other) => other is TvApp && other.id == id && other.label == label;

  @override
  int get hashCode => Object.hash(id, label);

  @override
  String toString() => 'TvApp($id, $label)';
}

/// A TV the brand search found on the Wi-Fi (or a typed address it recognised).
class BrandFound {
  const BrandFound({
    required this.kind,
    required this.name,
    required this.address,
    int? port,
    this.model,
    this.mac,
  }) : port = port ?? 0;

  final TvKind kind;

  /// The TV's own name ("Living Room", "[TV] Samsung 7 Series (55)" made plain), or the make's name.
  final String name;
  final String address;

  /// The remote service's port; 0 means the make's usual one ([TvKind.port]).
  final int port;

  /// The model, when the TV says it ("QA55Q60T", "OLED55C1PTB", "Roku Ultra").
  final String? model;

  /// The TV's MAC address ("aa:bb:cc:dd:ee:ff"), for waking it with Wake-on-LAN, when the TV says it.
  final String? mac;

  int get effectivePort => port == 0 ? kind.port : port;

  @override
  bool operator ==(Object other) =>
      other is BrandFound &&
      other.kind == kind &&
      other.name == name &&
      other.address == address &&
      other.port == port &&
      other.model == model &&
      other.mac == mac;

  @override
  int get hashCode => Object.hash(kind, name, address, port, model, mac);

  @override
  String toString() => 'BrandFound(${kind.wire}, $name, $address:$effectivePort, $model)';
}

// ---- what can go wrong, in words the person can act on (all of them English; the page translates with tm()) ----

/// The TV is not answering at its address (off, asleep, another network).
class BrandUnreachable implements Exception {
  const BrandUnreachable([this.cause]);

  final Object? cause;

  @override
  String toString() => 'BrandUnreachable($cause)';
}

/// The TV needs pairing before it takes commands: no secret kept yet, or the TV no longer takes the one kept.
class BrandNeedsPairing implements Exception {
  const BrandNeedsPairing([this.message = 'Pair this phone with the TV first.']);

  final String message;

  @override
  String toString() => 'BrandNeedsPairing($message)';
}

/// The TV said no.
class BrandRefused implements Exception {
  const BrandRefused(this.reason, this.message);

  /// The person pressed Deny (or Cancel) on the TV's prompt.
  static const String denied = 'denied';

  /// Nobody answered the TV's prompt in time.
  static const String timeout = 'timeout';

  /// A setting on the TV stops phones (Roku's "Control by mobile apps", Samsung's external device manager, Fire TV's
  /// ADB debugging switched off). [message] says where it is.
  static const String setting = 'setting';

  /// The code typed is not the one on the TV.
  static const String wrongCode = 'wrongCode';

  /// One of the words above.
  final String reason;
  final String message;

  @override
  String toString() => 'BrandRefused($reason, $message)';
}

/// Anything else: the TV answered in a way Orbit cannot use, or the make cannot do this. [message] is for the person.
class BrandError implements Exception {
  const BrandError(this.message, {this.unsupported = false});

  final String message;

  /// True when the make simply has no way to do it (the page hides the control; this is the guard behind that).
  final bool unsupported;

  @override
  String toString() => 'BrandError($message)';
}

/// A TV of one make at one address, driven from the phone.
///
/// Life: made with the address and the secret kept from an earlier pairing (or null), then [connect]. While open, the
/// commands work; when the connection drops by itself (the TV went to standby), [onClosed] fires and the link calls
/// [connect] again later. [close] ends it for good.
///
/// Every method throws only the exceptions above ([BrandUnreachable], [BrandNeedsPairing], [BrandRefused],
/// [BrandError]): the link turns them into the page's words.
abstract class BrandTv {
  TvKind get kind;

  String get address;

  /// What this TV can do from the phone ([Cap]). May grow after [connect] (when the TV said what it supports).
  Set<String> get caps;

  PairingWay get pairingWay;

  /// The secret to keep after a pairing (Samsung's token, LG's client key), or null when the make keeps none in Dart
  /// (Android TV and Fire TV pair the phone's own key, kept by the platform). Read it after [connect] and after
  /// [finishPairing]: the TV may have given a new one.
  String? get secret;

  /// True between a [connect] that worked and the connection dropping or [close].
  bool get isOpen;

  /// The model, when the TV said it (after [connect]); null otherwise.
  String? get model => null;

  /// The TV's MAC address ("aa:bb:cc:dd:ee:ff") when the TV said it, for Wake-on-LAN; null otherwise.
  String? get mac => null;

  /// The connection dropped by itself (not through [close]).
  void Function()? onClosed;

  /// The TV pushed news (volume, the app in front): read [state] again.
  void Function()? onChanged;

  /// Opens the connection.
  ///
  /// - With a secret the TV still takes (or [PairingWay.none]): completes when commands can be sent.
  /// - [PairingWay.allow] without one: the TV shows its prompt; this waits (about 30 s) for the person, then completes,
  ///   or throws [BrandRefused] ([BrandRefused.denied] or [BrandRefused.timeout]).
  /// - [PairingWay.code] without one: throws [BrandNeedsPairing]; then [startPairing] and [finishPairing].
  /// - A setting on the TV stops phones: [BrandRefused] ([BrandRefused.setting]).
  /// - Nothing answers: [BrandUnreachable].
  Future<void> connect();

  /// [PairingWay.code]: asks the TV to show its code. Others: [BrandError] (unsupported).
  Future<void> startPairing();

  /// [PairingWay.code]: the code the person typed. Completes when paired (and the connection open); throws
  /// [BrandRefused] ([BrandRefused.wrongCode]) for a wrong code. Others: [BrandError] (unsupported).
  Future<void> finishPairing(String code);

  /// One of [RemoteKey.all]. A word the make has no key for: [BrandError] (unsupported).
  Future<void> key(String key);

  /// Types [text] into the box the TV has open (and presses Enter after it when [submit]).
  Future<void> type(String text, {bool submit = false});

  /// The TV's apps, sorted by label. A make without a list: [BrandError] (unsupported).
  Future<List<TvApp>> apps();

  /// Opens the app with this id.
  Future<void> launch(String id);

  /// The app's picture: (media type, bytes), or null when the make has none.
  Future<(String, Uint8List)?> icon(String id);

  /// What the TV says now, as much as the make tells: `app` (label), `pkg` (id), `volume`, `max`, `muted`, `on`
  /// (false when the TV is in standby but still answering). Keys the make cannot tell are left out.
  Future<Map<String, Object?>> state();

  /// Sets the volume level (0..max). Without [Cap.volumeLevel]: [BrandError] (unsupported).
  Future<void> setVolume(int level);

  /// Turns the TV off (or to standby).
  Future<void> sleep();

  /// [Cap.pointer]: moves the cursor ('m') or scrolls ('s') by (dx, dy) TV pixels. Fire and forget.
  void pointer(String kind, double dx, double dy) {}

  /// [Cap.pointer]: a click where the cursor is.
  Future<void> click() async => throw const BrandError('This TV has no pointer.', unsupported: true);

  /// Ends the connection for good.
  Future<void> close();
}

/// A TV that takes an app from the phone (Fire TV, through its debugging connection): Orbit Live TV goes on it this way.
abstract interface class InstallsApps {
  /// Puts the APK on the TV and installs it; [name] is a plain file name ("orbit-live.apk").
  Future<void> installApk(Uint8List apk, String name);
}

/// Finds TVs of other makes on the Wi-Fi (`BrandDiscovery` in brand_discovery.dart; a fake in tests).
abstract interface class BrandFinder {
  /// One search; [onUpdate] gets the list each time it grows. Never throws.
  Future<List<BrandFound>> run(void Function(List<BrandFound> sofar) onUpdate);

  /// Which make answers at a typed address, or null.
  Future<BrandFound?> probe(String address);
}
