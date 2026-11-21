/// Finding the TVs of every make on the home Wi-Fi (phone/SPEC.md, "Every TV"): SSDP (what Samsung, LG and Roku
/// answer to) and mDNS (what Android TV and Fire TV advertise) run side by side for one short window, and the
/// answers are merged by address into [BrandFound]s.
///
/// Orbit OS TVs are found by `setup/setup_scan.dart`; this file is for the other makes, so the person's own TV shows
/// up without typing an address.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:nsd/nsd.dart' as nsd;

import 'brand.dart';

/// The ports used to identify and probe a TV. Injectable so tests can point them at loopback servers.
class BrandPorts {
  const BrandPorts({
    this.samsungRest = 8001,
    this.samsungWss = 8002,
    this.lgWs = 3000,
    this.lgWss = 3001,
    this.roku = 8060,
    this.androidTv = 6466,
    this.androidTvPair = 6467,
    this.fireAdb = 5555,
  });

  /// Samsung's plain REST and WebSocket port (`/api/v2/` answers here on every Tizen TV).
  final int samsungRest;

  /// Samsung's secure WebSocket port, the one newer TVs want (they say so with `TokenAuthSupport`).
  final int samsungWss;

  /// LG's plain WebSocket port (older webOS).
  final int lgWs;

  /// LG's secure WebSocket port (the one Orbit uses).
  final int lgWss;

  /// Roku's External Control Protocol (HTTP).
  final int roku;

  /// Google's remote protocol.
  final int androidTv;

  /// Google's pairing port; kept with the rest so one object names every port.
  final int androidTvPair;

  /// Fire TV's debugging connection.
  final int fireAdb;
}

// ---- SSDP ----

/// One SSDP answer: the address it came from and its headers (names in lower case).
class SsdpResponse {
  const SsdpResponse(this.address, this.headers);

  /// The sender's IPv4 address. The TV is identified at this address, never at one a header names.
  final String address;

  /// The headers, keys lower-cased, values trimmed; the first copy of a repeated header wins.
  final Map<String, String> headers;

  String? get location => _nonEmpty(headers['location']);
  String get st => headers['st'] ?? '';
  String get server => headers['server'] ?? '';
  String get usn => headers['usn'] ?? '';

  /// Reads an SSDP answer (the text of one UDP datagram). Tolerates `\r\n`, `\n` and `\r` line ends, any header-name
  /// case and a missing LOCATION. Null when no header line is found at all.
  static SsdpResponse? parse(String raw, String address) {
    final headers = <String, String>{};
    final lines = raw.split(RegExp(r'\r\n|\n|\r'));
    // The first line is the status line ("HTTP/1.1 200 OK"); a header line always has a colon after its name.
    for (final line in lines.skip(1)) {
      final colon = line.indexOf(':');
      if (colon <= 0) continue;
      final name = line.substring(0, colon).trim().toLowerCase();
      if (name.isEmpty) continue;
      headers.putIfAbsent(name, () => line.substring(colon + 1).trim());
    }
    return headers.isEmpty ? null : SsdpResponse(address, headers);
  }
}

/// Something that asks the network for SSDP answers.
abstract interface class SsdpSearch {
  /// Asks for [window] and yields every answer as it comes. Ends by itself when the window is over.
  Stream<SsdpResponse> search(Duration window);
}

/// [SsdpSearch] on a plain UDP socket: M-SEARCH to 239.255.255.250:1900, one search per make's ST, each sent twice
/// because UDP drops packets and TVs on Wi-Fi are often slow to wake their network chip. TVs answer to the sender's
/// own port (unicast), so no multicast group has to be joined.
class UdpSsdpSearch implements SsdpSearch {
  const UdpSsdpSearch({this.target, this.port = 1900, this.repeats = 2, this.gap = const Duration(milliseconds: 300)});

