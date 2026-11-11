import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

/// What only the phone itself can do for the page: haptics, the hardware volume keys, keeping the screen on,
/// leaving to the background on Back.
abstract interface class NativeHost {
  /// The `haptic` op's kinds.
  static const Set<String> hapticKinds = {'tick', 'light', 'medium', 'heavy', 'success', 'error'};

  /// Called with "up" or "down" for each press (and auto-repeat) of a volume key while [setVolumeKeys] is on.
  set onVolumeKey(void Function(String dir)? handler);

  /// On: the phone's volume keys are taken (both down and up are consumed) and reported; off: they set the phone's own
  /// volume as usual.
  Future<void> setVolumeKeys(bool on);

  Future<void> setKeepAwake(bool on);

  Future<void> haptic(String kind);

  /// Back with nowhere to go back to: the app goes behind, like Home, so opening it again is instant.
  Future<void> moveToBack();

  /// The app's cache directory (icons), or null.
  Future<Directory?> cacheDirectory();

  /// Opens [url] in the phone's browser (Orbit's public pages); false when nothing could open it.
  Future<bool> openUrl(String url);
}

/// [NativeHost] on Android: MainActivity.kt answers `dev.shiv.orbit/native`.
class PlatformNativeHost implements NativeHost {
  PlatformNativeHost() {
    _channel.setMethodCallHandler(_onCall);
  }

  static const MethodChannel _channel = MethodChannel('dev.shiv.orbit/native');

  void Function(String dir)? _onVolumeKey;
  bool? _volumeKeysSent;
  bool? _awakeSent;

  @override
  set onVolumeKey(void Function(String dir)? handler) => _onVolumeKey = handler;

  Future<Object?> _onCall(MethodCall call) async {
    if (call.method == 'volumeKey') {
      final args = call.arguments;
      final dir = args is Map ? args['dir'] : null;
      if (dir == 'up' || dir == 'down') _onVolumeKey?.call(dir as String);
    }
    return null;
  }

  @override
  Future<void> setVolumeKeys(bool on) async {
    if (_volumeKeysSent == on) return;
    _volumeKeysSent = on;
    try {
      await _channel.invokeMethod<void>('setVolumeKeys', on);
    } on Object catch (e) {
      _volumeKeysSent = null;
      debugPrint('orbit: volume keys not switched: $e');
    }
  }

  @override
  Future<void> setKeepAwake(bool on) async {
    if (_awakeSent == on) return;
    _awakeSent = on;
    try {
      await WakelockPlus.toggle(enable: on);
    } on Object catch (e) {
      _awakeSent = null;
      debugPrint('orbit: keep-awake not switched: $e');
    }
  }

  @override
  Future<void> haptic(String kind) async {
    try {
      switch (kind) {
        case 'tick':
          await HapticFeedback.selectionClick();
        case 'light':
          await HapticFeedback.lightImpact();
        case 'medium' || 'success':
          await HapticFeedback.mediumImpact();
        case 'heavy':
          await HapticFeedback.heavyImpact();
        case 'error':
          await HapticFeedback.heavyImpact();
          await Future<void>.delayed(const Duration(milliseconds: 110));
          await HapticFeedback.heavyImpact();
      }
    } on Object catch (e) {
      debugPrint('orbit: haptic $kind: $e');
    }
  }

  @override
  Future<void> moveToBack() async {
    try {
      await _channel.invokeMethod<void>('moveTaskToBack');
    } on Object {
      await SystemNavigator.pop();
    }
  }

  @override
  Future<Directory?> cacheDirectory() async {
    try {
      final path = await _channel.invokeMethod<String>('cacheDir');
      return path == null ? null : Directory(path);
    } on Object catch (e) {
      debugPrint('orbit: no cache directory: $e');
      return null;
    }
  }

  @override
  Future<bool> openUrl(String url) async {
    try {
      return await _channel.invokeMethod<bool>('openUrl', url) ?? false;
    } on Object catch (e) {
      debugPrint('orbit: link not opened: $e');
      return false;
    }
  }
}
