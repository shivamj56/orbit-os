import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/samsung.dart';

/// How the fake TV answers a phone it does not know.
enum Prompt { allow, deny, timeOut, silent }

/// A Samsung on loopback: REST + plain socket on one server, a secure socket on another, UPnP on a third.
class FakeTv {
  late HttpServer rest;
  HttpServer? secure;
  HttpServer? upnp;

  String tokenAuth = 'false';
  String? powerState;

  /// `FrameTVSupport` in the device info ("true" on The Frame).
  String? frameTv;
  Prompt prompt = Prompt.allow;
  final String issuedToken = '12345678';

  int prompts = 0;
  final List<Map<String, Object?>> received = [];
  final List<Map<String, String>> connects = []; // query of every socket
  final List<WebSocket> sockets = [];
  final List<String> restLaunches = [];
  int restLaunchStatus = 200;

  List<Map<String, Object?>> installed = [];
  bool answerIcons = true;
  final Uint8List iconBytes = Uint8List.fromList([137, 80, 78, 71, 1, 2, 3]);

  int volume = 20;
  bool muted = false;
  final List<String> soapActions = [];

  Future<void> startRest() async {
    rest = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    rest.listen(_onRequest);
  }

  Future<void> startUpnp() async {
    upnp = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    upnp!.listen((req) async {
      final body = await utf8.decodeStream(req);
      final action = RegExp(r'<u:(\w+) ').firstMatch(body)!.group(1)!;
      soapActions.add(action);
      expect(req.uri.path, '/upnp/control/RenderingControl1');
      expect(body, contains('<InstanceID>0</InstanceID>'));
      expect(body, contains('<Channel>Master</Channel>'));
      expect(req.headers.value('soapaction'), '"urn:schemas-upnp-org:service:RenderingControl:1#$action"');
      var inner = '';
      if (action == 'GetVolume') inner = '<CurrentVolume>$volume</CurrentVolume>';
      if (action == 'GetMute') inner = '<CurrentMute>${muted ? 1 : 0}</CurrentMute>';
      if (action == 'SetVolume') volume = int.parse(RegExp(r'<DesiredVolume>(\d+)<').firstMatch(body)!.group(1)!);
      req.response
        ..headers.contentType = ContentType('text', 'xml')
        ..write('<s:Envelope><s:Body><u:${action}Response>$inner</u:${action}Response></s:Body></s:Envelope>');
      await req.response.close();
    });
  }

  Future<void> startSecure(SecurityContext context) async {
    secure = await HttpServer.bindSecure(InternetAddress.loopbackIPv4, 0, context);
    secure!.listen(_onRequest);
  }

  Future<void> _onRequest(HttpRequest req) async {
    final path = req.uri.path;
    if (path == '/api/v2/' && req.method == 'GET') {
      req.response
        ..headers.contentType = ContentType.json
        ..write(
          jsonEncode({
            'device': {
              'name': 'Living Room',
              'modelName': 'QE55Q70A',
              'wifiMac': 'aa:bb:cc:dd:ee:ff',
              'TokenAuthSupport': tokenAuth,
              'PowerState': ?powerState,
              'FrameTVSupport': ?frameTv,
            },
          }),
        );
      await req.response.close();
    } else if (path.startsWith('/api/v2/applications/') && req.method == 'POST') {
      restLaunches.add(path.substring('/api/v2/applications/'.length));
      req.response.statusCode = restLaunchStatus;
      await req.response.close();
    } else if (path == '/api/v2/channels/samsung.remote.control' && WebSocketTransformer.isUpgradeRequest(req)) {
      await _onSocket(req);
    } else {
      req.response.statusCode = 404;
      await req.response.close();
    }
  }

