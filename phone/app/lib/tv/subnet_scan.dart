import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

import 'models.dart';
import 'tv_client.dart';

/// The phone's own Wi-Fi address and the /24 around it.
class LocalNetwork {
  const LocalNetwork._();

  /// Interface names that are never the home Wi-Fi: mobile data, VPNs, tethering over USB, Wi-Fi Direct.
  static final RegExp _notHome = RegExp(r'^(rmnet|ccmni|pdp|v4-|clat|seth|wwan|tun|ppp|ipsec|dummy|rndis|usb|p2p|lo)');

  /// The phone's IPv4 address on the home network, or null when it has none (not on Wi-Fi).
  ///
  /// Prefers `wlan*`, then wired `eth*`, then the phone's own hotspot (`swlan*`, `ap*`, `softap*`), and only ever a
  /// private address (10/8, 172.16/12, 192.168/16): a carrier's address on mobile data is never scanned.
  static Future<InternetAddress?> wifiAddress() async {
    final List<NetworkInterface> interfaces;
    try {
      interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4);
    } on SocketException {
      return null;
    }
    InternetAddress? best;
    var bestRank = 1 << 30;
    for (final interface in interfaces) {
      final name = interface.name.toLowerCase();
      if (_notHome.hasMatch(name)) continue;
      final rank = name.startsWith('wlan')
          ? 0
          : name.startsWith('eth')
          ? 1
          : (name.startsWith('swlan') || name.startsWith('ap') || name.startsWith('softap'))
          ? 2
          : 3;
      for (final address in interface.addresses) {
        if (address.type != InternetAddressType.IPv4 || !isPrivate(address.rawAddress)) continue;
        if (rank < bestRank) {
          best = address;
          bestRank = rank;
        }
      }
    }
    return best;
  }

  /// 10/8, 172.16/12 or 192.168/16.
  static bool isPrivate(List<int> b) {
    if (b.length != 4) return false;
    return b[0] == 10 || (b[0] == 172 && (b[1] & 0xF0) == 16) || (b[0] == 192 && b[1] == 168);
  }

  /// Every other host of [own]'s /24: x.y.z.1 to x.y.z.254 without [own].
  static List<String> neighbours(InternetAddress own) {
    final b = own.rawAddress;
    if (b.length != 4) return const [];
    return [
      for (var host = 1; host <= 254; host++)
        if (host != b[3]) '${b[0]}.${b[1]}.${b[2]}.$host',
    ];
  }
}

/// What a scan saw.
class ScanResult {
  const ScanResult({required this.onNetwork, required this.found});

  /// False when the phone had no home-network address to scan from.
  final bool onNetwork;
  final List<FoundTv> found;
}

/// Finds TVs by asking every host of the phone's /24 for `GET /api/state` on the door's port: a TV answers 401 with a
/// JSON body whose `ok` is false (phone/SPEC.md, `discover`). No token is ever sent while scanning.
class SubnetScanner {
  SubnetScanner({
    this.port = kDoorPort,
    this.parallel = 40,
    this.connectTimeout = const Duration(milliseconds: 400),
    this.answerTimeout = const Duration(milliseconds: 900),
    this.maxDuration = const Duration(seconds: 5),
    Future<List<String>?> Function()? targets,
  }) : _targets = targets ?? _ownSubnet;

  final int port;

  /// How many hosts are asked at once.
  final int parallel;

  /// Per host: to connect (an address nobody has never answers ARP, so this is what a scan mostly waits for)...
  final Duration connectTimeout;

  /// ...and to the last byte of the answer.
  final Duration answerTimeout;

  /// No host is asked after this (a scan of 253 hosts normally takes 2 to 3 s).
  final Duration maxDuration;

  /// The addresses to ask, or null when the phone is not on a home network.
  final Future<List<String>?> Function() _targets;

  static Future<List<String>?> _ownSubnet() async {
    final own = await LocalNetwork.wifiAddress();
    return own == null ? null : LocalNetwork.neighbours(own);
  }

  /// Asks every target; [onFound] is called for each TV as soon as it answers.
  Future<ScanResult> scan(void Function(FoundTv tv) onFound) async {
    final hosts = await _targets();
    if (hosts == null) return const ScanResult(onNetwork: false, found: []);
    final found = <FoundTv>[];
    if (hosts.isEmpty) return ScanResult(onNetwork: true, found: found);
    final io = HttpClient()
      ..connectionTimeout = connectTimeout
      ..idleTimeout = const Duration(milliseconds: 500)
      ..userAgent = 'Orbit/1.0 (Android)';
    final client = IOClient(io);
    var next = 0;
    final watch = Stopwatch()..start();
    Future<void> worker() async {
      while (next < hosts.length && watch.elapsed < maxDuration) {
        final host = hosts[next++];
        final tv = await probe(client, host);
        if (tv != null) {
          found.add(tv);
          onFound(tv);
        }
      }
    }

    try {
      await Future.wait([for (var i = 0; i < math.min(parallel, hosts.length); i++) worker()]);
    } finally {
      client.close();
    }
    return ScanResult(onNetwork: true, found: found);
  }

  /// The TV at [host], or null for anything else (nothing there, another device, a timeout).
  Future<FoundTv?> probe(http.Client client, String host) async {
    final abort = Completer<void>();
    final timer = Timer(answerTimeout, () {
      if (!abort.isCompleted) abort.complete();
    });
    try {
      final request =
          http.AbortableRequest(
              'GET',
              Uri(scheme: 'http', host: host, port: port, path: '/api/state'),
              abortTrigger: abort.future,
            )
            ..persistentConnection = false
            ..followRedirects = false;
      final response = await client.send(request).timeout(answerTimeout + const Duration(milliseconds: 300));
      if (response.statusCode != 401) {
        unawaited(response.stream.drain<void>().catchError((Object _) {}));
        return null;
      }
      final body = await _readSmall(response.stream).timeout(answerTimeout + const Duration(milliseconds: 300));
      final json = body == null ? null : TvReply.decodeJson(body);
      if (json is! Map || json['ok'] != false) return null;
      final name = json['tv'] ?? json['name'];
      return FoundTv(
        name: name is String && name.trim().isNotEmpty ? name.trim() : 'TV',
        address: host,
        port: port,
        named: name is String && name.trim().isNotEmpty,
      );
    } on Object {
      // Nothing there, refused, reset, timed out or not HTTP: not a TV.
      return null;
    } finally {
      timer.cancel();
      if (!abort.isCompleted) abort.complete();
    }
  }

  /// At most 4 kB: a TV's 401 is a line of JSON; anything longer is not a TV.
  static Future<Uint8List?> _readSmall(Stream<List<int>> stream) async {
    final out = BytesBuilder(copy: false);
    await for (final chunk in stream) {
      out.add(chunk);
      if (out.length > 4096) return null;
    }
    return out.takeBytes();
  }
}
