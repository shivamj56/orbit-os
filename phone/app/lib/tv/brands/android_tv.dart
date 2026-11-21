/// Google TV and Android TV without Orbit OS, driven through Google's own remote protocol (the Android TV Remote
/// Service, v2), the one the Google TV phone app speaks. Nothing to switch on in the TV's settings: the service comes
/// with the TV, and the phone pairs once with the code the TV shows.
///
/// Two TLS doors, both opened with the phone's own client certificate ([RemoteIdentity], made and kept by the
/// platform in AtvIdentity.kt):
/// - 6467, pairing ("Polo"): the TV shows a 6-character code, and the phone proves it saw it by sending a hash over
///   both certificates' RSA keys and the code ([Polo.secretFor]). From then on the TV knows the phone by its
///   certificate, so there is no secret to keep in Dart.
/// - 6466, the remote: keys, app links, typing. The TV tells its volume, the app in front and whether it is on, and
///   pings every 5 seconds.
///
/// The protocol follows androidtvremote2 by tronikos (Apache-2.0, https://github.com/tronikos/androidtvremote2),
/// reimplemented here rather than copied: atv_proto.dart has the messages, der.dart reads the keys.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';

import 'atv_proto.dart';
import 'brand.dart';
import 'der.dart';

/// The phone's certificate and private key for Android TVs, both PEM (the key in PKCS#8, "PRIVATE KEY").
class RemoteCredentials {
  const RemoteCredentials({required this.certPem, required this.keyPem});

  final String certPem;
  final String keyPem;
}

/// Where the phone's Android TV identity comes from: the platform in the app ([PlatformRemoteIdentity]), files made
/// for the purpose in tests.
abstract interface class RemoteIdentity {
  /// The same certificate every time: it is what a paired TV remembers the phone by.
  Future<RemoteCredentials> load();
}

/// The identity AtvIdentity.kt makes once (an RSA-2048 key and a self-signed certificate) and keeps in the app's
/// private files, behind the channel `dev.shiv.orbit/atvidentity` (method `load`: `{"cert": PEM, "key": PEM}`).
class PlatformRemoteIdentity implements RemoteIdentity {
  const PlatformRemoteIdentity();

  static const MethodChannel _channel = MethodChannel('dev.shiv.orbit/atvidentity');

  @override
  Future<RemoteCredentials> load() async {
    final answer = await _channel.invokeMapMethod<String, Object?>('load');
    final cert = answer?['cert'];
    final key = answer?['key'];
    if (cert is! String || key is! String || cert.isEmpty || key.isEmpty) {
      throw const FormatException('The platform gave no Android TV identity.');
    }
    return RemoteCredentials(certPem: cert, keyPem: key);
  }
}

/// A Google TV or Android TV at one address (see the library comment).
class AndroidTv extends BrandTv {
  AndroidTv({
    required this.address,
    required this._identity,
    this.port = 6466,
    this.pairingPort = 6467,
    this.timeout = const Duration(seconds: 5),
    this.idle = const Duration(seconds: 16),
  });

  // The words the person reads. Static on purpose: the page translates them by their exact text.
  static const String _msgWrongCode = 'That is not the code on the TV. Try again.';
  static const String _msgCodeGone = 'The TV stopped showing the code. Ask for a new one.';
  static const String _msgCannot = 'This TV cannot do that from a phone.';
  static const String _msgOdd = 'The TV did not answer as Orbit expected.';
  static const String _msgNoKey = 'The phone could not make its key for the TV.';

  /// The name the TV shows while pairing, and in its list of remotes.
  static const String clientName = 'Orbit';

  /// The page's keys as Android key codes (android.view.KeyEvent; remotemessage.proto's RemoteKeyCode).
  static const Map<String, int> keyCodes = {
    RemoteKey.up: 19,
    RemoteKey.down: 20,
    RemoteKey.left: 21,
    RemoteKey.right: 22,
    RemoteKey.ok: 23,
    RemoteKey.back: 4,
    RemoteKey.home: 3,
    RemoteKey.recents: 187,
    RemoteKey.settings: 176,
    RemoteKey.mute: 164,
    RemoteKey.volumeUp: 24,
    RemoteKey.volumeDown: 25,
    RemoteKey.playPause: 85,
    RemoteKey.next: 87,
    RemoteKey.previous: 88,
    RemoteKey.forward: 90,
    RemoteKey.rewind: 89,
  };

