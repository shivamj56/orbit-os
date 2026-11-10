import 'package:flutter/services.dart';

/// The few colours Flutter itself draws: behind the page before it paints, and the system bars.
abstract final class OrbitColors {
  /// Same as the launch window (android/app/src/main/res/values/colors.xml), so nothing flashes white.
  static const Color background = Color(0xFF05060A);

  static const Color transparent = Color(0x00000000);

  /// Transparent bars with light icons, drawn over the page (edge to edge).
  static const SystemUiOverlayStyle systemBars = SystemUiOverlayStyle(
    statusBarColor: transparent,
    statusBarBrightness: Brightness.dark,
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: transparent,
    systemNavigationBarDividerColor: transparent,
    systemNavigationBarIconBrightness: Brightness.light,
    systemNavigationBarContrastEnforced: false,
    systemStatusBarContrastEnforced: false,
  );
}
