import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'models.dart';

/// What the phone keeps between runs.
class StoredLink {
  const StoredLink({this.tv, this.token, this.volumeKeys = true});

  final SavedTv? tv;

  /// The TV's pairing token (32 hex characters), never shown to the page.
  final String? token;

  /// The `settings` op's volumeKeys (default true).
  final bool volumeKeys;
}

/// Where [StoredLink] lives.
abstract interface class TvStore {
  Future<StoredLink> load();

  Future<void> saveTv(SavedTv? tv);

  Future<void> saveToken(String? token);

  Future<void> saveVolumeKeys(bool on);
}

/// [TvStore] in flutter_secure_storage: AES-GCM under a key held in the Android Keystore. A store that cannot be read
/// (a restored backup, a Keystore reset) starts empty rather than stopping the app: the phone just pairs again.
class SecureTvStore implements TvStore {
  SecureTvStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const String _kTv = 'orbit.tv';
  static const String _kToken = 'orbit.token';
  static const String _kVolumeKeys = 'orbit.volumeKeys';

  final FlutterSecureStorage _storage;

  @override
  Future<StoredLink> load() async {
    try {
      final tvText = await _storage.read(key: _kTv);
      final token = await _storage.read(key: _kToken);
      final keys = await _storage.read(key: _kVolumeKeys);
      SavedTv? tv;
      if (tvText != null) {
        try {
          tv = SavedTv.fromJson(jsonDecode(tvText));
        } on FormatException {
          tv = null;
        }
      }
      return StoredLink(tv: tv, token: token != null && token.isNotEmpty ? token : null, volumeKeys: keys != 'false');
    } on Object catch (e) {
      debugPrint('orbit: saved TV could not be read, starting fresh: $e');
      return const StoredLink();
    }
  }

  @override
  Future<void> saveTv(SavedTv? tv) => _write(_kTv, tv == null ? null : jsonEncode(tv.toJson()));

  @override
  Future<void> saveToken(String? token) => _write(_kToken, token);

  @override
  Future<void> saveVolumeKeys(bool on) => _write(_kVolumeKeys, on ? 'true' : 'false');

  Future<void> _write(String key, String? value) async {
    try {
      if (value == null) {
        await _storage.delete(key: key);
      } else {
        await _storage.write(key: key, value: value);
      }
    } on Object catch (e) {
      // Not kept: this run still works, the next one pairs again.
      debugPrint('orbit: could not save $key: $e');
    }
  }
}

/// [TvStore] in memory, for tests.
class MemoryTvStore implements TvStore {
  MemoryTvStore({this.tv, this.token, this.volumeKeys = true});

  SavedTv? tv;
  String? token;
  bool volumeKeys;

  @override
  Future<StoredLink> load() async => StoredLink(tv: tv, token: token, volumeKeys: volumeKeys);

  @override
  Future<void> saveTv(SavedTv? tv) async => this.tv = tv;

  @override
  Future<void> saveToken(String? token) async => this.token = token;

  @override
  Future<void> saveVolumeKeys(bool on) async => volumeKeys = on;
}