  /// What the TVs of each make answer to: Samsung's remote receiver, LG's second screen, Roku's ECP, and DIAL (which
  /// most smart TVs answer, Samsung and LG among them, on firmware that hides its own ST).
  static const List<String> searchTargets = [
    'urn:samsung.com:device:RemoteControlReceiver:1',
    'urn:lge-com:service:webos-second-screen:1',
    'roku:ecp',
    'urn:dial-multiscreen-org:service:dial:1',
  ];

  /// The SSDP multicast group.
  static const String groupAddress = '239.255.255.250';

  /// Where the search goes; null means the multicast group. Tests aim it at a loopback socket.
  final InternetAddress? target;

  /// The UDP port the search goes to (1900).
  final int port;

  /// How many times each search is sent.
  final int repeats;

  /// The wait between one send and the next.
  final Duration gap;

  /// The exact M-SEARCH text for [st]. The HOST line always names the multicast group, as the standard says, even
  /// when a test sends to loopback.
  static String message(String st) =>
      'M-SEARCH * HTTP/1.1\r\n'
      'HOST: $groupAddress:1900\r\n'
      'MAN: "ssdp:discover"\r\n'
      'MX: 2\r\n'
      'ST: $st\r\n'
      '\r\n';

  @override
  Stream<SsdpResponse> search(Duration window) {
    final controller = StreamController<SsdpResponse>();
    unawaited(_run(window, controller));
    return controller.stream;
  }

  Future<void> _run(Duration window, StreamController<SsdpResponse> controller) async {
    RawDatagramSocket? socket;
    final timers = <Timer>[];
    try {
      socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      final open = socket;
      final destination = target ?? InternetAddress(groupAddress);
      open.listen((event) {
        if (event != RawSocketEvent.read) return;
        final datagram = open.receive();
        if (datagram == null || controller.isClosed) return;
        final parsed = SsdpResponse.parse(utf8.decode(datagram.data, allowMalformed: true), datagram.address.address);
        if (parsed != null) controller.add(parsed);
      });
      for (var round = 0; round < repeats; round++) {
        timers.add(
          Timer(gap * round, () {
            for (final st in searchTargets) {
              try {
                open.send(utf8.encode(message(st)), destination, port);
              } on Object catch (e) {
                debugPrint('orbit: ssdp send failed: $e');
              }
            }
          }),
        );
      }
      await Future<void>.delayed(window);
    } on Object catch (e) {
      debugPrint('orbit: ssdp search failed: $e');
    } finally {
      for (final timer in timers) {
        timer.cancel();
      }
      socket?.close();
      await controller.close();
    }
  }
}

// ---- mDNS ----

/// The mDNS types browsed and the make each one means.
const Map<String, TvKind> kBrandServiceTypes = {
  '_androidtvremote2._tcp': TvKind.androidtv,
  '_amzn-wplay._tcp': TvKind.firetv,
};

/// One mDNS advert of a TV: the service [type] it was seen on, its instance [name], its IPv4 [address], the
/// service's [port] (null when it did not say) and its TXT records as text.
class NsdSighting {
  const NsdSighting({required this.type, required this.name, required this.address, this.port, this.txt = const {}});

  final String type;
  final String name;
  final String address;
  final int? port;
  final Map<String, String> txt;
}

/// Something that browses several mDNS service types at once.
abstract interface class MultiNsdBrowser {
  /// Browses [kBrandServiceTypes] for [window] and yields each IPv4 advert as it is resolved. Ends when the window is
  /// over, after releasing the discovery.
  Stream<NsdSighting> browse(Duration window);
}

/// [MultiNsdBrowser] on Android's NsdManager through package:nsd, as `setup_scan.dart` does: every type at once, and
/// the plugin holds Wi-Fi's multicast lock for as long as a discovery is open, so every one is stopped at the end.
class PluginMultiNsdBrowser implements MultiNsdBrowser {
  const PluginMultiNsdBrowser();

  @override
  Stream<NsdSighting> browse(Duration window) {
    final controller = StreamController<NsdSighting>();
    unawaited(_run(window, controller));
    return controller.stream;
  }

