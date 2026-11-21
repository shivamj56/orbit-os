import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/lg.dart';

/// What the fake TV does when a phone registers without a key it knows.
enum _Prompt { accept, deny, silent }

/// A webOS TV on loopback: the SSAP socket at `/`, the pointer socket at `/input`, icons over HTTP at `/icon.png`.
class _FakeLg {
  _FakeLg._(this.server, this.secure);

  final HttpServer server;
  final bool secure;

  String? knownKey;
  _Prompt prompt = _Prompt.accept;
  bool rejectSigned = false;
  final String issuedKey = 'issued-key-1';

  /// What a real set often does with turnOff: 'answer', 'close' (the socket goes, no answer) or 'silent'.
  String turnOff = 'answer';

  final List<Map<String, Object?>> registers = [];
  final List<Map<String, Object?>> requests = [];
  final List<String> frames = [];
  final List<WebSocket> ssap = [];
  final List<WebSocket> inputs = [];
  final Map<String, Map<String, Object?>> answers = {};
  final Map<String, String> subscribed = {};
  int prompts = 0;

  int get port => server.port;

  static Future<_FakeLg> start({SecurityContext? context}) async {
    final server = context == null
        ? await HttpServer.bind(InternetAddress.loopbackIPv4, 0)
        : await HttpServer.bindSecure(InternetAddress.loopbackIPv4, 0, context);
    final tv = _FakeLg._(server, context != null);
    server.listen(tv._handle);
    return tv;
  }

  Future<void> _handle(HttpRequest req) async {
    if (req.uri.path == '/icon.png') {
      req.response
        ..headers.contentType = ContentType('image', 'png')
        ..add([1, 2, 3, 4]);
      await req.response.close();
      return;
    }
    if (!WebSocketTransformer.isUpgradeRequest(req)) {
      req.response.statusCode = 404;
      await req.response.close();
      return;
    }
    final ws = await WebSocketTransformer.upgrade(req);
    if (req.uri.path == '/input') {
      inputs.add(ws);
      ws.listen((data) => frames.add(data as String), onError: (Object _) {});
    } else {
      ssap.add(ws);
      ws.listen((data) => _onSsap(ws, jsonDecode(data as String) as Map<String, Object?>), onError: (Object _) {});
    }
  }

  void _send(WebSocket ws, Map<String, Object?> msg) {
    try {
      ws.add(jsonEncode(msg));
    } on StateError {
      // The phone's side was dropped by the test already.
    }
  }

  void _onSsap(WebSocket ws, Map<String, Object?> m) {
    final payload = (m['payload'] as Map?)?.cast<String, Object?>() ?? {};
    switch (m['type']) {
      case 'register':
        registers.add(m);
        if (rejectSigned && (payload['manifest'] as Map).containsKey('signatures')) {
          _send(ws, {'type': 'error', 'id': 'register_0', 'error': '403 forbidden', 'payload': {}});
          return;
        }
        final key = payload['client-key'];
        if (key != null && key == knownKey) {
          _send(ws, {
            'type': 'registered',
            'id': 'register_0',
            'payload': {'client-key': key},
          });
          return;
        }
        prompts++;
        _send(ws, {
          'type': 'response',
          'id': 'register_0',
          'payload': {'pairingType': 'PROMPT', 'returnValue': true},
        });
        switch (prompt) {
          case _Prompt.accept:
            Timer(const Duration(milliseconds: 30), () {
              knownKey = issuedKey;
              _send(ws, {
                'type': 'registered',
                'id': 'register_0',
                'payload': {'client-key': issuedKey},
              });
            });
          case _Prompt.deny:
            Timer(const Duration(milliseconds: 30), () {
              _send(ws, {'type': 'error', 'id': 'register_0', 'error': '403 User denied access', 'payload': {}});
            });
          case _Prompt.silent:
            break;
        }
      case 'request' || 'subscribe':
        requests.add(m);
        final uri = m['uri'] as String;
        if (m['type'] == 'subscribe') subscribed[uri] = m['id'] as String;
        if (uri == 'ssap://system/turnOff' && turnOff != 'answer') {
          if (turnOff == 'close') unawaited(ws.close());
          return;
        }
        final answer = answers[uri] ?? {'returnValue': true};
        if (uri.endsWith('getPointerInputSocket')) {
          final scheme = secure ? 'wss' : 'ws';
          answer['socketPath'] = '$scheme://127.0.0.1:$port/input';
        }
        _send(ws, {'type': 'response', 'id': m['id'], 'payload': answer});
    }
  }