  static const int _keyPower = 26;
  static const int _keyEnter = 66;

  /// Between typed text and its Enter: the text goes through the TV's input method, the key straight to the app.
  static const Duration _enterPause = Duration(milliseconds: 150);

  /// Google's protocol cannot list a TV's apps, so these well-known ones stand in. Each opens with the link Home
  /// Assistant's Android TV Remote page gives ("Launching activities"; androidtvremote2's own demo opens the first
  /// four the same way), and names the package the TV reports while it is in front ("Launching apps" there), so
  /// [state] can say "Netflix". Links rather than packages: opening by package (`market://launch?id=`) fails on many
  /// TVs since a Play Store change, as both projects warn.
  static const List<_KnownApp> _known = [
    _KnownApp('Disney+', 'https://www.disneyplus.com', 'com.disney.disneyplus'),
    _KnownApp('Netflix', 'netflix://', 'com.netflix.ninja'),
    _KnownApp('Plex', 'plex://', 'com.plexapp.android'),
    _KnownApp('Prime Video', 'https://app.primevideo.com', 'com.amazon.amazonvideo.livingroom'),
    _KnownApp('Twitch', 'twitch://home', 'tv.twitch.android.app'),
    _KnownApp('YouTube', 'https://www.youtube.com', 'com.google.android.youtube.tv'),
  ];

  @override
  final String address;

  /// The remote's port.
  final int port;

  /// The pairing port.
  final int pairingPort;

  /// How long each step waits for the TV: connecting, each pairing message, the remote's start.
  final Duration timeout;

  /// Silence that means the TV is gone without saying so. It pings every 5 seconds; androidtvremote2 gives up after
  /// 16 (the TV itself drops a phone after three unanswered pings).
  final Duration idle;

  final RemoteIdentity _identity;
  _Identity? _id;
  _Remote? _remote;
  _Pairing? _pairing;
  bool _open = false;
  bool _ime = false;
  String? _model;
  String? _mac;

  @override
  TvKind get kind => TvKind.androidtv;

  @override
  PairingWay get pairingWay => PairingWay.code;

  /// The pairing is the phone's certificate, kept by the platform: nothing to keep here.
  @override
  String? get secret => null;

  @override
  bool get isOpen => _open;

  /// The model the TV gave in its remote_configure ("SHIELD Android TV"), once connected.
  @override
  String? get model => _model;

  /// The MAC address in the TV's certificate, once a connection has seen it.
  @override
  String? get mac => _mac;

  /// Typing joins once the TV said it takes the phone as its input method (remote_configure).
  @override
  Set<String> get caps => {
    Cap.keys,
    Cap.volume,
    Cap.mute,
    Cap.media,
    Cap.recents,
    Cap.settings,
    Cap.power,
    Cap.launch,
    Cap.apps,
    Cap.nowPlaying,
    if (_ime) Cap.type,
  };

  // ---- the remote ----

  /// Opens the remote and goes through the TV's handshake: its remote_configure is answered with what the phone
  /// does, its remote_set_active likewise, and remote_start means commands can go.
  ///
  /// The TV turns away a certificate it has not paired. Over TLS 1.2 that fails the handshake; over TLS 1.3 the TV
  /// closes the connection right after it, before saying anything. Either way: [BrandNeedsPairing].
  @override
  Future<void> connect() async {
    final id = await _loadIdentity();
    _dropRemote();
    final SecureSocket socket;
    try {
      socket = await _dial(port, id);
    } on TlsException {
      throw const BrandNeedsPairing();
    }
    final remote = _Remote(_Conn(socket));
    _remote = remote;
    _mac = macOf(socket.peerCertificate?.subject) ?? _mac;
    remote.conn.messages.listen((message) => _onRemote(remote, message), onDone: () => _onRemoteEnd(remote));
    _touch(remote);

    final outcome = await remote.ready.future.timeout(timeout, onTimeout: () => _Outcome.silent);
    switch (outcome) {
      case _Outcome.started when identical(_remote, remote):
        _open = true;
      case _Outcome.refused:
        throw const BrandNeedsPairing();
      case _Outcome.silent:
        if (identical(_remote, remote)) _dropRemote();
        throw const BrandUnreachable('no answer');
      case _Outcome.started || _Outcome.ended || _Outcome.dropped:
        if (identical(_remote, remote)) _dropRemote();
        throw BrandUnreachable(remote.conn.error ?? 'closed');
    }
  }