  Future<void> _run(Duration window, StreamController<NsdSighting> controller) async {
    final discoveries = <nsd.Discovery>[];
    try {
      await Future.wait(
        kBrandServiceTypes.keys.map((type) async {
          try {
            final discovery = await nsd.startDiscovery(type, autoResolve: true).timeout(window);
            discoveries.add(discovery);
            void report(nsd.Service service, nsd.ServiceStatus status) {
              if (status != nsd.ServiceStatus.found || controller.isClosed) return;
              final address = _ipv4Of(service);
              if (address == null) return;
              controller.add(
                NsdSighting(
                  type: type,
                  name: (service.name ?? '').trim(),
                  address: address,
                  port: service.port,
                  txt: _txtOf(service),
                ),
              );
            }

            discovery.addServiceListener(report);
            for (final service in discovery.services) {
              report(service, nsd.ServiceStatus.found);
            }
          } on Object catch (e) {
            debugPrint('orbit: brand scan of $type failed: $e');
          }
        }),
      );
      await Future<void>.delayed(window);
    } finally {
      for (final discovery in discoveries) {
        unawaited(nsd.stopDiscovery(discovery).catchError((Object _) {}));
      }
      await controller.close();
    }
  }

  static String? _ipv4Of(nsd.Service service) {
    for (final address in service.addresses ?? const <InternetAddress>[]) {
      if (address.type == InternetAddressType.IPv4) return address.address;
    }
    final host = service.host;
    if (host != null && InternetAddress.tryParse(host)?.type == InternetAddressType.IPv4) return host;
    return null;
  }

  static Map<String, String> _txtOf(nsd.Service service) {
    final out = <String, String>{};
    service.txt?.forEach((key, value) {
      if (value == null) return;
      try {
        out[key] = utf8.decode(value);
      } on Object {
        // A binary record: not text, not used.
      }
    });
    return out;
  }
}

// ---- the search itself ----

String? _nonEmpty(String? value) {
  final text = value?.trim();
  return text == null || text.isEmpty ? null : text;
}

/// A found TV and how sure its make is. Higher wins when two sources disagree about an address:
/// [confirmed] (the TV itself answered a question about itself, or advertised a make-only service) beats [advert]
/// (a service advert naming the make, such as Android TV's remote service) beats [guess] (an SSDP header that
/// pointed at the make, but the TV did not answer when asked who it is).
class _Candidate {
  const _Candidate(this.found, this.strength);

  static const int guess = 1;
  static const int advert = 2;
  static const int confirmed = 3;

  final BrandFound found;
  final int strength;
}

/// The search for TVs of every make, and the probe of one typed address.
class BrandDiscovery implements BrandFinder {
  BrandDiscovery({
    SsdpSearch? ssdp,
    MultiNsdBrowser? nsd,
    this.ports = const BrandPorts(),
    this.window = const Duration(seconds: 4),
    this.httpTimeout = const Duration(seconds: 2),
  }) : _ssdp = ssdp ?? const UdpSsdpSearch(),
       _nsd = nsd ?? const PluginMultiNsdBrowser();

  final SsdpSearch _ssdp;
  final MultiNsdBrowser _nsd;
  final BrandPorts ports;

  /// How long SSDP and mDNS listen.
  final Duration window;

  /// How long one question to a TV (HTTP, TCP, WebSocket) may take before the TV counts as not answering.
  final Duration httpTimeout;

