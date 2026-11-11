import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:nsd/nsd.dart' as nsd;

/// Finding TVs for Orbit Setup: NSD browse of `_androidtvremote2._tcp`, `_googlecast._tcp` and `_orbit._tcp`
/// together, merged by IPv4 address (phone/SPEC.md, `setupScan`).

/// The service types browsed, and whether each one means "this is an Orbit TV".
const Map<String, bool> kSetupServiceTypes = {
  '_androidtvremote2._tcp': false,
  '_googlecast._tcp': false,
  '_orbit._tcp': true,
};

/// One advert seen at an address: its name (TXT `fn` or the service name), its model (TXT `md`), and whether the
/// advert was `_orbit._tcp`.
class ScannedService {
  const ScannedService({required this.address, this.fn, this.serviceName, this.model, this.orbit = false});

  final String address;

  /// TXT `fn` (the friendly name), or null.
  final String? fn;

  /// The mDNS service instance name, or null.
  final String? serviceName;

  /// TXT `md` (the model), or null.
  final String? model;

  /// The advert was on `_orbit._tcp`.
  final bool orbit;
}

/// The TVs merged by address, each `{"name","address","model","orbit"}`, sorted by name then address.
List<Map<String, Object?>> mergeScan(Iterable<ScannedService> services) {
  final byAddress = <String, Map<String, Object?>>{};
  for (final s in services) {
    final address = s.address.trim();
    if (address.isEmpty) continue;
    final fn = _clean(s.fn);
    final serviceName = _clean(s.serviceName);
    final model = _clean(s.model);
    final existing = byAddress[address];
    if (existing == null) {
      byAddress[address] = {
        'name': fn ?? serviceName ?? 'TV',
        '_hasFn': fn != null,
        'address': address,
        'model': model,
        'orbit': s.orbit,
      };
    } else {
      // A friendly name wins over a bare service name; the first model and any orbit sighting stick.
      if (fn != null && existing['_hasFn'] != true) {
        existing['name'] = fn;
        existing['_hasFn'] = true;
      } else if (existing['name'] == 'TV' && serviceName != null) {
        existing['name'] = serviceName;
      }
      existing['model'] ??= model;
      if (s.orbit) existing['orbit'] = true;
    }
  }
  final list = byAddress.values.map((m) {
    m.remove('_hasFn');
    return m;
  }).toList();
  list.sort((a, b) {
    final byName = (a['name']! as String).toLowerCase().compareTo((b['name']! as String).toLowerCase());
    return byName != 0 ? byName : (a['address']! as String).compareTo(b['address']! as String);
  });
  return list;
}

String? _clean(String? value) {
  final text = value?.trim();
  return text == null || text.isEmpty ? null : text;
}

/// Something that reports the adverts seen during a browse window.
abstract interface class SetupScanner {
  /// Browses [kSetupServiceTypes] for [window] and returns every advert seen (not yet merged).
  Future<List<ScannedService>> scan(Duration window);
}

/// [SetupScanner] on Android's NsdManager through package:nsd. Browses the three service types at once; the plugin
/// holds Wi-Fi's multicast lock while it looks.
class PluginSetupScanner implements SetupScanner {
  const PluginSetupScanner();

  @override
  Future<List<ScannedService>> scan(Duration window) async {
    final seen = <ScannedService>[];
    final discoveries = <nsd.Discovery>[];
    await Future.wait(
      kSetupServiceTypes.entries.map((entry) async {
        try {
          final discovery = await nsd.startDiscovery(entry.key, autoResolve: true).timeout(window);
          discoveries.add(discovery);
          void report(nsd.Service service, nsd.ServiceStatus status) {
            if (status != nsd.ServiceStatus.found) return;
            final address = _ipv4Of(service);
            if (address == null) return;
            seen.add(
              ScannedService(
                address: address,
                fn: _txt(service, 'fn'),
                serviceName: (service.name ?? '').trim(),
                model: _txt(service, 'md'),
                orbit: entry.value,
              ),
            );
          }

          discovery.addServiceListener(report);
          for (final service in discovery.services) {
            report(service, nsd.ServiceStatus.found);
          }
        } on Object catch (e) {
          debugPrint('orbit: setup scan of ${entry.key} failed: $e');
        }
      }),
    );
    await Future<void>.delayed(window);
    for (final discovery in discoveries) {
      unawaited(nsd.stopDiscovery(discovery).catchError((Object _) {}));
    }
    return seen;
  }

  static String? _ipv4Of(nsd.Service service) {
    for (final address in service.addresses ?? const <InternetAddress>[]) {
      if (address.type == InternetAddressType.IPv4) return address.address;
    }
    final host = service.host;
    if (host != null && InternetAddress.tryParse(host)?.type == InternetAddressType.IPv4) return host;
    return null;
  }

  static String? _txt(nsd.Service service, String key) {
    final value = service.txt?[key];
    if (value == null) return null;
    try {
      return utf8.decode(value);
    } on Object {
      return null;
    }
  }
}
