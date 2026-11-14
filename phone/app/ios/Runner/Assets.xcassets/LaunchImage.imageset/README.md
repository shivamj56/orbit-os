# Launch Screen Assets

The Orbit mark on the night background (#05070D), 288 pt square in the middle of the screen: painted from
`lib/app/splash_mark.dart` (SplashMarkPainter) at 1x, 2x and 3x, the same mark Flutter paints over the page until the
page's opening intro starts, so the launch screen, Flutter and the page hand over without a seam (phone/SPEC.md,
"The opening intro"). Repaint them when the painter changes.
