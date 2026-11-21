import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/roku.dart';

/// [volumeControl] and [powerControl]: the Roku OS 15.0 fields a player sets when it was set up to work the TV.
String _info({
  bool tv = false,
  String power = 'PowerOn',
  String user = '',
  bool volumeControl = false,
  bool powerControl = false,
}) =>
    '<?xml version="1.0" encoding="UTF-8" ?>'
    '<device-info><model-name>${tv ? '55R6A5R' : 'Roku Ultra'}</model-name>'
    '<is-tv>$tv</is-tv><power-mode>$power</power-mode>'
    '<user-device-name>$user</user-device-name>'
    '<friendly-device-name>Friendly &amp; Co</friendly-device-name>'
    '<default-device-name>Roku Ultra - X</default-device-name>'
    '<supports-tv-power-control>$powerControl</supports-tv-power-control>'
    '<supports-audio-volume-control>$volumeControl</supports-audio-volume-control></device-info>';

/// The last entry is how older Roku OS lists an app: no type at all.
const _appsXml =
    '<?xml version="1.0" encoding="UTF-8" ?><apps>'
    '<app id="tvinput.hdmi1" type="tvin" version="1.0.0">HDMI 1</app>'
    '<app id="13" type="appl" version="2.1">Prime &amp; Video</app>'
    '<app id="12" type="appl" version="4.2">Netflix</app>'
    '<app id="9" type="menu" version="1">Roku Channel &#x2014; Menu</app>'
    '<app id="14" type="appl" version="1">Caf&#233;</app>'
    '<app id="28">Pandora</app>'
    '</apps>';

class _Seen {
  _Seen(this.method, this.path);

  final String method;
  final String path;

  @override
  String toString() => '$method $path';
}

