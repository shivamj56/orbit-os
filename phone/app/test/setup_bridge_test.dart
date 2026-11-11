// The setup ops through OrbitBridge: the reply shapes, the setupAuth and setupLine events, the error `reason`, and
// setupAdopt against the mock TV's door. The ADB layer is faked ([FakeSetupHost]); the real protocol is covered in
// setup_adb_test.dart.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/setup/setup_host.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/tv_link.dart';
import 'package:orbit/tv/tv_store.dart';

import 'mock_tv.dart';
import 'support.dart';

/// A stand-in [SetupHost]: it records calls, returns canned data, can fire the events, and can fail with a reason.
class FakeSetupHost implements SetupHost {
  void Function()? _onAuthWaiting;
  void Function(String line)? _onLine;

  final List<String> calls = [];
  Duration? scannedWindow;
  Map<String, Object?>? savedRecord;
  String? savedKey;

  /// Set to make the next [connect] fail with this reason.
  String? connectReason;

  @override
  set onAuthWaiting(void Function()? handler) => _onAuthWaiting = handler;

  @override
  set onLine(void Function(String line)? handler) => _onLine = handler;

  void fireWaiting() => _onAuthWaiting?.call();

  void fireLine(String line) => _onLine?.call(line);

  @override
  Future<Map<String, Object?>> scan(Duration window) async {
    calls.add('scan');
    scannedWindow = window;
    return {
      'tvs': [
        {'name': 'Family room', 'address': '192.168.1.7', 'model': 'MiTV-AXFU0', 'orbit': true},
      ],
    };
  }

  @override
  Future<Map<String, Object?>> probe(String address, int port) async {
    calls.add('probe $address:$port');
    return {'open': true};
  }

  @override
  Future<Map<String, Object?>> connect(String address, int port) async {
    calls.add('connect $address:$port');
    final reason = connectReason;
    if (reason != null) throw SetupError(reason, 'connect failed: $reason');
    return {
      'model': 'MiTV-AXFU0',
      'manufacturer': 'Xiaomi',
      'brand': 'Xiaomi',
      'device': 'arctictale',
      'sdk': 34,
      'release': '14',
    };
  }

  @override
  Future<Map<String, Object?>> shell(String cmd, Duration timeout) async {
    calls.add('shell $cmd ${timeout.inMilliseconds}');
    return {'out': 'package:com.gathin.tvhome\n'};
  }

  @override
  Future<Map<String, Object?>> pushAsset(String asset, String to) async {
    calls.add('pushAsset $asset -> $to');
    return {'bytes': 3506975};
  }

  @override
  Future<Map<String, Object?>> pushText(String text, String to) async {
    calls.add('pushText ${text.length} -> $to');
    return {'bytes': text.length};
  }

  /// What [run] says, line by line, and its exit code.
  List<String> runLines = const ['@orbit step check start', '@orbit done ok'];
  int runExit = 0;

  @override
  Future<Map<String, Object?>> run(String cmd) async {
    calls.add('run $cmd');
    runLines.forEach(fireLine);
    return {'exit': runExit};
  }

  @override
  Future<Map<String, Object?>> close() async {
    calls.add('close');
    return const <String, Object?>{};
  }

  @override
  Future<Map<String, Object?>> recordLoad(String key) async {
    calls.add('recordLoad $key');
    return {'record': savedKey == key ? savedRecord : null};
  }

  @override
  Future<Map<String, Object?>> recordSave(String key, Map<String, Object?> record) async {
    calls.add('recordSave $key');
    savedKey = key;
    savedRecord = record;
    return {'record': record};
  }
}

