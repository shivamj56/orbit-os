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

  /// "android" or "ios".
  String get platform;

  /// The phone's own volume keys can turn the TV up and down (Android); iOS lets no app take them.
  bool get hasVolumeKeys;

  /// The ways this phone signs in, in the order the page shows them: Google; on an iPhone Apple first, then Google.
  List<String> get signInWays;

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

/// [NativeHost] on the phone: MainActivity.kt answers `dev.shiv.orbit/native` on Android, NativeChannel.swift on an
/// iPhone, where Back and the volume keys do not exist for an app.
class PlatformNativeHost implements NativeHost {
  PlatformNativeHost() {
    _channel.setMethodCallHandler(_onCall);
  }

  static final bool _ios = Platform.isIOS;

  @override
  String get platform => _ios ? 'ios' : 'android';

  @override
  bool get hasVolumeKeys => !_ios;

  @override
  List<String> get signInWays => _ios ? const ['apple', 'google'] : const ['google'];

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
    if (!hasVolumeKeys || _volumeKeysSent == on) return;
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

  /// An iPhone has no Back with nowhere to go, and an iOS app never closes itself: nothing happens there.
  @override
  Future<void> moveToBack() async {
    if (_ios) return;
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
