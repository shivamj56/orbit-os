/// Amazon Fire TV (Fire OS): the phone is a remote through the Fire TV's own debugging connection (ADB over Wi-Fi on
/// port 5555), the same classic ADB client Orbit Setup uses ([AdbConnection]).
///
/// The person switches "ADB debugging" on once in the TV's Developer options; the first connection makes the TV ask
/// "Allow USB debugging?", and once they say Yes the phone's key is remembered by the TV, so later connections (and
/// the reconnect after the TV slept) show nothing. There is no secret kept in Dart: the pairing is the app's ADB key.
///
/// Everything goes through `shell:` commands (`input keyevent`, `monkey`, `cmd package`, `dumpsys`): Fire OS has no
/// remote-control service of its own that an app may use, and these commands exist on Fire OS 7 and 8 (Android 9 and
/// 11).
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import '../../setup/adb.dart';
import '../../setup/setup_host.dart';
import 'brand.dart';

/// Opens the TCP connection to the TV's debugging port and hands it over as an ADB byte stream.
typedef FireTvDial = Future<AdbTransport> Function(String address, int port);

/// A Fire TV at one address.
class FireTv extends BrandTv implements InstallsApps {
  FireTv({
    required this.address,
    required this._crypto,
    this._port = 5555,
    FireTvDial? dial,
    this._allowWait = const Duration(seconds: 60),
  }) : _dial = dial ?? _dialSocket;

  @override
  final String address;

  final AdbCrypto _crypto;
  final int _port;
  final FireTvDial _dial;

  /// How long the person has to press Allow on the TV.
  final Duration _allowWait;

  // ---- what the page and the link see ----

  @override
  TvKind get kind => TvKind.firetv;

  @override
  Set<String> get caps => _caps;

  static const Set<String> _caps = {
    Cap.keys,
    Cap.volume,
    Cap.mute,
    Cap.media,
    Cap.type,
    Cap.apps,
    Cap.launch,
    Cap.power,
    Cap.settings,
    Cap.nowPlaying,
  };

  @override
  PairingWay get pairingWay => PairingWay.allow;

  @override
  String? get secret => null;

  @override
  bool get isOpen => _open;

  /// The TV's model (`ro.product.model`, for example "AFTMM"), once connected; null when the TV did not say.
  @override
  String? get model => _model;

  /// True when the TV's maker is Amazon. A Fire TV Edition set from another maker (or an Android TV with the same
  /// port open) says something else, which the link may want to know before it keeps this as a Fire TV.
  bool get isAmazon => _isAmazon;

  String? _model;
  bool _isAmazon = false;

  // ---- connection ----

  AdbConnection? _connection;
  _WatchedTransport? _watched;
  bool _open = false;
  bool _disposed = false;
  Future<void>? _connecting;

  @override
  Future<void> connect() {
    if (_disposed) return Future<void>.error(const BrandUnreachable('closed'));
    if (_open) return Future<void>.value();
    return _connecting ??= _connectOnce().whenComplete(() => _connecting = null);
  }

  Future<void> _connectOnce() async {
    final AdbTransport raw;
    try {
      raw = await _dial(address, _port);
    } on Object catch (e) {
      // A refused connection means the TV answered but nothing listens on the port: the switch is off. Anything else
      // (no route, timeout) means the TV is off, asleep or on another network.
      if (_isRefused(e)) {
        throw const BrandRefused(
          BrandRefused.setting,
          'Turn on ADB debugging on the Fire TV: Settings › My Fire TV › Developer options › ADB debugging.',
        );
      }
      throw BrandUnreachable(e);
    }
    final watched = _WatchedTransport(raw, _ended);
    final AdbConnection connection;
    try {
      connection = await AdbConnection.open(watched, _crypto, allowTimeout: _allowWait);
    } on AdbFailure catch (failure) {
      throw switch (failure.reason) {
        'refused' => const BrandRefused(BrandRefused.denied, 'The Fire TV was told not to allow this phone.'),
        'timeout' => const BrandRefused(BrandRefused.timeout, 'The Fire TV did not get a Yes in time.'),
        'tls' => const BrandError('The Fire TV did not offer a debugging connection Orbit can use.'),
        _ => BrandUnreachable(failure),
      };
    }
    if (_disposed) {
      unawaited(connection.close());
      throw const BrandUnreachable('closed');
    }
    _connection = connection;
    _watched = watched;
    watched.live = true;
    _open = true;
    await _readIdentity(connection);
  }

