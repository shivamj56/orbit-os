// Fakes for the cloud path: an in-memory Realtime Database (with the link token rule of phone/firebase/
// database.rules.json and ServerValue.timestamp), Firebase Auth, Google sign-in, and the TV's side of the database.
// No network anywhere.
import 'dart:async';
import 'dart:convert';

import 'package:orbit/cloud/account.dart';
import 'package:orbit/cloud/backend.dart';
import 'package:orbit/cloud/cloud_tv.dart';
import 'package:orbit/cloud/google_identity.dart';

import 'mock_tv.dart';

/// Short timings (the 3-minute online window stays as it is).
const CloudTimings fastCloud = CloudTimings(
  answer: Duration(milliseconds: 400),
  linkWait: Duration(milliseconds: 700),
  heartbeat: Duration(milliseconds: 60),
  pointerGap: Duration(milliseconds: 100),
  lateAnswer: Duration(milliseconds: 400),
  unlinkWait: Duration(milliseconds: 300),
);

class _Watch {
  _Watch(this.path, this.controller);

  final String path;
  final StreamController<Object?> controller;
  String? last;
}

class FakeCloudDb implements CloudDb {
  FakeCloudDb({this.skewMs = 0});

  /// The database's clock minus the phone's.
  int skewMs;
  final Map<String, Object?> root = {};
  final List<_Watch> _watches = [];
  final List<StreamController<bool>> _connectedListeners = [];
  bool _online = true;
  int _pushes = 0;

  /// Every path the phone wrote, in order.
  final List<String> writes = [];

  int get serverNow => DateTime.now().millisecondsSinceEpoch + skewMs;

  /// The phone's connection to the database.
  set online(bool on) {
    _online = on;
    for (final c in List.of(_connectedListeners)) {
      c.add(on);
    }
  }

  static List<String> _parts(String path) => [
    for (final p in path.split('/'))
      if (p.isNotEmpty) p,
  ];

  Object? read(String path) {
    Object? node = root;
    for (final part in _parts(path)) {
      if (node is! Map) return null;
      node = node[part];
    }
    return node == null ? null : jsonDecode(jsonEncode(node));
  }

  /// A write that skips the rules (the TV's own writes in tests).
  void write(String path, Object? value) {
    _put(path, value);
    _notify();
  }

  Object? _resolve(Object? value) {
    if (value is Map) {
      if (value.length == 1 && value['.sv'] == 'timestamp') return serverNow;
      final out = <String, Object?>{};
      for (final e in value.entries) {
        final v = _resolve(e.value);
        if (v != null) out['${e.key}'] = v;
      }
      return out.isEmpty ? null : out;
    }
    if (value is List) return [for (final v in value) _resolve(v)];
    return value;
  }

  void _put(String path, Object? value) {
    final parts = _parts(path);
    final resolved = _resolve(value);
    var node = root;
    for (final part in parts.take(parts.length - 1)) {
      final next = node[part];
      if (next is Map<String, Object?>) {
        node = next;
      } else {
        if (resolved == null) return;
        final created = <String, Object?>{};
        node[part] = created;
        node = created;
      }
    }
    if (resolved == null) {
      node.remove(parts.last);
    } else {
      node[parts.last] = resolved;
    }
    _prune(root);
  }

  static bool _prune(Map<String, Object?> node) {
    node.removeWhere((_, v) => v is Map<String, Object?> && _prune(v));
    return node.isEmpty;
  }

  void _notify() {
    for (final w in List.of(_watches)) {
      final now = read(w.path);
      final text = jsonEncode(now);
      if (text == w.last) continue;
      w.last = text;
      w.controller.add(now);
    }
  }

  /// phone/firebase/database.rules.json, the part the phone meets: `/link/{code}/token` only while the code is there
  /// and only once.
  bool _refused(String path, Object? value) {
    final parts = _parts(path);
    if (parts.length == 3 && parts[0] == 'link' && parts[2] == 'token') {
      return read('link/${parts[1]}') == null || read(path) != null || value is! String || parts[1].length != 8;
    }
    return false;
  }

  @override
  Stream<Object?> values(String path) {
    late final _Watch watch;
    final controller = StreamController<Object?>(
      onListen: () {
        final now = read(path);
        watch.last = jsonEncode(now);
        _watches.add(watch);
        watch.controller.add(now);
      },
      onCancel: () => _watches.remove(watch),
    );
    watch = _Watch(path, controller);
    return controller.stream;
  }

  @override
  Future<Object?> get(String path) async => read(path);

  @override
  Future<void> set(String path, Object? value) async {
    await Future<void>.delayed(Duration.zero);
    if (_refused(path, value)) throw const CloudDenied('permission-denied');
    writes.add(path);
    write(path, value);
  }

  @override
  Future<void> update(String path, Map<String, Object?> values) async {
    await Future<void>.delayed(Duration.zero);
    for (final e in values.entries) {
      writes.add('$path/${e.key}');
      _put('$path/${e.key}', e.value);
    }
    _notify();
  }