void main() {
  late HttpServer server;
  late List<_Seen> seen;
  late Map<String, (int, String, String)> routes;
  late RokuTv tv;

  setUp(() async {
    seen = [];
    routes = {'/query/device-info': (200, _info(), 'text/xml')};
    server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((req) async {
      seen.add(_Seen(req.method, req.uri.path));
      final r = routes[req.uri.path];
      if (r == null) {
        if (req.uri.path.startsWith('/keypress/') || req.uri.path.startsWith('/launch/')) {
          req.response.statusCode = 200;
        } else {
          req.response.statusCode = 404;
        }
      } else {
        req.response.statusCode = r.$1;
        req.response.headers.contentType = ContentType.parse(r.$3.isEmpty ? 'text/plain' : r.$3);
        req.response.add(utf8.encode(r.$2));
      }
      await req.response.close();
    });
    tv = RokuTv(address: '127.0.0.1', port: server.port, timeout: const Duration(seconds: 2));
  });

  tearDown(() async {
    await tv.close();
    await server.close(force: true);
  });

  List<String> keysSent() =>
      seen.where((s) => s.path.startsWith('/keypress/')).map((s) => s.path.substring('/keypress/'.length)).toList();

  test('a player: info, caps, no secret, nothing to pair', () async {
    await tv.connect();
    expect(tv.isOpen, isTrue);
    expect(tv.isTv, isFalse);
    expect(tv.model, 'Roku Ultra');
    expect(tv.deviceName, 'Friendly & Co');
    expect(tv.secret, isNull);
    expect(tv.pairingWay, PairingWay.none);
    expect(tv.kind, TvKind.roku);
    expect(tv.caps, {Cap.keys, Cap.media, Cap.type, Cap.apps, Cap.launch, Cap.settings, Cap.nowPlaying});
  });

  test('a TV: owner name wins, TV caps appear', () async {
    routes['/query/device-info'] = (200, _info(tv: true, user: 'Living Room'), 'text/xml');
    await tv.connect();
    expect(tv.isTv, isTrue);
    expect(tv.model, '55R6A5R');
    expect(tv.deviceName, 'Living Room');
    expect(tv.caps, containsAll([Cap.volume, Cap.mute, Cap.power, Cap.keys]));
  });

  test('every common key goes to its ECP name by POST', () async {
    await tv.connect();
    const wanted = {
      'up': 'Up',
      'down': 'Down',
      'left': 'Left',
      'right': 'Right',
      'ok': 'Select',
      'back': 'Back',
      'home': 'Home',
      'settings': 'Info',
      'play_pause': 'Play',
      'forward': 'Fwd',
      'rewind': 'Rev',
      'previous': 'InstantReplay',
    };
    for (final e in wanted.entries) {
      await tv.key(e.key);
    }
    expect(keysSent(), wanted.values.toList());
    expect(seen.where((s) => s.path.startsWith('/keypress/')).every((s) => s.method == 'POST'), isTrue);
  });

  test('a player keeps next, recents and volume unsupported', () async {
    await tv.connect();
    for (final k in ['next', 'recents', 'mute', 'volup', 'voldown']) {
      await expectLater(
        tv.key(k),
        throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', isTrue)),
        reason: k,
      );
    }
    await expectLater(tv.sleep(), throwsA(isA<BrandError>()));
    await expectLater(tv.setVolume(5), throwsA(isA<BrandError>()));
    expect(keysSent(), isEmpty);
  });

  test('a player set up to work the TV (Roku OS 15.0) gets the volume keys and PowerOff', () async {
    routes['/query/device-info'] = (200, _info(volumeControl: true, powerControl: true), 'text/xml');
    await tv.connect();
    expect(tv.isTv, isFalse);
    expect(tv.caps, containsAll([Cap.volume, Cap.mute, Cap.power]));
    await tv.key('volup');
    await tv.key('mute');
    await tv.sleep();
    expect(keysSent(), ['VolumeUp', 'VolumeMute', 'PowerOff']);
  });

  test('a player with volume control only keeps power hidden', () async {
    routes['/query/device-info'] = (200, _info(volumeControl: true), 'text/xml');
    await tv.connect();
    expect(tv.caps, containsAll([Cap.volume, Cap.mute]));
    expect(tv.caps, isNot(contains(Cap.power)));
    await expectLater(tv.sleep(), throwsA(isA<BrandError>().having((e) => e.unsupported, 'unsupported', isTrue)));
  });

  test('a TV sends volume keys and PowerOff; next and recents stay unsupported', () async {
    routes['/query/device-info'] = (200, _info(tv: true), 'text/xml');
    await tv.connect();
    await tv.key('mute');
    await tv.key('volup');
    await tv.key('voldown');
    await tv.sleep();
    expect(keysSent(), ['VolumeMute', 'VolumeUp', 'VolumeDown', 'PowerOff']);
    await expectLater(tv.key('next'), throwsA(isA<BrandError>()));
    await expectLater(tv.key('recents'), throwsA(isA<BrandError>()));
  });

  test('typing sends one Lit_ per character, UTF-8 percent-encoded, then Enter', () async {
    await tv.connect();
    await tv.type('a ü\u{1F600}', submit: true);
    expect(keysSent(), ['Lit_a', 'Lit_%20', 'Lit_%C3%BC', 'Lit_%F0%9F%98%80', 'Enter']);
    seen.clear();
    await tv.type('hi');
    expect(keysSent(), ['Lit_h', 'Lit_i']);
  });

  test('apps: entities decoded, tvin left out, an app without a type kept, sorted by label', () async {
    routes['/query/apps'] = (200, _appsXml, 'text/xml');
    await tv.connect();
    final apps = await tv.apps();
    expect(apps.map((a) => a.label).toList(), ['Café', 'Netflix', 'Pandora', 'Prime & Video', 'Roku Channel — Menu']);
    expect(apps.map((a) => a.id).toList(), ['14', '12', '28', '13', '9']);
  });

  test('launch posts the id; icon returns type and bytes, null when missing', () async {
    routes['/query/icon/12'] = (200, 'PNGDATA', 'image/png');
    await tv.connect();
    await tv.launch('12');
    expect(seen.last.toString(), 'POST /launch/12');
    final icon = await tv.icon('12');
    expect(icon!.$1, 'image/png');
    expect(utf8.decode(icon.$2), 'PNGDATA');
    expect(await tv.icon('99'), isNull);
  });

  test('state with an app, then Home with none', () async {
    routes['/query/active-app'] = (
      200,
      '<active-app><app id="12" type="appl" version="4">Netflix</app></active-app>',
      'text/xml',
    );
    await tv.connect();
    expect(await tv.state(), {'app': 'Netflix', 'pkg': '12', 'on': true});
    routes['/query/active-app'] = (200, '<active-app><app>Roku</app></active-app>', 'text/xml');
    final home = await tv.state();
    expect(home['app'], 'Home');
    expect(home['pkg'], isNull);
  });

  test('state reads the power mode at most every 10 seconds', () async {
    routes['/query/active-app'] = (200, '<active-app><app>Roku</app></active-app>', 'text/xml');
    routes['/query/device-info'] = (200, _info(power: 'PowerOff'), 'text/xml');
    await tv.connect();
    expect((await tv.state())['on'], isFalse);
    await tv.state();
    expect(seen.where((s) => s.path == '/query/device-info').length, 1);
  });

  test('a 403 on connect and on a command is the setting refusal', () async {
    routes['/query/device-info'] = (403, '', '');
    await expectLater(
      tv.connect(),
      throwsA(
        isA<BrandRefused>()
            .having((e) => e.reason, 'reason', BrandRefused.setting)
            .having((e) => e.message, 'message', RokuTv.settingMessage),
      ),
    );
    expect(tv.isOpen, isFalse);
    routes['/query/device-info'] = (200, _info(), 'text/xml');
    await tv.connect();
    routes['/keypress/Up'] = (403, 'ECP command not allowed in Limited mode.', 'text/plain');
    await expectLater(
      tv.key('up'),
      throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.setting)),
    );
    expect(tv.isOpen, isTrue);
  });

  test('a 401 (some firmware of 2024) is the same setting refusal', () async {
    routes['/query/device-info'] = (401, '', '');
    await expectLater(
      tv.connect(),
      throwsA(isA<BrandRefused>().having((e) => e.reason, 'reason', BrandRefused.setting)),
    );
  });

  test('nothing answering: unreachable on connect, and onClosed once when open', () async {
    final dead = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = dead.port;
    await dead.close();
    final lost = RokuTv(address: '127.0.0.1', port: port, timeout: const Duration(seconds: 1));
    await expectLater(lost.connect(), throwsA(isA<BrandUnreachable>()));
    expect(lost.isOpen, isFalse);
    await lost.close();

    await tv.connect();
    var closed = 0;
    tv.onClosed = () => closed++;
    await server.close(force: true);
    await expectLater(tv.key('up'), throwsA(isA<BrandUnreachable>()));
    await expectLater(tv.key('up'), throwsA(isA<BrandUnreachable>()));
    expect(tv.isOpen, isFalse);
    expect(closed, 1);
  });

  test('close ends it without calling onClosed', () async {
    await tv.connect();
    var closed = 0;
    tv.onClosed = () => closed++;
    await tv.close();
    expect(tv.isOpen, isFalse);
    expect(closed, 0);
  });
}