  void _onRemote(_Remote remote, Uint8List bytes) {
    if (!identical(_remote, remote)) return;
    remote.heard = true;
    _touch(remote);
    final RemoteNews news;
    try {
      news = RemoteNews.decode(bytes);
    } on FormatException {
      // As androidtvremote2 does: a message that does not parse is skipped, the connection goes on.
      return;
    }
    var changed = false;
    switch (news) {
      case RemoteConfigure(:final features, :final model):
        remote.features = RemoteFeature.orbit & features;
        _ime = remote.features & RemoteFeature.ime != 0;
        if (model.trim().isNotEmpty) _model = model.trim();
        _reply(remote, RemoteMessages.configure(remote.features));
      case RemoteSetActive():
        _reply(remote, RemoteMessages.setActive(remote.features));
      case RemoteImeInfo(:final package, :final imeCounter, :final fieldCounter):
        remote.imeCounter = imeCounter;
        remote.fieldCounter = fieldCounter;
        remote.hasImeCounter = imeCounter != 0;
        remote.hasFieldCounter = fieldCounter != 0;
        if (package != remote.package) {
          remote.package = package;
          changed = true;
        }
      case RemoteImeShow(:final fieldCounter):
        if (fieldCounter != null) {
          remote.fieldCounter = fieldCounter;
          remote.hasFieldCounter = true;
        }
      case RemoteImeEdit(:final imeCounter, :final fieldCounter):
        // Only when remote_ime_key_inject gave no counters of its own.
        if (!remote.hasImeCounter) remote.imeCounter = imeCounter;
        if (!remote.hasFieldCounter) remote.fieldCounter = fieldCounter;
      case RemoteVolume(:final level, :final max, :final muted):
        if (level != remote.volume || max != remote.max || muted != remote.muted) {
          remote.volume = level;
          remote.max = max;
          remote.muted = muted;
          changed = true;
        }
      case RemoteStart(:final started):
        // Ready either way; `started` is false while the TV is in standby.
        if (started != remote.on) {
          remote.on = started;
          changed = true;
        }
        remote.settle(_Outcome.started);
      case RemotePing(:final val1):
        _reply(remote, RemoteMessages.pingResponse(val1));
      case RemoteFailure():
      case RemoteOther():
        break;
    }
    if (changed) onChanged?.call();
  }

  void _onRemoteEnd(_Remote remote) {
    remote.idleTimer?.cancel();
    // Closed (or a TLS alert) before the TV said a word: it turned the certificate away (see [connect]).
    final error = remote.conn.error;
    final refused = !remote.heard && (error == null || error is TlsException);
    remote.settle(refused ? _Outcome.refused : _Outcome.ended);
    if (!identical(_remote, remote)) return;
    _remote = null;
    final wasOpen = _open;
    _open = false;
    if (wasOpen) onClosed?.call();
  }

  /// Something came or went: the idle clock starts again.
  void _touch(_Remote remote) {
    remote.idleTimer?.cancel();
    remote.idleTimer = Timer(idle, () {
      if (identical(_remote, remote)) remote.conn.close();
    });
  }

  /// An answer to the TV inside its own handshake; a dead socket is the end handler's business.
  void _reply(_Remote remote, Uint8List message) {
    try {
      remote.conn.send(message);
    } on BrandUnreachable {
      // closed meanwhile
    }
  }

  /// The open remote, or [BrandUnreachable].
  _Remote _live() {
    final remote = _remote;
    if (!_open || remote == null || remote.conn.ended) throw const BrandUnreachable('closed');
    return remote;
  }

  void _send(Uint8List message) {
    final remote = _live();
    _touch(remote);
    remote.conn.send(message);
  }

  /// Ends the remote connection here, quietly (no [onClosed]: it did not drop by itself).
  void _dropRemote() {
    final remote = _remote;
    _remote = null;
    _open = false;
    if (remote == null) return;
    remote.idleTimer?.cancel();
    remote.settle(_Outcome.dropped);
    remote.conn.close();
  }

  // ---- pairing ----