  /// Looks for [window] and returns the TVs found, sorted by name then address. [onUpdate] gets the list so far each
  /// time it grows (a TV at a new address). Merged by address: see [_merge]. Never throws.
  @override
  Future<List<BrandFound>> run(void Function(List<BrandFound> sofar) onUpdate) async {
    final byAddress = <String, _Candidate>{};
    final pending = <Future<void>>[];
    final identified = <String>{};

    void add(_Candidate candidate) {
      final address = candidate.found.address;
      final existing = byAddress[address];
      final grew = existing == null;
      byAddress[address] = existing == null ? candidate : _merge(existing, candidate);
      if (!grew) return;
      try {
        onUpdate(_sorted(byAddress.values));
      } on Object catch (e) {
        debugPrint('orbit: brand scan listener failed: $e');
      }
    }

    void onSsdp(SsdpResponse response) {
      final kind = classifySsdp(response);
      if (kind == null || !identified.add('${kind.wire}@${response.address}')) return;
      pending.add(
        _identifySsdp(kind, response).then(add, onError: (Object e) => debugPrint('orbit: identify failed: $e')),
      );
    }

    void onNsd(NsdSighting sighting) {
      final candidate = _fromSighting(sighting);
      if (candidate != null) add(candidate);
    }

    final done = [_listen(_ssdp, onSsdp, (s) => s.search(window)), _listen(_nsd, onNsd, (s) => s.browse(window))];
    try {
      await Future.wait(done);
      await Future.wait(pending);
    } on Object catch (e) {
      debugPrint('orbit: brand scan failed: $e');
    }
    return _sorted(byAddress.values);
  }

  /// Listens to one source until it ends or the window is over (plus a little for a source that is late to stop).
  Future<void> _listen<S, T>(S source, void Function(T) onEvent, Stream<T> Function(S) open) async {
    final finished = Completer<void>();
    StreamSubscription<T>? subscription;
    final timer = Timer(window + const Duration(milliseconds: 500), () {
      if (!finished.isCompleted) finished.complete();
    });
    try {
      subscription = open(source).listen(
        onEvent,
        onError: (Object e) => debugPrint('orbit: brand source failed: $e'),
        onDone: () {
          if (!finished.isCompleted) finished.complete();
        },
        cancelOnError: false,
      );
      await finished.future;
    } on Object catch (e) {
      debugPrint('orbit: brand source failed: $e');
    } finally {
      timer.cancel();
      await subscription?.cancel();
    }
  }

  /// Two sightings of one address: the stronger wins whole; on a tie the first stays. Either way a model or MAC that
  /// only the loser knows is kept, so no source's facts are thrown away.
  static _Candidate _merge(_Candidate a, _Candidate b) {
    final winner = b.strength > a.strength ? b : a;
    final loser = identical(winner, a) ? b : a;
    final w = winner.found;
    final l = loser.found;
    // A different make's model or MAC would be wrong for this make, so facts only carry over within one make.
    final sameMake = w.kind == l.kind;
    final model = w.model ?? (sameMake ? l.model : null);
    final mac = w.mac ?? (sameMake ? l.mac : null);
    if (model == w.model && mac == w.mac) return winner;
    return _Candidate(
      BrandFound(kind: w.kind, name: w.name, address: w.address, port: w.port, model: model, mac: mac),
      winner.strength,
    );
  }

  static List<BrandFound> _sorted(Iterable<_Candidate> candidates) {
    final list = candidates.map((c) => c.found).toList();
    list.sort((a, b) {
      final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
      return byName != 0 ? byName : a.address.compareTo(b.address);
    });
    return list;
  }

  // ---- mDNS ----

  _Candidate? _fromSighting(NsdSighting s) {
    final kind = kBrandServiceTypes[s.type];
    if (kind == null || s.address.trim().isEmpty) return null;
    final service = _nonEmpty(s.name);
    switch (kind) {
      case TvKind.androidtv:
        return _Candidate(
          BrandFound(kind: kind, name: service ?? 'Android TV', address: s.address, port: s.port ?? ports.androidTv),
          _Candidate.advert,
        );
      case TvKind.firetv:
        // `_amzn-wplay._tcp` is Amazon's own service, so it says "Fire TV" with more certainty than a generic Android
        // TV advert does. TXT `n` is the device's name where the Fire TV sets it (not verified on every model).
        return _Candidate(
          BrandFound(
            kind: kind,
            name: _nonEmpty(s.txt['n']) ?? service ?? 'Fire TV',
            address: s.address,
            port: ports.fireAdb,
          ),
          _Candidate.confirmed,
        );
      case TvKind.samsung:
      case TvKind.lg:
      case TvKind.roku:
        return null;
    }
  }

  // ---- SSDP ----