void main() {
  late FakeSetupHost setup;
  late FakeNative native;
  late List<Map<String, Object?>> sent;

  setUp(() {
    setup = FakeSetupHost();
    native = FakeNative();
    sent = [];
  });

  OrbitBridge bridgeWith(TvLink link, {MemoryTvStore? store}) => OrbitBridge(
    remote: wifiOnly(link),
    native: native,
    icons: IconCache(directory: native.cacheDirectory),
    setup: setup,
  )..attach((script) async => sent.add(messageOf(script)));

  List<Map<String, Object?>> replies() => [
    for (final m in sent)
      if (m.containsKey('id')) m,
  ];
  List<Map<String, Object?>> events([String? name]) => [
    for (final m in sent)
      if (m.containsKey('event') && (name == null || m['event'] == name)) m,
  ];

  group('reply shapes', () {
    test('scan, probe, connect, shell, push, run, close, record', () async {
      final bridge = bridgeWith(linkFor(null));

      await bridge.handle('{"id":1,"op":"setupScan","args":{"seconds":6}}');
      expect(setup.scannedWindow, const Duration(seconds: 6));
      expect((replies().last['data'] as Map)['tvs'], isA<List<Object?>>());

      await bridge.handle('{"id":2,"op":"setupProbe","args":{"address":"192.168.1.7","port":5555}}');
      expect(replies().last['data'], {'open': true});

      await bridge.handle('{"id":3,"op":"setupConnect","args":{"address":"192.168.1.7"}}');
      expect(setup.calls, contains('connect 192.168.1.7:5555'), reason: 'port defaults to 5555');
      expect((replies().last['data'] as Map)['sdk'], 34);

      await bridge.handle('{"id":4,"op":"setupShell","args":{"cmd":"pm list packages"}}');
      expect(setup.calls, contains('shell pm list packages 20000'), reason: 'timeout defaults to 20000');
      expect((replies().last['data'] as Map)['out'], contains('tvhome'));

      await bridge.handle(
        '{"id":5,"op":"setupPush","args":{"asset":"orbit-home.apk","to":"/data/local/tmp/orbit/orbit-home.apk"}}',
      );
      expect(replies().last['data'], {'bytes': 3506975});

      await bridge.handle('{"id":6,"op":"setupPush","args":{"text":"home=1\\n","to":"/data/local/tmp/orbit/plan.txt"}}');
      expect((replies().last['data'] as Map)['bytes'], 'home=1\n'.length);

      await bridge.handle('{"id":7,"op":"setupRun","args":{"cmd":"sh /data/local/tmp/orbit/orbit-setup.sh install"}}');
      expect(replies().last['data'], {'exit': 0});

      await bridge.handle('{"id":8,"op":"setupClose"}');
      expect(replies().last, {'id': 8, 'ok': true, 'data': <String, Object?>{}});

      await bridge.handle('{"id":9,"op":"setupRecord","args":{"key":"192.168.1.7","record":{"home":1}}}');
      expect(replies().last['data'], {
        'record': {'home': 1},
      });
      await bridge.handle('{"id":10,"op":"setupRecord","args":{"key":"192.168.1.7"}}');
      expect(replies().last['data'], {
        'record': {'home': 1},
      });
      await bridge.handle('{"id":11,"op":"setupRecord","args":{"key":"10.0.0.1"}}');
      expect(replies().last['data'], {'record': null});
    });
  });

  group('switching the home screen', () {
    test('the script goes first, then the run\'s lines reach the page in order, then its exit', () async {
      final bridge = bridgeWith(linkFor(null));
      await bridge.handle('{"id":1,"op":"hello"}');
      setup.runLines = const [
        '@orbit step switch start',
        'on com.google.android.apps.tv.launcherx',
        '@orbit step switch ok',
        '@orbit done ok',
      ];
      await bridge.handle(
        '{"id":2,"op":"setupPush","args":{"asset":"orbit-setup.sh","to":"/data/local/tmp/orbit/orbit-setup.sh"}}',
      );
      await bridge.handle('{"id":3,"op":"setupRun","args":{"cmd":"sh /data/local/tmp/orbit/orbit-setup.sh switch stock"}}');
      expect(setup.calls.where((c) => c.startsWith('pushAsset') || c.startsWith('run')), [
        'pushAsset orbit-setup.sh -> /data/local/tmp/orbit/orbit-setup.sh',
        'run sh /data/local/tmp/orbit/orbit-setup.sh switch stock',
      ]);
      expect(events('setupLine').map((e) => (e['data'] as Map)['line']), setup.runLines);
      final lineAt = sent.indexWhere((m) => m['event'] == 'setupLine');
      final replyAt = sent.indexWhere((m) => m['id'] == 3);
      expect(lineAt, lessThan(replyAt), reason: 'every line before the answer');
      expect(replies().last, {'id': 3, 'ok': true, 'data': {'exit': 0}});
    });

    test('a switch that failed answers with its exit code; the page reads why from the lines', () async {
      final bridge = bridgeWith(linkFor(null));
      await bridge.handle('{"id":1,"op":"hello"}');
      setup
        ..runLines = const [
          '@orbit step switch start',
          '@orbit step switch fail There is no record of the TV\'s own home screen',
          '@orbit done fail There is no record of the TV\'s own home screen, so Orbit Home stays Home',
        ]
        ..runExit = 1;
      await bridge.handle('{"id":2,"op":"setupRun","args":{"cmd":"sh /data/local/tmp/orbit/orbit-setup.sh switch stock"}}');
      expect(events('setupLine').last['data'], {
        'line': '@orbit done fail There is no record of the TV\'s own home screen, so Orbit Home stays Home',
      });
      expect(replies().last, {'id': 2, 'ok': true, 'data': {'exit': 1}});
    });
  });

  group('events and errors', () {
    test('setupConnect emits setupAuth {state: waiting} while waiting for Allow', () async {
      final bridge = bridgeWith(linkFor(null));
      await bridge.handle('{"id":1,"op":"hello"}');
      sent.clear();
      // The real host fires this mid-connect; the fake lets the test fire it.
      setup.fireWaiting();
      expect(events('setupAuth').single['data'], {'state': 'waiting'});
    });

    test('setupRun streams each line as a setupLine event', () async {
      final bridge = bridgeWith(linkFor(null));
      await bridge.handle('{"id":1,"op":"hello"}');
      sent.clear();
      await bridge.handle('{"id":2,"op":"setupRun","args":{"cmd":"sh x"}}');
      expect(events('setupLine').map((e) => (e['data'] as Map)['line']), [
        '@orbit step check start',
        '@orbit done ok',
      ]);
    });

    test('a setup failure is ok:false with a reason, not a status', () async {
      final bridge = bridgeWith(linkFor(null));
      setup.connectReason = 'timeout';
      await bridge.handle('{"id":3,"op":"setupConnect","args":{"address":"192.168.1.7"}}');
      expect(replies().last, {
        'id': 3,
        'ok': false,
        'reason': 'timeout',
        'error': 'connect failed: timeout',
      });
    });

    test('bad setup args are the usual 400s', () async {
      final bridge = bridgeWith(linkFor(null));
      await bridge.handle('{"id":1,"op":"setupPush","args":{"to":"/tmp/x"}}');
      expect(replies().last['status'], 400, reason: 'neither asset nor text');
      await bridge.handle('{"id":2,"op":"setupPush","args":{"asset":"x","to":"relative"}}');
      expect(replies().last['status'], 400, reason: 'the destination must be an absolute path');
      await bridge.handle('{"id":3,"op":"setupAdopt","args":{"address":"192.168.1.7","token":"nothex"}}');
      expect(replies().last['status'], 400, reason: 'the token must be 32 hex');
    });
  });

  group('setupAdopt against the mock TV door', () {
    late MockTv tv;
    late MemoryTvStore store;
    late TvLink link;

    setUp(() async {
      tv = await MockTv.start();
      store = MemoryTvStore();
      link = linkFor(tv, store: store);
    });

    tearDown(() async {
      link.dispose();
      await tv.close();
    });

    test('saves the TV and token and goes connected once the door answers', () async {
      final bridge = bridgeWith(link, store: store);
      // A token the mock TV will accept (its door checks x-portal-token against its set).
      const token = 'abcdef0123456789abcdef0123456789';
      tv.tokens.add(token);
      await bridge.handle('{"id":1,"op":"hello"}');
      sent.clear();

      await bridge.handle(
        jsonEncode({
          'id': 2,
          'op': 'setupAdopt',
          'args': {'address': '127.0.0.1', 'port': tv.port, 'token': token, 'name': 'Family room'},
        }),
      );
      final data = replies().last['data'] as Map;
      expect(data['state'], 'connected');
      expect((data['tv'] as Map)['name'], 'Family room');
      await link.saved;
      expect(store.token, token);
      expect(store.tv?.address, '127.0.0.1');
      expect(tv.to('/api/state'), isNotEmpty, reason: 'it checked the door with the token');
    });

    test('a door that rejects the token ends in needsPairing', () async {
      final bridge = bridgeWith(link, store: store);
      await bridge.handle('{"id":1,"op":"hello"}');
      sent.clear();
      // The mock TV does not know this token, so GET /api/state is a 401 from the door.
      await bridge.handle(
        jsonEncode({
          'id': 2,
          'op': 'setupAdopt',
          'args': {'address': '127.0.0.1', 'port': tv.port, 'token': 'ffffffffffffffffffffffffffffffff', 'name': 'TV'},
        }),
      );
      expect((replies().last['data'] as Map)['state'], 'needsPairing');
    });
  });

  test('parseGetprop reads the model, ids, sdk and release', () {
    final props = parseGetprop('''
[ro.product.model]: [MiTV-AXFU0]
[ro.product.manufacturer]: [Xiaomi]
[ro.product.brand]: [Xiaomi]
[ro.product.device]: [arctictale]
[ro.build.version.sdk]: [34]
[ro.build.version.release]: [14]
[something.else]: [ignored]
''');
    expect(props, {
      'model': 'MiTV-AXFU0',
      'manufacturer': 'Xiaomi',
      'brand': 'Xiaomi',
      'device': 'arctictale',
      'sdk': 34,
      'release': '14',
    });
  });
}
