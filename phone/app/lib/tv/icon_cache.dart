import 'dart:collection';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// An app's picture from the TV, ready for an `<img src>`.
class CachedIcon {
  const CachedIcon(this.src, {this.stale = false});

  /// `data:image/png;base64,...`
  final String src;

  /// Older than [IconCache.maxAge]: fetch again when the TV answers, use this when it does not.
  final bool stale;
}

/// The `icon` op's cache: in memory (the newest [memoryEntries]) and on disk in the app's cache directory, where
/// Android may clear it whenever it needs the room.
class IconCache {
  IconCache({required this._directory, this.memoryEntries = 80, this.maxAge = const Duration(days: 7)});

  final Future<Directory?> Function() _directory;
  final int memoryEntries;
  final Duration maxAge;
  final LinkedHashMap<String, String> _memory = LinkedHashMap();
  Future<Directory?>? _dir;

  static const Map<String, String> _extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };

  /// Android package names: letters, digits, underscores and dots. Anything else is never a file name here.
  static final RegExp packageName = RegExp(r'^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$');

  static String dataUri(String mime, List<int> bytes) => 'data:$mime;base64,${base64Encode(bytes)}';

  String? fromMemory(String pkg) {
    final src = _memory.remove(pkg);
    if (src != null) _memory[pkg] = src;
    return src;
  }

  Future<CachedIcon?> fromDisk(String pkg) async {
    if (!packageName.hasMatch(pkg)) return null;
    final dir = await _folder();
    if (dir == null) return null;
    for (final entry in _extensions.entries) {
      final file = File('${dir.path}/$pkg.${entry.value}');
      try {
        if (!file.existsSync()) continue;
        final bytes = await file.readAsBytes();
        if (bytes.isEmpty) continue;
        final src = dataUri(entry.key, bytes);
        _remember(pkg, src);
        final age = DateTime.now().difference(file.lastModifiedSync());
        return CachedIcon(src, stale: age > maxAge);
      } on FileSystemException {
        continue;
      }
    }
    return null;
  }

  /// Keeps the picture; returns its data URI.
  Future<String> store(String pkg, String mime, Uint8List bytes) async {
    final src = dataUri(mime, bytes);
    _remember(pkg, src);
    final ext = _extensions[mime];
    if (ext == null || !packageName.hasMatch(pkg)) return src;
    final dir = await _folder();
    if (dir == null) return src;
    try {
      for (final other in _extensions.values) {
        if (other == ext) continue;
        final old = File('${dir.path}/$pkg.$other');
        if (old.existsSync()) old.deleteSync();
      }
      final file = File('${dir.path}/$pkg.$ext');
      final temp = File('${file.path}.part');
      await temp.writeAsBytes(bytes, flush: true);
      await temp.rename(file.path);
    } on FileSystemException catch (e) {
      debugPrint('orbit: icon not kept on disk: $e');
    }
    return src;
  }

  static bool isSupported(String mime) => _extensions.containsKey(mime);

  void _remember(String pkg, String src) {
    _memory.remove(pkg);
    _memory[pkg] = src;
    while (_memory.length > memoryEntries) {
      _memory.remove(_memory.keys.first);
    }
  }

  Future<Directory?> _folder() => _dir ??= () async {
    try {
      final base = await _directory();
      if (base == null) return null;
      final dir = Directory('${base.path}/orbit-icons');
      if (!dir.existsSync()) dir.createSync(recursive: true);
      return dir;
    } on Object catch (e) {
      debugPrint('orbit: no icon folder: $e');
      return null;
    }
  }();
}