  /// Which make an SSDP answer comes from, or null for one to ignore. The ST says it best; failing that the SERVER or
  /// USN line. A DIAL answer from anything else (Chromecast, Fire TV, a speaker) is not a TV Orbit can drive.
  static TvKind? classifySsdp(SsdpResponse r) {
    final st = r.st.toLowerCase();
    if (st.contains('samsung.com')) return TvKind.samsung;
    if (st.contains('webos-second-screen') || st.contains('lge-com')) return TvKind.lg;
    if (st.contains('roku:ecp')) return TvKind.roku;
    final text = '${r.server} ${r.usn}'.toLowerCase();
    if (text.contains('samsung') || text.contains('tizen')) return TvKind.samsung;
    if (text.contains('webos') || RegExp(r'\blg\b').hasMatch(text)) return TvKind.lg;
    if (text.contains('roku')) return TvKind.roku;
    return null;
  }

  Future<_Candidate> _identifySsdp(TvKind kind, SsdpResponse r) async {
    final BrandFound? found;
    switch (kind) {
      case TvKind.samsung:
        found = await _samsungInfo(r.address);
      case TvKind.lg:
        found = await _lgInfo(r);
      case TvKind.roku:
        found = await _rokuInfo(r.address);
      case TvKind.androidtv:
      case TvKind.firetv:
        found = null;
    }
    if (found != null) return _Candidate(found, _Candidate.confirmed);
    return _Candidate(
      BrandFound(kind: kind, name: _makeName(kind), address: r.address, port: _portOf(kind)),
      _Candidate.guess,
    );
  }

  static String _makeName(TvKind kind) => switch (kind) {
    TvKind.samsung => 'Samsung TV',
    TvKind.lg => 'LG TV',
    TvKind.roku => 'Roku',
    TvKind.androidtv => 'Android TV',
    TvKind.firetv => 'Fire TV',
  };

  int _portOf(TvKind kind) => switch (kind) {
    TvKind.samsung => ports.samsungWss,
    TvKind.lg => ports.lgWss,
    TvKind.roku => ports.roku,
    TvKind.androidtv => ports.androidTv,
    TvKind.firetv => ports.fireAdb,
  };

  /// Samsung: `GET /api/v2/` on the plain port, `{"device": {"name", "modelName", "wifiMac", "TokenAuthSupport"}}`.
  /// Null when the TV does not answer in that shape.
  Future<BrandFound?> _samsungInfo(String address) async {
    final body = await _get(Uri(scheme: 'http', host: address, port: ports.samsungRest, path: '/api/v2/'));
    if (body == null) return null;
    try {
      final decoded = jsonDecode(body);
      final device = decoded is Map ? decoded['device'] : null;
      if (device is! Map) return null;
      final name = _text(device['name'])?.replaceFirst(RegExp(r'^\[TV\]\s*', caseSensitive: false), '').trim();
      // Newer TVs only take the secure port, and say so with TokenAuthSupport; older ones talk on the plain one.
      final secure = '${device['TokenAuthSupport']}'.toLowerCase() == 'true';
      return BrandFound(
        kind: TvKind.samsung,
        name: name == null || name.isEmpty ? 'Samsung TV' : name,
        address: address,
        port: secure ? ports.samsungWss : ports.samsungRest,
        model: _text(device['modelName']),
        mac: _text(device['wifiMac']),
      );
    } on Object {
      return null;
    }
  }

  /// LG: the UPnP description at the answer's LOCATION. That URL must name the sender itself, so a stray or forged
  /// answer cannot make the phone fetch from another machine.
  Future<BrandFound?> _lgInfo(SsdpResponse r) async {
    final uri = Uri.tryParse(r.location ?? '');
    if (uri == null || !uri.hasScheme || (uri.scheme != 'http' && uri.scheme != 'https') || uri.host != r.address) {
      return null;
    }
    final xml = await _get(uri);
    if (xml == null) return null;
    final name = _xmlTag(xml, 'friendlyName');
    if (name == null) return null;
    return BrandFound(
      kind: TvKind.lg,
      name: name,
      address: r.address,
      port: ports.lgWss,
      model: _xmlTag(xml, 'modelName') ?? _xmlTag(xml, 'modelNumber'),
    );
  }

