/// The real drivers and the real search, for the app (tests give DirectLink their own).
library;

import '../../setup/setup_host.dart' show PlatformAdbCrypto;
import 'android_tv.dart';
import 'brand.dart';
import 'brand_discovery.dart';
import 'direct_link.dart';
import 'fire_tv.dart';
import 'lg.dart';
import 'roku.dart';
import 'samsung.dart';

/// The driver for a kept TV of another make, with the secret from its last pairing.
///
/// Samsung and LG choose their own ports (secure first, then plain), so only Roku, Android TV and Fire TV take the
/// kept one.
BrandTv makeBrandTv(DirectTv tv, String? secret) => switch (tv.kind) {
  TvKind.samsung => SamsungTv(address: tv.address, secret: secret),
  TvKind.lg => LgTv(address: tv.address, secret: secret),
  TvKind.roku => RokuTv(address: tv.address, port: tv.effectivePort),
  TvKind.androidtv => AndroidTv(address: tv.address, identity: PlatformRemoteIdentity(), port: tv.effectivePort),
  TvKind.firetv => FireTv(address: tv.address, crypto: const PlatformAdbCrypto(), port: tv.effectivePort),
};

/// The search on the phone: SSDP over the Wi-Fi and Android's NsdManager.
BrandFinder makeBrandFinder() => BrandDiscovery(ssdp: UdpSsdpSearch(), nsd: PluginMultiNsdBrowser());
