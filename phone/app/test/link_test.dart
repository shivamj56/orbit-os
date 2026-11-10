import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/tv_link.dart';
import 'package:orbit/tv/tv_store.dart';

import 'mock_tv.dart';
import 'support.dart';

void main() {
  late MockTv tv;
  late MemoryTvStore store;
  late TvLink link;
  late List<LinkStatus> statuses;
  late List<Map<String, Object?>> states;

  setUp(() async {
    tv = await MockTv.start();
    store = MemoryTvStore();
    statuses = [];
    states = [];
  });

  tearDown(() async {
    link.dispose();
    await tv.close();
  });

  TvLink open({FakeNsd? nsd}) {
    link = linkFor(tv, store: store, nsd: nsd)
      ..onStatus = statuses.add
      ..onTvState = states.add;
    return link;
  }

  Future<void> pairWithMock() async {
    await link.connect('127.0.0.1', tv.port);
    await link.askCode();
    await link.pair(tv.nextCode);
  }

  test('hello finds the TV; then connect, askCode, a wrong code, the right code: connected', () async {
    open(
      nsd: FakeNsd([FoundTv(name: 'Family room', address: '127.0.0.1', port: tv.port, named: true)]),
    );
    final hello = await link.hello();
    expect(hello.state, anyOf(LinkState.searching, LinkState.found)); // mDNS here answers at once
    await eventually(() => link.status.state == LinkState.found, what: 'found');
    // mDNS and the scan saw the same TV: one entry, with the advert's name.
    await eventually(() => tv.to('/api/state').isNotEmpty, what: 'the scan asked the TV');
    await Future<void>.delayed(const Duration(milliseconds: 100));
    expect(link.status.found.map((f) => f.toJson()), [
      {'name': 'Family room', 'address': '127.0.0.1', 'port': tv.port},
    ]);

    final afterConnect = await link.connect('127.0.0.1', tv.port);
    expect(afterConnect.state, LinkState.needsPairing);
    expect(afterConnect.tv?.name, 'Family room');
    await link.saved;
    expect(store.tv?.port, tv.port);

    await link.askCode();
    expect(tv.shownCode, '123456');
    expect(link.status.state, LinkState.pairing);

    await expectLater(
      link.pair('654321'),
      throwsA(
        isA<OpError>()
            .having((e) => e.status, 'status', 403)
            .having((e) => e.message, 'message', 'That is not the code on the TV. 4 tries left.'),
      ),
    );
    expect(link.status.state, LinkState.pairing);

    final paired = await link.pair('123456');
    expect(paired.state, LinkState.connected);
    expect(paired.tv?.name, 'Family room');
    expect(paired.tv?.udp, tv.udpPort); // from the TV's state
    expect(paired.error, isNull);
    await link.saved;
    expect(store.token, matches(RegExp(r'^[0-9a-f]{32}$')));
    expect(link.isConnected, isTrue);
    expect(states, isNotEmpty);
    expect(states.last['tv'], 'Family room');
    expect(statuses.last.state, LinkState.connected);
  });

  test('nothing on the Wi-Fi: searching, with a word for the person, and it keeps looking', () async {
    final nsd = FakeNsd();
    link = linkFor(null, store: store, nsd: nsd)..onStatus = statuses.add;
    await link.hello();
    await eventually(() => link.status.error != null, what: 'an error');
    expect(link.status.state, LinkState.searching);
    expect(link.status.error, 'No TV found on this Wi-Fi yet.');
    await eventually(() => nsd.runs >= 3, what: 'more searches');
    link.setForeground(false);
    await Future<void>.delayed(const Duration(milliseconds: 250));
    final paused = nsd.runs;
    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(nsd.runs, paused);
  });

  test('polls every interval while connected and in front, and not while paused', () async {
    open();
    await pairWithMock();
    final before = tv.to('/api/state').length;
    final pushed = states.length;
    await eventually(() => tv.to('/api/state').length >= before + 3, what: 'three polls');
    // The TV's state did not change, and the page still hears it after every poll.
    await eventually(() => states.length >= pushed + 3, what: 'three tvstate events');
    link.setForeground(false);
    await Future<void>.delayed(const Duration(milliseconds: 100));
    final paused = tv.to('/api/state').length;
    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(tv.to('/api/state').length, paused);
    link.setForeground(true);
    await eventually(() => tv.to('/api/state').length > paused, what: 'poll after resume');
  });

  test('a 401 drops the token and asks to pair again', () async {
    open();
    await pairWithMock();
    tv.revokeAll();
    await eventually(() => link.status.state == LinkState.needsPairing, what: 'needsPairing');
    await link.saved;
    expect(store.token, isNull);
    expect(link.status.error, 'The TV no longer knows this phone. Pair it again.');
    expect(link.status.tv?.address, '127.0.0.1'); // the TV stays chosen
    expect(link.isConnected, isFalse);
  });

  test('a 401 on a request also drops the token, and the request fails with 401', () async {
    open();
    await pairWithMock();
    link.setForeground(false); // no polls racing the request
    tv.revokeAll();
    await expectLater(
      link.postJson('/api/key', {'key': 'up'}),
      throwsA(isA<OpError>().having((e) => e.status, 'status', 401)),
    );
    expect(link.status.state, LinkState.needsPairing);
    await link.saved;
    expect(store.token, isNull);
  });

  test('offline when the TV stops answering, connected again when it is back', () async {
    open();
    await pairWithMock();
    tv.unreachable = true;
    await eventually(() => link.status.state == LinkState.offline, what: 'offline');
    expect(link.status.error, contains('not answering'));
    expect(store.token, isNotNull); // an outage keeps the pairing
    tv.unreachable = false;
    await eventually(() => link.status.state == LinkState.connected, what: 'connected again');
    expect(link.status.error, isNull);
  });

  test('a saved TV and token connect at start, before any hello', () async {
    open();
    await pairWithMock();
    link.dispose();
    final token = store.token;
    statuses = [];
    open();
    await link.start();
    await eventually(() => link.status.state == LinkState.connected, what: 'connected from storage');
    expect(store.token, token);
    expect(link.status.tv?.name, 'Family room');
  });

  test('connect: another TV, something that is not a TV, and nothing at all', () async {
    open();
    await pairWithMock();
    final kept = store.token;

    // Something that is not the TV's door: refused, and nothing changes.
    final router = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    router.listen(
      (r) => r.response
        ..headers.contentType = ContentType.html
        ..write('<html>router</html>')
        ..close(),
    );
    await expectLater(
      link.connect('127.0.0.1', router.port),
      throwsA(isA<OpError>().having((e) => e.message, 'message', contains('not the TV'))),
    );
    expect(link.status.state, LinkState.connected);
    expect(link.status.tv?.port, tv.port);
    expect(store.token, kept);
    await router.close(force: true);

    // Another TV: the kept token is checked there, refused (401), and dropped.
    final other = await MockTv.start();
    final status = await link.connect('127.0.0.1', other.port);
    expect(status.state, LinkState.needsPairing);
    expect(status.tv?.port, other.port);
    await link.saved;
    expect(store.token, isNull);
    expect(store.tv?.port, other.port);
    await other.close();

    // Nothing at that address (a TV that is off): chosen, and offline until it answers.
    final gone = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final port = gone.port;
    await gone.close();
    final offline = await link.connect('127.0.0.1', port);
    expect(offline.state, LinkState.offline);
    expect(offline.tv?.port, port);
  });

  test('pairing without a code on the TV is 409; five wrong codes end the code (429)', () async {
    open();
    await link.connect('127.0.0.1', tv.port);
    await expectLater(link.pair('123456'), throwsA(isA<OpError>().having((e) => e.status, 'status', 409)));
    expect(link.status.state, LinkState.needsPairing);
    await link.askCode();
    for (var i = 0; i < 4; i++) {
      await expectLater(link.pair('000000'), throwsA(isA<OpError>().having((e) => e.status, 'status', 403)));
    }
    await expectLater(link.pair('000000'), throwsA(isA<OpError>().having((e) => e.status, 'status', 429)));
    expect(link.status.state, LinkState.needsPairing);
    expect(link.status.error, 'Too many wrong codes. Ask the TV for a new one.');
  });

  test('forget drops the token and the TV and searches again', () async {
    open();
    await pairWithMock();
    await link.hello();
    final status = await link.forget();
    expect(status.state, LinkState.searching);
    expect(status.tv, isNull);
    await link.saved;
    expect(store.tv, isNull);
    expect(store.token, isNull);
    await eventually(() => link.status.state == LinkState.found, what: 'found again');
  });

  test('actions go to the TV with the token; pointer moves go out as datagrams', () async {
    open();
    await pairWithMock();
    await link.postJson('/api/key', {'key': 'up'});
    await link.postJson('/api/volume', {'level': 30});
    expect(tv.keys, ['up']);
    expect(tv.volume, 30);
    final apps = await link.getJson('/api/apps');
    expect(apps, isA<List<Object?>>());
    link.pointer('m', 3.5, -1.2);
    link.pointer('s', 0, -8);
    await eventually(() => tv.datagrams.length == 2, what: 'two datagrams');
    final token = store.token;
    final first = tv.datagrams[0].split(' ');
    final second = tv.datagrams[1].split(' ');
    expect(first[0], 'o1');
    expect(first[1], token);
    expect(first.sublist(3), ['m', '3.5', '-1.2']);
    expect(second.sublist(3), ['s', '0', '-8']);
    expect(int.parse(second[2]), int.parse(first[2]) + 1);
  });

  test('ops that need a TV or a token say so without asking the network', () async {
    open();
    await link.start();
    await expectLater(link.askCode(), throwsA(isA<OpError>().having((e) => e.status, 'status', 0)));
    await expectLater(link.getJson('/api/apps'), throwsA(isA<OpError>().having((e) => e.status, 'status', 0)));
    await link.connect('127.0.0.1', tv.port);
    await expectLater(link.getJson('/api/apps'), throwsA(isA<OpError>().having((e) => e.status, 'status', 401)));
    expect(tv.to('/api/apps'), isEmpty);
  });

  test('after the code\'s 3 minutes (2 s here) pairing goes back to needsPairing', () async {
    open();
    await link.connect('127.0.0.1', tv.port);
    await link.askCode();
    expect(link.status.state, LinkState.pairing);
    await eventually(() => link.status.state == LinkState.needsPairing, timeout: const Duration(seconds: 4));
  });
}
