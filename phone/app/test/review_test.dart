// Google Play's review sheet after a trial (phone/SPEC.md, "Asking for a review"): asked for at most once in the app's
// life, only with Google Play on the phone, never in demo mode, and never with a question of the app's own first.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/app/demo_store.dart';
import 'package:orbit/app/review_prompt.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/tv_store.dart';

import 'mock_tv.dart';
import 'support.dart';

/// Google's side, as the plugin would answer.
class FakePlayReview implements PlayReview {
  bool available = true;
  bool fails = false;
  int shown = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<void> requestReview() async {
    shown++;
    if (fails) throw StateError('Play could not show the sheet');
  }
}

/// [ReviewPrompt] that only counts.
class CountingReview implements ReviewPrompt {
  int asked = 0;

  @override
  Future<bool> ask() async {
    asked++;
    return true;
  }
}

void main() {
  late Directory storage;
  late FakePlayReview play;

  setUp(() async {
    storage = await Directory.systemTemp.createTemp('orbit-review');
    play = FakePlayReview();
  });

  tearDown(() => storage.delete(recursive: true));

  OnceReviewPrompt prompt() => OnceReviewPrompt(play: play, storage: () async => storage);

  test('asks once, and never again, even after the app starts over', () async {
    final first = prompt();
    expect(await first.ask(), isTrue);
    expect(play.shown, 1);
    expect(await first.ask(), isFalse);
    expect(await prompt().ask(), isFalse, reason: 'a new start of the app remembers the ask');
    expect(play.shown, 1);
  });

  test('asks once when two asks come together', () async {
    final p = prompt();
    final asked = await Future.wait([p.ask(), p.ask()]);
    expect(asked.where((a) => a), hasLength(1));
    expect(play.shown, 1);
  });

  test('without Google Play nothing is shown, and the one ask is kept for later', () async {
    play.available = false;
    expect(await prompt().ask(), isFalse);
    expect(play.shown, 0);
    play.available = true;
    expect(await prompt().ask(), isTrue);
    expect(play.shown, 1);
  });

  test('a sheet Google could not show still counts as the one ask', () async {
    play.fails = true;
    expect(await prompt().ask(), isFalse);
    play.fails = false;
    expect(await prompt().ask(), isFalse);
    expect(play.shown, 1);
  });

  group('the askReview op', () {
    late MockTv tv;
    late FakeNative native;
    late Directory cache;
    late List<Map<String, Object?>> sent;

    setUp(() async {
      tv = await MockTv.start();
      native = FakeNative();
      cache = await Directory.systemTemp.createTemp('orbit-review-icons');
      native.cache = cache;
      sent = [];
    });

    tearDown(() async {
      await tv.close();
      await cache.delete(recursive: true);
    });

    OrbitBridge bridgeWith(ReviewPrompt? review, {MemoryDemoStore? demoStore}) {
      final link = linkFor(tv, store: MemoryTvStore());
      addTearDown(link.dispose);
      return OrbitBridge(
        remote: wifiOnly(link),
        native: native,
        icons: IconCache(directory: native.cacheDirectory),
        demoStore: demoStore,
        review: review,
      )..attach((script) async => sent.add(messageOf(script)));
    }

    Map<String, Object?> reply(int id) => sent.lastWhere((m) => m['id'] == id);

    test('asks for the sheet and says whether it did', () async {
      final bridge = bridgeWith(OnceReviewPrompt(play: play, storage: () async => storage));
      await bridge.handle('{"id":7,"op":"askReview"}');
      expect(reply(7), {'id': 7, 'ok': true, 'data': {'asked': true}});
      await bridge.handle('{"id":8,"op":"askReview"}');
      expect(reply(8), {'id': 8, 'ok': true, 'data': {'asked': false}});
      expect(play.shown, 1);
    });

    test('is refused in demo mode: a pretend trial asks nothing of Google', () async {
      final review = CountingReview();
      final bridge = bridgeWith(review, demoStore: MemoryDemoStore());
      await bridge.handle(jsonEncode({'id': 1, 'op': 'demo', 'args': {'on': true}}));
      await bridge.handle('{"id":2,"op":"askReview"}');
      expect(reply(2)['ok'], isFalse);
      expect(reply(2)['status'], 409);
      expect(review.asked, 0);
    });

    test('answers asked false in a build without it', () async {
      final bridge = bridgeWith(null);
      await bridge.handle('{"id":3,"op":"askReview"}');
      expect(reply(3), {'id': 3, 'ok': true, 'data': {'asked': false}});
    });
  });
}
