// The link to a TV of another make (tv/brands/direct_link.dart) and how TvRemote and the bridge use it, against a fake
// driver: no sockets beyond the Orbit TV's loopback door in the TvRemote tests.
import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/direct_link.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/remote.dart';

import '../support.dart';

/// A TV of another make that does what the test says.
class FakeBrandTv extends BrandTv implements InstallsApps {
  FakeBrandTv(this.kind, this.address, this.secretIn, {this.pairingWay = PairingWay.allow});

  @override
  final TvKind kind;
  @override
  final String address;
  final String? secretIn;
  @override
  final PairingWay pairingWay;

  /// What [connect] does next: null opens; otherwise it throws this.
  Object? connectFails;

  /// When set, [connect] waits for it (the person at the TV).
  Completer<void>? holdConnect;

  /// The token the TV hands out on an accepted prompt.
  String? giveSecret = 'tok-1';
  String code = 'A1B2C3';
  bool codeShown = false;
  bool _open = false;
  final List<String> keys = [];
  final List<String> typed = [];
  final List<String> launched = [];
  Map<String, Object?> stateNow = {'app': 'Netflix', 'pkg': 'netflix'};
  int connects = 0;
  int closes = 0;
  Uint8List? installed;
  Set<String> capsNow = {Cap.keys, Cap.volume, Cap.mute, Cap.apps, Cap.launch, Cap.type, Cap.power};

  String? _secret;

  @override
  String? get secret => _secret ?? secretIn;

  @override
  Set<String> get caps => capsNow;

  @override
  bool get isOpen => _open;

  @override
  String? get model => 'QA55';

  @override
  String? get mac => 'AA:BB:CC:DD:EE:FF';

  @override
  Future<void> connect() async {
    connects++;
    final hold = holdConnect;
    if (hold != null) await hold.future;
    final fail = connectFails;
    if (fail != null) throw fail;
    if (pairingWay == PairingWay.code && !codeShown && secretIn == null && _secret == null) {
      throw const BrandNeedsPairing();
    }
    if (pairingWay == PairingWay.allow && secret == null) _secret = giveSecret;
    _open = true;
  }

  @override
  Future<void> startPairing() async => codeShown = true;

  @override
  Future<void> finishPairing(String code) async {
    if (code != this.code) throw const BrandRefused(BrandRefused.wrongCode, 'That is not the code on the TV.');
    _secret = 'paired';
    _open = true;
  }

  /// The TV went to standby.
  void drop() {
    _open = false;
    onClosed?.call();
  }

  @override
  Future<void> key(String key) async {
    if (!_open) throw const BrandUnreachable();
    if (key == RemoteKey.recents) throw const BrandError('No recents here.', unsupported: true);
    keys.add(key);
  }

  @override
  Future<void> type(String text, {bool submit = false}) async => typed.add('$text|$submit');

  @override
  Future<List<TvApp>> apps() async => const [TvApp('netflix', 'Netflix'), TvApp('youtube', 'YouTube')];

  @override
  Future<void> launch(String id) async => launched.add(id);

  @override
  Future<(String, Uint8List)?> icon(String id) async =>
      id == 'netflix' ? ('image/png', Uint8List.fromList([0x89, 0x50, 0x4e, 0x47])) : null;

  @override
  Future<Map<String, Object?>> state() async => stateNow;

  @override
  Future<void> setVolume(int level) async => throw const BrandError('No level.', unsupported: true);

  @override
  Future<void> sleep() async => keys.add('sleep');

  @override
  Future<void> installApk(Uint8List apk, String name) async => installed = apk;

  @override
  Future<void> close() async {
    closes++;
    _open = false;
  }
}

class FakeFinder implements BrandFinder {
  FakeFinder([this.tvs = const []]);

  List<BrandFound> tvs;
  BrandFound? probed;
  int runs = 0;

  @override
  Future<List<BrandFound>> run(void Function(List<BrandFound> sofar) onUpdate) async {
    runs++;
    if (tvs.isNotEmpty) onUpdate(tvs);
    return tvs;
  }

  @override
  Future<BrandFound?> probe(String address) async => probed?.address == address ? probed : null;
}

const DirectTimings fast = DirectTimings(
  poll: Duration(milliseconds: 40),
  retry: Duration(milliseconds: 60),
  showPrompt: Duration(milliseconds: 30),
  reply: Duration(milliseconds: 80),
  searchAgain: [Duration(milliseconds: 50)],
);