  /// Reads who made the TV. A TV that fails here is still usable, so nothing is thrown.
  Future<void> _readIdentity(AdbConnection connection) async {
    try {
      final maker = (await connection.shell('getprop ro.product.manufacturer', timeout: _shellTimeout)).trim();
      final name = (await connection.shell('getprop ro.product.model', timeout: _shellTimeout)).trim();
      _isAmazon = maker.toLowerCase() == 'amazon';
      _model = name.isEmpty ? null : name;
    } on Object {
      // The link is up; the identity just stays unknown.
    }
  }

  /// The connection ended by itself (the TV went to standby or left the network).
  void _ended(_WatchedTransport watched) {
    if (!identical(_watched, watched) || !_open) return;
    _open = false;
    _connection = null;
    _watched = null;
    unawaited(watched.close());
    onClosed?.call();
  }

  @override
  Future<void> startPairing() async => throw _unsupported;

  @override
  Future<void> finishPairing(String code) async => throw _unsupported;

  @override
  Future<void> close() async {
    _disposed = true;
    _open = false;
    final connection = _connection;
    _connection = null;
    _watched = null;
    await connection?.close();
  }

  // ---- the serial queue ----

  Future<void> _tail = Future<void>.value();

  /// Key presses that were accepted and have not started yet.
  int _waitingKeys = 0;

  /// A held key repeats faster than the TV answers; past this many waiting presses the extra ones are dropped, so the
  /// TV does not keep scrolling for seconds after the finger left.
  static const int _maxWaitingKeys = 4;

  /// Runs [job] after everything queued before it. One command at a time: the TV answers in order, and a key that
  /// overtook another would make a menu land in the wrong place.
  Future<T> _enqueue<T>(Future<T> Function() job) {
    final done = Completer<T>();
    _tail = _tail.then((_) async {
      try {
        done.complete(await job());
      } on Object catch (e, s) {
        done.completeError(e, s);
      }
    });
    return done.future;
  }

  /// Runs [body] on a live connection; a closed one is reopened once first (the key is already allowed, so the TV shows
  /// no prompt).
  Future<T> _withConnection<T>(Future<T> Function(AdbConnection connection) body) async {
    if (_disposed) throw const BrandUnreachable('closed');
    if (!_open) await connect();
    final connection = _connection;
    final watched = _watched;
    if (connection == null || watched == null) throw const BrandUnreachable('closed');
    try {
      return await body(connection);
    } on AdbFailure catch (failure) {
      _ended(watched);
      throw BrandUnreachable(failure);
    }
  }

  Future<String> _shell(String command, {Duration timeout = _shellTimeout}) =>
      _withConnection((connection) => connection.shell(command, timeout: timeout));

  /// One queued shell command; its output.
  Future<String> _queued(String command, {Duration timeout = _shellTimeout}) =>
      _enqueue(() => _shell(command, timeout: timeout));

  static const Duration _shellTimeout = Duration(seconds: 15);

  // ---- keys ----

