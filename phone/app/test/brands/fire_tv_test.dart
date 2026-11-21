// FireTv (lib/tv/brands/fire_tv.dart) against a fake ADB device over an in-memory pipe: no sockets, no RSA. The fake
// answers shell commands from a map, can hold its answers back (to see the serial queue), can drop the connection, and
// keeps what was pushed.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/setup/adb.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/fire_tv.dart';

class Pipe implements AdbTransport {
  final StreamController<Uint8List> _incoming = StreamController<Uint8List>();
  void Function(Uint8List bytes)? toDevice;

  @override
  Stream<Uint8List> get incoming => _incoming.stream;

  @override
  void add(List<int> bytes) => toDevice?.call(Uint8List.fromList(bytes));

  @override
  Future<void> close() async {
    if (!_incoming.isClosed) await _incoming.close();
  }

  void fromDevice(Uint8List bytes) {
    if (!_incoming.isClosed) _incoming.add(bytes);
  }

  void deviceClosed() {
    if (!_incoming.isClosed) _incoming.close();
  }
}

class FakeCrypto implements AdbCrypto {
  @override
  Future<Uint8List> signToken(Uint8List token) async => Uint8List(256);

  @override
  Future<String> publicKey() async => 'QAAAAfake orbit@phone\u0000';
}

/// The device half of ADB. [auth]: 'known' (accepts the signature), 'allow', 'deny', 'hang', 'tls'.
class FakeDevice {
  FakeDevice(this.pipe, {this.auth = 'allow', this.answers = const {}}) {
    pipe.toDevice = _onHostBytes;
  }

  final Pipe pipe;
  final String auth;

  /// Shell command -> its output. Commands not in the map answer with nothing.
  Map<String, String> answers;

  /// Every shell command, in the order the device got it.
  final List<String> commands = [];

  /// While set, shell answers wait for it (the commands are still logged on arrival).
  Completer<void>? hold;

  String? pushPath;
  final BytesBuilder pushed = BytesBuilder(copy: false);

  final BytesBuilder _buffer = BytesBuilder(copy: false);
  int _nextRemote = 100;
  int? _syncHost;
  int? _syncRemote;

  static const int _cnxn = 0x4e584e43;
  static const int _auth = 0x48545541;
  static const int _open = 0x4e45504f;
  static const int _okay = 0x59414b4f;
  static const int _wrte = 0x45545257;
  static const int _clse = 0x45534c43;

  void _onHostBytes(Uint8List chunk) {
    _buffer.add(chunk);
    final data = _buffer.takeBytes();
    var offset = 0;
    while (data.length - offset >= 24) {
      final view = ByteData.sublistView(data, offset);
      final length = view.getUint32(12, Endian.little);
      if (data.length - offset - 24 < length) break;
      final payload = Uint8List.sublistView(data, offset + 24, offset + 24 + length);
      _handle(
        view.getUint32(0, Endian.little),
        view.getUint32(4, Endian.little),
        view.getUint32(8, Endian.little),
        payload,
      );
      offset += 24 + length;
    }
    if (offset > 0) _buffer.add(Uint8List.sublistView(data, offset));
  }

  void _send(int command, int arg0, int arg1, [Uint8List? payload]) =>
      pipe.fromDevice(AdbMessage(command, arg0, arg1, payload ?? Uint8List(0)).toBytes());

  void _sendCnxn() => _send(_cnxn, 0x01000000, 256 * 1024, Uint8List.fromList(utf8.encode('device::fake\u0000')));

  void _sendToken() => _send(_auth, 1, 0, Uint8List(20));