  /// Opens the pairing door and goes through its first steps: the request (with Orbit's name), the options (a
  /// 6-digit hexadecimal code, the phone typing it) and the configuration. After the TV's ack it shows the code.
  @override
  Future<void> startPairing() async {
    final id = await _loadIdentity();
    _dropPairing();
    final SecureSocket socket;
    try {
      socket = await _dial(pairingPort, id);
    } on TlsException {
      // The pairing door takes any phone; one that refuses TLS is not speaking this protocol.
      throw const BrandError(_msgOdd);
    }
    final pairing = _Pairing(_Conn(socket));
    _pairing = pairing;
    _mac = macOf(socket.peerCertificate?.subject) ?? _mac;
    try {
      final der = socket.peerCertificate?.der;
      if (der == null) throw const BrandError(_msgOdd);
      pairing.server = rsaPublicKeyOfCertificate(der);
      for (final (message, answer) in [
        (Polo.pairingRequest(clientName), PoloField.pairingRequestAck),
        (Polo.options(), PoloField.options),
        (Polo.configuration(), PoloField.configurationAck),
      ]) {
        final reply = await _exchange(pairing, message);
        if (reply == null || reply.status != PoloStatus.ok || reply.step != answer) throw const BrandError(_msgOdd);
      }
    } on FormatException {
      _dropPairing(pairing);
      throw const BrandError(_msgOdd);
    } on Object {
      _dropPairing(pairing);
      rethrow;
    }
  }

  /// Checks the code against its own checksum first (a mistyped code never reaches the TV, which goes on showing
  /// the same code), then sends the secret. Once the TV acks it, the phone is paired and the remote opens.
  @override
  Future<void> finishPairing(String code) async {
    final pairing = _pairing;
    final server = pairing?.server;
    if (pairing == null || server == null || pairing.conn.ended) {
      _dropPairing();
      throw const BrandRefused(BrandRefused.denied, _msgCodeGone);
    }
    final typed = code.replaceAll(RegExp(r'\s'), '').toUpperCase();
    if (!Polo.isCode(typed)) throw const BrandRefused(BrandRefused.wrongCode, _msgWrongCode);
    final id = await _loadIdentity();
    final secret = Polo.secretFor(
      clientModulus: id.key.modulus,
      clientExponent: id.key.exponent,
      serverModulus: server.modulus,
      serverExponent: server.exponent,
      code: typed,
    );
    if (!Polo.codeMatches(typed, secret)) throw const BrandRefused(BrandRefused.wrongCode, _msgWrongCode);

    final PoloReply? reply;
    try {
      reply = await _exchange(pairing, Polo.secret(secret));
    } finally {
      // Whatever the TV said, this pairing is over: a new try starts with a new code.
      _dropPairing(pairing);
    }
    if (reply == null) throw const BrandRefused(BrandRefused.denied, _msgCodeGone);
    if (reply.status == PoloStatus.badSecret) throw const BrandRefused(BrandRefused.wrongCode, _msgWrongCode);
    if (reply.status != PoloStatus.ok) throw const BrandRefused(BrandRefused.denied, _msgCodeGone);
    if (reply.step != PoloField.secretAck) throw const BrandError(_msgOdd);
    await connect();
  }

  /// Sends [message] and reads the TV's answer: null when the TV closed the pairing first. [BrandUnreachable] when it
  /// says nothing for [timeout]; [BrandError] for an answer that is not a pairing message.
  Future<PoloReply?> _exchange(_Pairing pairing, Uint8List message) async {
    try {
      pairing.conn.send(message);
    } on BrandUnreachable {
      return null;
    }
    final bytes = await pairing.next(timeout);
    if (bytes == null) return null;
    try {
      return PoloReply.decode(bytes);
    } on FormatException {
      throw const BrandError(_msgOdd);
    }
  }

  /// Ends the pairing connection ([only] that one, when given and still current).
  void _dropPairing([_Pairing? only]) {
    final pairing = _pairing;
    if (pairing == null || (only != null && !identical(pairing, only))) {
      only?.close();
      return;
    }
    _pairing = null;
    pairing.close();
  }

  // ---- commands ----

  @override
  Future<void> key(String key) async {
    final code = keyCodes[key];
    if (code == null) throw const BrandError(_msgCannot, unsupported: true);
    _send(RemoteMessages.key(code));
  }

  /// Through the TV's input method (remote_ime_batch_edit): into the text field the TV has open, with the counters
  /// the TV last gave for it. Enter after it, when asked, is KEYCODE_ENTER.
  @override
  Future<void> type(String text, {bool submit = false}) async {
    final remote = _live();
    if (remote.features & RemoteFeature.ime == 0) throw const BrandError(_msgCannot, unsupported: true);
    if (text.isNotEmpty) {
      _send(RemoteMessages.imeBatchEdit(imeCounter: remote.imeCounter, fieldCounter: remote.fieldCounter, text: text));
    }
    if (!submit) return;
    if (text.isNotEmpty) await Future<void>.delayed(_enterPause);
    _send(RemoteMessages.key(_keyEnter));
  }