  @override
  Future<void> remove(String path) => set(path, null);

  static const String _chars = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';

  @override
  String pushId(String path) {
    var time = serverNow;
    final head = List<String>.filled(8, '-');
    for (var i = 7; i >= 0; i--) {
      head[i] = _chars[time % 64];
      time ~/= 64;
    }
    var n = _pushes++;
    final tail = List<String>.filled(12, '-');
    for (var i = 11; i >= 0; i--) {
      tail[i] = _chars[n % 64];
      n ~/= 64;
    }
    return head.join() + tail.join();
  }

  @override
  Stream<bool> connected() {
    late final StreamController<bool> controller;
    controller = StreamController<bool>(
      onListen: () {
        _connectedListeners.add(controller);
        controller.add(_online);
      },
      onCancel: () => _connectedListeners.remove(controller),
    );
    return controller.stream;
  }

  @override
  Stream<int> serverTimeOffset() => Stream<int>.value(skewMs);
}

class FakeCloudAuth implements CloudAuth {
  CloudUser? _user;
  final StreamController<CloudUser?> _changes = StreamController<CloudUser?>.broadcast();
  int signIns = 0;

  /// The same Google account gets the same uid on every device.
  static String uidFor(String email) => 'uid-${email.split('@').first}';

  @override
  CloudUser? get currentUser => _user;

  @override
  Stream<CloudUser?> userChanges() => _changes.stream;

  @override
  Future<CloudUser> signInWithGoogleIdToken(String idToken) async {
    await Future<void>.delayed(Duration.zero);
    final email = jwtEmail(idToken);
    if (email == null) throw const SignInFailed('Google\'s sign-in was not accepted. Try again.');
    signIns++;
    final user = CloudUser(uid: uidFor(email), email: email);
    _user = user;
    _changes.add(user);
    return user;
  }

  @override
  Future<void> signOut() async {
    _user = null;
    _changes.add(null);
  }

  /// Firebase wants a fresh sign-in before the next delete (it asks once).
  bool wantsRecentLogin = false;
  int deletes = 0;
  int reauths = 0;

  @override
  Future<void> deleteUser() async {
    await Future<void>.delayed(Duration.zero);
    if (_user == null) return;
    if (wantsRecentLogin) throw const RecentLoginRequired();
    deletes++;
    _user = null;
    _changes.add(null);
  }

  @override
  Future<void> reauthenticateWithGoogleIdToken(String idToken) async {
    await Future<void>.delayed(Duration.zero);
    final email = jwtEmail(idToken);
    if (_user == null || email == null || uidFor(email) != _user!.uid) {
      throw const SignInFailed('That is another Google account. Choose the one Orbit is signed in with.');
    }
    reauths++;
    wantsRecentLogin = false;
  }
}

int _tokenSerial = 0;

/// An unsigned JWT with the fields the phone reads (email, exp) and the web client as audience.
String fakeIdToken(String email, Duration life) {
  final payload = base64Url
      .encode(
        utf8.encode(
          jsonEncode({
            'iss': 'https://accounts.google.com',
            'aud': CloudConfig.webClientId,
            'email': email,
            'exp': DateTime.now().add(life).millisecondsSinceEpoch ~/ 1000,
            'n': _tokenSerial++,
          }),
        ),
      )
      .replaceAll('=', '');
  return 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.$payload.c2lnbmF0dXJl';
}

class FakeGoogle implements GoogleIdentity {
  FakeGoogle({this.email = 'owner@gmail.com'});

  String email;
  Duration life = const Duration(hours: 1);
  bool cancel = false;
  bool quietWorks = true;
  int sheets = 0;
  int quiet = 0;

  @override
  Future<GoogleIdToken> signIn() async {
    await Future<void>.delayed(Duration.zero);
    if (cancel) throw const SignInFailed('Sign-in was closed before an account was chosen.', cancelled: true);
    sheets++;
    return GoogleIdToken(fakeIdToken(email, life), email: email);
  }

  @override
  Future<GoogleIdToken?> refresh() async {
    await Future<void>.delayed(Duration.zero);
    quiet++;
    return quietWorks ? GoogleIdToken(fakeIdToken(email, life), email: email) : null;
  }

  @override
  Future<void> signOut() async {}

  int revokes = 0;

  @override
  Future<void> revoke() async => revokes++;
}

/// The TV's side of the database: shows link codes, signs in with the token it is given (as the same account), keeps
/// `tv/online` fresh, answers commands, writes its state, and leaves on `tv/unlink`.
class FakeTvSide {
  FakeTvSide(this.db, {this.name = 'Family room'});

  final FakeCloudDb db;
  final String name;
  String? uid;
  String? tokenSeen;
  final List<Map<String, Object?>> commands = [];
  final List<DateTime> commandTimes = [];

  /// Answers no command (asleep).
  bool asleep = false;

  /// Help mode, as the last `/api/help` command left it.
  bool helpOn = false;
  int status = 200;

