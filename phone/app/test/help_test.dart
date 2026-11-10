import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/bridge/event_queue.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/tv/help_mode.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/remote.dart';
import 'package:orbit/tv/tv_link.dart';

import 'cloud_fakes.dart';
import 'mock_tv.dart';
import 'support.dart';

/// The Wi-Fi door's screen read every 40 ms instead of 700.
const HelpTimings fastHelp = HelpTimings(screenRead: Duration(milliseconds: 40));

void main() {
  late List<Map<String, Object?>> sent;
  late FakeNative native;

  setUp(() {
    sent = [];
    native = FakeNative();
  });

  OrbitBridge bridgeFor(TvRemote remote) => OrbitBridge(
    remote: remote,
    native: native,
    icons: IconCache(directory: native.cacheDirectory),
  )..attach((script) async => sent.add(messageOf(script)));
  Map<String, Object?> reply(int id) => sent.lastWhere((m) => m['id'] == id);
  List<Map<String, Object?>> frames() => [
    for (final m in sent)
      if (m['event'] == 'screen') (m['data'] as Map).cast<String, Object?>(),
  ];
  int now() => DateTime.now().millisecondsSinceEpoch;

  test('jpegSize: the size from the frame header, baseline or progressive; nothing for what is not a JPEG', () {
    expect(jpegSize(MockTv.fakeJpeg), (640, 360));
    final progressive = Uint8List.fromList(MockTv.fakeJpeg)..[21] = 0xC2;
    expect(jpegSize(progressive), (640, 360));
    expect(jpegSize(MockTv.fakePng), isNull);
    expect(jpegSize(Uint8List.fromList(MockTv.fakeJpeg.sublist(0, 26))), isNull, reason: 'cut short');
    expect(jpegSize(Uint8List(0)), isNull);
  });

  test('before hello only the newest picture is held, like the other snapshots', () {
    final out = <Map<String, Object?>>[];
    final queue = EventQueue(out.add)
      ..push('screen', {'seq': 1})
      ..push('volumeKey', {'dir': 'up'})
      ..push('screen', {'seq': 2});
    expect(queue.held, [
      {
        'event': 'volumeKey',
        'data': {'dir': 'up'},
      },
      {
        'event': 'screen',
        'data': {'seq': 2},
      },
    ]);
    queue.open();
    expect(out, hasLength(2));
  });

  group('help over the cloud', () {
    late CloudRig rig;
    late FakeTvSide tv;
    late TvRemote remote;
    late OrbitBridge bridge;

    Future<void> start({int skewMs = 0, MockTv? wifiTv}) async {
      rig = CloudRig(skewMs: skewMs);
      final link = linkFor(wifiTv);
      remote = TvRemote(wifi: link, helpTimings: fastHelp)..attachCloud(rig.account, rig.cloud);
      await link.start();
      tv = await rig.linkedTv();
      await eventually(() => remote.onCloud, what: 'on the cloud');
      bridge = bridgeFor(remote);
      await bridge.handle('{"id":1,"op":"hello"}');
    }

    tearDown(() {
      remote.dispose();
      tv.close();
    });

    test('on: /api/help, then each picture as a screen event (at in the phone\'s clock), the heartbeat on; '
        'off: no more pictures', () async {
      // The database's clock is 2 minutes ahead of the phone's.
      await start(skewMs: 120000);
      await bridge.handle('{"id":2,"op":"help","args":{"on":true}}');
      expect(reply(2), {
        'id': 2,
        'ok': true,
        'data': {'ok': true, 'on': true},
      });
      expect(tv.commands.last['path'], '/api/help');
      expect(tv.commands.last['body'], {'on': true});
      expect(remote.help.via, 'cloud');

      tv.showScreen(1);
      await eventually(() => frames().length == 1, what: 'the first picture');
      final frame = frames().single;
      expect(frame['jpg'], FakeTvSide.fakeJpg);
      expect([frame['w'], frame['h'], frame['seq']], [640, 360, 1]);
      expect(now() - (frame['at'] as int), inInclusiveRange(-50, 2000), reason: 'when the TV took it, phone clock');

      tv.showScreen(2);
      await eventually(() => frames().length == 2, what: 'the next picture');
      final beats = rig.writesTo('orbit/${rig.uid}/watch');
      await eventually(() => rig.writesTo('orbit/${rig.uid}/watch') >= beats + 2, what: 'the heartbeat going on');

      await bridge.handle('{"id":3,"op":"help","args":{"on":false}}');
      expect(reply(3)['data'], {'ok': true, 'on': false});
      expect(tv.commands.last['body'], {'on': false});
      expect(remote.help.isOn, isFalse);
      expect(rig.cloud.watchScreen, isFalse);
      tv.showScreen(3);
      await Future<void>.delayed(const Duration(milliseconds: 150));
      expect(frames(), hasLength(2), reason: 'no pictures once help is off');
    });

    test(
      'a picture left from an earlier help is not shown; the TV\'s new ones are, whatever their stamp says',
      () async {
        await start();
        tv.showScreen(7, at: rig.db.serverNow - 60000);
        await bridge.handle('{"id":2,"op":"help","args":{"on":true}}');
        await Future<void>.delayed(const Duration(milliseconds: 100));
        expect(frames(), isEmpty);
        tv.showScreen(8);
        await eventually(() => frames().length == 1, what: 'the new picture');
        expect(frames().single['seq'], 8);
        // A TV whose clock is two minutes behind: what it writes now is still a picture of now.
        tv.showScreen(9, at: rig.db.serverNow - 120000);
        await eventually(() => frames().length == 2, what: 'the picture with an old stamp');
        expect(now() - (frames().last['at'] as int), inInclusiveRange(-50, 1000));
      },
    );

    test('a value that is not a picture is not one; missing sizes are the TV\'s 640 x 360', () async {
      await start();
      final cloud = rig.cloud;
      expect(cloud.screenFrame(null), isNull);
      expect(cloud.screenFrame('nonsense'), isNull);
      expect(cloud.screenFrame({'jpg': '', 'seq': 1}), isNull);
      final frame = cloud.screenFrame({'jpg': 'AAAA', 'w': 'wide', 'seq': 4.0})!;
      expect([frame['w'], frame['h'], frame['seq']], [640, 360, 4]);
      expect(now() - (frame['at'] as int), inInclusiveRange(-50, 1000), reason: 'a new picture: when it arrived');
      // The one waiting when listening starts keeps the TV's time (in the phone's clock), or goes when too old.
      final waiting = cloud.screenFrame({'jpg': 'AAAA', 'at': rig.db.serverNow - 5000}, waiting: true)!;
      expect(now() - (waiting['at'] as int), inInclusiveRange(4900, 6000));
      expect(cloud.screenFrame({'jpg': 'AAAA', 'at': rig.db.serverNow - 31000}, waiting: true), isNull);
    });

    test(
      'the app in the background: help ends by itself, no pictures, no heartbeat; "on" waits until it is back',
      () async {
        await start();
        await bridge.handle('{"id":2,"op":"help","args":{"on":true}}');
        tv.showScreen(1);
        await eventually(() => frames().length == 1, what: 'a picture');

        bridge.lifecycle(resumed: false);
        await eventually(() => !tv.helpOn, what: 'help off at the TV');
        expect(tv.commands.last['body'], {'on': false});
        expect(remote.help.isOn, isFalse);
        final beats = rig.writesTo('orbit/${rig.uid}/watch');
        tv.showScreen(2);
        await Future<void>.delayed(const Duration(milliseconds: 200));
        expect(frames(), hasLength(1), reason: 'no pictures in the background');
        expect(rig.writesTo('orbit/${rig.uid}/watch'), beats, reason: 'no heartbeat in the background');

        await bridge.handle('{"id":3,"op":"help","args":{"on":true}}');
        expect(reply(3), {'id': 3, 'ok': false, 'error': 'Help starts when Orbit is on the screen.', 'status': 409});
        expect(tv.helpOn, isFalse);

        // Back in front: the page sends help again when it hears "resumed".
        bridge.lifecycle(resumed: true);
        expect(sent.lastWhere((m) => m['event'] == 'lifecycle')['data'], {'state': 'resumed'});
        await bridge.handle('{"id":4,"op":"help","args":{"on":true}}');
        expect(reply(4)['ok'], isTrue);
        expect(tv.helpOn, isTrue);
        tv.showScreen(3);
        await eventually(() => frames().any((f) => f['seq'] == 3), what: 'pictures again');
      },
    );

    test('tapAt: a tap at a spot of the TV\'s screen, in its pixels, rounded and kept on the screen', () async {
      await start();
      await bridge.handle('{"id":2,"op":"tapAt","args":{"x":640.4,"y":359.6}}');
      expect(reply(2), {
        'id': 2,
        'ok': true,
        'data': {'ok': true},
      });
      expect(tv.commands.last['path'], '/api/pointer');
      expect(tv.commands.last['body'], {'action': 'tap', 'x': 640, 'y': 360});
      await bridge.handle('{"id":3,"op":"tapAt","args":{"x":5000,"y":-20}}');
      expect(tv.commands.last['body'], {'action': 'tap', 'x': 1279, 'y': 0});
      await bridge.handle('{"id":4,"op":"tapAt","args":{"x":"middle","y":3}}');
      expect(reply(4), {'id': 4, 'ok': false, 'error': 'Orbit needs "x" as a number.', 'status': 400});
      expect(tv.commands.where((c) => c['path'] == '/api/pointer'), hasLength(2));
    });

    test(
      'the Wi-Fi door takes over while help is on: help is asked for there, and the pictures come from it',
      () async {
        final wifiTv = await MockTv.start();
        addTearDown(wifiTv.close);
        await start(wifiTv: wifiTv);
        await bridge.handle('{"id":2,"op":"help","args":{"on":true}}');
        expect(remote.help.via, 'cloud');
        expect(rig.cloud.watchScreen, isTrue);

        await remote.wifi.connect('127.0.0.1', wifiTv.port);
        await remote.wifi.askCode();
        await remote.wifi.pair(wifiTv.nextCode);
        await eventually(() => remote.help.via == 'wifi', what: 'help through the Wi-Fi');
        expect(rig.cloud.watchScreen, isFalse);
        await eventually(() => wifiTv.helpOn, what: 'help on at the Wi-Fi door');
        await eventually(() => frames().isNotEmpty, what: 'a picture from /api/screen');
        expect(frames().last['jpg'], base64Encode(wifiTv.screen));
      },
    );
  });

  group('help over the Wi-Fi door', () {
    late MockTv tv;
    late TvLink link;
    late TvRemote remote;
    late OrbitBridge bridge;

    setUp(() async {
      tv = await MockTv.start();
      link = linkFor(tv);
      remote = TvRemote(wifi: link, helpTimings: fastHelp)..cloudUnavailable();
      bridge = bridgeFor(remote);
      await bridge.handle('{"id":1,"op":"hello"}');
      await link.connect('127.0.0.1', tv.port);
      await link.askCode();
      await link.pair(tv.nextCode);
      expect(remote.isConnected, isTrue);
    });

    tearDown(() async {
      remote.dispose();
      await tv.close();
    });

    test('on: POST /api/help, then /api/screen read again and again; a picture goes on only when x-screen-seq '
        'changed; off: the reads stop', () async {
      await bridge.handle('{"id":2,"op":"help","args":{"on":true}}');
      expect(reply(2)['data'], {'ok': true, 'on': true});
      expect(tv.helpOn, isTrue);
      expect(remote.help.via, 'wifi');
      await eventually(() => frames().length == 1, what: 'the first picture');
      final first = frames().single;
      expect(first['jpg'], base64Encode(MockTv.fakeJpeg));
      expect([first['w'], first['h'], first['seq']], [640, 360, 1]);
      expect(now() - (first['at'] as int), inInclusiveRange(0, 2000));
      expect(tv.to('/api/screen').first.headers['x-portal-token'], isNotNull);

      final reads = tv.to('/api/screen').length;
      await eventually(() => tv.to('/api/screen').length >= reads + 3, what: 'more reads');
      expect(frames(), hasLength(1), reason: 'the same seq is the same picture');

      tv.nextScreen();
      await eventually(() => frames().length == 2, what: 'the changed picture');
      expect(frames().last['seq'], 2);
      expect(frames().last['jpg'], base64Encode(tv.screen));

      await bridge.handle('{"id":3,"op":"help","args":{"on":false}}');
      expect(reply(3)['data'], {'ok': true, 'on': false});
      expect(tv.helpOn, isFalse);
      await Future<void>.delayed(const Duration(milliseconds: 80));
      final after = tv.to('/api/screen').length;
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(tv.to('/api/screen').length, after, reason: 'no reads once help is off');
    });

    test('the app in the background, or a new page: help off at the TV, and the reads stop', () async {
      await bridge.handle('{"id":2,"op":"help","args":{"on":true}}');
      await eventually(() => frames().isNotEmpty, what: 'a picture');
      bridge.lifecycle(resumed: false);
      await eventually(() => !tv.helpOn, what: 'help off at the TV');
      await Future<void>.delayed(const Duration(milliseconds: 80));
      final reads = tv.to('/api/screen').length;
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(tv.to('/api/screen').length, reads, reason: 'no reads in the background');

      bridge.lifecycle(resumed: true);
      await bridge.handle('{"id":3,"op":"help","args":{"on":true}}');
      expect(tv.helpOn, isTrue);
      bridge.pageStarted();
      await eventually(() => !tv.helpOn, what: 'help off for the new page');
      expect(remote.help.isOn, isFalse);
    });

    test('tapAt over the Wi-Fi door', () async {
      await bridge.handle('{"id":2,"op":"tapAt","args":{"x":12.2,"y":700}}');
      expect(reply(2)['ok'], isTrue);
      expect(jsonDecode(tv.to('/api/pointer').single.body), {'action': 'tap', 'x': 12, 'y': 700});
    });
  });
}