  /// The well-known apps (see [_known]), sorted by label.
  @override
  Future<List<TvApp>> apps() async =>
      [for (final app in _known) TvApp(app.link, app.label)]..sort((a, b) => a.label.compareTo(b.label));

  /// An app link: [id] as it is when it has a URL scheme, else a package name for `market://launch?id=`
  /// ([appLinkFor]).
  @override
  Future<void> launch(String id) async {
    if (id.trim().isEmpty) throw const BrandError(_msgCannot);
    _send(RemoteMessages.appLink(appLinkFor(id)));
  }

  /// androidtvremote2's rule (androidtv_remote.py, send_launch_app_command): anything with a URL scheme goes as it
  /// is ("netflix://", "https://www.youtube.com"); a package name becomes `market://launch?id=<package>`.
  static String appLinkFor(String id) {
    final trimmed = id.trim();
    return (Uri.tryParse(trimmed)?.hasScheme ?? false) ? trimmed : 'market://launch?id=$trimmed';
  }

  @override
  Future<(String, Uint8List)?> icon(String id) async => null;

  @override
  Future<Map<String, Object?>> state() async {
    final remote = _live();
    final package = remote.package;
    return {
      if (remote.volume != null) 'volume': remote.volume,
      if (remote.max != null) 'max': remote.max,
      if (remote.muted != null) 'muted': remote.muted,
      if (package != null && package.isNotEmpty) ...{'pkg': package, 'app': labelOf(package)},
      if (remote.on != null) 'on': remote.on,
    };
  }

  /// The label of a well-known app's package, else the package itself.
  static String labelOf(String package) {
    for (final app in _known) {
      if (app.package == package) return app.label;
    }
    return package;
  }

  /// The protocol tells the volume but takes only the keys: no level to set.
  @override
  Future<void> setVolume(int level) async => throw const BrandError(_msgCannot, unsupported: true);

  /// KEYCODE_POWER, only while the TV is on: the same key wakes a TV in standby.
  @override
  Future<void> sleep() async {
    final remote = _live();
    if (remote.on != true) return;
    _send(RemoteMessages.key(_keyPower));
  }

  @override
  Future<void> close() async {
    _dropPairing();
    _dropRemote();
  }

  // ---- inside ----

  /// The phone's certificate as a TLS context, and its RSA key for the pairing hash; loaded once.
  Future<_Identity> _loadIdentity() async {
    final kept = _id;
    if (kept != null) return kept;
    try {
      final credentials = await _identity.load();
      final context = SecurityContext(withTrustedRoots: false)
        ..useCertificateChainBytes(utf8.encode(credentials.certPem))
        ..usePrivateKeyBytes(utf8.encode(credentials.keyPem));
      final key = rsaPublicKeyOfCertificate(derOfPem(credentials.certPem));
      return _id = _Identity(context, key);
    } on Object {
      throw const BrandError(_msgNoKey);
    }
  }

  /// TLS to the TV with the phone's certificate. The TV's certificate is its own self-signed one, accepted here for
  /// this one connection to [address] (the callback belongs to this connection only): what ties the TV to the phone
  /// is the pairing hash over both keys and the code, not a certificate authority.
  ///
  /// [BrandUnreachable] when nothing answers in [timeout]; a TLS failure ([TlsException]) is the caller's to read.
  Future<SecureSocket> _dial(int port, _Identity id) async {
    final ConnectionTask<SecureSocket> task;
    try {
      task = await SecureSocket.startConnect(address, port, context: id.context, onBadCertificate: (_) => true);
    } on Object catch (e) {
      throw BrandUnreachable(e);
    }
    try {
      return await task.socket.timeout(timeout);
    } on TlsException {
      rethrow;
    } on TimeoutException catch (e) {
      // A handshake still under way is cut off when it finishes.
      task.cancel();
      unawaited(
        task.socket.then((socket) {
          socket.done.ignore();
          socket.destroy();
        }, onError: (Object _) {}),
      );
      throw BrandUnreachable(e);
    } on Object catch (e) {
      throw BrandUnreachable(e);
    }
  }