  void _handle(int command, int arg0, int arg1, Uint8List payload) {
    switch (command) {
      case _cnxn:
        if (auth == 'tls') {
          pipe.fromDevice(Uint8List.fromList([0x16, 0x03, 0x01, 0x00, 0x05, 1, 2, 3, 4, 5]));
        } else if (auth == 'known') {
          _sendToken();
        } else {
          _sendToken();
        }
      case _auth:
        if (arg0 == 2) {
          if (auth == 'known') {
            _sendCnxn();
          } else {
            _sendToken();
          }
        } else if (arg0 == 3) {
          if (auth == 'allow') _sendCnxn();
          if (auth == 'deny') pipe.deviceClosed();
        }
      case _open:
        final service = utf8.decode(payload).replaceAll('\u0000', '');
        final remote = _nextRemote++;
        _send(_okay, remote, arg0);
        if (service.startsWith('shell:')) {
          final cmd = service.substring(6);
          commands.add(cmd);
          final gate = hold;
          void reply() {
            _send(_wrte, remote, arg0, Uint8List.fromList(utf8.encode(answers[cmd] ?? '')));
            _send(_clse, remote, arg0);
          }

          if (gate == null) {
            reply();
          } else {
            unawaited(gate.future.then((_) => reply()));
          }
        } else if (service.startsWith('sync:')) {
          _syncHost = arg0;
          _syncRemote = remote;
        }
      case _wrte:
        _send(_okay, arg1, arg0);
        if (_syncHost == arg0) _onSync(payload);
    }
  }

  void _onSync(Uint8List payload) {
    if (payload.length < 8) return;
    final id = ascii.decode(payload.sublist(0, 4));
    final len = ByteData.sublistView(payload, 4, 8).getUint32(0, Endian.little);
    switch (id) {
      case 'SEND':
        final target = utf8.decode(payload.sublist(8, 8 + len));
        pushPath = target.substring(0, target.lastIndexOf(','));
        // The push is on the device before the install command that follows it.
        commands.add('push $pushPath');
      case 'DATA':
        pushed.add(payload.sublist(8, 8 + len));
      case 'DONE':
        final okay = BytesBuilder()
          ..add(ascii.encode('OKAY'))
          ..add(Uint8List(4));
        _send(_wrte, _syncRemote!, _syncHost!, okay.toBytes());
    }
  }
}

const String _leanbackCmd =
    'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER';
const String _launcherCmd =
    'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER';
const String _focusCmd = "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'";

const Map<String, String> _amazonProps = {
  'getprop ro.product.manufacturer': 'Amazon\n',
  'getprop ro.product.model': 'AFTMM\n',
};

/// A FireTv wired to fake devices; every dial makes a new pipe and device (kept in [devices]).
class Rig {
  Rig({this.auth = 'allow', Map<String, String> answers = const {}, Duration allowWait = const Duration(seconds: 5)})
    : answers = {..._amazonProps, ...answers} {
    tv = FireTv(
      address: '127.0.0.1',
      crypto: FakeCrypto(),
      allowWait: allowWait,
      dial: (address, port) async {
        dials.add('$address:$port');
        if (dialError != null) throw dialError!;
        final pipe = Pipe();
        devices.add(FakeDevice(pipe, auth: auth, answers: this.answers));
        return pipe;
      },
    );
  }

  final String auth;
  final Map<String, String> answers;
  final List<String> dials = [];
  final List<FakeDevice> devices = [];
  Object? dialError;
  late final FireTv tv;

  FakeDevice get device => devices.last;

  /// Shell commands that are not the two identity reads.
  List<String> get sent => device.commands.where((c) => !c.startsWith('getprop')).toList();
}

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 30));

