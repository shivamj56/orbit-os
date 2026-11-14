import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../bridge/orbit_bridge.dart';
import '../native/native_host.dart';
import 'splash_mark.dart';
import 'theme.dart';

/// The page in the Flutter assets (phone/ui/dist/index.html, copied by tool/sync_ui.sh).
const String kUiAsset = 'assets/ui/index.html';

/// Where Orbit's page is on Android.
const String _androidPagePrefix = 'file:///android_asset/flutter_assets/assets/ui/';

/// Whether [url] is Orbit's own page (or same-document, data: or blob: content). On Android the page is at
/// [_androidPagePrefix]; on an iPhone it is a file inside the app itself,
/// `file:///…/Runner.app/Frameworks/App.framework/flutter_assets/assets/ui/index.html`, under a folder that changes with
/// every install, and the WebView may read nothing outside `assets/ui/`.
bool isOwnPageUrl(String url, {required bool ios}) {
  if (url.startsWith('about:blank') || url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (!ios) return url.startsWith(_androidPagePrefix);
  final uri = Uri.tryParse(url);
  return uri != null &&
      uri.scheme == 'file' &&
      uri.host.isEmpty &&
      uri.path.contains('.app/Frameworks/App.framework/flutter_assets/assets/ui/') &&
      !uri.pathSegments.contains('..');
}

/// The only screen: the page, full screen behind transparent system bars.
///
/// The page is told where the bars are through CSS variables on `<html>`: `--orbit-inset-top`, `-right`, `-bottom`
/// and `-left`, in CSS px (bottom is 0 while the keyboard is up). While the keyboard is up the WebView is shortened
/// to end at the keyboard, so `100%`/`100vh` layouts stay above it. Back goes back in the page's history when it has
/// any (history.pushState), and otherwise sends the app behind, like Home.
///
/// From the first frame of a cold start until the page's opening intro shows its first frame (the `intro` op), the
/// Orbit mark is painted above the page exactly as the system splash left it, so splash, Flutter and page hand over
/// without a seam (phone/SPEC.md, "The opening intro").
class OrbitScreen extends StatefulWidget {
  const OrbitScreen({super.key, required this.bridge, required this.native});

  final OrbitBridge bridge;
  final NativeHost native;

  @override
  State<OrbitScreen> createState() => _OrbitScreenState();
}

class _OrbitScreenState extends State<OrbitScreen> {
  late final WebViewController _controller;
  EdgeInsets _insets = EdgeInsets.zero;
  String? _insetsSent;

  /// The mark above the page: shown, fading, or gone.
  bool _mark = true;
  bool _markFading = false;
  Timer? _markTimer;

  @override
  void initState() {
    super.initState();
    final platform = WebViewPlatform.instance;
    final params = platform is AndroidWebViewPlatform
        ? AndroidWebViewControllerCreationParams()
        : platform is WebKitWebViewPlatform
        // Like Android's setMediaPlaybackRequiresUserGesture(false): the opening intro plays at once, in the page.
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true,
            mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
          )
        : const PlatformWebViewControllerCreationParams();
    _controller = WebViewController.fromPlatformCreationParams(params);
    widget.bridge.attach(_controller.runJavaScript);
    widget.bridge.beforeHelloReply = () => _sendInsets(force: true);
    widget.bridge.onIntro = _dropMark;
    // A page that never says so (an older one, or one that failed) does not keep the mark up for long.
    _markTimer = Timer(const Duration(seconds: 5), _dropMark);
    unawaited(_open());
  }

  /// The page shows the same mark now: the copy above it fades off while the page holds that frame.
  void _dropMark() {
    _markTimer?.cancel();
    if (!mounted || !_mark || _markFading) return;
    setState(() => _markFading = true);
  }

  @override
  void dispose() {
    _markTimer?.cancel();
    widget.bridge.onIntro = null;
    super.dispose();
  }

  Future<void> _open() async {
    final c = _controller;
    try {
      await c.setBackgroundColor(OrbitColors.background);
      await c.setJavaScriptMode(JavaScriptMode.unrestricted);
      await c.enableZoom(false);
      await c.setOverScrollMode(WebViewOverScrollMode.never);
      await c.setVerticalScrollBarEnabled(false);
      await c.setHorizontalScrollBarEnabled(false);
      await c.addJavaScriptChannel('OrbitNative', onMessageReceived: (m) => widget.bridge.handleMessage(m.message));
      await c.setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (request) =>
              _isOwnPage(request.url) ? NavigationDecision.navigate : NavigationDecision.prevent,
          onPageStarted: (_) {
            _insetsSent = null;
            widget.bridge.pageStarted();
          },
          onPageFinished: (_) => _sendInsets(force: true),
          onWebResourceError: (error) => debugPrint('orbit: page error ${error.errorCode}: ${error.description}'),
        ),
      );
      final android = c.platform;
      if (android is AndroidWebViewController) {
        await AndroidWebViewController.enableDebugging(kDebugMode);
        await android.setMediaPlaybackRequiresUserGesture(false);
        // The page is laid out for its own sizes: the phone's font size setting does not stretch it.
        await android.setTextZoom(100);
        await android.setAllowFileAccess(false);
        await android.setAllowContentAccess(false);
        await android.setGeolocationEnabled(false);
        // Flutter shortens the WebView for the keyboard; the page must not also shrink for it.
        await android.setInsetsForWebContentToIgnore(const [AndroidWebViewInsets.ime]);
        if (kDebugMode) await android.setOnConsoleMessage((m) => debugPrint('page ${m.level.name}: ${m.message}'));
      }
      final webKit = c.platform;
      if (webKit is WebKitWebViewController) {
        // Safari's Web Inspector in debug builds; no link previews or swipe-back: the page is the whole app.
        await webKit.setInspectable(kDebugMode);
        await webKit.setAllowsLinkPreview(false);
        await webKit.setAllowsBackForwardNavigationGestures(false);
        if (kDebugMode) await webKit.setOnConsoleMessage((m) => debugPrint('page ${m.level.name}: ${m.message}'));
      }
      await c.loadFlutterAsset(kUiAsset);
    } on Object catch (e, stack) {
      debugPrint('orbit: the page could not be opened: $e\n$stack');
    }
  }

  /// Only Orbit's own page (and same-document, data: or blob: content) ever loads: OrbitNative is reachable from any
  /// page in this WebView, so nothing from the network may become one.
  static bool _isOwnPage(String url) => isOwnPageUrl(url, ios: defaultTargetPlatform == TargetPlatform.iOS);

  void _sendInsets({bool force = false}) {
    final i = _insets;
    final script =
        '(function(){var d=document.documentElement;if(!d)return;var s=d.style;'
        "s.setProperty('--orbit-inset-top','${_px(i.top)}');"
        "s.setProperty('--orbit-inset-right','${_px(i.right)}');"
        "s.setProperty('--orbit-inset-bottom','${_px(i.bottom)}');"
        "s.setProperty('--orbit-inset-left','${_px(i.left)}');})();";
    if (!force && script == _insetsSent) return;
    _insetsSent = script;
    unawaited(_controller.runJavaScript(script).catchError((Object _) {}));
  }

  static String _px(double v) => '${(v.isFinite ? v : 0).toStringAsFixed(2)}px';

  Future<void> _onBack(bool didPop, Object? result) async {
    if (didPop) return;
    try {
      if (await _controller.canGoBack()) {
        await _controller.goBack();
        return;
      }
    } on Object catch (e) {
      debugPrint('orbit: back: $e');
    }
    await widget.native.moveToBack();
  }

  @override
  Widget build(BuildContext context) {
    final padding = MediaQuery.paddingOf(context);
    final keyboard = MediaQuery.viewInsetsOf(context).bottom;
    final insets = EdgeInsets.fromLTRB(padding.left, padding.top, padding.right, keyboard > 0 ? 0 : padding.bottom);
    if (insets != _insets) {
      _insets = insets;
      WidgetsBinding.instance.addPostFrameCallback((_) => _sendInsets());
    }
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: OrbitColors.systemBars,
      child: PopScope<Object?>(
        canPop: false,
        onPopInvokedWithResult: (didPop, result) => unawaited(_onBack(didPop, result)),
        child: ColoredBox(
          color: OrbitColors.background,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Padding(
                padding: EdgeInsets.only(bottom: keyboard),
                child: WebViewWidget(
                  controller: _controller,
                  gestureRecognizers: {Factory<OneSequenceGestureRecognizer>(EagerGestureRecognizer.new)},
                ),
              ),
              if (_mark)
                IgnorePointer(
                  child: AnimatedOpacity(
                    opacity: _markFading ? 0 : 1,
                    duration: const Duration(milliseconds: 160),
                    curve: Curves.easeOut,
                    onEnd: () {
                      if (_markFading && mounted) setState(() => _mark = false);
                    },
                    child: const CustomPaint(painter: SplashMarkPainter()),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