  /// The MAC address in a TV certificate's subject, where Android TVs put it last
  /// ("/CN=atvremote/darcy/darcy/SHIELD Android TV/XX:XX:XX:XX:XX:XX"; androidtvremote2, _parse_name_and_mac).
  static String? macOf(String? subject) {
    if (subject == null) return null;
    final last = subject.split('/').last.trim().toLowerCase();
    if (!RegExp(r'^([0-9a-f]{2}:){5}[0-9a-f]{2}$').hasMatch(last) || last == '00:00:00:00:00:00') return null;
    return last;
  }
}

class _KnownApp {
  const _KnownApp(this.label, this.link, this.package);

  final String label;
  final String link;
  final String package;
}

class _Identity {
  const _Identity(this.context, this.key);

  final SecurityContext context;
  final RsaPublicKey key;
}

/// How a remote connection's handshake ended.
enum _Outcome {
  /// remote_start came: commands can go.
  started,

  /// Closed before the TV said anything: it turned the certificate away.
  refused,

  /// Closed after the TV had spoken.
  ended,

  /// Closed from here (another connect, or [AndroidTv.close]).
  dropped,

  /// Nothing came in time.
  silent,
}

/// One remote connection and what the TV told on it. A new connection starts from nothing.
class _Remote {
  _Remote(this.conn);

  final _Conn conn;
  final Completer<_Outcome> ready = Completer<_Outcome>();
  Timer? idleTimer;

  /// The TV has said something on this connection.
  bool heard = false;

  /// The features in use: what Orbit asks for, cut down to what the TV has once it said so.
  int features = RemoteFeature.orbit;

  int imeCounter = 0;
  int fieldCounter = 0;
  bool hasImeCounter = false;
  bool hasFieldCounter = false;

  String? package;
  int? volume;
  int? max;
  bool? muted;
  bool? on;

  void settle(_Outcome outcome) {
    if (!ready.isCompleted) ready.complete(outcome);
  }
}

/// The pairing connection, read one answer at a time.
class _Pairing {
  _Pairing(this.conn) : _replies = StreamIterator<Uint8List>(conn.messages);

  final _Conn conn;
  final StreamIterator<Uint8List> _replies;

  /// The TV's RSA key, from its certificate: half of the pairing hash.
  RsaPublicKey? server;

  /// The TV's next message, or null once the connection is closed. [BrandUnreachable] after [timeout].
  Future<Uint8List?> next(Duration timeout) async {
    final bool more;
    try {
      more = await _replies.moveNext().timeout(timeout);
    } on TimeoutException {
      close();
      throw const BrandUnreachable('no answer');
    }
    return more ? _replies.current : null;
  }

  void close() {
    conn.close();
    unawaited(_replies.cancel());
  }
}

/// One TLS connection to the TV, speaking length-prefixed protobuf messages ([frame], [FrameReader]). [messages]
/// ends when the connection does, whichever side ended it; [error] says why, when something failed.
class _Conn {
  _Conn(this.socket) {
    // A TLS alert after the handshake (TLS 1.3) is reported here, and must never go unhandled.
    unawaited(
      socket.done.then<void>(
        (_) {},
        onError: (Object e) {
          error ??= e;
        },
      ),
    );
    _sub = socket.listen(_onData, onError: (Object e) => _end(e), onDone: () => _end(null), cancelOnError: true);
  }

  final SecureSocket socket;
  final FrameReader _frames = FrameReader();
  final StreamController<Uint8List> _messages = StreamController<Uint8List>();
  late final StreamSubscription<Uint8List> _sub;
  bool ended = false;
  Object? error;

  Stream<Uint8List> get messages => _messages.stream;

  /// [BrandUnreachable] once the connection is gone.
  void send(List<int> message) {
    if (ended) throw const BrandUnreachable('closed');
    try {
      socket.add(frame(message));
    } on Object catch (e) {
      _end(e);
      throw BrandUnreachable(e);
    }
  }

  void close() => _end(null);

  void _onData(Uint8List data) {
    final List<Uint8List> messages;
    try {
      messages = _frames.add(data);
    } on FormatException catch (e) {
      // A length that makes no sense: the stream cannot be read on after it.
      _end(e);
      return;
    }
    for (final message in messages) {
      if (!ended) _messages.add(message);
    }
  }

  void _end(Object? cause) {
    if (ended) return;
    ended = true;
    error ??= cause;
    unawaited(_sub.cancel());
    socket.destroy();
    unawaited(_messages.close());
  }
}
