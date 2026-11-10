import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:nsd/nsd.dart' as nsd;

import 'models.dart';
import 'subnet_scan.dart';

/// The TV's mDNS advert (PhonePortal.advertise on the TV).
const String kServiceType = '_orbit._tcp';

/// Something that reports the TVs announcing [kServiceType] on the Wi-Fi.
abstract interface class NsdBrowser {
  /// Listens for [window]; [onFound] gets each TV with an IPv4 address, [onNameOnly] the name of one seen only by an
  /// IPv6 address (the door answers IPv4 only, so the scan has to supply its address). Never throws.
  Future<void> browse(Duration window, void Function(FoundTv tv) onFound, void Function(String name) onNameOnly);
}

/// [NsdBrowser] on Android's NsdManager through package:nsd. The plugin takes Wi-Fi's multicast lock while it
/// discovers (that needs CHANGE_WIFI_MULTICAST_STATE in the manifest).
class PluginNsdBrowser implements NsdBrowser {
  const PluginNsdBrowser();

  /// Returns after [window] (starting included); stopping happens after that, without holding the caller.
  @override
  Future<void> browse(Duration window, void Function(FoundTv tv) onFound, void Function(String name) onNameOnly) async {
    final watch = Stopwatch()..start();
    final starting = nsd.startDiscovery(kServiceType, autoResolve: true);
    nsd.Discovery discovery;
    try {
      discovery = await starting.timeout(window);
    } on Object catch (e) {
      debugPrint('orbit: mDNS discovery did not start: $e');
      // Started late after all: stop it, so the multicast lock is let go.
      unawaited(starting.then(nsd.stopDiscovery).catchError((Object _) {}));
      return;
    }
    final seen = <String>{};
    void report(nsd.Service service, nsd.ServiceStatus status) {
      if (status != nsd.ServiceStatus.found) return;
      final name = (service.name ?? '').trim();
      final port = service.port ?? kDoorPort;
      String? ipv4;
      for (final address in service.addresses ?? const <InternetAddress>[]) {
        if (address.type == InternetAddressType.IPv4) {
          ipv4 = address.address;
          break;
        }
      }
      final host = service.host;
      if (ipv4 == null && host != null && InternetAddress.tryParse(host)?.type == InternetAddressType.IPv4) {
        ipv4 = host;
      }
      if (ipv4 == null) {
        if (name.isNotEmpty) onNameOnly(name);
        return;
      }
      if (!seen.add('$ipv4:$port')) return;
      onFound(FoundTv(name: name.isEmpty ? 'TV' : name, address: ipv4, port: port, named: name.isNotEmpty));
    }

    discovery.addServiceListener(report);
    for (final service in discovery.services) {
      report(service, nsd.ServiceStatus.found);
    }
    final left = window - watch.elapsed;
    if (left > Duration.zero) await Future<void>.delayed(left);
    discovery.removeServiceListener(report);
    unawaited(
      nsd.stopDiscovery(discovery).catchError((Object e) {
        debugPrint('orbit: mDNS discovery did not stop cleanly: $e');
      }),
    );
  }
}

/// What one discovery run found.
class DiscoveryResult {
  const DiscoveryResult({required this.found, required this.onNetwork});

  /// Sorted by name, then address.
  final List<FoundTv> found;

  /// False when the phone had no home-network address (so the scan could not run).
  final bool onNetwork;
}

/// One run = the mDNS browse and the /24 scan side by side, merged by address (the advert's name wins).
class TvDiscovery {
  TvDiscovery({required this.nsd, required this.scanner, this.nsdWindow = const Duration(seconds: 4)});

  final NsdBrowser nsd;
  final SubnetScanner scanner;
  final Duration nsdWindow;

  /// [onUpdate] gets the merged list each time it grows. Without [scan], mDNS only.
  Future<DiscoveryResult> run(void Function(List<FoundTv> sofar) onUpdate, {bool scan = true}) async {
    final byKey = <String, FoundTv>{};
    final namesOnly = <String>[];
    void publish() => onUpdate(merged(byKey.values, namesOnly));

    void add(FoundTv tv) {
      final existing = byKey[tv.key];
      if (existing != null && (existing.named || !tv.named)) return;
      byKey[tv.key] = tv;
      publish();
    }

    void nameOnly(String name) {
      if (namesOnly.contains(name)) return;
      namesOnly.add(name);
      publish();
    }

    var onNetwork = true;
    Future<void> browse() async {
      try {
        await nsd.browse(nsdWindow, add, nameOnly);
      } on Object catch (e) {
        debugPrint('orbit: mDNS failed: $e');
      }
    }

    Future<void> scanSubnet() async {
      try {
        onNetwork = (await scanner.scan(add)).onNetwork;
      } on Object catch (e) {
        debugPrint('orbit: scan failed: $e');
      }
    }

    await Future.wait<void>([browse(), if (scan) scanSubnet()]);
    return DiscoveryResult(found: merged(byKey.values, namesOnly), onNetwork: onNetwork || byKey.isNotEmpty);
  }

  /// The TVs sorted by name then address. When exactly one TV is known only by the scan and exactly one advert had
  /// only an IPv6 address, they are the same TV: it gets the advert's name.
  static List<FoundTv> merged(Iterable<FoundTv> tvs, List<String> namesOnly) {
    final list = tvs.toList();
    final unnamed = [
      for (final tv in list)
        if (!tv.named) tv,
    ];
    final usedNames = {
      for (final tv in list)
        if (tv.named) tv.name,
    };
    final spare = [
      for (final name in namesOnly)
        if (!usedNames.contains(name)) name,
    ];
    if (unnamed.length == 1 && spare.length == 1) {
      final tv = unnamed.single;
      list[list.indexOf(tv)] = FoundTv(name: spare.single, address: tv.address, port: tv.port, named: true);
    }
    list.sort((a, b) {
      final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      return byName != 0 ? byName : _addressOrder(a.address, b.address);
    });
    return list;
  }

  static int _addressOrder(String a, String b) {
    final pa = a.split('.').map(int.tryParse).toList();
    final pb = b.split('.').map(int.tryParse).toList();
    if (pa.length == 4 && pb.length == 4 && !pa.contains(null) && !pb.contains(null)) {
      for (var i = 0; i < 4; i++) {
        final d = pa[i]! - pb[i]!;
        if (d != 0) return d;
      }
      return 0;
    }
    return a.compareTo(b);
  }
}