  Future<void> _onSocket(HttpRequest req) async {
    final query = req.uri.queryParameters;
    connects.add(query);
    if (query['name'] != base64.encode(utf8.encode('Orbit')) && query['name'] != base64.encode(utf8.encode('Pad'))) {
      req.response.statusCode = 400;
      await req.response.close();
      return;
    }
    final ws = await WebSocketTransformer.upgrade(req);
    sockets.add(ws);
    ws.listen((Object? raw) {
      final message = (jsonDecode(raw! as String) as Map).cast<String, Object?>();
      received.add(message);
      _answer(ws, message);
    });

    if (query['token'] == issuedToken) {
      ws.add(
        jsonEncode({
          'event': 'ms.channel.connect',
          'data': {'token': issuedToken},
        }),
      );
      return;
    }
    prompts++;
    switch (prompt) {
      case Prompt.allow:
        await Future<void>.delayed(const Duration(milliseconds: 30));
        final data = tokenAuth == 'true' ? {'token': issuedToken} : <String, Object?>{};
        ws.add(jsonEncode({'event': 'ms.channel.connect', 'data': data}));
      case Prompt.deny:
        ws.add(jsonEncode({'event': 'ms.channel.unauthorized'}));
      case Prompt.timeOut:
        ws.add(jsonEncode({'event': 'ms.channel.timeOut'}));
      case Prompt.silent:
        break;
    }
  }

  void _answer(WebSocket ws, Map<String, Object?> message) {
    if (message['method'] != 'ms.channel.emit') return;
    final params = (message['params']! as Map).cast<String, Object?>();
    if (params['event'] == 'ed.installedApp.get') {
      ws.add(
        jsonEncode({
          'event': 'ed.installedApp.get',
          'data': {'data': installed},
        }),
      );
    } else if (params['event'] == 'ed.apps.icon' && answerIcons) {
      final path = (params['data']! as Map)['iconPath'];
      ws.add(
        jsonEncode({
          'event': 'ed.apps.icon',
          'data': {'iconPath': path, 'imageBase64': base64.encode(iconBytes)},
        }),
      );
    }
  }

  List<Map<String, Object?>> get commands => received.where((m) => m['method'] == 'ms.remote.control').toList();

  Future<void> stop() async {
    for (final ws in sockets) {
      unawaited(ws.close().catchError((Object _) => null));
    }
    await rest.close(force: true);
    await secure?.close(force: true);
    await upnp?.close(force: true);
  }
}

Map<String, Object?> keyJson(String key) => {
  'method': 'ms.remote.control',
  'params': {'Cmd': 'Click', 'DataOfCmd': key, 'Option': 'false', 'TypeOfRemote': 'SendRemoteKey'},
};

/// A port nothing listens on.
Future<int> closedPort() async {
  final s = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final p = s.port;
  await s.close();
  return p;
}

Future<void> pause([int ms = 150]) => Future<void>.delayed(Duration(milliseconds: ms));

