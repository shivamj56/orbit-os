// Demo mode on the phone's side (phone/SPEC.md, "Demo mode"): while the page plays with its pretend TV, the bridge
// refuses every op about a TV, the real TV (the mock TV's door on 127.0.0.1) hears nothing at all, the phone's volume
// keys are its own again, and only the phone's own ops (haptics, keep awake, the intro, the demo switch) are answered.
// Leaving the demo brings the real TV back. A start in demo mode does not even read the saved TV.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/app/demo_store.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/remote.dart';
import 'package:orbit/tv/tv_link.dart';
import 'package:orbit/tv/tv_store.dart';

import 'mock_tv.dart';
import 'support.dart';

void main() {
  late MockTv tv;
  late MemoryTvStore store;
  late TvLink link;
  late TvRemote remote;
  late FakeNative native;
  late Directory cache;
  late MemoryDemoStore demoStore;
  late OrbitBridge bridge;
  late List<Map<String, Object?>> sent;
  var intros = 0;

  setUp(() async {
    tv = await MockTv.start();
    store = MemoryTvStore();
    link = linkFor(tv, store: store);
    remote = wifiOnly(link);
    native = FakeNative();
    cache = await Directory.systemTemp.createTemp('orbit-demo-icons');
    native.cache = cache;
    demoStore = MemoryDemoStore();
    sent = [];
    intros = 0;
    bridge = OrbitBridge(remote: remote, native: native, icons: IconCache(directory: native.cacheDirectory), demoStore: demoStore)
      ..attach((script) async => sent.add(messageOf(script)))
      ..onIntro = () => intros++;
  });

  tearDown(() async {
    remote.dispose();
    await tv.close();
    await cache.delete(recursive: true);
  });

  Map<String, Object?> reply(int id) => sent.lastWhere((m) => m['id'] == id);

  Future<void> pair() async {
    await bridge.handle('{"id":1,"op":"hello"}');
    await bridge.handle(jsonEncode({'id': 2, 'op': 'connect', 'args': {'address': '127.0.0.1', 'port': tv.port}}));
    await bridge.handle('{"id":3,"op":"askCode"}');
    await bridge.handle('{"id":4,"op":"pair","args":{"code":"123456"}}');
    expect(reply(4), containsPair('ok', true), reason: '${reply(4)}');
  }

  test('demo mode refuses every TV op, and the real TV hears nothing until it ends', () async {
    await pair();
    await bridge.handle('{"id":5,"op":"key","args":{"key":"up"}}');
    expect(tv.keys, ['up']);
    expect(native.volumeKeys.last, isTrue, reason: 'paired: the phone\'s volume keys turn the TV');

    await bridge.handle('{"id":6,"op":"demo","args":{"on":true}}');
    expect(reply(6)['data'], {'on': true});
    expect(demoStore.on, isTrue, reason: 'kept for the next start');
    expect(native.volumeKeys.last, isFalse, reason: 'the volume keys are the phone\'s own again');
    // A poll on its way when the demo began may still land; after that, nothing.
    await Future<void>.delayed(const Duration(milliseconds: 150));
    final heard = tv.requests.length;

    var id = 10;
    for (final op in [
      '{"op":"key","args":{"key":"down"}}',
      '{"op":"hello"}',
      '{"op":"state"}',
      '{"op":"apps"}',
      '{"op":"discover"}',
      '{"op":"connect","args":{"address":"127.0.0.1"}}',
      '{"op":"volumeStep","args":{"dir":"up"}}',
      '{"op":"help","args":{"on":true}}',
      '{"op":"setupScan"}',
      '{"op":"setupRun","args":{"cmd":"sh /data/local/tmp/orbit/orbit-setup.sh switch stock"}}',
      '{"op":"backupList"}',
      '{"op":"deleteAccount"}',
      '{"op":"signIn"}',
    ]) {
      final n = ++id;
      await bridge.handle('{"id":$n,${op.substring(1)}');
      expect(reply(n), {'id': n, 'ok': false, 'error': 'Orbit is showing its demo. Leave the demo to use your TV.', 'status': 409}, reason: op);
    }

    // The phone's own ops still work.
    await bridge.handle('{"id":40,"op":"haptic","args":{"kind":"success"}}');
    expect(reply(40), containsPair('ok', true));
    expect(native.haptics, contains('success'));
    await bridge.handle('{"id":41,"op":"keepAwake","args":{"on":true}}');
    expect(reply(41), containsPair('ok', true));
    await bridge.handle('{"id":0,"op":"intro","args":{"state":"shown"}}');
    expect(intros, 1);
    // A volume key that slips through never reaches the TV.
    native.volumeKeyHandler!('up');

    await Future<void>.delayed(const Duration(milliseconds: 400));
    expect(tv.requests.length, heard, reason: 'no polls, no search, no keys while the demo plays');
    expect(tv.keys, ['up']);

    await bridge.handle('{"id":50,"op":"demo","args":{"on":false}}');
    expect(reply(50)['data'], {'on': false});
    expect(demoStore.on, isFalse);
    expect(native.volumeKeys.last, isTrue);
    await eventually(() => tv.requests.length > heard, what: 'polls of the real TV again');
    await bridge.handle('{"id":51,"op":"key","args":{"key":"ok"}}');
    expect(reply(51), containsPair('ok', true));
    expect(tv.keys, ['up', 'ok']);
  });

  test('Orbit\'s public pages open in the browser, in demo mode too; nothing else does', () async {
    await bridge.handle('{"id":1,"op":"demo","args":{"on":true}}');
    await bridge.handle('{"id":2,"op":"openUrl","args":{"url":"https://shivamj56.github.io/orbit-os-site/privacy.html"}}');
    expect(reply(2)['data'], {'opened': true});
    await bridge.handle('{"id":3,"op":"openUrl","args":{"url":"https://github.com/shivamj56/orbit-os-site/issues"}}');
    expect(reply(3)['data'], {'opened': true});
    for (final (n, url) in [
      (4, 'http://shivamj56.github.io/orbit-os-site/privacy.html'),
      (5, 'https://shivamj56.github.io/elsewhere/'),
      (6, 'https://github.com/shivamj56/orbit-os/issues'),
      (7, 'https://evil.example/https://shivamj56.github.io/orbit-os-site/'),
      (8, 'intent://open#Intent;end'),
      (9, 'https://shivamj56.github.io:444/orbit-os-site/privacy.html'),
    ]) {
      await bridge.handle(jsonEncode({'id': n, 'op': 'openUrl', 'args': {'url': url}}));
      expect(reply(n), {'id': n, 'ok': false, 'error': 'Orbit only opens its own pages.', 'status': 400}, reason: url);
    }
    expect(native.opened, [
      'https://shivamj56.github.io/orbit-os-site/privacy.html',
      'https://github.com/shivamj56/orbit-os-site/issues',
    ]);
  });

  test('the demo op without "on" says where things stand', () async {
    await bridge.handle('{"id":1,"op":"demo"}');
    expect(reply(1)['data'], {'on': false});
  });

  test('a start in demo mode leaves the saved TV unread until the demo ends', () async {
    await pair();
    final saved = (store.tv, store.token);
    expect(saved.$1, isNotNull);
    remote.dispose();
    await Future<void>.delayed(const Duration(milliseconds: 100));
    tv.requests.clear();

    // The next start of the app: the same saved TV and token, demo mode kept on.
    link = linkFor(tv, store: MemoryTvStore(tv: SavedTv(name: 'Family room', address: '127.0.0.1', port: tv.port), token: saved.$2));
    remote = wifiOnly(link)..setDemo(true);
    // OrbitApp starts the link only out of demo mode.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    expect(tv.requests, isEmpty, reason: 'nothing reaches a real TV while the demo plays');

    remote.setDemo(false);
    await eventually(() => link.isConnected, what: 'the saved TV checked and connected');
    expect(tv.requests.first.path, '/api/state');
  });
}
