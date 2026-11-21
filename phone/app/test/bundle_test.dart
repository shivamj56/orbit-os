// The TV-side bundle the app carries (assets/setup/, phone/SPEC.md "Bundled files") must be the repository's own scripts:
// Orbit 1.5.2 shipped an older orbit-setup.sh by mistake, and its 15-minute trial then could not start on any TV.
// The assets are git-ignored build inputs (tool/sync_setup.sh), so this only checks a checkout that has them.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  for (final name in ['orbit-setup.sh', 'orbit-undo.sh']) {
    final bundled = File('assets/setup/$name');
    test('assets/setup/$name is setup/tv/$name', () {
      final source = File('../../setup/tv/$name');
      expect(source.existsSync(), isTrue, reason: 'setup/tv/$name is part of the repository');
      expect(bundled.readAsStringSync(), source.readAsStringSync(),
          reason: 'run tool/sync_setup.sh (or copy setup/tv/$name) before building the app');
    }, skip: bundled.existsSync() ? false : 'no bundle in this checkout');
  }
}
