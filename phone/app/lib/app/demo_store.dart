import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

/// Where demo mode is kept between starts of the app (phone/SPEC.md, "Demo mode"), so a start in demo mode leaves the
/// real TV alone from the first moment, before the page has said anything.
abstract interface class DemoStore {
  Future<bool> load();

  Future<void> save(bool on);
}

/// [DemoStore] as one small file in app storage: there while demo mode is on.
class FileDemoStore implements DemoStore {
  FileDemoStore({Future<Directory> Function()? storage}) : _storage = storage ?? getApplicationSupportDirectory;

  final Future<Directory> Function() _storage;

  Future<File> _file() async => File('${(await _storage()).path}/orbit-demo');

  @override
  Future<bool> load() async {
    try {
      final file = await _file();
      return file.existsSync() && (await file.readAsString()).trim() == 'on';
    } on Object catch (e) {
      debugPrint('orbit: demo mode unreadable: $e');
      return false;
    }
  }

  @override
  Future<void> save(bool on) async {
    try {
      final file = await _file();
      if (on) {
        await file.writeAsString('on', flush: true);
      } else if (file.existsSync()) {
        await file.delete();
      }
    } on Object catch (e) {
      debugPrint('orbit: demo mode not kept: $e');
    }
  }
}

/// [DemoStore] in memory, for tests.
class MemoryDemoStore implements DemoStore {
  MemoryDemoStore([this.on = false]);

  bool on;

  @override
  Future<bool> load() async => on;

  @override
  Future<void> save(bool value) async => on = value;
}