  /// A picture of the TV's screen as the cloud carries it.
  static final String fakeJpg = base64Encode(MockTv.fakeJpeg);

  /// One picture of the screen at `/orbit/{uid}/screen`, as the TV writes it while help is on.
  void showScreen(int seq, {Object? at}) =>
      db.write('orbit/$uid/screen', {'at': at ?? kServerTimestamp, 'seq': seq, 'w': 640, 'h': 360, 'jpg': fakeJpg});
  Object? Function(String path, Map<String, Object?> body)? answer;
  final List<StreamSubscription<Object?>> _subs = [];

  static Map<String, Object?> state(String name) => {
    'tv': name,
    'app': 'YouTube',
    'pkg': 'com.google.android.youtube.tv',
    'title': 'A video',
    'artist': 'Someone',
    'playing': true,
    'position': 1000,
    'duration': 60000,
    'volume': 12,
    'max': 100,
    'muted': false,
    'udp': 8091,
    'pointer': true,
    // 'player' is null on the TV, and the database keeps no nulls: it is missing here.
  };

  void showCode(String code) {
    db.write('link/$code', {'tv': 'anon-tv', 'at': kServerTimestamp});
    _subs.add(
      db.values('link/$code/token').listen((token) {
        if (token is String && uid == null) _signIn(code, token);
      }),
    );
  }

  /// Already linked to [account]'s user (as after an earlier link).
  void linkedTo(String email) {
    uid = FakeCloudAuth.uidFor(email);
    _online();
    _serve();
  }

  void heartbeat() => db.write('orbit/$uid/tv/online', kServerTimestamp);

  void _signIn(String code, String token) {
    tokenSeen = token;
    db.write('link/$code', null);
    uid = FakeCloudAuth.uidFor(jwtEmail(token)!);
    _online();
    _serve();
  }

  void _online() {
    db.write('orbit/$uid/tv/name', name);
    db.write('orbit/$uid/tv/online', kServerTimestamp);
  }

  void _serve() {
    _subs
      ..add(
        db.values('orbit/$uid/cmd').listen((value) {
          if (value is! Map || asleep) return;
          for (final entry in value.entries) {
            final id = entry.key as String;
            if (commands.any((c) => c['id'] == id)) continue;
            final cmd = (entry.value as Map).cast<String, Object?>();
            commands.add({'id': id, ...cmd});
            commandTimes.add(DateTime.now());
            final path = cmd['path'] as String;
            final body = (cmd['body'] as Map?)?.cast<String, Object?>() ?? const <String, Object?>{};
            if (path == '/api/help') {
              helpOn = body['on'] == true;
              // Help over: the TV takes its picture away.
              if (!helpOn) db.write('orbit/$uid/screen', null);
            }
            final reply = answer?.call(path, body) ?? _answer(path, body);
            db.write('orbit/$uid/res/$id', {'status': status, 'body': reply});
            db.write('orbit/$uid/cmd/$id', null);
            db.write('orbit/$uid/tv/state', state(name));
          }
        }),
      )
      ..add(
        db.values('orbit/$uid/tv/unlink').listen((value) {
          if (value != true) return;
          db.write('orbit/$uid/tv/unlink', null);
          close();
        }),
      );
  }

  Object? _answer(String path, Map<String, Object?> body) => switch (path) {
    '/api/state' => state(name),
    '/api/apps' => [
      {'pkg': 'com.netflix.ninja', 'label': 'Netflix'},
    ],
    '/api/icon' => {'png': base64Encode(MockTv.fakePng)},
    '/api/volume' => {'ok': true, 'volume': body['level'], 'max': 100},
    '/api/help' => {'ok': true, 'on': body['on'] == true},
    _ => {'ok': true},
  };

  void close() {
    for (final s in _subs) {
      unawaited(s.cancel());
    }
    _subs.clear();
  }
}

/// A signed-out account and its (not yet linked) cloud TV on a fake database.
class CloudRig {
  CloudRig({CloudTimings timings = fastCloud, int skewMs = 0}) : db = FakeCloudDb(skewMs: skewMs) {
    account = CloudAccount(auth: auth, google: google);
    cloud = CloudTv(db: db, account: account, timings: timings);
  }

  final FakeCloudDb db;
  final FakeCloudAuth auth = FakeCloudAuth();
  final FakeGoogle google = FakeGoogle();
  late final CloudAccount account;
  late final CloudTv cloud;

  /// Both started and following each other (what TvRemote.attachCloud does).
  CloudRig started() {
    account.onChange = () => cloud.follow(account.uid);
    account.start();
    cloud.start();
    return this;
  }

  String get uid => account.uid!;

  /// Signed in, with a TV linked and online.
  Future<FakeTvSide> linkedTv() async {
    await account.signIn();
    final tv = FakeTvSide(db)..linkedTo(google.email);
    await eventually(() => cloud.online && cloud.connected, what: 'the TV online in the cloud');
    return tv;
  }

  int writesTo(String path) => db.writes.where((p) => p == path).length;
}