  static const Map<String, int> _keyCodes = {
    RemoteKey.up: 19,
    RemoteKey.down: 20,
    RemoteKey.left: 21,
    RemoteKey.right: 22,
    RemoteKey.ok: 23,
    RemoteKey.back: 4,
    RemoteKey.home: 3,
    // The remote's menu (≡) key: Fire OS has no settings key code that does anything reliably.
    RemoteKey.settings: 82,
    RemoteKey.mute: 164,
    RemoteKey.volumeUp: 24,
    RemoteKey.volumeDown: 25,
    RemoteKey.playPause: 85,
    RemoteKey.next: 87,
    RemoteKey.previous: 88,
    RemoteKey.forward: 90,
    RemoteKey.rewind: 89,
  };

  static const BrandError _unsupported = BrandError('Fire TV cannot do that from a phone.', unsupported: true);

  @override
  Future<void> key(String key) {
    final code = _keyCodes[key];
    if (code == null) return Future<void>.error(_unsupported);
    if (_waitingKeys >= _maxWaitingKeys) return Future<void>.value();
    _waitingKeys++;
    return _enqueue(() {
      _waitingKeys--;
      return _shell('input keyevent $code');
    });
  }

  // ---- typing ----

  @override
  Future<void> type(String text, {bool submit = false}) {
    for (final unit in text.codeUnits) {
      if (unit < 0x20 || unit > 0x7e) {
        return Future<void>.error(const BrandError('Fire TV takes only plain letters and numbers from a phone.'));
      }
    }
    return _enqueue(() async {
      final command = _textCommand(text);
      if (command.isNotEmpty) await _shell(command);
      if (submit) await _shell('input keyevent 66');
    });
  }

  /// `input text '…'` for [text] (printable ASCII only).
  ///
  /// Spaces are `%s`, which `input text` turns back into spaces. The argument is in single quotes, so the shell leaves
  /// `;`, `$`, `&`, `*` and the rest alone, and a single quote itself is closed, escaped and reopened (`'\''`).
  /// A literal `%` is sent as its own `input text '%'`: next to a space or an `s` it would be read as part of a `%s`
  /// ("100% sure" would come out as "100%%ssure").
  static String _textCommand(String text) {
    final commands = <String>[];
    final piece = StringBuffer();
    void flush() {
      if (piece.isEmpty) return;
      commands.add("input text ${_quote(piece.toString().replaceAll(' ', '%s'))}");
      piece.clear();
    }

    for (final char in text.split('')) {
      if (char == '%') {
        flush();
        commands.add("input text '%'");
      } else {
        piece.write(char);
      }
    }
    flush();
    return commands.join('; ');
  }

  static String _quote(String value) => "'${value.replaceAll("'", r"'\''")}'";

  // ---- apps ----

  static const String _leanback = 'android.intent.category.LEANBACK_LAUNCHER';
  static const String _launcher = 'android.intent.category.LAUNCHER';

  static final RegExp _packageName = RegExp(r'^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$');

  /// `package/activity` in the output of `cmd package query-activities --brief` (a bare line, or after the priority
  /// fields; the activity may be short, `.Main`).
  static final RegExp _component = RegExp(r'\b([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/([A-Za-z0-9_.$]+)');

  /// Amazon's and Android's own packages: the home screen, settings, set-up and background services. They are not
  /// apps a person opens from a phone, and opening one (or switching one off) would only get in the way.
  static const List<String> _systemPrefixes = [
    'com.amazon.tv.launcher',
    'com.amazon.tv.settings',
    'com.amazon.tv.oobe',
    'com.amazon.firehomestartupservice',
    'com.amazon.ssmsys',
    'com.amazon.dcp',
    'com.android.',
    'android',
  ];

  /// Names for packages whose id says nothing; the ones only the ids Orbit is sure of.
  static const Map<String, String> _labels = {
    'com.netflix.ninja': 'Netflix',
    'com.amazon.avod': 'Prime Video',
    'com.amazon.firebat': 'Prime Video',
    'com.amazon.firetv.youtube': 'YouTube',
    'in.startv.hotstar': 'Disney+ Hotstar',
    'com.spotify.tv.android': 'Spotify',
    'com.disney.disneyplus': 'Disney+',
    'com.hulu.plus': 'Hulu',
    'com.amazon.cloud9': 'Silk Browser',
    'com.plexapp.android': 'Plex',
    'org.videolan.vlc': 'VLC',
    'com.mxtech.videoplayer.ad': 'MX Player',
    'com.graymatrix.did': 'ZEE5',
  };