void main() {
  late FakeTv tv;
  late SecurityContext serverContext;
  late Directory certDir;
  final made = <SamsungTv>[];

  setUpAll(() async {
    certDir = await Directory.systemTemp.createTemp('orbit-samsung-cert');
    final run = await Process.run('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      '${certDir.path}/key.pem',
      '-out',
      '${certDir.path}/cert.pem',
    ]);
    expect(run.exitCode, 0, reason: '${run.stderr}');
    serverContext = SecurityContext()
      ..useCertificateChain('${certDir.path}/cert.pem')
      ..usePrivateKey('${certDir.path}/key.pem');
  });

  tearDownAll(() async => certDir.delete(recursive: true));

  setUp(() async {
    tv = FakeTv();
    await tv.startRest();
  });

  tearDown(() async {
    for (final s in made) {
      await s.close();
    }
    made.clear();
    await tv.stop();
  });

  /// A phone-side Samsung pointed at the fake. UPnP goes to a dead port unless the test started it.
  Future<SamsungTv> make({
    String? secret,
    bool wss = false,
    bool withUpnp = false,
    Duration allowWait = const Duration(seconds: 3),
    Duration timeout = const Duration(seconds: 2),
    String appName = 'Orbit',
  }) async {
    if (wss) {
      tv.tokenAuth = 'true';
      await tv.startSecure(serverContext);
    }
    if (withUpnp) await tv.startUpnp();
    final samsung = SamsungTv(
      address: '127.0.0.1',
      secret: secret,
      appName: appName,
      port: tv.secure?.port ?? await closedPort(),
      restPort: tv.rest.port,
      upnpPort: tv.upnp?.port ?? await closedPort(),
      allowWait: allowWait,
      timeout: timeout,
    );
    made.add(samsung);
    return samsung;
  }

  group('pairing', () {
    test('allowed on a plain-socket TV: no token, open, caps, device facts', () async {
      final s = await make();
      expect(s.kind, TvKind.samsung);
      expect(s.pairingWay, PairingWay.allow);
      await s.connect();
      expect(s.isOpen, isTrue);
      expect(s.secret, isNull);
      expect(tv.prompts, 1);
      expect(tv.connects.single['name'], base64.encode(utf8.encode('Orbit')));
      expect(s.model, 'QE55Q70A');
      expect(s.mac, 'aa:bb:cc:dd:ee:ff');
      expect(s.name, 'Living Room');
      expect(s.caps, {
        Cap.keys,
        Cap.volume,
        Cap.mute,
        Cap.media,
        Cap.type,
        Cap.apps,
        Cap.launch,
        Cap.power,
        Cap.settings,
      });
    });

    test('allowed on a wss TV: the token becomes the secret', () async {
      final s = await make(wss: true);
      await s.connect();
      expect(s.isOpen, isTrue);
      expect(s.secret, '12345678');
      expect(tv.connects.single.containsKey('token'), isFalse);
    });

    test('another app name is sent as its own base64', () async {
      final s = await make(appName: 'Pad');
      await s.connect();
      expect(tv.connects.single['name'], base64.encode(utf8.encode('Pad')));
    });

    test('reconnect with the token: sent along, no prompt', () async {
      final s = await make(wss: true, secret: '12345678');
      await s.connect();
      expect(s.isOpen, isTrue);
      expect(tv.prompts, 0);
      expect(tv.connects.single['token'], '12345678');
      expect(s.secret, '12345678');
    });

    test('denied: BrandRefused denied, closed', () async {
      tv.prompt = Prompt.deny;
      final s = await make(wss: true);
      await expectLater(
        s.connect(),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.denied)
              .having((e) => e.message, 'message', 'The TV said no. To try again, choose it again and press Allow.'),
        ),
      );
      expect(s.isOpen, isFalse);
      expect(s.secret, isNull);
    });

    test('the TV says it timed out: BrandRefused timeout', () async {
      tv.prompt = Prompt.timeOut;
      final s = await make();
      await expectLater(
        s.connect(),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.timeout)
              .having((e) => e.message, 'message', 'Press Allow on the TV to let Orbit control it.'),
        ),
      );
      expect(s.isOpen, isFalse);
    });

    test('a timeOut with a token the TV took is a TV asleep: unreachable, no new pairing', () async {
      tv.prompt = Prompt.timeOut;
      final s = await make(secret: 'kept-token');
      await expectLater(s.connect(), throwsA(isA<BrandUnreachable>()));
      expect(s.secret, 'kept-token');
    });

    test('nobody answers within allowWait: BrandRefused timeout', () async {
      tv.prompt = Prompt.silent;
      final s = await make(allowWait: const Duration(milliseconds: 300));
      await expectLater(
        s.connect(),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.timeout)),
      );
      expect(s.isOpen, isFalse);
    });

    test('a socket the TV refuses is the external-device setting', () async {
      final s = await make(appName: 'Nobody');
      await expectLater(
        s.connect(),
        throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.setting)),
      );
    });

    test('Samsung pairing is by prompt, not code', () async {
      final s = await make();
      await expectLater(s.startPairing(), throwsA(isA<BrandError>().having((e) => e.unsupported, 'u', isTrue)));
      await expectLater(s.finishPairing('ABC123'), throwsA(isA<BrandError>()));
    });
  });

  group('unreachable', () {
    test('nothing listening: BrandUnreachable', () async {
      final s = SamsungTv(
        address: '127.0.0.1',
        restPort: await closedPort(),
        port: await closedPort(),
        timeout: const Duration(milliseconds: 500),
      );
      made.add(s);
      await expectLater(s.connect(), throwsA(isA<BrandUnreachable>()));
      expect(s.isOpen, isFalse);
    });

    test('a web server that is not a Samsung: BrandError', () async {
      await tv.rest.close(force: true);
      final other = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      other.listen((req) async {
        req.response.write('<html>hello</html>');
        await req.response.close();
      });
      final s = SamsungTv(address: '127.0.0.1', restPort: other.port, timeout: const Duration(seconds: 1));
      made.add(s);
      await expectLater(s.connect(), throwsA(isA<BrandError>()));
      await other.close(force: true);
      tv.rest = await HttpServer.bind(InternetAddress.loopbackIPv4, 0); // so tearDown has something to close
    });
  });

  group('keys', () {
    test('every mapped key sends the exact JSON', () async {
      final s = await make();
      await s.connect();
      const expected = {
        'up': 'KEY_UP',
        'down': 'KEY_DOWN',
        'left': 'KEY_LEFT',
        'right': 'KEY_RIGHT',
        'ok': 'KEY_ENTER',
        'back': 'KEY_RETURN',
        'home': 'KEY_HOME',
        'settings': 'KEY_MENU',
        'mute': 'KEY_MUTE',
        'volup': 'KEY_VOLUP',
        'voldown': 'KEY_VOLDOWN',
        'forward': 'KEY_FF',
        'rewind': 'KEY_REWIND',
      };
      for (final entry in expected.entries) {
        await s.key(entry.key);
      }
      await pause();
      expect(tv.commands, [for (final k in expected.values) keyJson(k)]);
    });

    test('play_pause alternates, starting with pause', () async {
      final s = await make();
      await s.connect();
      await s.key(RemoteKey.playPause);
      await s.key(RemoteKey.playPause);
      await s.key(RemoteKey.playPause);
      await pause();
      expect(tv.commands, [keyJson('KEY_PAUSE'), keyJson('KEY_PLAY'), keyJson('KEY_PAUSE')]);
    });

    test('recents, next, previous and unknown words are unsupported', () async {
      final s = await make();
      await s.connect();
      for (final word in [RemoteKey.recents, RemoteKey.next, RemoteKey.previous, 'banana']) {
        await expectLater(
          s.key(word),
          throwsA(
            isA<BrandError>()
                .having((e) => e.unsupported, 'unsupported', isTrue)
                .having((e) => e.message, 'message', 'Samsung TVs cannot do that from a phone.'),
          ),
        );
      }
      await pause();
      expect(tv.commands, isEmpty);
    });

    test('sleep sends KEY_POWER', () async {
      final s = await make();
      await s.connect();
      await s.sleep();
      await pause();
      expect(tv.commands, [keyJson('KEY_POWER')]);
    });

    test('a Frame is switched off with the power key held: Press every 100 ms for about 4 s, then Release', () async {
      tv.frameTv = 'true';
      final s = await make();
      await s.connect();
      await s.sleep();
      await pause();
      Map<String, Object?> power(String cmd) => {
        'method': 'ms.remote.control',
        'params': {'Cmd': cmd, 'DataOfCmd': 'KEY_POWER', 'Option': 'false', 'TypeOfRemote': 'SendRemoteKey'},
      };
      expect(tv.commands, [for (var i = 0; i < 40; i++) power('Press'), power('Release')]);
    });

    test('pointer and click are not offered', () async {
      final s = await make();
      await s.connect();
      expect(s.caps, isNot(contains(Cap.pointer)));
      expect(s.caps, isNot(contains(Cap.recents)));
      expect(s.caps, isNot(contains(Cap.nowPlaying)));
      await expectLater(s.click(), throwsA(isA<BrandError>()));
    });
  });

  group('typing', () {
    test('the text-received broadcast, then text as base64 utf8, then the end marker', () async {
      final s = await make();
      await s.connect();
      await s.type('héllo ✓');
      await pause();
      expect(tv.received.first, {
        'method': 'ms.channel.emit',
        'params': {'event': 'custom.remote.textReceived', 'to': 'broadcast'},
      });
      expect(tv.commands, [
        {
          'method': 'ms.remote.control',
          'params': {
            'Cmd': base64.encode(utf8.encode('héllo ✓')),
            'DataOfCmd': 'base64',
            'TypeOfRemote': 'SendInputString',
          },
        },
        {
          'method': 'ms.remote.control',
          'params': {'TypeOfRemote': 'SendInputEnd'},
        },
      ]);
    });

    test('submit adds Enter', () async {
      final s = await make();
      await s.connect();
      await s.type('x', submit: true);
      await pause();
      expect(tv.commands.length, 3);
      expect(tv.commands.last, keyJson('KEY_ENTER'));
    });
  });

  group('apps', () {
    setUp(() {
      tv.installed = [
        {'appId': '3201907018807', 'name': 'Netflix', 'app_type': 2, 'icon': '/opt/share/netflix.png'},
        {'appId': '111299001912', 'name': 'YouTube', 'app_type': 2, 'icon': '/opt/share/yt.png'},
        {'appId': '3201606009684', 'name': 'amazon prime', 'app_type': 4, 'icon': '/opt/share/prime.png'},
        {'appId': '5', 'name': 'Browser', 'app_type': 4},
      ];
    });

    test('the list is sorted by label, case-insensitively', () async {
      final s = await make();
      await s.connect();
      final apps = await s.apps();
      expect(apps.map((a) => a.label), ['amazon prime', 'Browser', 'Netflix', 'YouTube']);
      expect(apps.first, const TvApp('3201606009684', 'amazon prime'));
    });

    test('launch: app_type 2 and unknown ids are deep links, other types are native', () async {
      final s = await make();
      await s.connect();
      await s.apps();
      await s.launch('3201907018807');
      await s.launch('3201606009684');
      await s.launch('999'); // not in the list
      await pause();
      final launches = tv.received.where((m) => (m['params']! as Map)['event'] == 'ed.apps.launch').toList();
      Map<String, Object?> launch(String id, String type) => {
        'method': 'ms.channel.emit',
        'params': {
          'event': 'ed.apps.launch',
          'to': 'host',
          'data': {'appId': id, 'action_type': type},
        },
      };
      expect(launches, [
        launch('3201907018807', 'DEEP_LINK'),
        launch('3201606009684', 'NATIVE_LAUNCH'),
        launch('999', 'DEEP_LINK'),
      ]);
      expect(tv.restLaunches, isEmpty);
    });

    test('no list known: the REST launch goes first and the socket is left alone', () async {
      final s = await make();
      await s.connect();
      await s.launch('111299001912');
      await pause();
      expect(tv.restLaunches, ['111299001912']);
      expect(tv.received.where((m) => m['method'] == 'ms.channel.emit'), isEmpty);
    });

    test('no list known and the REST launch refused: the socket launches it', () async {
      tv.restLaunchStatus = 404;
      final s = await make();
      await s.connect();
      await s.launch('111299001912');
      await pause();
      expect(tv.restLaunches, ['111299001912']);
      final emit = tv.received.singleWhere((m) => m['method'] == 'ms.channel.emit');
      expect(((emit['params']! as Map)['data']! as Map)['action_type'], 'DEEP_LINK');
    });

    test('an icon comes back as png bytes; unknown app is null', () async {
      final s = await make();
      await s.connect();
      expect(await s.icon('3201907018807'), isNull); // no list yet, no path
      await s.apps();
      final icon = await s.icon('3201907018807');
      expect(icon!.$1, 'image/png');
      expect(icon.$2, tv.iconBytes);
      expect(await s.icon('5'), isNull); // app without an icon path
      expect(await s.icon('nope'), isNull);
    });

    test('an icon the TV never sends is null after the timeout', () async {
      tv.answerIcons = false;
      final s = await make(timeout: const Duration(milliseconds: 300));
      await s.connect();
      await s.apps();
      expect(await s.icon('3201907018807'), isNull);
    });

    test('two icons asked at once each get their own picture', () async {
      final s = await make();
      await s.connect();
      await s.apps();
      final both = await Future.wait([s.icon('3201907018807'), s.icon('111299001912')]);
      expect(both.every((r) => r != null && r.$2.length == tv.iconBytes.length), isTrue);
    });
  });

  group('volume and state', () {
    test('UPnP that answers adds volumeLevel; state tells level, max and mute', () async {
      tv.volume = 37;
      tv.muted = true;
      tv.powerState = 'on';
      final s = await make(withUpnp: true);
      await s.connect();
      expect(s.caps, contains(Cap.volumeLevel));
      expect(await s.state(), {'on': true, 'volume': 37, 'max': 100, 'muted': true});
    });

    test('setVolume goes to the TV and is clamped', () async {
      final s = await make(withUpnp: true);
      await s.connect();
      await s.setVolume(55);
      expect(tv.volume, 55);
      await s.setVolume(500);
      expect(tv.volume, 100);
      await s.setVolume(-4);
      expect(tv.volume, 0);
      expect(tv.soapActions, contains('SetVolume'));
    });

    test('no UPnP: no volumeLevel, state keeps out what it cannot know, setVolume unsupported', () async {
      final s = await make();
      await s.connect();
      expect(s.caps, isNot(contains(Cap.volumeLevel)));
      expect(await s.state(), isEmpty);
      await expectLater(s.setVolume(10), throwsA(isA<BrandError>().having((e) => e.unsupported, 'u', isTrue)));
    });

    test('standby shows as on: false', () async {
      tv.powerState = 'standby';
      final s = await make();
      await s.connect();
      expect(await s.state(), {'on': false});
    });
  });

  group('connection drops', () {
    test('a closed socket calls onClosed; the next command reconnects with the token and sends', () async {
      final s = await make(wss: true);
      var closed = 0;
      s.onClosed = () => closed++;
      await s.connect();
      expect(tv.prompts, 1);
      await tv.sockets.single.close();
      await pause(300);
      expect(closed, 1);
      expect(s.isOpen, isFalse);

      await s.key(RemoteKey.up);
      await pause();
      expect(s.isOpen, isTrue);
      expect(tv.connects.length, 2);
      expect(tv.connects.last['token'], '12345678');
      expect(tv.prompts, 1); // no new prompt
      expect(tv.commands, [keyJson('KEY_UP')]);
      expect(closed, 1);
    });

    test('close() ends it for good: no onClosed, and commands fail', () async {
      final s = await make();
      var closed = 0;
      s.onClosed = () => closed++;
      await s.connect();
      await s.close();
      await pause();
      expect(closed, 0);
      expect(s.isOpen, isFalse);
      await expectLater(s.key(RemoteKey.up), throwsA(isA<BrandUnreachable>()));
    });

    test('socket dropped and the TV gone: the command throws BrandUnreachable', () async {
      final s = await make(wss: true);
      await s.connect();
      await tv.sockets.single.close();
      await pause(300);
      await tv.rest.close(force: true);
      tv.rest = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      await expectLater(s.key(RemoteKey.home), throwsA(isA<BrandUnreachable>()));
    });
  });
}