void main() {
  group('connecting', () {
    test('Allow on the TV opens it, reads who made it, and keeps no secret', () async {
      final rig = Rig();
      await rig.tv.connect();
      expect(rig.tv.isOpen, isTrue);
      expect(rig.tv.model, 'AFTMM');
      expect(rig.tv.isAmazon, isTrue);
      expect(rig.tv.secret, isNull);
      expect(rig.tv.pairingWay, PairingWay.allow);
      expect(rig.tv.kind, TvKind.firetv);
      expect(rig.dials, ['127.0.0.1:5555']);
      await rig.tv.close();
    });

    test('a phone the TV already knows connects with no prompt', () async {
      final rig = Rig(auth: 'known');
      await rig.tv.connect();
      expect(rig.tv.isOpen, isTrue);
      await rig.tv.close();
    });

    test('another maker is not Amazon', () async {
      final rig = Rig(answers: {'getprop ro.product.manufacturer': 'TCL\n'});
      await rig.tv.connect();
      expect(rig.tv.isAmazon, isFalse);
      await rig.tv.close();
    });

    test('caps are the ones a Fire TV can do', () {
      final tv = FireTv(address: '127.0.0.1', crypto: FakeCrypto());
      expect(tv.caps, {
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
      });
    });

    test('Deny on the TV is BrandRefused denied', () async {
      final rig = Rig(auth: 'deny');
      await expectLater(
        rig.tv.connect(),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.denied)),
      );
      expect(rig.tv.isOpen, isFalse);
    });

    test('nobody pressing Allow is BrandRefused timeout', () async {
      final rig = Rig(auth: 'hang', allowWait: const Duration(milliseconds: 150));
      await expectLater(
        rig.tv.connect(),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.timeout)),
      );
    });

    test('a closed port says where ADB debugging is switched on', () async {
      final rig = Rig()..dialError = const SocketException('refused', osError: OSError('Connection refused', 111));
      await expectLater(
        rig.tv.connect(),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.setting)
              .having(
                (e) => e.message,
                'message',
                'Turn on ADB debugging on the Fire TV: Settings › My Fire TV › Developer options › ADB debugging.',
              ),
        ),
      );
    });

    test('a TV that does not answer at all is unreachable', () async {
      final rig = Rig()..dialError = TimeoutException('no answer');
      await expectLater(rig.tv.connect(), throwsA(isA<BrandUnreachable>()));
      rig.dialError = const SocketException('no route', osError: OSError('No route to host', 113));
      await expectLater(rig.tv.connect(), throwsA(isA<BrandUnreachable>()));
    });

    test('Wireless debugging only (TLS) is a BrandError', () async {
      final rig = Rig(auth: 'tls');
      await expectLater(rig.tv.connect(), throwsA(isA<BrandError>()));
    });
  });

  group('keys', () {
    test('every key is its exact keyevent', () async {
      final rig = Rig();
      await rig.tv.connect();
      const expected = {
        'up': 19,
        'down': 20,
        'left': 21,
        'right': 22,
        'ok': 23,
        'back': 4,
        'home': 3,
        'settings': 82,
        'mute': 164,
        'volup': 24,
        'voldown': 25,
        'play_pause': 85,
        'next': 87,
        'previous': 88,
        'forward': 90,
        'rewind': 89,
      };
      for (final entry in expected.entries) {
        await rig.tv.key(entry.key);
      }
      expect(rig.sent, [for (final code in expected.values) 'input keyevent $code']);
      await rig.tv.close();
    });

    test('recents and unknown words are unsupported', () async {
      final rig = Rig();
      await rig.tv.connect();
      await expectLater(
        rig.tv.key('recents'),
        throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', true)),
      );
      await expectLater(rig.tv.key('banana'), throwsA(isA<BrandError>()));
      expect(rig.sent, isEmpty);
      await rig.tv.close();
    });

    test('commands run one at a time, in the order pressed', () async {
      final rig = Rig();
      await rig.tv.connect();
      rig.device.hold = Completer<void>();
      final first = rig.tv.key('down');
      final second = rig.tv.key('down');
      final third = rig.tv.key('ok');
      await settle();
      expect(rig.sent, ['input keyevent 20'], reason: 'the second waits for the first to be answered');
      final gate = rig.device.hold!;
      rig.device.hold = null;
      gate.complete();
      await Future.wait([first, second, third]);
      expect(rig.sent, ['input keyevent 20', 'input keyevent 20', 'input keyevent 23']);
      await rig.tv.close();
    });

    test('a held key: past four waiting, the extra presses are dropped', () async {
      final rig = Rig();
      await rig.tv.connect();
      rig.device.hold = Completer<void>();
      final running = rig.tv.key('right');
      await settle();
      final more = [for (var i = 0; i < 7; i++) rig.tv.key('right')];
      await settle();
      final gate = rig.device.hold!;
      rig.device.hold = null;
      gate.complete();
      await Future.wait([running, ...more]);
      // One was running, four waited, the other three were dropped.
      expect(rig.sent.length, 5);
      expect(rig.sent.toSet(), {'input keyevent 22'});
      // Once the queue is empty, presses are taken again.
      await rig.tv.key('left');
      expect(rig.sent.last, 'input keyevent 21');
      await rig.tv.close();
    });

    test('sleep is keyevent 223', () async {
      final rig = Rig();
      await rig.tv.connect();
      await rig.tv.sleep();
      expect(rig.sent, ['input keyevent 223']);
      await rig.tv.close();
    });

    test('there is no volume level or icon', () async {
      final rig = Rig();
      await rig.tv.connect();
      await expectLater(rig.tv.setVolume(5), throwsA(isA<BrandError>()));
      expect(await rig.tv.icon('com.netflix.ninja'), isNull);
      await rig.tv.close();
    });
  });

  group('type', () {
    test('spaces become %s inside single quotes', () async {
      final rig = Rig();
      await rig.tv.connect();
      await rig.tv.type('hello big world');
      expect(rig.sent, ["input text 'hello%sbig%sworld'"]);
      await rig.tv.close();
    });

    test('quotes, semicolons and dollars cannot leave the quotes', () async {
      final rig = Rig();
      await rig.tv.connect();
      await rig.tv.type("it's a; b \$HOME \"x\" `y` & z");
      expect(rig.sent, [r"""input text 'it'\''s%sa;%sb%s$HOME%s"x"%s`y`%s&%sz'"""]);
      await rig.tv.close();
    });

    test('a literal percent is sent on its own so it is never read as %s', () async {
      final rig = Rig();
      await rig.tv.connect();
      await rig.tv.type('100% sure');
      expect(rig.sent, ["input text '100'; input text '%'; input text '%ssure'"]);
      await rig.tv.close();
    });

    test('submit presses Enter (66) after the text', () async {
      final rig = Rig();
      await rig.tv.connect();
      await rig.tv.type('news', submit: true);
      expect(rig.sent, ["input text 'news'", 'input keyevent 66']);
      await rig.tv.type('', submit: true);
      expect(rig.sent.last, 'input keyevent 66');
      expect(rig.sent.length, 3);
      await rig.tv.close();
    });

    test('anything but plain ASCII is refused and nothing is sent', () async {
      final rig = Rig();
      await rig.tv.connect();
      for (final text in ['café', 'नमस्ते', 'a\nb', 'smile 🙂']) {
        await expectLater(
          rig.tv.type(text),
          throwsA(
            isA<BrandError>().having(
              (e) => e.message,
              'message',
              'Fire TV takes only plain letters and numbers from a phone.',
            ),
          ),
        );
      }
      expect(rig.sent, isEmpty);
      await rig.tv.close();
    });
  });

  group('apps', () {
    // Real-looking output of `cmd package query-activities --brief` on Fire OS 7.
    const leanback = '''
7 activities found:
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.netflix.ninja/.MainActivity
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.amazon.firebat/com.amazon.firebat.deeplink.DeepLinkRoutingActivity
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.amazon.tv.launcher/.ui.HomeActivity_vNext
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.amazon.tv.settings.v2/.tv.MainSettingsActivity
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.example.coolapp/com.example.coolapp.ui.Main
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.example.coolapp/com.example.coolapp.ui.Second
  priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true
  com.amazon.firetv.youtube/dev.cobalt.app.MainActivity
''';

    test('lists the leanback apps with labels, sorted, without Amazon system packages', () async {
      final rig = Rig(answers: {_leanbackCmd: leanback});
      await rig.tv.connect();
      final apps = await rig.tv.apps();
      expect(apps, const [
        TvApp('com.example.coolapp', 'Coolapp'),
        TvApp('com.netflix.ninja', 'Netflix'),
        TvApp('com.amazon.firebat', 'Prime Video'),
        TvApp('com.amazon.firetv.youtube', 'YouTube'),
      ]);
      expect(rig.sent, [_leanbackCmd], reason: 'no fallback when the first list has apps');
      await rig.tv.close();
    });

    test('with nothing in the leanback list it asks for the LAUNCHER category', () async {
      final rig = Rig(
        answers: {
          _leanbackCmd: '0 activities found:\n',
          _launcherCmd:
              '2 activities found:\n  priority=0\n  org.videolan.vlc/.gui.MainActivity\n  com.android.settings/.Settings\n'
              '  com.some_vendor.tv_player/.Main\n',
        },
      );
      await rig.tv.connect();
      final apps = await rig.tv.apps();
      expect(apps, const [TvApp('com.some_vendor.tv_player', 'Tv player'), TvApp('org.videolan.vlc', 'VLC')]);
      expect(rig.sent, [_leanbackCmd, _launcherCmd]);
      await rig.tv.close();
    });

    test('a leanback list of only system packages also falls back', () async {
      final rig = Rig(
        answers: {
          _leanbackCmd: '  com.amazon.tv.launcher/.ui.HomeActivity\n',
          _launcherCmd: '  com.spotify.tv.android/.SpotifyTVActivity\n',
        },
      );
      await rig.tv.connect();
      expect(await rig.tv.apps(), const [TvApp('com.spotify.tv.android', 'Spotify')]);
      await rig.tv.close();
    });
  });

  group('launch', () {
    test('opens through monkey with the leanback category', () async {
      final rig = Rig(
        answers: {'monkey -p com.netflix.ninja -c android.intent.category.LEANBACK_LAUNCHER 1': 'Events injected: 1\n'},
      );
      await rig.tv.connect();
      await rig.tv.launch('com.netflix.ninja');
      expect(rig.sent, ['monkey -p com.netflix.ninja -c android.intent.category.LEANBACK_LAUNCHER 1']);
      await rig.tv.close();
    });

    test('falls back to the LAUNCHER category when there is no leanback activity', () async {
      final rig = Rig(
        answers: {
          'monkey -p org.videolan.vlc -c android.intent.category.LEANBACK_LAUNCHER 1':
              '** No activities found to run, monkey aborted.\n',
          'monkey -p org.videolan.vlc -c android.intent.category.LAUNCHER 1': 'Events injected: 1\n',
        },
      );
      await rig.tv.connect();
      await rig.tv.launch('org.videolan.vlc');
      expect(rig.sent.length, 2);
      await rig.tv.close();
    });

    test('an app with neither category is a BrandError', () async {
      final rig = Rig(
        answers: {
          'monkey -p com.gone.app -c android.intent.category.LEANBACK_LAUNCHER 1':
              '** No activities found to run, monkey aborted.\n',
          'monkey -p com.gone.app -c android.intent.category.LAUNCHER 1':
              '** No activities found to run, monkey aborted.\n',
        },
      );
      await rig.tv.connect();
      await expectLater(rig.tv.launch('com.gone.app'), throwsA(isA<BrandError>()));
      await rig.tv.close();
    });

    test('an id that is not a package name never reaches the shell', () async {
      final rig = Rig();
      await rig.tv.connect();
      for (final id in ['com.x; rm -rf /', r'com.x$(id)', 'nodots', '', 'com.x y', '../etc', 'com..x', '1com.x']) {
        await expectLater(rig.tv.launch(id), throwsA(isA<BrandError>()), reason: id);
      }
      expect(rig.sent, isEmpty);
      await rig.tv.close();
    });
  });

  group('state', () {
    test('reads the focused window (Android 11 style)', () async {
      final rig = Rig(
        answers: {
          _focusCmd:
              '  mCurrentFocus=Window{2c1f9a3 u0 com.netflix.ninja/com.netflix.ninja.MainActivity}\n'
              '  mFocusedApp=ActivityRecord{7e1d4b2 u0 com.netflix.ninja/.MainActivity t23}\n',
        },
      );
      await rig.tv.connect();
      expect(await rig.tv.state(), {'app': 'Netflix', 'pkg': 'com.netflix.ninja'});
      await rig.tv.close();
    });

    test('falls back to the focused app when the focused window is an overlay (Android 9 style)', () async {
      final rig = Rig(
        answers: {
          _focusCmd:
              '  mCurrentFocus=Window{91ab u0 StatusBar}\r\n'
              '  mFocusedApp=AppWindowToken{3d1c2b token=Token{9a8b7c ActivityRecord{1e2f3a u0 com.example.coolapp/.Main t12}}}\r\n',
        },
      );
      await rig.tv.connect();
      expect(await rig.tv.state(), {'app': 'Coolapp', 'pkg': 'com.example.coolapp'});
      await rig.tv.close();
    });

    test('the Fire TV home screen is Home, and no focus is an empty answer', () async {
      final rig = Rig(
        answers: {
          _focusCmd:
              '  mCurrentFocus=Window{1a u0 com.amazon.tv.launcher/com.amazon.tv.launcher.ui.HomeActivity_vNext}\n',
        },
      );
      await rig.tv.connect();
      expect(await rig.tv.state(), {'app': 'Home', 'pkg': 'com.amazon.tv.launcher'});
      rig.device.answers = {_focusCmd: '  mCurrentFocus=null\n  mFocusedApp=null\n'};
      expect(await rig.tv.state(), isEmpty);
      await rig.tv.close();
    });
  });

  group('installApk', () {
    final apk = Uint8List.fromList(List<int>.generate(150000, (i) => i % 251));
    const path = '/data/local/tmp/orbit-live.apk';

    test('pushes, installs, then removes the file', () async {
      final rig = Rig(answers: {'pm install -r -g $path': 'Success\n'});
      await rig.tv.connect();
      await rig.tv.installApk(apk, 'orbit-live.apk');
      expect(rig.sent, ['push $path', 'pm install -r -g $path', 'rm -f $path']);
      expect(rig.device.pushed.takeBytes(), apk);
      await rig.tv.close();
    });

    test('a refusal throws the installer line, and the file is still removed', () async {
      final rig = Rig(answers: {'pm install -r -g $path': 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]\n'});
      await rig.tv.connect();
      await expectLater(
        rig.tv.installApk(apk, 'orbit-live.apk'),
        throwsA(isA<BrandError>().having((e) => e.message, 'message', 'Failure [INSTALL_FAILED_VERSION_DOWNGRADE]')),
      );
      expect(rig.sent.last, 'rm -f $path');
      await rig.tv.close();
    });

    test('a first line before the verdict does not hide the failure', () async {
      final rig = Rig(
        answers: {
          'pm install -r -g $path': 'Performing Streamed Install\nFailure [INSTALL_FAILED_INSUFFICIENT_STORAGE]\n',
        },
      );
      await rig.tv.connect();
      await expectLater(
        rig.tv.installApk(apk, 'orbit-live.apk'),
        throwsA(isA<BrandError>().having((e) => e.message, 'message', 'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]')),
      );
      await rig.tv.close();
    });

    test('a file name with a path or odd characters is refused', () async {
      final rig = Rig();
      await rig.tv.connect();
      for (final name in ['../x.apk', 'a b.apk', 'Orbit.apk', 'x.apk; rm -rf /', 'x.zip', '.apk']) {
        await expectLater(rig.tv.installApk(apk, name), throwsA(isA<BrandError>()), reason: name);
      }
      expect(rig.device.commands.where((c) => c.startsWith('push') || c.startsWith('pm')), isEmpty);
      await rig.tv.close();
    });
  });

  group('drops', () {
    test('a dropped connection fires onClosed once, then the next command reconnects without a prompt', () async {
      final rig = Rig();
      var closed = 0;
      rig.tv.onClosed = () => closed++;
      await rig.tv.connect();
      expect(rig.dials.length, 1);

      rig.device.pipe.deviceClosed();
      await settle();
      expect(rig.tv.isOpen, isFalse);
      expect(closed, 1);

      await rig.tv.key('home');
      expect(rig.dials.length, 2, reason: 'one reconnect');
      expect(rig.tv.isOpen, isTrue);
      expect(rig.sent, ['input keyevent 3']);
      expect(closed, 1);
      await rig.tv.key('back');
      expect(rig.dials.length, 2);
      await rig.tv.close();
    });

    test('when the reconnect cannot happen the command says the TV is unreachable', () async {
      final rig = Rig();
      await rig.tv.connect();
      rig.device.pipe.deviceClosed();
      await settle();
      rig.dialError = TimeoutException('gone');
      await expectLater(rig.tv.key('home'), throwsA(isA<BrandUnreachable>()));
      expect(rig.tv.isOpen, isFalse);
    });

    test('close() ends it for good and does not fire onClosed', () async {
      final rig = Rig();
      var closed = 0;
      rig.tv.onClosed = () => closed++;
      await rig.tv.connect();
      await rig.tv.close();
      await settle();
      expect(closed, 0);
      expect(rig.tv.isOpen, isFalse);
      await expectLater(rig.tv.key('home'), throwsA(isA<BrandUnreachable>()));
      expect(rig.dials.length, 1);
    });
  });
}