  static bool _isSystem(String package) {
    for (final prefix in _systemPrefixes) {
      if (package == prefix || package.startsWith(prefix.endsWith('.') ? prefix : '$prefix.')) return true;
    }
    return false;
  }

  /// A name for [package]: the known one, or its last meaningful part ("com.example.coolapp" becomes "Coolapp").
  static String _labelOf(String package) {
    final known = _labels[package];
    if (known != null) return known;
    if (package == 'com.amazon.tv.launcher') return 'Home';
    const filler = {'android', 'app', 'tv', 'client', 'main', 'mobile', 'ui', 'firetv'};
    final parts = package.split('.');
    var name = parts.last;
    for (var i = parts.length - 1; i >= 1; i--) {
      name = parts[i];
      if (!filler.contains(name.toLowerCase())) break;
    }
    name = name.replaceAll('_', ' ').trim();
    if (name.isEmpty) return package;
    return name[0].toUpperCase() + name.substring(1);
  }

  Future<Set<String>> _installed() async {
    final out = await _queued('pm list packages -3', timeout: const Duration(seconds: 30));
    return {
      for (final line in out.split('\n'))
        if (line.trim().startsWith('package:') && !_isSystem(line.trim().substring(8))) line.trim().substring(8),
    };
  }

  Future<List<String>> _query(String category) async {
    final out = await _queued(
      'cmd package query-activities --brief -a android.intent.action.MAIN -c $category',
      timeout: const Duration(seconds: 30),
    );
    final packages = <String>[];
    for (final line in out.split('\n')) {
      final match = _component.firstMatch(line);
      if (match == null) continue;
      final package = match.group(1)!;
      if (!_isSystem(package) && !packages.contains(package)) packages.add(package);
    }
    return packages;
  }

  /// Both lists, merged: apps made for Fire OS declare the plain LAUNCHER category (the one python-androidtv launches
  /// Fire TV apps with), Android TV builds LEANBACK_LAUNCHER, and an app may declare only one of the two.
  @override
  Future<List<TvApp>> apps() async {
    var packages = {...await _query(_launcher), ...await _query(_leanback)};
    // Fire OS 6 (Android 7.1) may not know `query-activities --brief`: then the installed apps' own list, without
    // Amazon's and Android's system packages.
    if (packages.isEmpty) packages = await _installed();
    final apps = [for (final package in packages) TvApp(package, _labelOf(package))];
    apps.sort((a, b) => a.label.toLowerCase().compareTo(b.label.toLowerCase()));
    return apps;
  }

  /// One monkey event that starts the app. `--pct-syskeys 0` because a Fire TV has no physical system keys, and without
  /// it monkey stops at once ("** SYS_KEYS has no physical keys but with factor 2.0%.", seen on a Fire TV Stick 4K);
  /// so success is the line monkey prints only after it ran, not the absence of an error.
  @override
  Future<void> launch(String id) async {
    // The id goes into a shell line, so it must be a package name and nothing else.
    if (!_packageName.hasMatch(id)) throw const BrandError('That app would not open.');
    for (final category in const [_leanback, _launcher]) {
      final out = await _queued('monkey -p $id -c $category --pct-syskeys 0 1');
      if (out.contains('Events injected: 1')) return;
    }
    throw const BrandError('That app would not open.');
  }

  @override
  Future<(String, Uint8List)?> icon(String id) async => null;

  // ---- state ----

  /// `u0 com.netflix.ninja/…` inside a window or activity record.
  static final RegExp _focusedComponent = RegExp(r'\bu\d+\s+([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)/');

