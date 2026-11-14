import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/bridge/js_message.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/bridge/request.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/tv_link.dart';
import 'package:orbit/tv/tv_store.dart';

import 'mock_tv.dart';
import 'support.dart';

void main() {
  group('receiveScript (the JS string for runJavaScript)', () {
    test('quotes, backslashes, newlines, </script>, U+2028/2029 and non-ASCII survive, as pure ASCII', () {
      final message = <String, Object?>{
        'event': 'tvstate',
        'data': {
          'title': 'He said "hi" \\ and left\nnext line\r\ttab',
          'artist': '</script><script>alert(1)</script>',
          'player': 'line${String.fromCharCode(0x2028)}separator${String.fromCharCode(0x2029)}paragraph',
          'app': 'कुरुक्षेत्र 🎬 Ünïcødé',
          'pkg': "it's & <b>",
          'nested': [
            1,
            2.5,
            null,
            true,
            {'k': 'v'},
          ],
        },
      };
      final script = receiveScript(message);
      expect(script, startsWith('(function(){var f=window.orbitReceive;if(typeof f==="function")f(JSON.parse("'));
      expect(script, endsWith('"));})();'));
      expect(script.codeUnits.every((u) => u >= 0x20 && u < 0x7F), isTrue, reason: 'printable ASCII only');
      expect(script.toLowerCase(), isNot(contains('</script')));
      expect(script, isNot(contains('<')));
      expect(script, isNot(contains('\n')));
      expect(messageOf(script), message);
    });

    test('a reply and an event have the SPEC shapes', () {
      expect(messageOf(receiveScript({'id': 12, 'ok': true, 'data': <String, Object?>{}})), {
        'id': 12,
        'ok': true,
        'data': <String, Object?>{},
      });
      expect(jsStringLiteral('a"b'), r'"a\"b"');
      // Written with fromCharCode: a backslash-u in this file would be read as the character itself by some tools.
      final u = '${String.fromCharCode(92)}u';
      expect(jsStringLiteral('<&>'), '"${u}003c${u}0026${u}003e"');
      expect(jsStringLiteral(String.fromCharCode(0x2028)), '"${u}2028"');
    });
  });

  group('BridgeRequest.parse', () {
    test('id 0, a positive id, a missing id (0); args default to {}', () {
      expect(BridgeRequest.parse('{"id":0,"op":"pointer","args":{"type":"move","dx":1,"dy":2}}')!.id, 0);
      expect(BridgeRequest.parse('{"id":12,"op":"key","args":{"key":"up"}}')!.id, 12);
      final noId = BridgeRequest.parse('{"op":"haptic","args":{"kind":"tick"}}')!;
      expect(noId.id, 0);
      final noArgs = BridgeRequest.parse('{"id":3,"op":"hello"}')!;
      expect(noArgs.op, 'hello');
      expect(noArgs.args.has('anything'), isFalse);
    });

    test('unreadable messages are dropped: not JSON, not an object, a negative or fractional id', () {
      expect(BridgeRequest.parse('not json'), isNull);
      expect(BridgeRequest.parse('[1,2]'), isNull);
      expect(BridgeRequest.parse('{"id":-1,"op":"hello"}'), isNull);
      expect(BridgeRequest.parse('{"id":1.5,"op":"hello"}'), isNull);
      expect(BridgeRequest.parse('{"id":"7","op":"hello"}'), isNull);
      expect(BridgeRequest.parse('{"id":7.0,"op":"hello"}')!.id, 7);
    });

    test('typed addresses', () {
      expect(parseTypedAddress(' 192.168.1.7 '), ('192.168.1.7', 8090));
      expect(parseTypedAddress('192.168.1.7:8099'), ('192.168.1.7', 8099));
      expect(parseTypedAddress('http://192.168.1.7:8090/'), ('192.168.1.7', 8090));
      expect(parseTypedAddress('Living-Room.local'), ('living-room.local', 8090));
      for (final bad in ['', '192.168.1', '300.1.1.1', '192.168.1.7:0', '192.168.1.7:99999', 'a b', 'fe80::1']) {
        expect(
          () => parseTypedAddress(bad),
          throwsA(isA<OpError>().having((e) => e.status, 'status', 400)),
          reason: bad,
        );
      }
    });
  });

  group('OrbitBridge', () {
    late MockTv tv;
    late MemoryTvStore store;
    late TvLink link;
    late FakeNative native;
    late OrbitBridge bridge;
    late List<Map<String, Object?>> sent;
    late Directory cacheDir;

    setUp(() async {
      tv = await MockTv.start();
      store = MemoryTvStore();
      link = linkFor(tv, store: store);
      native = FakeNative();
      cacheDir = await Directory.systemTemp.createTemp('orbit-icons-test');
      native.cache = cacheDir;
      sent = [];
      bridge = OrbitBridge(
        remote: wifiOnly(link),
        native: native,
        icons: IconCache(directory: native.cacheDirectory),
      )..attach((script) async => sent.add(messageOf(script)));
    });

    tearDown(() async {
      link.dispose();
      await tv.close();
      await cacheDir.delete(recursive: true);
    });

    List<Map<String, Object?>> replies() => [
      for (final m in sent)
        if (m.containsKey('id')) m,
    ];
    List<Map<String, Object?>> events([String? name]) => [
      for (final m in sent)
        if (m.containsKey('event') && (name == null || m['event'] == name)) m,
    ];

    Future<void> pair() async {
      await bridge.handle(
        jsonEncode({
          'id': 101,
          'op': 'connect',
          'args': {'address': '127.0.0.1', 'port': tv.port},
        }),
      );
      await bridge.handle('{"id":102,"op":"askCode"}');
      await bridge.handle('{"id":103,"op":"pair","args":{"code":"123 456"}}');
      expect(replies().last, containsPair('ok', true), reason: '${replies().last}');
    }

    test('id 0 gets no reply; every other id gets exactly one, with its own id', () async {
      await bridge.handle('{"id":0,"op":"haptic","args":{"kind":"tick"}}');
      await bridge.handle('{"op":"haptic","args":{"kind":"light"}}');
      expect(sent, isEmpty);
      expect(native.haptics, ['tick', 'light']);

      await bridge.handle('{"id":7,"op":"haptic","args":{"kind":"error"}}');
      await bridge.handle('{"id":8,"op":"status"}');
      expect(replies().map((r) => r['id']), [7, 8]);
      expect(replies()[0], {'id': 7, 'ok': true, 'data': <String, Object?>{}});
      expect((replies()[1]['data'] as Map)['state'], 'searching');
      expect((replies()[1]['data'] as Map)['via'], 'wifi');
    });

    test('errors are replies too: unknown op, bad args (400); unreadable messages are dropped', () async {
      await bridge.handle('{"id":4,"op":"teleport"}');
      await bridge.handle('{"id":5,"op":"haptic","args":{"kind":"thunder"}}');
      await bridge.handle('{"id":6,"op":"pair","args":{"code":"12"}}');
      await bridge.handle('{"id":9,"op":"key","args":{"key":"up"}}');
      await bridge.handle('{"id":-3,"op":"status"}');
      await bridge.handle('garbage');
      expect(replies().map((r) => r['id']), [4, 5, 6, 9]);
      expect(replies()[0], {'id': 4, 'ok': false, 'error': 'Orbit has no "teleport".', 'status': 400});
      expect(replies()[1]['status'], 400);
      expect(replies()[2], {'id': 6, 'ok': false, 'error': 'Type the 6 digits shown on the TV.', 'status': 400});
      expect(replies()[3], {'id': 9, 'ok': false, 'error': 'Choose your TV first.', 'status': 0});
    });

    test('events wait for hello, go out after its reply, and then go straight through', () async {
      await link.start();
      bridge.pageStarted();
      bridge.lifecycle(resumed: false);
      bridge.lifecycle(resumed: true);
      native.volumeKeyHandler!('up');
      expect(sent, isEmpty, reason: 'nothing before hello');
      expect(bridge.events.held.map((m) => m['event']), ['status', 'account', 'lifecycle', 'volumeKey']);

      await bridge.handle('{"id":1,"op":"hello"}');
      expect(sent.first['id'], 1, reason: 'the reply comes first');
      expect((sent.first['data'] as Map)['state'], isA<String>());
      expect(sent.skip(1).take(4).map((m) => m['event']), ['status', 'account', 'lifecycle', 'volumeKey']);
      expect(events('account').single['data'], {
        'available': false,
        'signedIn': false,
        'provider': null,
        'email': null,
        'tvLinked': false,
        'tvOnline': false,
        'tvName': null,
      });
      expect(events('lifecycle').single['data'], {'state': 'resumed'}, reason: 'only the newest lifecycle is kept');

      final before = sent.length;
      bridge.lifecycle(resumed: false);
      expect(sent.length, before + 1);
      expect(sent.last, {
        'event': 'lifecycle',
        'data': {'state': 'paused'},
      });
    });

    test('a page reload holds events again until its own hello, starting from the current status', () async {
      await bridge.handle('{"id":1,"op":"hello"}');
      sent.clear();
      bridge.pageStarted();
      bridge.lifecycle(resumed: false);
      expect(sent, isEmpty);
      await bridge.handle('{"id":2,"op":"hello"}');
      expect(sent.first['id'], 2);
      expect(events().map((e) => e['event']), containsAllInOrder(['status', 'lifecycle']));
    });

    test('pairing through the bridge, then key, volume, apps, icon, state, pointer', () async {
      await bridge.handle('{"id":1,"op":"hello"}');
      await pair();
      final status = replies().last['data'] as Map;
      expect(status['state'], 'connected');
      expect((status['tv'] as Map)['name'], 'Family room');
      expect(native.volumeKeys.last, isTrue, reason: 'volume keys go to the TV once connected');
      expect(events('status').last['data'], containsPair('state', 'connected'));

      sent.clear();
      await bridge.handle('{"id":20,"op":"key","args":{"key":"up"}}');
      await bridge.handle('{"id":21,"op":"volume","args":{"level":30}}');
      await bridge.handle('{"id":22,"op":"apps"}');
      await bridge.handle('{"id":23,"op":"icon","args":{"pkg":"com.netflix.ninja"}}');
      await bridge.handle('{"id":24,"op":"icon","args":{"pkg":"com.netflix.ninja"}}');
      await bridge.handle('{"id":25,"op":"state"}');
      await bridge.handle('{"id":0,"op":"pointer","args":{"type":"move","dx":3.5,"dy":-1.2}}');
      await bridge.handle('{"id":26,"op":"pointer","args":{"type":"click"}}');
      await bridge.handle('{"id":27,"op":"volumeStep","args":{"dir":"down"}}');
      final byId = {for (final r in replies()) r['id']: r};
      expect(byId[20], {'id': 20, 'ok': true, 'data': <String, Object?>{}});
      expect(byId[21]!['data'], {'volume': 30, 'max': 100});
      expect(byId[22]!['data'], [
        {'pkg': 'com.netflix.ninja', 'label': 'Netflix'},
        {'pkg': 'com.google.android.youtube.tv', 'label': 'YouTube'},
      ]);
      final src = 'data:image/png;base64,${base64Encode(MockTv.fakePng)}';
      expect(byId[23]!['data'], {'src': src});
      expect(byId[24]!['data'], {'src': src});
      expect(tv.to('/api/icon'), hasLength(1), reason: 'the second icon comes from memory');
      expect(File('${cacheDir.path}/orbit-icons/com.netflix.ninja.png').existsSync(), isTrue);
      expect((byId[25]!['data'] as Map)['title'], 'A "quoted" title\n</script>');
      expect(byId[26]!['data'], {'ok': true});
      expect(byId[27], {'id': 27, 'ok': true, 'data': <String, Object?>{}});
      expect(tv.keys, ['up', 'voldown']);
      await eventually(() => tv.datagrams.isNotEmpty, what: 'a datagram');
      expect(tv.datagrams.single, endsWith(' m 3.5 -1.2'));
      expect(replies().where((r) => r['id'] == 0), isEmpty);
    });

    test('the phone\'s volume keys: an event for the page and a step on the TV, only when allowed', () async {
      await bridge.handle('{"id":1,"op":"hello"}');
      await pair();
      native.volumeKeyHandler!('up');
      await eventually(() => tv.keys.contains('volup'), what: 'volup on the TV');
      expect(events('volumeKey').last, {
        'event': 'volumeKey',
        'data': {'dir': 'up'},
      });

      await bridge.handle('{"id":30,"op":"settings","args":{"volumeKeys":false}}');
      expect(native.volumeKeys.last, isFalse);
      await link.saved;
      expect(store.volumeKeys, isFalse);
      await bridge.handle('{"id":31,"op":"settings","args":{"volumeKeys":true}}');
      expect(native.volumeKeys.last, isTrue);

      await bridge.handle('{"id":32,"op":"forget"}');
      expect(native.volumeKeys.last, isFalse, reason: 'no TV: the keys set the phone\'s own volume again');
    });

    test('keepAwake holds the screen on only while the app is in front', () async {
      await bridge.handle('{"id":1,"op":"keepAwake","args":{"on":true}}');
      expect(native.keepAwake.last, isTrue);
      bridge.lifecycle(resumed: false);
      expect(native.keepAwake.last, isFalse);
      bridge.lifecycle(resumed: true);
      expect(native.keepAwake.last, isTrue);
      await bridge.handle('{"id":2,"op":"keepAwake","args":{"on":false}}');
      expect(native.keepAwake.last, isFalse);
    });

    test('a 401 from the TV reaches the page as status 401 and a needsPairing status event', () async {
      await bridge.handle('{"id":1,"op":"hello"}');
      await pair();
      link.setForeground(false);
      tv.revokeAll();
      await bridge.handle('{"id":40,"op":"key","args":{"key":"ok"}}');
      expect(replies().last, {'id': 40, 'ok': false, 'error': 'This phone is not paired with the TV.', 'status': 401});
      expect(events('status').last['data'], containsPair('state', 'needsPairing'));
      expect(native.volumeKeys.last, isFalse);
    });
  });
}
