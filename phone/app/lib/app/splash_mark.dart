import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// The Orbit mark as the Android 12+ system splash shows it (android/app/src/main/res/drawable/splash_mark.xml: 288 dp,
/// in the middle of the screen) and as the page's opening intro starts (phone/ui/src/intro/Intro.tsx, MARK): a dark glass
/// planet with an ice rim, its ring in sky, ice and lilac (the far half behind the planet, the near half in front), and
/// a satellite on the near half. Flutter paints it from its first frame until the page's intro shows the same frame,
/// so the system splash, Flutter and the page hand over without a seam.
class SplashMarkPainter extends CustomPainter {
  const SplashMarkPainter();

  static const Color night = Color(0xFF05070D);

  /// The mark's measures in dp, from the middle of the screen.
  static const double planet = 29.33;
  static const double ringA = 72;
  static const double ringB = 28;
  static const double stroke = 4;
  static const double roll = -24 * math.pi / 180;
  static const double satellite = -34.9 * math.pi / 180;

  static const List<Color> ringColors = [Color(0xFF74D1FF), Color(0xFFADC6FF), Color(0xFFE9B3FF)];

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = night);
    final c = size.center(Offset.zero);
    final ring = Rect.fromCenter(center: Offset.zero, width: ringA * 2, height: ringB * 2);
    Paint ringPaint(double width, double opacity) => Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = width
      ..strokeCap = StrokeCap.round
      ..shader = LinearGradient(
        colors: [for (final k in ringColors) k.withValues(alpha: opacity)],
        stops: const [0, 0.5, 1],
      ).createShader(Rect.fromLTWH(-ringA, -ringB, ringA * 2, ringB * 2));

    // The far half of the ring, behind the planet.
    canvas
      ..save()
      ..translate(c.dx, c.dy)
      ..rotate(roll)
      ..drawArc(ring, math.pi, math.pi, false, ringPaint(stroke * 0.8, 0.45))
      ..restore();

    // The planet: lit from the upper left, with a thin ice rim.
    final planetRect = Rect.fromCircle(center: c, radius: planet);
    canvas.drawCircle(
      c,
      planet,
      Paint()
        ..shader = RadialGradient(
          center: const Alignment(-0.24, -0.36),
          // 1.6 planet radii, as a share of the box (two radii).
          radius: 0.8,
          colors: const [Color(0xFF1D2A56), Color(0xFF0A0F22)],
        ).createShader(planetRect),
    );
    canvas.drawCircle(
      c,
      planet - 0.75,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 1.5
        ..color = const Color(0xFFADC6FF).withValues(alpha: 0.55),
    );

    // The near half, in front, and the satellite on it.
    canvas
      ..save()
      ..translate(c.dx, c.dy)
      ..rotate(roll)
      ..drawArc(ring, 0, math.pi, false, ringPaint(stroke * 1.22, 1));
    final sat = Offset(ringA * math.cos(satellite), -ringB * math.sin(satellite));
    canvas
      ..drawCircle(
        sat,
        9,
        Paint()
          ..shader = RadialGradient(
            colors: [const Color(0xFFFFFFFF), const Color(0xFF74D1FF).withValues(alpha: 0.8), const Color(0x0074D1FF)],
            stops: const [0, 0.4, 1],
          ).createShader(Rect.fromCircle(center: sat, radius: 9)),
      )
      ..drawCircle(sat, 3, Paint()..color = const Color(0xFFFFFFFF))
      ..restore();
  }

  @override
  bool shouldRepaint(SplashMarkPainter oldDelegate) => false;
}
