import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/cloud/cloud_tv.dart';
import 'package:orbit/cloud/google_identity.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/remote.dart';
import 'package:orbit/tv/tv_store.dart';

import 'cloud_fakes.dart';
import 'mock_tv.dart';
import 'support.dart';

Matcher opError(int status, String message) =>
    isA<OpError>().having((e) => e.status, 'status', status).having((e) => e.message, 'message', message);

void main() {
  group('account', () {
    test('signing in and out; the account JSON follows', () async {
      final rig = CloudRig().started();
      expect(rig.cloud.accountJson(), {
        'available': true,
        'signedIn': false,
        'provider': null,
        'email': null,
        'tvLinked': false,
        'tvOnline': false,
        'tvName': null,
      });
      await rig.account.signIn();
      expect(rig.cloud.accountJson(), containsPair('signedIn', true));
      expect(rig.cloud.accountJson(), containsPair('email', 'owner@gmail.com'));
      expect(rig.google.sheets, 1);
      await rig.account.signOut();
      expect(rig.cloud.accountJson()['signedIn'], isFalse);
    });

    test('a kept ID token near its end is refreshed quietly before it is handed to the TV', () async {
      final rig = CloudRig().started();
      rig.google.life = const Duration(minutes: 2); // under the 5-minute margin
      await rig.account.signIn();
      rig.google.life = const Duration(hours: 1);
      final tv = FakeTvSide(rig.db)..showCode('11112222');
      await eventually(() => rig.cloud.connected);
      await rig.cloud.link('11112222');
      expect(rig.google.quiet, 1);
      expect(rig.google.sheets, 1, reason: 'no second sheet');
      expect(jwtExpiry(tv.tokenSeen!)!.isAfter(DateTime.now().add(const Duration(minutes: 50))), isTrue);
    });

    test('without a quiet refresh, Google\'s sheet gives the new token', () async {
      final rig = CloudRig().started();
      rig.google.life = const Duration(seconds: 30);
      await rig.account.signIn();
      rig.google
        ..quietWorks = false
        ..life = const Duration(hours: 1);
      final token = await rig.account.freshIdToken();
      expect(rig.google.sheets, 2);
      expect(jwtExpiry(token)!.isAfter(DateTime.now().add(const Duration(minutes: 50))), isTrue);
      // A good token is kept: no more asking.
      expect(await rig.account.freshIdToken(), token);
      expect(rig.google.sheets, 2);
    });
  });

  group('linking', () {
    test('a code that is not on the TV', () async {
      final rig = CloudRig().started();
      await rig.account.signIn();
      await eventually(() => rig.cloud.connected);
      await expectLater(rig.cloud.link('12345678'), throwsA(opError(403, 'That code is not on the TV.')));
    });

    test('the TV takes the token, signs in as the same account, and comes online', () async {
      final rig = CloudRig().started();
      await rig.account.signIn();
      final tv = FakeTvSide(rig.db)..showCode('12345678');
      await eventually(() => rig.cloud.connected);
      await rig.cloud.link('12345678');
      expect(tv.uid, rig.uid);
      expect(rig.db.read('link/12345678'), isNull, reason: 'the TV deleted its code');
      expect(rig.cloud.accountJson(), {
        'available': true,
        'signedIn': true,
        'provider': 'google',
        'email': 'owner@gmail.com',
        'tvLinked': true,
        'tvOnline': true,
        'tvName': 'Family room',
      });
    });

    test('no answer from the TV in time; an online stamp from before the link does not count', () async {
      final rig = CloudRig().started();
      await rig.account.signIn();
      rig.db
        ..write('link/87654321', {'tv': 'anon-tv', 'at': rig.db.serverNow})
        ..write('orbit/${rig.uid}/tv/name', 'Family room')
        ..write('orbit/${rig.uid}/tv/online', rig.db.serverNow - 60000);
      await eventually(() => rig.cloud.connected && rig.cloud.linked);
      await expectLater(rig.cloud.link('87654321'), throwsA(opError(0, 'The TV did not answer. Is it on?')));
      expect(rig.db.read('link/87654321/token'), isA<String>(), reason: 'the token was written');
    });

    test('signed out: sign in first', () async {
      final rig = CloudRig().started();
      await expectLater(rig.cloud.link('12345678'), throwsA(opError(401, 'Sign in with Google first.')));
    });

    test('unlink: tv/unlink, and the TV no longer counts as linked', () async {
      final rig = CloudRig().started();
      final tv = await rig.linkedTv();
      await rig.cloud.unlink();
      expect(rig.cloud.linked, isFalse);
      expect(rig.cloud.accountJson()['tvLinked'], isFalse);
      expect(rig.db.writes, containsAll(['orbit/${rig.uid}/tv/unlink', 'orbit/${rig.uid}/tv/name']));
      await eventually(() => rig.db.read('orbit/${rig.uid}/tv') == null, what: 'the TV left');
      tv.close();
    });
  });

  group('commands', () {
    test('cmd out, res back and deleted, the body returned; the TV\'s refusals keep its status', () async {
      final rig = CloudRig().started();
      final tv = await rig.linkedTv();
      expect(await rig.cloud.command('/api/key', {'key': 'up'}), {'ok': true});
      final sent = tv.commands.single;
      expect(sent['path'], '/api/key');
      expect(sent['body'], {'key': 'up'});
      expect(sent['at'], isA<int>(), reason: 'the server\'s timestamp');
      await eventually(() => rig.db.read('orbit/${rig.uid}/res') == null, what: 'res deleted');
      expect(rig.db.read('orbit/${rig.uid}/cmd'), isNull);

      final state = await rig.cloud.command('/api/state', const {}) as Map<String, Object?>;
      expect(state, containsPair('ok', true));
      expect(state, containsPair('player', null), reason: 'a null the database dropped comes back');
      expect(state, containsPair('tv', 'Family room'));
      expect(tv.commands.last.containsKey('body'), isFalse, reason: 'an empty body is not stored');

      tv
        ..status = 409
        ..answer = (path, body) => {'ok': false, 'error': 'The TV did not take the key.'};
      await expectLater(
        rig.cloud.command('/api/key', {'key': 'ok'}),
        throwsA(opError(409, 'The TV did not take the key.')),
      );
      tv.close();
    });

    test('a TV that does not answer: "not answering", and the command is taken back', () async {
      final rig = CloudRig().started();
      final tv = await rig.linkedTv();
      tv.asleep = true;
      await expectLater(
        rig.cloud.command('/api/key', {'key': 'up'}),
        throwsA(opError(0, 'Family room is not answering. Is it on?')),
      );
      await eventually(() => rig.db.read('orbit/${rig.uid}/cmd') == null, what: 'cmd taken back');
      tv.close();
    });

    test('no internet on the phone: commands fail at once', () async {
      final rig = CloudRig().started();
      final tv = await rig.linkedTv();
      rig.db.online = false;
      await eventually(() => !rig.cloud.connected);
      expect(rig.cloud.usable, isFalse);
      await expectLater(rig.cloud.command('/api/key', {'key': 'up'}), throwsA(opError(0, 'No internet on the phone.')));
      expect(tv.commands, isEmpty);
      tv.close();
    });

    test('pointer moves are summed and sent at most once per 100 ms', () async {
      final rig = CloudRig().started();
      final tv = await rig.linkedTv();
      for (var i = 0; i < 30; i++) {
        rig.cloud.pointer('move', 1, -0.5);
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      rig.cloud.pointer('scroll', 0, -8);
      await Future<void>.delayed(const Duration(milliseconds: 400));
      final moves = [
        for (final c in tv.commands)
          if ((c['body'] as Map)['action'] == 'move') c['body'] as Map,
      ];
      final scrolls = [
        for (final c in tv.commands)
          if ((c['body'] as Map)['action'] == 'scroll') c['body'] as Map,
      ];
      expect(tv.commands.every((c) => c['path'] == '/api/pointer'), isTrue);
      expect(moves.length, inInclusiveRange(2, 6), reason: '${moves.length} commands for 30 moves in ~300 ms');
      expect(moves.fold<num>(0, (sum, m) => sum + (m['dx'] as num)), 30);
      expect(moves.fold<num>(0, (sum, m) => sum + (m['dy'] as num)), -15);
      expect(scrolls.single, {'action': 'scroll', 'dx': 0, 'dy': -8});
      for (var i = 1; i < tv.commandTimes.length; i++) {
        expect(tv.commandTimes[i].difference(tv.commandTimes[i - 1]).inMilliseconds, greaterThanOrEqualTo(80));
      }
      tv.close();
    });
  });

  group('presence, heartbeat, state', () {
    test('while on the cloud and in front: watch every interval, tv/state as tvstate; paused: neither', () async {
      final rig = CloudRig().started();
      final tv = await rig.linkedTv();
      final states = <Map<String, Object?>>[];
      rig.cloud
        ..onTvState = states.add
        ..active = true;
      await eventually(() => rig.writesTo('orbit/${rig.uid}/watch') >= 3, what: 'three heartbeats');
      expect(rig.db.read('orbit/${rig.uid}/watch'), isA<int>());
      rig.db.write('orbit/${rig.uid}/tv/state', {'tv': 'Family room', 'app': 'YouTube', 'volume': 9});
      await eventually(() => states.any((s) => s['volume'] == 9), what: 'the state');
      expect(states.last, containsPair('ok', true));
      expect(states.last, containsPair('pkg', null));

      rig.cloud.inFront = false;
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final beats = rig.writesTo('orbit/${rig.uid}/watch');
      final seen = states.length;
      rig.db.write('orbit/${rig.uid}/tv/state', {'tv': 'Family room', 'volume': 10});
      await Future<void>.delayed(const Duration(milliseconds: 250));
      expect(rig.writesTo('orbit/${rig.uid}/watch'), beats);
      expect(states.length, seen);
      tv.close();
    });

    test('online = a stamp within 3 minutes by the database\'s clock, and it lapses by itself', () async {
      // The phone's clock is 2 minutes behind the database's.
      final rig = CloudRig(skewMs: 120000).started();
      await rig.account.signIn();
      var changes = 0;
      rig.cloud.onChange = () => changes++;
      rig.db
        ..write('orbit/${rig.uid}/tv/name', 'Family room')
        ..write('orbit/${rig.uid}/tv/online', rig.db.serverNow - 200000);
      await eventually(() => rig.cloud.linked);
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(rig.cloud.online, isFalse, reason: '3 min 20 s old by the database (80 s by the phone)');

      rig.db.write('orbit/${rig.uid}/tv/online', rig.db.serverNow - 180000 + 300);
      await eventually(() => rig.cloud.online, what: 'online');
      final before = changes;
      // The lapse is announced by itself (a timer), not only seen when someone asks.
      await eventually(() => !rig.cloud.online && changes > before, what: 'lapsed and announced');
    });
  });

  group('TvRemote', () {
    late MockTv wifiTv;

    setUp(() async => wifiTv = await MockTv.start());
    tearDown(() async => wifiTv.close());

    test('the cloud carries the TV when the Wi-Fi has none: via cloud, ops become commands', () async {
      final rig = CloudRig();
      final link = linkFor(null);
      final remote = TvRemote(wifi: link)..attachCloud(rig.account, rig.cloud);
      await link.start();
      final tv = await rig.linkedTv();
      await eventually(() => remote.onCloud, what: 'on the cloud');
      expect(remote.status.toJson(), {
        'state': 'connected',
        'tv': {'name': 'Family room', 'address': 'cloud', 'port': 0, 'udp': null},
        'found': <Object?>[],
        'via': 'cloud',
        'error': null,
      });
      expect(remote.isConnected, isTrue);
      expect(link.quietSearch, isTrue, reason: 'no /24 scans while the cloud carries the TV');
      await remote.postJson('/api/key', {'key': 'up'});
      expect(tv.commands.last['body'], {'key': 'up'});
      final (type, bytes) = await remote.icon('com.netflix.ninja');
      expect(type, 'image/png');
      expect(bytes, MockTv.fakePng);
      expect(await remote.getJson('/api/apps'), [
        {'pkg': 'com.netflix.ninja', 'label': 'Netflix'},
      ]);
      remote.dispose();
      tv.close();
    });

    test('the Wi-Fi door wins when it answers', () async {
      final rig = CloudRig();
      final store = MemoryTvStore();
      final link = linkFor(wifiTv, store: store);
      final remote = TvRemote(wifi: link)..attachCloud(rig.account, rig.cloud);
      final tv = await rig.linkedTv();
      await eventually(() => remote.onCloud);
      await link.connect('127.0.0.1', wifiTv.port);
      expect(remote.status.state, LinkState.needsPairing, reason: 'a TV chosen on the Wi-Fi answers: pair it there');
      expect(remote.onCloud, isFalse);
      await link.askCode();
      await link.pair(wifiTv.nextCode);
      expect(remote.status.via, 'wifi');
      expect(remote.status.state, LinkState.connected);
      await remote.postJson('/api/key', {'key': 'ok'});
      expect(wifiTv.keys, ['ok']);
      expect(tv.commands, isEmpty);
      final beats = rig.writesTo('orbit/${rig.uid}/watch');
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(rig.writesTo('orbit/${rig.uid}/watch'), beats, reason: 'no heartbeat while on the Wi-Fi');
      remote.dispose();
      tv.close();
    });

    test('signed in and linked, the TV not online: offline via cloud, with a word, and ops say so', () async {
      final rig = CloudRig();
      final link = linkFor(null);
      final remote = TvRemote(wifi: link)..attachCloud(rig.account, rig.cloud);
      await link.start();
      await rig.account.signIn();
      rig.db
        ..write('orbit/${rig.uid}/tv/name', 'Family room')
        ..write('orbit/${rig.uid}/tv/online', rig.db.serverNow - 4 * 60000);
      await eventually(() => remote.status.via == 'cloud', what: 'the cloud TV');
      expect(remote.status.toJson(), {
        'state': 'offline',
        'tv': {'name': 'Family room', 'address': 'cloud', 'port': 0, 'udp': null},
        'found': <Object?>[],
        'via': 'cloud',
        'error': 'Family room is not online. Is it on?',
      });
      await expectLater(
        remote.postJson('/api/key', {'key': 'up'}),
        throwsA(opError(0, 'Family room is not online. Is it on?')),
      );
      remote.dispose();
    });
  });

  group('the bridge over the cloud', () {
    late List<Map<String, Object?>> sent;
    late FakeNative native;
    late Directory cache;

    setUp(() async {
      sent = [];
      native = FakeNative();
      cache = await Directory.systemTemp.createTemp('orbit-cloud-icons');
      native.cache = cache;
    });
    tearDown(() async => cache.delete(recursive: true));

    OrbitBridge bridgeFor(TvRemote remote) => OrbitBridge(
      remote: remote,
      native: native,
      icons: IconCache(directory: native.cacheDirectory),
    )..attach((script) async => sent.add(messageOf(script)));
    Map<String, Object?> reply(int id) => sent.lastWhere((m) => m['id'] == id);
    List<Map<String, Object?>> events(String name) => [
      for (final m in sent)
        if (m['event'] == name) m,
    ];

    test('account, signIn, linkTv, ops over the cloud, unlinkTv, signOut', () async {
      final rig = CloudRig();
      final link = linkFor(null);
      final remote = TvRemote(wifi: link)..attachCloud(rig.account, rig.cloud);
      final bridge = bridgeFor(remote);
      await bridge.handle('{"id":1,"op":"hello"}');
      await bridge.handle('{"id":2,"op":"account"}');
      expect(reply(2)['data'], containsPair('signedIn', false));

      await bridge.handle('{"id":3,"op":"signIn"}');
      expect(reply(3)['data'], containsPair('email', 'owner@gmail.com'));
      expect(events('account').last['data'], containsPair('signedIn', true));

      await bridge.handle('{"id":4,"op":"linkTv","args":{"code":"123"}}');
      expect(reply(4), {'id': 4, 'ok': false, 'error': 'Type the 8 digits shown on the TV.', 'status': 400});

      final tv = FakeTvSide(rig.db)..showCode('12345678');
      await eventually(() => rig.cloud.connected);
      await bridge.handle('{"id":5,"op":"linkTv","args":{"code":"1234 5678"}}');
      expect(reply(5)['data'], {
        'available': true,
        'signedIn': true,
        'provider': 'google',
        'email': 'owner@gmail.com',
        'tvLinked': true,
        'tvOnline': true,
        'tvName': 'Family room',
      });
      await eventually(() => events('status').isNotEmpty && (events('status').last['data'] as Map)['via'] == 'cloud');
      expect(events('status').last['data'], containsPair('state', 'connected'));
      expect(native.volumeKeys.last, isTrue, reason: 'the volume keys go to the TV over the cloud too');

      await bridge.handle('{"id":6,"op":"key","args":{"key":"up"}}');
      expect(reply(6), {'id': 6, 'ok': true, 'data': <String, Object?>{}});
      expect(tv.commands.last['body'], {'key': 'up'});
      await bridge.handle('{"id":7,"op":"icon","args":{"pkg":"com.netflix.ninja"}}');
      expect(reply(7)['data'], {'src': 'data:image/png;base64,${base64Encode(MockTv.fakePng)}'});
      await bridge.handle('{"id":8,"op":"volume","args":{"level":30}}');
      expect(reply(8)['data'], {'volume': 30, 'max': 100});
      await bridge.handle('{"id":9,"op":"askCode"}');
      expect(reply(9)['status'], 0, reason: 'askCode is Wi-Fi only');

      await bridge.handle('{"id":10,"op":"unlinkTv"}');
      expect(reply(10)['data'], containsPair('tvLinked', false));
      await bridge.handle('{"id":11,"op":"signOut"}');
      expect(reply(11)['data'], containsPair('signedIn', false));
      expect(events('account').last['data'], containsPair('signedIn', false));
      expect(native.volumeKeys.last, isFalse);
      remote.dispose();
      tv.close();
    });

    test('a closed sign-in sheet is 499; without Firebase, signIn is 503 and the account is empty', () async {
      final rig = CloudRig();
      rig.google.cancel = true;
      final withCloud = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      final bridge = bridgeFor(withCloud);
      await bridge.handle('{"id":1,"op":"signIn"}');
      expect(reply(1), {
        'id': 1,
        'ok': false,
        'error': 'Sign-in was closed before an account was chosen.',
        'status': 499,
      });
      withCloud.dispose();

      sent.clear();
      final wifiOnlyBridge = bridgeFor(wifiOnly(linkFor(null)));
      await wifiOnlyBridge.handle('{"id":2,"op":"account"}');
      expect(reply(2)['data'], {
        'available': false,
        'signedIn': false,
        'provider': null,
        'email': null,
        'tvLinked': false,
        'tvOnline': false,
        'tvName': null,
      });
      await wifiOnlyBridge.handle('{"id":3,"op":"signIn"}');
      expect(reply(3)['status'], 503);
    });
  });

  test('a res in the Wi-Fi shape: errors without a body get the plain words', () {
    expect(
      () => CloudTv.unwrapAnswer('/api/key', {'status': 500}),
      throwsA(opError(500, 'Something went wrong on the TV.')),
    );
    expect(
      () => CloudTv.unwrapAnswer('/api/key', 'nonsense'),
      throwsA(isA<OpError>().having((e) => e.status, 's', 502)),
    );
    expect(CloudTv.unwrapAnswer('/api/apps', {'status': 200, 'body': <Object?>[]}), <Object?>[]);
    expect(jsonEncode(CloudTv.wifiShapedState({'tv': 'X'})), contains('"ok":true'));
  });
}