  @override
  Future<Map<String, Object?>> state() async {
    final out = await _queued("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'");
    final package = _focusedPackage(out);
    if (package == null) return {};
    return {'app': _labelOf(package), 'pkg': package};
  }

  /// The package in front: the focused window, else the focused app (the window can be a system overlay, which has no
  /// package).
  static String? _focusedPackage(String out) {
    for (final key in const ['mCurrentFocus', 'mFocusedApp']) {
      for (final line in out.split('\n')) {
        if (!line.contains(key)) continue;
        final match = _focusedComponent.firstMatch(line);
        if (match != null) return match.group(1);
      }
    }
    return null;
  }

  @override
  Future<void> setVolume(int level) async => throw _unsupported;

  @override
  Future<void> sleep() => _queued('input keyevent 223');

  // ---- installing ----

  static final RegExp _apkName = RegExp(r'^[a-z0-9-]+\.apk$');

  /// Puts [apk] on the TV and installs it (replacing an older copy, with its permissions granted), then removes the
  /// file. This is how Orbit Live TV gets onto a Fire TV. Throws [BrandError] with the installer's own first line when
  /// it refuses.
  @override
  Future<void> installApk(Uint8List apk, String name) {
    if (!_apkName.hasMatch(name)) {
      return Future<void>.error(const BrandError('That file name cannot be installed.'));
    }
    final path = '/data/local/tmp/$name';
    return _enqueue(() async {
      var out = '';
      try {
        await _withConnection((connection) async {
          try {
            await connection.push(apk, path);
          } on AdbFailure catch (failure) {
            // The connection may be gone (handled by the caller); otherwise the TV would not take the file.
            if (_open) throw const BrandError('The install failed.');
            throw BrandUnreachable(failure);
          }
        });
        out = await _shell('pm install -r -g $path', timeout: const Duration(minutes: 3));
      } finally {
        try {
          await _shell('rm -f $path');
        } on Object {
          // A file left in /data/local/tmp does no harm; the install result is what matters.
        }
      }
      final lines = [for (final line in out.split('\n')) line.trim()].where((line) => line.isNotEmpty).toList();
      if (lines.any((line) => line == 'Success')) return;
      final failure = lines.where((line) => line.startsWith('Failure') || line.startsWith('Error')).firstOrNull;
      throw BrandError(failure ?? lines.firstOrNull ?? 'The install failed.');
    });
  }

  // ---- the socket ----

  static Future<AdbTransport> _dialSocket(String address, int port) async {
    final socket = await Socket.connect(address, port, timeout: const Duration(seconds: 5));
    socket.setOption(SocketOption.tcpNoDelay, true);
    return SocketTransport(socket);
  }

  /// "Connection refused" on Android, macOS and Windows.
  static bool _isRefused(Object error) {
    if (error is! SocketException) return false;
    final code = error.osError?.errorCode;
    return code == 111 || code == 61 || code == 10061;
  }
}

/// An ADB byte stream that tells when it ends, so a drop is noticed even while no command is running.
class _WatchedTransport implements AdbTransport {
  _WatchedTransport(this._inner, this._onEnd);

  final AdbTransport _inner;
  final void Function(_WatchedTransport watched) _onEnd;

  /// Set once the connection is open; ends before that belong to the handshake, which reports its own failure.
  bool live = false;

  void _end() {
    if (live) _onEnd(this);
  }

  @override
  late final Stream<Uint8List> incoming = _inner.incoming.transform(
    StreamTransformer<Uint8List, Uint8List>.fromHandlers(
      handleError: (error, stack, sink) {
        _end();
        sink.addError(error, stack);
      },
      handleDone: (sink) {
        _end();
        sink.close();
      },
    ),
  );

  @override
  void add(List<int> bytes) => _inner.add(bytes);

  @override
  Future<void> close() => _inner.close();
}