Future<void> until(bool Function() ok, {Duration within = const Duration(seconds: 2)}) async {
  final end = DateTime.now().add(within);
  while (!ok()) {
    if (DateTime.now().isAfter(end)) fail('condition not met in time');
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}

void main() {
  late List<FakeBrandTv> made;
  late MemoryDirectStore store;
  late FakeFinder finder;
  late List<LinkStatus> statuses;
  late List<Map<String, Object?>> states;
  PairingWay way = PairingWay.allow;
  void Function(FakeBrandTv tv)? prepare;

  DirectLink makeLink({List<String>? woke}) {
    final link = DirectLink(
      store: store,
      make: (tv, secret) {
        final fake = FakeBrandTv(tv.kind, tv.address, secret, pairingWay: way);
        prepare?.call(fake);
        made.add(fake);
        return fake;
      },
      finder: finder,
      waker: (mac, address) async {
        woke?.add('$mac@$address');
        return true;
      },
      timings: fast,
    );
    link.onStatus = statuses.add;
    link.onTvState = states.add;
    return link;
  }

  setUp(() {
    made = [];
    store = MemoryDirectStore();
    finder = FakeFinder();
    statuses = [];
    states = [];
    way = PairingWay.allow;
    prepare = null;
  });

  group('choosing and pairing', () {
    test('accepting on the TV: "pairing" with how=allow while it waits, then connected, the token kept', () async {
      final link = makeLink();
      final hold = Completer<void>();
      prepare = (tv) => tv.holdConnect = hold;
      final first = await link.choose(TvKind.samsung, '10.0.0.5', name: 'Living room');
      expect(first.state, LinkState.pairing);
      expect(first.pairing, {'how': 'allow'});
      expect(first.tv!.kind, 'samsung');
      expect(first.tv!.caps, DirectLink.defaultCaps[TvKind.samsung]);
      hold.complete();
      await until(() => link.isConnected);
      expect(link.status.pairing, isNull);
      expect(link.status.tv!.caps, (made.single.capsNow.toList()..sort()));
      await link.saved;
      expect(store.value.secret, 'tok-1');
      expect(store.value.active, isTrue);
      expect(store.value.tv!.model, 'QA55', reason: 'what the TV said about itself is kept');
      expect(store.value.tv!.mac, 'aa:bb:cc:dd:ee:ff');
      link.dispose();
    });

    test('a refusal on the TV: needsPairing with its words, and again() tries once more', () async {
      final link = makeLink();
      prepare = (tv) => tv.connectFails = const BrandRefused(BrandRefused.denied, 'The TV said no.');
      final status = await link.choose(TvKind.lg, '10.0.0.6');
      expect(status.state, LinkState.needsPairing);
      expect(status.error, 'The TV said no.');
      expect(status.pairing, {'how': 'allow'});
      made.single.connectFails = null;
      await link.again();
      await until(() => link.isConnected);
      expect(made.single.connects, 2);
      link.dispose();
    });

    test('a setting on the TV stops phones: how=setting, and the words say where', () async {
      final link = makeLink();
      way = PairingWay.none;
      prepare = (tv) => tv.connectFails = const BrandRefused(BrandRefused.setting, 'Turn on network access.');
      final status = await link.choose(TvKind.roku, '10.0.0.7');
      expect(status.state, LinkState.needsPairing);
      expect(status.pairing, {'how': 'setting'});
      expect(status.error, 'Turn on network access.');
      link.dispose();
    });

    test('a code TV: needsPairing (hex), askCode shows it, a wrong code is 403 and stays, the right one connects', () async {
      way = PairingWay.code;
      final link = makeLink();
      final status = await link.choose(TvKind.androidtv, '10.0.0.8');
      expect(status.state, LinkState.needsPairing);
      expect(status.pairing, {'how': 'code', 'length': 6, 'chars': 'hex'});
      await link.askCode();
      expect(made.single.codeShown, isTrue);
      expect(link.status.state, LinkState.pairing);
      await expectLater(
        link.pair('FFFFFF'),
        throwsA(isA<OpError>().having((e) => e.status, 'status', 403)),
      );
      expect(link.status.state, LinkState.pairing);
      final paired = await link.pair('A1B2C3');
      expect(paired.state, LinkState.connected);
      link.dispose();
    });

    test('nobody answers: offline with the usual words, and the retry connects once the TV is back', () async {
      final link = makeLink();
      prepare = (tv) => tv.connectFails = const BrandUnreachable();
      final status = await link.choose(TvKind.samsung, '10.0.0.9', name: 'Bedroom');
      expect(status.state, LinkState.offline);
      expect(status.error, 'Bedroom is not answering. Is it on, and is the phone on the home Wi-Fi?');
      made.single.connectFails = null;
      await until(() => link.isConnected);
      link.dispose();
    });

    test('the TV going to standby: offline, then back by itself', () async {
      final link = makeLink();
      await link.choose(TvKind.samsung, '10.0.0.10');
      await until(() => link.isConnected);
      made.single.drop();
      expect(link.status.state, LinkState.offline);
      await until(() => link.isConnected);
      expect(made.single.connects, 2);
      link.dispose();
    });

    test('kept across starts: the active TV connects at once with its secret, no prompt', () async {
      store = MemoryDirectStore(
        const StoredDirect(
          tv: DirectTv(kind: TvKind.lg, name: 'Den', address: '10.0.0.11'),
          secret: 'client-key',
          active: true,
        ),
      );
      final link = makeLink();
      await link.start();
      await until(() => link.isConnected);
      expect(made.single.secretIn, 'client-key');
      expect(link.status.tv!.name, 'Den');
      link.dispose();
    });

    test('choosing another make or address drops the old secret; release keeps it, forget drops everything', () async {
      final link = makeLink();
      await link.choose(TvKind.samsung, '10.0.0.12');
      await until(() => link.isConnected);
      await link.saved;
      expect(store.value.secret, 'tok-1');
      await link.release();
      await link.saved;
      expect(link.active, isFalse);
      expect(store.value.secret, 'tok-1');
      expect(store.value.active, isFalse);
      expect(made.single.closes, 1);
      await link.choose(TvKind.samsung, '10.0.0.12');
      expect(made.last.secretIn, 'tok-1', reason: 'the same TV again keeps its token');
      await link.choose(TvKind.samsung, '10.0.0.13');
      expect(made.last.secretIn, isNull);
      await link.forget();
      await link.saved;
      expect(store.value.tv, isNull);
      expect(store.value.secret, isNull);
      link.dispose();
    });
  });

  group('commands and state', () {
    test('keys, typing, apps, launch, icons, sleep; unsupported is 501, and the state has the page\'s shape', () async {
      final link = makeLink();
      await link.choose(TvKind.samsung, '10.0.0.20', name: 'Hall');
      await until(() => link.isConnected);
      await link.key('up');
      await link.type('news', submit: true);
      expect(await link.apps(), [
        {'pkg': 'netflix', 'label': 'Netflix'},
        {'pkg': 'youtube', 'label': 'YouTube'},
      ]);
      await link.launch('youtube');
      final (type, bytes) = await link.icon('netflix');
      expect(type, 'image/png');
      expect(bytes, hasLength(4));
      await expectLater(link.icon('youtube'), throwsA(isA<OpError>().having((e) => e.status, 'status', 404)));
      await expectLater(link.key('recents'), throwsA(isA<OpError>().having((e) => e.status, 'status', 501)));
      await link.sleep();
      expect(made.single.keys, ['up', 'sleep']);
      expect(made.single.typed, ['news|true']);
      expect(made.single.launched, ['youtube']);
      final state = await link.fetchState();
      expect(state, containsPair('tv', 'Hall'));
      expect(state, containsPair('app', 'Netflix'));
      expect(state, containsPair('kind', 'samsung'));
      expect(state, containsPair('volumeKnown', false));
      expect(state, containsPair('udp', null));
      await until(() => states.isNotEmpty);
      link.dispose();
    });

    test('a command while the TV is away: 0 with the usual words, and the link goes offline', () async {
      final link = makeLink();
      await link.choose(TvKind.samsung, '10.0.0.21');
      await until(() => link.isConnected);
      made.single.drop();
      await expectLater(link.key('up'), throwsA(isA<OpError>().having((e) => e.status, 'status', 0)));
      link.dispose();
    });

    test('wake sends Wake-on-LAN to the kept MAC; installing an app reaches a TV that takes one', () async {
      final woke = <String>[];
      final link = makeLink(woke: woke);
      await link.choose(TvKind.lg, '10.0.0.22');
      await until(() => link.isConnected);
      expect(await link.wake(), {'sent': true});
      expect(woke, ['aa:bb:cc:dd:ee:ff@10.0.0.22']);
      await link.install(Uint8List.fromList([1, 2, 3]), 'orbit-live.apk');
      expect(made.single.installed, [1, 2, 3]);
      link.dispose();
    });
  });

  group('the search', () {
    test('found TVs reach onFound, and searching repeats while on', () async {
      finder.tvs = const [BrandFound(kind: TvKind.roku, name: 'Roku Ultra', address: '10.0.0.30')];
      final link = makeLink();
      final seen = <List<BrandFound>>[];
      link.onFound = seen.add;
      await link.start();
      link.searching = true;
      await until(() => finder.runs >= 2);
      expect(link.found.single.name, 'Roku Ultra');
      expect(seen, isNotEmpty);
      link.searching = false;
      link.dispose();
    });
  });

  group('TvRemote and the bridge', () {
    test('only TVs of other makes on the Wi-Fi: "found" lists them with their kind; choosing one drives it', () async {
      finder.tvs = const [
        BrandFound(kind: TvKind.samsung, name: 'Samsung Q60', address: '10.0.0.40', port: 8002, model: 'QA43Q60'),
      ];
      final wifi = linkFor(null);
      final direct = makeLink();
      final remote = TvRemote(wifi: wifi, direct: direct)..cloudUnavailable();
      await remote.hello();
      await until(() => remote.status.state == LinkState.found);
      final found = remote.status.toJson()['found']! as List;
      expect(found.single, {
        'name': 'Samsung Q60',
        'address': '10.0.0.40',
        'port': 8002,
        'kind': 'samsung',
        'model': 'QA43Q60',
      });

      final bridge = OrbitBridge(remote: remote, native: FakeNative(), icons: IconCache(directory: () async => null));
      final sent = <Map<String, Object?>>[];
      bridge.attach((script) async => sent.add(messageOf(script)));
      await bridge.handle('{"id":1,"op":"connect","args":{"address":"10.0.0.40","port":8002,"kind":"samsung"}}');
      await until(() => remote.isConnected);
      expect(remote.directActive, isTrue);
      expect(remote.status.tv!.kind, 'samsung');
      expect(remote.status.tv!.name, 'Samsung Q60', reason: 'the name the search found');

      await bridge.handle('{"id":2,"op":"key","args":{"key":"ok"}}');
      await bridge.handle('{"id":3,"op":"help","args":{"on":true}}');
      await bridge.handle('{"id":4,"op":"icon","args":{"pkg":"netflix"}}');
      await bridge.handle('{"id":5,"op":"volumeStep","args":{"dir":"up"}}');
      await bridge.handle('{"id":6,"op":"installLive"}');
      Map<String, Object?> reply(int id) => sent.firstWhere((m) => m['id'] == id);
      expect(reply(2)['ok'], isTrue);
      expect(reply(3)['status'], 501);
      expect((reply(4)['data']! as Map)['src'], startsWith('data:image/png;base64,'));
      expect(made.single.keys, ['ok', 'volup']);
      expect(reply(6)['ok'], isFalse, reason: 'no Orbit Live TV in a test bundle: ${reply(6)}');

      await bridge.handle('{"id":7,"op":"forget"}');
      expect(remote.directActive, isFalse);
      remote.dispose();
    });

    test('pair takes 6 hex characters for an Android TV (any case, spaces let go) and refuses others', () async {
      way = PairingWay.code;
      final wifi = linkFor(null);
      final direct = makeLink();
      final remote = TvRemote(wifi: wifi, direct: direct)..cloudUnavailable();
      final bridge = OrbitBridge(remote: remote, native: FakeNative(), icons: IconCache(directory: () async => null));
      final sent = <Map<String, Object?>>[];
      bridge.attach((script) async => sent.add(messageOf(script)));
      await remote.hello();
      await bridge.handle('{"id":1,"op":"connect","args":{"address":"10.0.0.41","port":6466,"kind":"androidtv"}}');
      await bridge.handle('{"id":2,"op":"askCode"}');
      await bridge.handle('{"id":3,"op":"pair","args":{"code":"12345G"}}');
      await bridge.handle('{"id":4,"op":"pair","args":{"code":"a1b 2c3"}}');
      Map<String, Object?> reply(int id) => sent.firstWhere((m) => m['id'] == id);
      expect(reply(3)['status'], 400);
      expect(reply(4)['ok'], isTrue, reason: '${reply(4)}');
      expect(remote.isConnected, isTrue);
      remote.dispose();
    });

    test('a typed address that is not an Orbit TV is asked which make it is', () async {
      finder.probed = const BrandFound(kind: TvKind.roku, name: 'Roku', address: '127.0.0.1');
      way = PairingWay.none;
      final wifi = linkFor(null);
      final direct = makeLink();
      final remote = TvRemote(wifi: wifi, direct: direct)..cloudUnavailable();
      await remote.hello();
      final status = await remote.connectTyped('127.0.0.1', kDoorPort);
      expect(status.tv!.kind, 'roku');
      await until(() => remote.isConnected);
      remote.dispose();
    });
  });
}