  /// Pushes news on an open subscription.
  void push(String uri, Map<String, Object?> payload) {
    final id = subscribed[uri]!;
    _send(ssap.last, {'type': 'response', 'id': id, 'payload': payload});
  }

  List<String> get uris => [for (final r in requests) r['uri'] as String];

  Map<String, Object?> lastPayload(String uri) =>
      (requests.lastWhere((r) => r['uri'] == uri)['payload'] as Map?)?.cast<String, Object?>() ?? {};

  Future<void> dropSsap() async {
    for (final ws in List.of(ssap)) {
      await ws.close();
    }
  }

  Future<void> stop() => server.close(force: true);
}

Future<int> _deadPort() async {
  final s = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = s.port;
  await s.close();
  return port;
}

Future<void> _until(bool Function() ok, {String what = 'condition'}) async {
  final end = DateTime.now().add(const Duration(seconds: 3));
  while (!ok()) {
    if (DateTime.now().isAfter(end)) fail('timed out waiting for $what');
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

const _unknownCard = {'returnValue': true};

void main() {
  late _FakeLg fake;
  late int dead;
  final made = <LgTv>[];

  LgTv lg({String? secret, Duration allowWait = const Duration(seconds: 3), int? securePort, int? plainPort}) {
    final tv = LgTv(
      address: '127.0.0.1',
      secret: secret,
      securePort: securePort ?? dead,
      plainPort: plainPort ?? fake.port,
      allowWait: allowWait,
      timeout: const Duration(seconds: 2),
    );
    made.add(tv);
    return tv;
  }

  setUp(() async {
    fake = await _FakeLg.start();
    dead = await _deadPort();
  });

  tearDown(() async {
    for (final tv in made) {
      await tv.close();
    }
    made.clear();
    await fake.stop();
  });

  group('pairing', () {
    test('a first pairing waits for Accept and keeps the key the TV hands out', () async {
      final tv = lg();
      expect(tv.pairingWay, PairingWay.allow);
      expect(tv.kind, TvKind.lg);
      expect(tv.secret, isNull);
      await tv.connect();
      expect(tv.isOpen, isTrue);
      expect(tv.secret, 'issued-key-1');
      expect(fake.prompts, 1);
      final payload = fake.registers.single['payload'] as Map;
      expect(fake.registers.single['id'], 'register_0');
      expect(payload['pairingType'], 'PROMPT');
      expect(payload['forcePairing'], false);
      expect(payload.containsKey('client-key'), isFalse);
      final manifest = payload['manifest'] as Map;
      expect(manifest['signatures'], isNotEmpty);
      expect((manifest['signed'] as Map)['appId'], 'com.lge.test');
    });

    test('Deny on the TV throws BrandRefused.denied', () async {
      fake.prompt = _Prompt.deny;
      final tv = lg();
      await expectLater(
        tv.connect(),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.denied)
              .having(
                (e) => e.message,
                'message',
                'The TV said no. To try again, choose it again and accept on the TV.',
              ),
        ),
      );
      expect(tv.isOpen, isFalse);
      expect(tv.secret, isNull);
    });

    test('nobody answering the prompt throws BrandRefused.timeout', () async {
      fake.prompt = _Prompt.silent;
      final tv = lg(allowWait: const Duration(milliseconds: 300));
      await expectLater(
        tv.connect(),
        throwsA(
          isA<BrandRefused>()
              .having((e) => e.reason, 'reason', BrandRefused.timeout)
              .having((e) => e.message, 'message', 'Press Accept on the TV to let Orbit control it.'),
        ),
      );
      expect(tv.isOpen, isFalse);
    });

    test('a saved key the TV knows gives no prompt', () async {
      fake.knownKey = 'saved';
      final tv = lg(secret: 'saved');
      await tv.connect();
      expect(tv.isOpen, isTrue);
      expect(fake.prompts, 0);
      expect((fake.registers.single['payload'] as Map)['client-key'], 'saved');
      expect(tv.secret, 'saved');
    });

    test('a saved key the TV no longer knows prompts again and the new key replaces it', () async {
      fake.knownKey = 'other';
      final tv = lg(secret: 'stale');
      await tv.connect();
      expect(fake.prompts, 1);
      expect(tv.secret, 'issued-key-1');
    });

    test('firmware that refuses the signed manifest gets the unsigned one', () async {
      fake.rejectSigned = true;
      final tv = lg();
      await tv.connect();
      expect(fake.registers, hasLength(2));
      final manifest = (fake.registers.last['payload'] as Map)['manifest'] as Map;
      expect(manifest.containsKey('signatures'), isFalse);
      expect(manifest.containsKey('signed'), isFalse);
      expect(manifest['permissions'], contains('READ_LGE_SDX'));
      expect(tv.secret, 'issued-key-1');
    });

    test('pairing by code is not a thing for LG', () async {
      final tv = lg();
      await expectLater(tv.startPairing(), throwsA(isA<BrandError>().having((e) => e.unsupported, 'u', isTrue)));
      await expectLater(tv.finishPairing('ABC123'), throwsA(isA<BrandError>()));
    });
  });

  group('wss', () {
    test('the self-signed certificate is accepted for the TV address', () async {
      final dir = await Directory.systemTemp.createTemp('lg_cert');
      addTearDown(() => dir.delete(recursive: true));
      final run = await Process.run('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1', //
        '-keyout', '${dir.path}/k.pem', '-out', '${dir.path}/c.pem',
      ]);
      expect(run.exitCode, 0, reason: '${run.stderr}');
      final context = SecurityContext()
        ..useCertificateChain('${dir.path}/c.pem')
        ..usePrivateKey('${dir.path}/k.pem');
      final secure = await _FakeLg.start(context: context);
      addTearDown(secure.stop);
      secure.knownKey = 'k';

      final tv = lg(secret: 'k', securePort: secure.port, plainPort: dead);
      await tv.connect();
      expect(tv.isOpen, isTrue);
      expect(secure.registers, hasLength(1));

      await tv.key(RemoteKey.up);
      await _until(() => secure.frames.isNotEmpty, what: 'a frame on the wss pointer socket');
      expect(secure.frames.single, 'type:button\nname:UP\n\n');
    });
  });

  group('commands', () {
    late LgTv tv;
    setUp(() async {
      tv = lg();
      await tv.connect();
    });

    test('caps', () {
      expect(tv.caps, {
        Cap.keys, Cap.volume, Cap.mute, Cap.volumeLevel, Cap.media, Cap.type, Cap.apps, Cap.launch, Cap.power, //
        Cap.pointer, Cap.settings, Cap.nowPlaying,
      });
    });

    test('buttons are the exact frames on the pointer socket', () async {
      const names = {
        RemoteKey.up: 'UP',
        RemoteKey.down: 'DOWN',
        RemoteKey.left: 'LEFT',
        RemoteKey.right: 'RIGHT',
        RemoteKey.ok: 'ENTER',
        RemoteKey.back: 'BACK',
        RemoteKey.home: 'HOME',
        RemoteKey.settings: 'MENU',
      };
      for (final entry in names.entries) {
        await tv.key(entry.key);
      }
      await _until(() => fake.frames.length == names.length, what: 'eight frames');
      expect(fake.frames, [for (final n in names.values) 'type:button\nname:$n\n\n']);
      expect(fake.uris.where((u) => u.endsWith('getPointerInputSocket')), hasLength(1));
    });

    test('next, previous and recents are unsupported', () async {
      for (final key in [RemoteKey.next, RemoteKey.previous, RemoteKey.recents, 'bogus']) {
        await expectLater(tv.key(key), throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', isTrue)));
      }
    });

    test('volume up, down and a level', () async {
      await tv.key(RemoteKey.volumeUp);
      await tv.key(RemoteKey.volumeDown);
      await tv.setVolume(25);
      expect(
        fake.uris,
        containsAllInOrder(['ssap://audio/volumeUp', 'ssap://audio/volumeDown', 'ssap://audio/setVolume']),
      );
      expect(fake.lastPayload('ssap://audio/setVolume'), {'volume': 25});
    });

    test('mute toggles the state read from the new getVolume answer', () async {
      fake.answers['ssap://audio/getVolume'] = {
        'returnValue': true,
        'volumeStatus': {'volume': 12, 'muteStatus': false},
      };
      await tv.key(RemoteKey.mute);
      expect(fake.lastPayload('ssap://audio/setMute'), {'mute': true});
      fake.answers['ssap://audio/getVolume'] = {
        'returnValue': true,
        'volumeStatus': {'volume': 12, 'muteStatus': true},
      };
      await tv.key(RemoteKey.mute);
      expect(fake.lastPayload('ssap://audio/setMute'), {'mute': false});
    });

    test('mute toggles the state read from the old getVolume answer', () async {
      fake.answers['ssap://audio/getVolume'] = {'returnValue': true, 'volume': 9, 'muted': true};
      await tv.key(RemoteKey.mute);
      expect(fake.lastPayload('ssap://audio/setMute'), {'mute': false});
    });

    test('mute left out of getVolume is read from audio/getStatus', () async {
      fake.answers['ssap://audio/getVolume'] = {'returnValue': true, 'volume': 9};
      fake.answers['ssap://audio/getStatus'] = {'returnValue': true, 'volume': 9, 'mute': true};
      await tv.key(RemoteKey.mute);
      expect(fake.lastPayload('ssap://audio/setMute'), {'mute': false});
    });

    test('media: play_pause alternates starting with pause; forward and rewind', () async {
      await tv.key(RemoteKey.playPause);
      await tv.key(RemoteKey.playPause);
      await tv.key(RemoteKey.playPause);
      await tv.key(RemoteKey.forward);
      await tv.key(RemoteKey.rewind);
      final media = fake.uris.where((u) => u.startsWith('ssap://media.controls/')).toList();
      expect(media, [
        'ssap://media.controls/pause',
        'ssap://media.controls/play',
        'ssap://media.controls/pause',
        'ssap://media.controls/fastForward',
        'ssap://media.controls/rewind',
      ]);
    });

    test('pointer move, scroll and click; zero moves are dropped', () async {
      tv.pointer('m', 3.6, -2.4);
      tv.pointer('m', 0.2, -0.3);
      tv.pointer('s', 0, 8);
      await _until(() => fake.frames.length == 2, what: 'move and scroll frames');
      await tv.click();
      await _until(() => fake.frames.length == 3, what: 'click frame');
      expect(fake.frames, ['type:move\ndx:4\ndy:-2\ndown:0\n\n', 'type:scroll\ndx:0\ndy:8\n\n', 'type:click\n\n']);
    });

    test('the pointer socket is reopened after it dropped', () async {
      await tv.key(RemoteKey.up);
      await _until(() => fake.frames.length == 1);
      await fake.inputs.single.close();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      await tv.key(RemoteKey.down);
      await _until(() => fake.frames.length == 2, what: 'a frame on the second pointer socket');
      expect(fake.inputs, hasLength(2));
      expect(fake.frames.last, 'type:button\nname:DOWN\n\n');
    });

    test('typing, with and without Enter', () async {
      await tv.type('hello');
      expect(fake.lastPayload('ssap://com.webos.service.ime/insertText'), {'text': 'hello', 'replace': 0});
      expect(fake.uris, isNot(contains('ssap://com.webos.service.ime/sendEnterKey')));
      await tv.type('search', submit: true);
      expect(fake.lastPayload('ssap://com.webos.service.ime/insertText')['text'], 'search');
      expect(fake.uris.last, 'ssap://com.webos.service.ime/sendEnterKey');
    });

    test('sleep is system/turnOff', () async {
      await tv.sleep();
      expect(fake.uris.last, 'ssap://system/turnOff');
    });

    test('an answer with returnValue false is a BrandError', () async {
      fake.answers['ssap://system/turnOff'] = {'returnValue': false};
      await expectLater(tv.sleep(), throwsA(isA<BrandError>()));
    });

    test('a set that switches off before it answers: sleep is done, and the drop is reported', () async {
      fake.turnOff = 'close';
      final closed = Completer<void>();
      tv.onClosed = closed.complete;
      await tv.sleep();
      await closed.future.timeout(const Duration(seconds: 3));
      expect(fake.uris.last, 'ssap://system/turnOff');
    });

    test('a set that never answers turnOff: sleep is still done', () async {
      fake.turnOff = 'silent';
      await tv.sleep();
      expect(fake.uris.last, 'ssap://system/turnOff');
    });
  });

  group('apps', () {
    late LgTv tv;
    setUp(() async {
      fake.answers['ssap://com.webos.applicationManager/listLaunchPoints'] = {
        'returnValue': true,
        'launchPoints': [
          {'id': 'youtube.leanback.v4', 'title': 'YouTube', 'icon': 'http://127.0.0.1:${fake.port}/icon.png'},
          {'id': 'netflix', 'title': 'Netflix', 'largeIcon': 'http://127.0.0.1:${fake.port}/icon.png'},
          {'id': 'com.webos.app.hdmi1', 'title': 'HDMI 1'},
          {'id': 'elsewhere', 'title': 'Elsewhere', 'icon': 'http://203.0.113.9/x.png'},
        ],
      };
      tv = lg();
      await tv.connect();
    });

    test('apps are sorted by label; launch sends the id', () async {
      final list = await tv.apps();
      expect(list.map((a) => a.label), ['Elsewhere', 'HDMI 1', 'Netflix', 'YouTube']);
      expect(list.last.id, 'youtube.leanback.v4');
      await tv.launch('netflix');
      expect(fake.uris.last, 'ssap://system.launcher/launch');
      expect(fake.lastPayload('ssap://system.launcher/launch'), {'id': 'netflix'});
    });

    test('icon fetches the remembered address; unknown ids and foreign hosts give null', () async {
      expect(await tv.icon('netflix'), isNull); // list not read yet
      await tv.apps();
      final icon = await tv.icon('netflix');
      expect(icon, isNotNull);
      expect(icon!.$1, 'image/png');
      expect(icon.$2, Uint8List.fromList([1, 2, 3, 4]));
      expect((await tv.icon('youtube.leanback.v4'))!.$2, hasLength(4));
      expect(await tv.icon('com.webos.app.hdmi1'), isNull);
      expect(await tv.icon('elsewhere'), isNull);
      expect(await tv.icon('nope'), isNull);
    });

    test('state maps the foreground app to its label (new volume answer)', () async {
      fake.answers['ssap://com.webos.applicationManager/getForegroundAppInfo'] = {
        'returnValue': true,
        'appId': 'netflix',
      };
      fake.answers['ssap://audio/getVolume'] = {
        'returnValue': true,
        'volumeStatus': {'volume': 17, 'muteStatus': true},
      };
      expect(await tv.state(), {'app': 'Netflix', 'pkg': 'netflix', 'volume': 17, 'max': 100, 'muted': true});
    });

    test('state with the old volume answer and an app that is not in the list', () async {
      fake.answers['ssap://com.webos.applicationManager/getForegroundAppInfo'] = {
        'returnValue': true,
        'appId': 'com.webos.app.unknown',
      };
      fake.answers['ssap://audio/getVolume'] = {'returnValue': true, 'volume': 30, 'muted': false};
      expect(await tv.state(), {
        'app': 'com.webos.app.unknown',
        'pkg': 'com.webos.app.unknown',
        'volume': 30,
        'max': 100,
        'muted': false,
      });
    });

    test('state leaves out what the TV does not tell', () async {
      fake.answers['ssap://com.webos.applicationManager/getForegroundAppInfo'] = {'returnValue': true, 'appId': ''};
      fake.answers['ssap://audio/getVolume'] = _unknownCard;
      expect(await tv.state(), isEmpty);
    });

    test('news on a subscription calls onChanged, the first answer does not', () async {
      var news = 0;
      tv.onChanged = () => news++;
      await _until(() => fake.subscribed.length == 2, what: 'both subscriptions');
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(news, 0);
      fake.push('ssap://audio/getVolume', {'returnValue': true, 'volume': 5});
      await _until(() => news == 1, what: 'onChanged');
    });
  });

  group('mac', () {
    test('is read from the connected interface after connect', () async {
      fake.knownKey = 'k';
      fake.answers['ssap://com.webos.service.connectionmanager/getinfo'] = {
        'returnValue': true,
        'wiredInfo': {'macAddress': 'aa:aa:aa:aa:aa:aa', 'state': 'disconnected'},
        'wifiInfo': {'macAddress': 'bb:bb:bb:bb:bb:bb', 'state': 'connected'},
      };
      final tv = lg(secret: 'k');
      expect(tv.mac, isNull);
      await tv.connect();
      expect(tv.mac, 'bb:bb:bb:bb:bb:bb');
    });

    test('a wired-only TV gives its wired address; a TV without the service gives null', () async {
      fake.knownKey = 'k';
      fake.answers['ssap://com.webos.service.connectionmanager/getinfo'] = {
        'returnValue': true,
        'wiredInfo': {'macAddress': 'cc:cc:cc:cc:cc:cc', 'state': 'connected'},
      };
      final wired = lg(secret: 'k');
      await wired.connect();
      expect(wired.mac, 'cc:cc:cc:cc:cc:cc');

      fake.answers['ssap://com.webos.service.connectionmanager/getinfo'] = {'returnValue': false};
      final none = lg(secret: 'k');
      await none.connect();
      expect(none.isOpen, isTrue);
      expect(none.mac, isNull);
    });
  });

  group('connection', () {
    test('a drop calls onClosed; the next command reconnects with the key and goes through', () async {
      final tv = lg();
      await tv.connect();
      final closed = Completer<void>();
      tv.onClosed = closed.complete;
      await fake.dropSsap();
      await closed.future.timeout(const Duration(seconds: 3));
      expect(tv.isOpen, isFalse);

      await tv.key(RemoteKey.volumeUp);
      expect(tv.isOpen, isTrue);
      expect(fake.registers, hasLength(2));
      expect((fake.registers.last['payload'] as Map)['client-key'], 'issued-key-1');
      expect(fake.prompts, 1);
      expect(fake.uris.last, 'ssap://audio/volumeUp');
    });

    test('close() ends it without onClosed', () async {
      final tv = lg();
      await tv.connect();
      var closed = 0;
      tv.onClosed = () => closed++;
      await tv.close();
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(tv.isOpen, isFalse);
      expect(closed, 0);
    });

    test('nothing listening: connect and commands throw BrandUnreachable', () async {
      final tv = lg(secret: 'k', plainPort: dead);
      await expectLater(tv.connect(), throwsA(isA<BrandUnreachable>()));
      expect(tv.isOpen, isFalse);
      await expectLater(tv.key(RemoteKey.volumeUp), throwsA(isA<BrandUnreachable>()));
    });

    test('a TV that went away makes the next command BrandUnreachable', () async {
      fake.knownKey = 'k';
      final tv = lg(secret: 'k');
      await tv.connect();
      await fake.dropSsap();
      await fake.stop();
      await _until(() => !tv.isOpen, what: 'the drop');
      await expectLater(tv.sleep(), throwsA(isA<BrandUnreachable>()));
    });
  });
}
