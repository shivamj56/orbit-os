import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/io_client.dart';
import 'package:orbit/tv/subnet_scan.dart';
import 'package:orbit/tv/tv_client.dart';

import 'mock_tv.dart';

void main() {
  late MockTv tv;
  late TvClient client;

  setUp(() async {
    tv = await MockTv.start();
    client = TvClient(timeout: const Duration(seconds: 2));
  });

  tearDown(() async {
    client.close();
    await tv.close();
  });

  Future<String> pair() async {
    await client.postJson('127.0.0.1', tv.port, '/api/askcode', const <String, Object?>{});
    final answer = await client.postJson('127.0.0.1', tv.port, '/api/pair', {'code': tv.shownCode});
    return (answer as Map)['token'] as String;
  }

  group('TvClient', () {
    test('askcode, pair, then state and key with the token', () async {
      final token = await pair();
      expect(token, matches(RegExp(r'^[0-9a-f]{32}$')));
      final state = await client.getJson('127.0.0.1', tv.port, '/api/state', token: token) as Map;
      expect(state['ok'], isTrue);
      expect(state['tv'], 'Family room');
      await client.postJson('127.0.0.1', tv.port, '/api/key', {'key': 'up'}, token: token);
      expect(tv.keys, ['up']);
    });

    test('sends exactly the headers the door wants, and never an Origin', () async {
      final token = await pair();
      await client.postJson('127.0.0.1', tv.port, '/api/key', {'key': 'ok'}, token: token);
      await client.getJson('127.0.0.1', tv.port, '/api/state', token: token);
      final post = tv.to('/api/key').single.headers;
      expect(post['content-type'], 'application/json');
      expect(post['content-length'], '${utf8.encode(jsonEncode({'key': 'ok'})).length}');
      expect(post.containsKey('transfer-encoding'), isFalse);
      expect(post['x-portal-token'], token);
      expect(post['host'], '127.0.0.1:${tv.port}');
      expect(post['connection'], 'close');
      for (final request in tv.requests) {
        expect(request.headers.containsKey('origin'), isFalse, reason: request.path);
        expect(request.headers.containsKey('sec-fetch-site'), isFalse, reason: request.path);
      }
      // The scan and askcode carry no token; only requests after pairing do.
      expect(tv.to('/api/askcode').single.headers.containsKey('x-portal-token'), isFalse);
      expect(tv.to('/api/state').single.headers['x-portal-token'], token);
    });

    test('a refusal carries the TV\'s own words and status', () async {
      await expectLater(
        client.getJson('127.0.0.1', tv.port, '/api/state'),
        throwsA(
          isA<TvHttpException>()
              .having((e) => e.status, 'status', 401)
              .having((e) => e.message, 'message', 'This phone is not paired with the TV.')
              .having((e) => e.fromDoor, 'fromDoor', isTrue),
        ),
      );
      await client.postJson('127.0.0.1', tv.port, '/api/askcode', const <String, Object?>{});
      await expectLater(
        client.postJson('127.0.0.1', tv.port, '/api/pair', {'code': '000000'}),
        throwsA(
          isA<TvHttpException>()
              .having((e) => e.status, 'status', 403)
              .having((e) => e.message, 'message', 'That is not the code on the TV. 4 tries left.'),
        ),
      );
    });

    test('nothing listening is unreachable, not an HTTP error', () async {
      final closed = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      final port = closed.port;
      await closed.close();
      await expectLater(client.getJson('127.0.0.1', port, '/api/state'), throwsA(isA<TvUnreachableException>()));
    });

    test('a dropped connection is unreachable', () async {
      tv.unreachable = true;
      await expectLater(client.getJson('127.0.0.1', tv.port, '/api/state'), throwsA(isA<TvUnreachableException>()));
    });

    test('a TV that does not answer times out (about the client\'s timeout, then unreachable)', () async {
      tv.hang = true;
      final quick = TvClient(timeout: const Duration(milliseconds: 300));
      final watch = Stopwatch()..start();
      await expectLater(quick.getJson('127.0.0.1', tv.port, '/api/state'), throwsA(isA<TvUnreachableException>()));
      expect(watch.elapsedMilliseconds, lessThan(1500));
      quick.close();
    });

    test('an icon comes back as bytes with its type', () async {
      final token = await pair();
      final reply = await client.request(
        'GET',
        '127.0.0.1',
        tv.port,
        '/api/icon',
        token: token,
        query: {'pkg': 'com.netflix.ninja'},
      );
      expect(reply.contentType, 'image/png');
      expect(reply.bytes, MockTv.fakePng);
      expect(tv.to('/api/icon').single.query['pkg'], 'com.netflix.ninja');
    });
  });

  group('SubnetScanner', () {
    test('a TV is an address whose /api/state answers 401 with ok:false; others are not', () async {
      // Another device on the network: answers 200 with a web page.
      final other = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      other.listen(
        (r) => r.response
          ..headers.contentType = ContentType.html
          ..write('<html>router</html>')
          ..close(),
      );
      // And one that answers 401, but not as the TV's door does.
      final strict = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      strict.listen(
        (r) => r.response
          ..statusCode = 401
          ..write('Unauthorized')
          ..close(),
      );

      final scanner = SubnetScanner(port: tv.port, targets: () async => ['127.0.0.1']);
      final seen = <String>[];
      final result = await scanner.scan((found) => seen.add(found.key));
      expect(result.onNetwork, isTrue);
      expect(seen, ['127.0.0.1:${tv.port}']);
      expect(result.found.single.name, 'TV'); // the door's 401 has no name; mDNS supplies it
      expect(tv.to('/api/state').single.headers.containsKey('x-portal-token'), isFalse);

      final io = IOClient();
      expect(await SubnetScanner(port: other.port).probe(io, '127.0.0.1'), isNull);
      expect(await SubnetScanner(port: strict.port).probe(io, '127.0.0.1'), isNull);
      io.close();
      await other.close(force: true);
      await strict.close(force: true);
    });

    test('no home network: the scan says so and asks nobody', () async {
      final result = await SubnetScanner(targets: () async => null).scan((_) => fail('nothing to find'));
      expect(result.onNetwork, isFalse);
      expect(result.found, isEmpty);
    });

    test('the /24 around the phone, without the phone', () {
      final hosts = LocalNetwork.neighbours(InternetAddress('192.168.1.23'));
      expect(hosts, hasLength(253));
      expect(hosts.first, '192.168.1.1');
      expect(hosts.last, '192.168.1.254');
      expect(hosts, isNot(contains('192.168.1.23')));
      expect(LocalNetwork.isPrivate([192, 168, 1, 7]), isTrue);
      expect(LocalNetwork.isPrivate([172, 20, 0, 1]), isTrue);
      expect(LocalNetwork.isPrivate([10, 0, 0, 2]), isTrue);
      expect(LocalNetwork.isPrivate([100, 64, 0, 1]), isFalse); // carrier-grade NAT on mobile data
      expect(LocalNetwork.isPrivate([8, 8, 8, 8]), isFalse);
    });
  });
}