  /// Roku: `GET /query/device-info` on the ECP port.
  Future<BrandFound?> _rokuInfo(String address) async {
    final xml = await _get(Uri(scheme: 'http', host: address, port: ports.roku, path: '/query/device-info'));
    if (xml == null || !xml.contains('<device-info')) return null;
    final name =
        _xmlTag(xml, 'user-device-name') ?? _xmlTag(xml, 'friendly-device-name') ?? _xmlTag(xml, 'default-device-name');
    return BrandFound(
      kind: TvKind.roku,
      name: name ?? 'Roku',
      address: address,
      port: ports.roku,
      model: _xmlTag(xml, 'model-name'),
    );
  }

  // ---- a typed address ----

  /// For an address the person typed: asks every make's door at once and returns the first confident answer, in the
  /// order Samsung, Roku, LG, Android TV; null when none answers. Port 5555 alone is not taken for a Fire TV, since
  /// any Android device can have it open. Never throws.
  @override
  Future<BrandFound?> probe(String address) async {
    final host = address.trim();
    if (host.isEmpty) return null;
    try {
      final checks = [_samsungInfo(host), _rokuInfo(host), _probeLg(host), _probeAndroidTv(host)];
      for (final check in checks) {
        final found = await check.catchError((Object _) => null);
        if (found != null) return found;
      }
    } on Object catch (e) {
      debugPrint('orbit: probe of $host failed: $e');
    }
    return null;
  }

  Future<BrandFound?> _probeLg(String host) async {
    final found = BrandFound(kind: TvKind.lg, name: 'LG TV', address: host, port: ports.lgWss);
    WebSocket? socket;
    try {
      socket = await WebSocket.connect('ws://$host:${ports.lgWs}/').timeout(httpTimeout);
      return found;
    } on Object {
      // Not an LG on the plain port; the secure one may still be open.
    } finally {
      await socket?.close();
    }
    return await _tcpOpen(host, ports.lgWss) ? found : null;
  }

  Future<BrandFound?> _probeAndroidTv(String host) async {
    if (!await _tcpOpen(host, ports.androidTv)) return null;
    return BrandFound(kind: TvKind.androidtv, name: 'Android TV', address: host, port: ports.androidTv);
  }

  Future<bool> _tcpOpen(String host, int port) async {
    try {
      final socket = await Socket.connect(host, port, timeout: httpTimeout);
      socket.destroy();
      return true;
    } on Object {
      return false;
    }
  }

  // ---- small helpers ----

  /// The body of a 200 answer, or null for any failure (refused, slow, other status, unreadable).
  Future<String?> _get(Uri uri) async {
    final client = HttpClient()..connectionTimeout = httpTimeout;
    try {
      final request = await client.getUrl(uri).timeout(httpTimeout);
      final response = await request.close().timeout(httpTimeout);
      if (response.statusCode != 200) {
        await response.drain<void>().timeout(httpTimeout);
        return null;
      }
      return await response.transform(const Utf8Decoder(allowMalformed: true)).join().timeout(httpTimeout);
    } on Object catch (e) {
      debugPrint('orbit: GET $uri failed: $e');
      return null;
    } finally {
      client.close(force: true);
    }
  }

  static String? _text(Object? value) => value == null ? null : _nonEmpty('$value');

  /// The text of the first `<tag>…</tag>`, with entities undone; null when absent or blank. A tolerant reader for the
  /// two tiny XML answers TVs give, not a parser.
  static String? _xmlTag(String xml, String tag) {
    final match = RegExp('<$tag(?:\\s[^>]*)?>([\\s\\S]*?)</$tag>', caseSensitive: false).firstMatch(xml);
    if (match == null) return null;
    final text = match
        .group(1)!
        .replaceAllMapped(RegExp(r'<!\[CDATA\[([\s\S]*?)\]\]>'), (m) => m.group(1)!)
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&#39;', "'")
        .replaceAll('&amp;', '&');
    return _nonEmpty(text);
  }
}
