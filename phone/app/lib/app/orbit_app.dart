import 'dart:async';

import 'package:flutter/widgets.dart';

import '../bridge/orbit_bridge.dart';
import '../cloud/account.dart';
import '../cloud/backend.dart';
import '../cloud/cloud_tv.dart';
import '../cloud/firebase_backend.dart';
import '../cloud/google_identity.dart';
import '../native/native_host.dart';
import '../setup/setup_host.dart';
import '../tv/discovery.dart';
import '../tv/icon_cache.dart';
import '../tv/remote.dart';
import '../tv/subnet_scan.dart';
import '../tv/tv_client.dart';
import '../tv/tv_link.dart';
import '../tv/tv_store.dart';
import 'orbit_screen.dart';
import 'theme.dart';

/// Orbit: the link to the TV, the bridge to the page, and the one screen. No Material: the page is the interface.
class OrbitApp extends StatefulWidget {
  const OrbitApp({super.key, required this.firebase});

  /// Firebase starting (null when it could not): the cloud path joins when it is up; the Wi-Fi path never waits.
  final Future<FirebaseBackend?> firebase;

  @override
  State<OrbitApp> createState() => _OrbitAppState();
}

class _OrbitAppState extends State<OrbitApp> with WidgetsBindingObserver {
  late final PlatformNativeHost _native;
  late final TvLink _link;
  late final TvRemote _remote;
  late final OrbitBridge _bridge;

  @override
  void initState() {
    super.initState();
    _native = PlatformNativeHost();
    _link = TvLink(
      store: SecureTvStore(),
      client: TvClient(),
      discovery: TvDiscovery(nsd: const PluginNsdBrowser(), scanner: SubnetScanner()),
    );
    _remote = TvRemote(wifi: _link);
    _bridge = OrbitBridge(
      remote: _remote,
      native: _native,
      icons: IconCache(directory: _native.cacheDirectory),
      setup: PlatformSetupHost(),
    );
    unawaited(_startCloud());
    WidgetsBinding.instance.addObserver(this);
    final now = WidgetsBinding.instance.lifecycleState;
    if (now != null && now != AppLifecycleState.resumed && now != AppLifecycleState.inactive) {
      _bridge.lifecycle(resumed: false);
    }
    unawaited(_link.start());
  }

  Future<void> _startCloud() async {
    final backend = await widget.firebase;
    if (!mounted) return;
    if (backend == null) {
      _remote.cloudUnavailable();
      return;
    }
    final account = CloudAccount(
      auth: backend,
      google: PluginGoogleIdentity(serverClientId: CloudConfig.webClientId),
    );
    _remote.attachCloud(account, CloudTv(db: backend, account: account));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.resumed:
        _bridge.lifecycle(resumed: true);
      case AppLifecycleState.hidden || AppLifecycleState.paused:
        _bridge.lifecycle(resumed: false);
      case AppLifecycleState.inactive || AppLifecycleState.detached:
        // Inactive: still on screen (the shade is down, a dialog is up). Detached: going away.
        break;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _remote.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return WidgetsApp(
      title: 'Orbit',
      color: OrbitColors.background,
      debugShowCheckedModeBanner: false,
      pageRouteBuilder: <T>(RouteSettings settings, WidgetBuilder builder) => PageRouteBuilder<T>(
        settings: settings,
        transitionDuration: Duration.zero,
        reverseTransitionDuration: Duration.zero,
        pageBuilder: (context, _, _) => builder(context),
      ),
      home: OrbitScreen(bridge: _bridge, native: _native),
    );
  }
}
