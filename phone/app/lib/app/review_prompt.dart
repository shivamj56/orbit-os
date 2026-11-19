import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:in_app_review/in_app_review.dart';
import 'package:path_provider/path_provider.dart';

/// Google Play's own review sheet (phone/SPEC.md, "Asking for a review"), asked for at most once in the app's life,
/// right after a trial of Orbit on a TV ends.
///
/// Google decides whether the sheet shows at all: it keeps a quota per person, and shows nothing for an install that
/// did not come from Play. The person can close it, and the app is never told whether they rated. So nothing asks a
/// question before it, nothing waits on its answer, and nothing asks again (Play's rules for in-app reviews).
abstract interface class ReviewPrompt {
  /// Asks Google for the sheet, unless it was asked for before. True when it was asked for now.
  Future<bool> ask();
}

/// The two calls of Google's In-App Review API that Orbit makes (the in_app_review plugin), apart for tests.
abstract interface class PlayReview {
  /// Google Play is on the phone and can show the sheet.
  Future<bool> isAvailable();

  /// Google shows the sheet over the app, or nothing; it returns either way.
  Future<void> requestReview();
}

/// [PlayReview] through the in_app_review plugin.
class PluginPlayReview implements PlayReview {
  const PluginPlayReview();

  @override
  Future<bool> isAvailable() => InAppReview.instance.isAvailable();

  @override
  Future<void> requestReview() => InAppReview.instance.requestReview();
}

/// [ReviewPrompt] that keeps the one ask as a small file in app storage, there once it has asked.
class OnceReviewPrompt implements ReviewPrompt {
  OnceReviewPrompt({this.play = const PluginPlayReview(), Future<Directory> Function()? storage})
    : _storage = storage ?? getApplicationSupportDirectory;

  /// Google's side of it.
  final PlayReview play;
  final Future<Directory> Function() _storage;
  bool _asking = false;

  Future<File> _file() async => File('${(await _storage()).path}/orbit-review-asked');

  @override
  Future<bool> ask() async {
    if (_asking) return false;
    _asking = true;
    try {
      final file = await _file();
      if (file.existsSync()) return false;
      // Without Google Play there is no sheet to show: the one ask is kept for a phone that has it.
      if (!await play.isAvailable()) return false;
      // Kept before the sheet shows: an app closed while it is up has still had its one ask.
      await file.writeAsString('${DateTime.now().toUtc().toIso8601String()}\n', flush: true);
      await play.requestReview();
      return true;
    } on Object catch (e) {
      debugPrint('orbit: review not asked: $e');
      return false;
    } finally {
      _asking = false;
    }
  }
}
