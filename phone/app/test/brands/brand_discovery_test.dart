import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/tv/brands/brand.dart';
import 'package:orbit/tv/brands/brand_discovery.dart';

/// A loopback HTTP server that answers fixed bodies for fixed paths (404 for the rest).
class _Http {
  _Http(this.server, this.routes) {
    server.listen((request) {
      hits.add(request.uri.path);
      final body = routes[request.uri.path];
      if (body == null) {
        request.response.statusCode = 404;
      } else {
        request.response.write(body);
      }
      request.response.close();
    });
  }

  final HttpServer server;
  final Map<String, String> routes;
  final List<String> hits = [];

  int get port => server.port;

  static Future<_Http> start(Map<String, String> routes) async =>
      _Http(await HttpServer.bind(InternetAddress.loopbackIPv4, 0), routes);

  Future<void> stop() => server.close(force: true);
}

class _FakeSsdp implements SsdpSearch {
  _FakeSsdp(this.responses, {this.fail = false});

  final List<SsdpResponse> responses;
  final bool fail;

  @override
  Stream<SsdpResponse> search(Duration window) {
    if (fail) return Stream<SsdpResponse>.error(StateError('no network'));
    return Stream.fromIterable(responses);
  }
}

class _FakeNsd implements MultiNsdBrowser {
  _FakeNsd(this.sightings);

  final List<NsdSighting> sightings;

  @override
  Stream<NsdSighting> browse(Duration window) => Stream.fromIterable(sightings);
}

/// A port nothing listens on (bound, then released).
Future<int> _closedPort() async {
  final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final port = server.port;
  await server.close();
  return port;
}

SsdpResponse _ssdp(String address, {required String st, String server = '', String? location, String usn = ''}) {
  final raw = StringBuffer('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nEXT:\r\n');
  if (location != null) raw.write('LOCATION: $location\r\n');
  if (server.isNotEmpty) raw.write('SERVER: $server\r\n');
  raw.write('ST: $st\r\nUSN: $usn\r\n\r\n');
  return SsdpResponse.parse(raw.toString(), address)!;
}

const _samsungSt = 'urn:samsung.com:device:RemoteControlReceiver:1';
const _lgSt = 'urn:lge-com:service:webos-second-screen:1';
const _dialSt = 'urn:dial-multiscreen-org:service:dial:1';

String _samsungJson({String name = '[TV] Samsung 7 Series (55)', String token = 'true'}) => jsonEncode({
  'device': {'name': name, 'modelName': 'QA55Q60T', 'wifiMac': 'aa:bb:cc:dd:ee:ff', 'TokenAuthSupport': token},
});

const _lgXml = '''<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><device>
<deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType>
<friendlyName>Den &amp; Bar</friendlyName>
<manufacturer>LG Electronics</manufacturer>
<modelName>OLED55C1PTB</modelName><modelNumber>OLED55C1</modelNumber>
</device></root>''';

const _rokuXml = '''<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
<default-device-name>Roku Ultra - 1GH</default-device-name>
<friendly-device-name>Bedroom Roku</friendly-device-name>
<user-device-name>Kitchen</user-device-name>
<model-name>Roku Ultra</model-name>
</device-info>''';

void main() {
  late int closed;
  late BrandPorts ports;
  final stop = <Future<void> Function()>[];

  setUp(() async {
    closed = await _closedPort();
    ports = BrandPorts(
      samsungRest: closed,
      samsungWss: 9002,
      lgWs: closed,
      lgWss: closed,
      roku: closed,
      androidTv: closed,
      fireAdb: 5555,
    );
  });

  tearDown(() async {
    for (final s in stop) {
      await s();
    }
    stop.clear();
  });

  Future<_Http> serve(Map<String, String> routes) async {
    final http = await _Http.start(routes);
    stop.add(http.stop);
    return http;
  }

  BrandDiscovery discovery({
    List<SsdpResponse> ssdp = const [],
    List<NsdSighting> nsd = const [],
    BrandPorts? withPorts,
  }) => BrandDiscovery(
    ssdp: _FakeSsdp(ssdp),
    nsd: _FakeNsd(nsd),
    ports: withPorts ?? ports,
    window: const Duration(milliseconds: 300),
    httpTimeout: const Duration(milliseconds: 400),
  );

  group('SsdpResponse.parse', () {
    test('reads headers whatever their case, with CRLF, LF or CR line ends', () {
      for (final eol in ['\r\n', '\n', '\r']) {
        final raw = [
          'HTTP/1.1 200 OK',
          'Location: http://1.2.3.4:9/d.xml',
          'server: Roku/9',
          'sT: roku:ecp',
          'usn: uuid:1',
          '',
          '',
        ].join(eol);
        final r = SsdpResponse.parse(raw, '1.2.3.4')!;
        expect(r.location, 'http://1.2.3.4:9/d.xml', reason: 'eol ${jsonEncode(eol)}');
        expect(r.server, 'Roku/9');
        expect(r.st, 'roku:ecp');
        expect(r.usn, 'uuid:1');
        expect(r.address, '1.2.3.4');
      }
    });

    test('a missing LOCATION is null, a colon inside a value is kept, the first copy of a header wins', () {
      final r = SsdpResponse.parse('HTTP/1.1 200 OK\r\nST: a\r\nST: b\r\nUSN: uuid:x::urn:y\r\n\r\n', '1.1.1.1')!;
      expect(r.location, isNull);
      expect(r.st, 'a');
      expect(r.usn, 'uuid:x::urn:y');
      expect(SsdpResponse.parse('LOCATION:   \r\nST: a\r\n', '1.1.1.1')!.location, isNull);
    });

    test('text with no header line gives null', () {
      expect(SsdpResponse.parse('', '1.1.1.1'), isNull);
      expect(SsdpResponse.parse('HTTP/1.1 200 OK\r\n\r\n', '1.1.1.1'), isNull);
      expect(SsdpResponse.parse('garbage without colons', '1.1.1.1'), isNull);
    });
  });

  group('classification', () {
    test('Samsung by ST, by SERVER and by USN; LG by ST and by SERVER; Roku by ST and by SERVER', () {
      TvKind? kind(SsdpResponse r) => BrandDiscovery.classifySsdp(r);
      expect(kind(_ssdp('1.1.1.1', st: _samsungSt)), TvKind.samsung);
      expect(kind(_ssdp('1.1.1.1', st: _dialSt, server: 'SHP, UPnP/1.0, Samsung UPnP SDK/1.0')), TvKind.samsung);
      expect(kind(_ssdp('1.1.1.1', st: _dialSt, usn: 'uuid:1::Tizen')), TvKind.samsung);
      expect(kind(_ssdp('1.1.1.1', st: _lgSt)), TvKind.lg);
      expect(kind(_ssdp('1.1.1.1', st: _dialSt, server: 'Linux/3.10 UPnP/1.0 WebOS/4.0 DLNADOC/1.50')), TvKind.lg);
      expect(kind(_ssdp('1.1.1.1', st: _dialSt, server: 'LG Electronics UPnP/1.0')), TvKind.lg);
      expect(kind(_ssdp('1.1.1.1', st: 'roku:ecp')), TvKind.roku);
      expect(kind(_ssdp('1.1.1.1', st: _dialSt, server: 'Roku/9.4.0 UPnP/1.0 Roku/9.4.0')), TvKind.roku);
    });

    test('DIAL answers from Chromecast and Fire TV are ignored', () {
      expect(
        BrandDiscovery.classifySsdp(_ssdp('1.1.1.1', st: _dialSt, server: 'Linux/3.8 UPnP/1.0 Chromecast/1.0')),
        isNull,
      );
      expect(
        BrandDiscovery.classifySsdp(_ssdp('1.1.1.1', st: _dialSt, server: 'Linux/4.9 UPnP/1.0 Amazon-Fire-TV')),
        isNull,
      );
      expect(BrandDiscovery.classifySsdp(_ssdp('1.1.1.1', st: _dialSt)), isNull);
    });
  });

  group('run: identification', () {
    test('Samsung: name loses "[TV] ", model and MAC come along, port 8002 with TokenAuthSupport', () async {
      final tv = await serve({'/api/v2/': _samsungJson()});
      final p = BrandPorts(samsungRest: tv.port, samsungWss: 9002);
      final found = await discovery(
        withPorts: p,
        ssdp: [_ssdp('127.0.0.1', st: _samsungSt, location: 'http://127.0.0.1:${tv.port}/dmr')],
      ).run((_) {});
      expect(found, [
        const BrandFound(
          kind: TvKind.samsung,
          name: 'Samsung 7 Series (55)',
          address: '127.0.0.1',
          port: 9002,
          model: 'QA55Q60T',
          mac: 'aa:bb:cc:dd:ee:ff',
        ),
      ]);
    });

    test('Samsung without TokenAuthSupport stays on the plain port', () async {
      final tv = await serve({'/api/v2/': _samsungJson(name: 'Hall', token: 'false')});
      final found = await discovery(
        withPorts: BrandPorts(samsungRest: tv.port, samsungWss: 9002),
        ssdp: [_ssdp('127.0.0.1', st: _samsungSt)],
      ).run((_) {});
      expect(found.single.name, 'Hall');
      expect(found.single.port, tv.port);
    });

    test('LG: friendlyName (entities undone) and modelName from the description at LOCATION, port 3001', () async {
      final tv = await serve({'/desc.xml': _lgXml});
      final found = await discovery(
        withPorts: BrandPorts(lgWss: 3001),
        ssdp: [_ssdp('127.0.0.1', st: _lgSt, location: 'http://127.0.0.1:${tv.port}/desc.xml')],
      ).run((_) {});
      expect(found.single.kind, TvKind.lg);
      expect(found.single.name, 'Den & Bar');
      expect(found.single.model, 'OLED55C1PTB');
      expect(found.single.port, 3001);
    });

    test('LG: modelNumber is the fallback model', () async {
      final tv = await serve({'/d': '<friendlyName>Den</friendlyName><modelNumber>C1</modelNumber>'});
      final found = await discovery(
        ssdp: [_ssdp('127.0.0.1', st: _lgSt, location: 'http://127.0.0.1:${tv.port}/d')],
      ).run((_) {});
      expect(found.single.model, 'C1');
    });

    test('LG: a LOCATION naming another machine is not fetched; the answer falls back to "LG TV"', () async {
      final found = await discovery(
        ssdp: [_ssdp('127.0.0.1', st: _lgSt, location: 'http://127.0.0.2:$closed/d.xml')],
      ).run((_) {});
      expect(found.single.name, 'LG TV');
    });

    test('Roku: user name first, then friendly, then default; model-name; port 8060 from ports', () async {
      final tv = await serve({'/query/device-info': _rokuXml});
      final p = BrandPorts(roku: tv.port);
      final found = await discovery(
        withPorts: p,
        ssdp: [_ssdp('127.0.0.1', st: 'roku:ecp')],
      ).run((_) {});
      expect(
        found.single,
        BrandFound(kind: TvKind.roku, name: 'Kitchen', address: '127.0.0.1', port: tv.port, model: 'Roku Ultra'),
      );

      await tv.stop();
      final tv2 = await serve({
        '/query/device-info': '<device-info><friendly-device-name>Bed</friendly-device-name><default-device-name>X</default-device-name></device-info>',
      });
      final again = await discovery(
        withPorts: BrandPorts(roku: tv2.port),
        ssdp: [_ssdp('127.0.0.1', st: 'roku:ecp')],
      ).run((_) {});
      expect(again.single.name, 'Bed');
    });

    test('a failed identification still reports the TV with the make name and the address', () async {
      final found = await discovery(
        ssdp: [
          _ssdp('127.0.0.1', st: _samsungSt),
          _ssdp('127.0.0.2', st: _lgSt),
          _ssdp('127.0.0.3', st: 'roku:ecp'),
        ],
      ).run((_) {});
      expect(found.map((f) => (f.kind, f.name, f.address)), [
        (TvKind.lg, 'LG TV', '127.0.0.2'),
        (TvKind.roku, 'Roku', '127.0.0.3'),
        (TvKind.samsung, 'Samsung TV', '127.0.0.1'),
      ]);
    });

    test('a 404 or a body in the wrong shape counts as a failed identification', () async {
      final tv = await serve({'/api/v2/': '{"nothing":1}'});
      final found = await discovery(
        withPorts: BrandPorts(samsungRest: tv.port),
        ssdp: [_ssdp('127.0.0.1', st: _samsungSt)],
      ).run((_) {});
      expect(found.single.name, 'Samsung TV');
    });

    test('ignored DIAL answers add nothing', () async {
      final found = await discovery(
        ssdp: [
          _ssdp('127.0.0.1', st: _dialSt, server: 'Linux UPnP/1.0 Chromecast/1.0'),
          _ssdp('127.0.0.2', st: _dialSt, server: 'Linux UPnP/1.0 Amazon-Fire-TV'),
        ],
      ).run((_) {});
      expect(found, isEmpty);
    });
  });

  group('run: mDNS', () {
    test('Android TV: service name and port from the service; default 6466 when the service has none', () async {
      final found = await discovery(
        withPorts: const BrandPorts(),
        nsd: const [
          NsdSighting(type: '_androidtvremote2._tcp', name: 'Living Room TV', address: '10.0.0.5', port: 6467),
          NsdSighting(type: '_androidtvremote2._tcp', name: 'Study', address: '10.0.0.6'),
        ],
      ).run((_) {});
      expect(found, const [
        BrandFound(kind: TvKind.androidtv, name: 'Living Room TV', address: '10.0.0.5', port: 6467),
        BrandFound(kind: TvKind.androidtv, name: 'Study', address: '10.0.0.6', port: 6466),
      ]);
    });

    test('Fire TV: TXT n when present, else the service name; port 5555', () async {
      final found = await discovery(
        nsd: const [
          NsdSighting(type: '_amzn-wplay._tcp', name: 'amzn-1234', address: '10.0.0.7', txt: {'n': 'Fire TV Stick'}),
          NsdSighting(type: '_amzn-wplay._tcp', name: 'amzn-9999', address: '10.0.0.8'),
        ],
      ).run((_) {});
      expect(found.map((f) => (f.kind, f.name, f.address, f.port)), [
        (TvKind.firetv, 'amzn-9999', '10.0.0.8', 5555),
        (TvKind.firetv, 'Fire TV Stick', '10.0.0.7', 5555),
      ]);
    });

    test('other service types are ignored', () async {
      final found = await discovery(
        nsd: const [NsdSighting(type: '_googlecast._tcp', name: 'Cast', address: '10.0.0.5')],
      ).run((_) {});
      expect(found, isEmpty);
    });
  });

  group('run: merging, order, updates', () {
    test('the same address from SSDP twice and from mDNS is one TV', () async {
      final tv = await serve({'/api/v2/': _samsungJson(name: 'Hall')});
      final p = BrandPorts(samsungRest: tv.port);
      final found = await discovery(
        withPorts: p,
        ssdp: [
          _ssdp('127.0.0.1', st: _samsungSt),
          _ssdp('127.0.0.1', st: _dialSt, server: 'Samsung UPnP SDK/1.0'),
        ],
        nsd: const [NsdSighting(type: '_androidtvremote2._tcp', name: 'Phantom', address: '127.0.0.1')],
      ).run((_) {});
      expect(found, hasLength(1));
      // The Samsung identified itself (confirmed); the Android TV advert is weaker and loses.
      expect(found.single.kind, TvKind.samsung);
      expect(found.single.name, 'Hall');
      // Only one identification was made for the repeated answers.
      expect(tv.hits.where((h) => h == '/api/v2/'), hasLength(1));
    });

    test('a Fire TV advert (confirmed) beats an Android TV advert at the same address', () async {
      final nsd = [
        const NsdSighting(type: '_androidtvremote2._tcp', name: 'AFTT', address: '10.0.0.4'),
        const NsdSighting(type: '_amzn-wplay._tcp', name: 'amzn', address: '10.0.0.4', txt: {'n': 'Fire TV'}),
      ];
      final a = await discovery(nsd: nsd).run((_) {});
      final b = await discovery(nsd: nsd.reversed.toList()).run((_) {});
      for (final found in [a, b]) {
        expect(found.single.kind, TvKind.firetv);
        expect(found.single.name, 'Fire TV');
      }
    });

    test('an Android TV advert beats an unconfirmed SSDP guess at the same address', () async {
      // The SSDP answer comes from loopback (its question fails fast on the closed port) so it is only a guess.
      final found = await discovery(
        ssdp: [_ssdp('127.0.0.1', st: 'roku:ecp')],
        nsd: const [NsdSighting(type: '_androidtvremote2._tcp', name: 'Nvidia Shield', address: '127.0.0.1')],
      ).run((_) {});
      expect(found.single.kind, TvKind.androidtv);
      expect(found.single.name, 'Nvidia Shield');
    });

    test('a Roku identified from its device-info carries its model', () async {
      final tv = await serve({'/query/device-info': _rokuXml});
      final found = await discovery(
        withPorts: BrandPorts(roku: tv.port),
        ssdp: [_ssdp('127.0.0.1', st: 'roku:ecp')],
      ).run((_) {});
      expect(found.single.model, 'Roku Ultra');
    });

    test('sorted by name (case-blind), then by address', () async {
      final found = await discovery(
        nsd: const [
          NsdSighting(type: '_androidtvremote2._tcp', name: 'zeta', address: '10.0.0.1'),
          NsdSighting(type: '_androidtvremote2._tcp', name: 'Alpha', address: '10.0.0.30'),
          NsdSighting(type: '_androidtvremote2._tcp', name: 'alpha', address: '10.0.0.2'),
          NsdSighting(type: '_androidtvremote2._tcp', name: 'Beta', address: '10.0.0.3'),
        ],
      ).run((_) {});
      expect(found.map((f) => f.address), ['10.0.0.2', '10.0.0.30', '10.0.0.3', '10.0.0.1']);
    });

    test('onUpdate fires each time the list grows, with the list so far', () async {
      final seen = <List<String>>[];
      await discovery(
        nsd: const [
          NsdSighting(type: '_androidtvremote2._tcp', name: 'B', address: '10.0.0.2'),
          NsdSighting(type: '_androidtvremote2._tcp', name: 'B again', address: '10.0.0.2'),
          NsdSighting(type: '_androidtvremote2._tcp', name: 'A', address: '10.0.0.1'),
        ],
      ).run((sofar) => seen.add(sofar.map((f) => f.name).toList()));
      expect(seen, [
        ['B'],
        ['A', 'B'],
      ]);
    });

    test('never throws: a failing source and a throwing listener still give the other source\'s TVs', () async {
      final d = BrandDiscovery(
        ssdp: _FakeSsdp(const [], fail: true),
        nsd: _FakeNsd(const [NsdSighting(type: '_androidtvremote2._tcp', name: 'Ok', address: '10.0.0.1')]),
        ports: ports,
        window: const Duration(milliseconds: 200),
        httpTimeout: const Duration(milliseconds: 200),
      );
      final found = await d.run((_) => throw StateError('listener bug'));
      expect(found.single.name, 'Ok');
    });

    test('nothing on the network gives an empty list, and a source that never ends is cut at the window', () async {
      final d = BrandDiscovery(
        ssdp: _Endless(),
        nsd: _FakeNsd(const []),
        ports: ports,
        window: const Duration(milliseconds: 200),
        httpTimeout: const Duration(milliseconds: 200),
      );
      final watch = Stopwatch()..start();
      expect(await d.run((_) {}), isEmpty);
      expect(watch.elapsed, lessThan(const Duration(seconds: 3)));
    });
  });

  group('probe', () {
    test('Samsung by its REST answer', () async {
      final tv = await serve({'/api/v2/': _samsungJson()});
      final found = await discovery(
        withPorts: BrandPorts(
          samsungRest: tv.port,
          samsungWss: 9002,
          roku: closed,
          lgWs: closed,
          lgWss: closed,
          androidTv: closed,
        ),
      ).probe('127.0.0.1');
      expect(found?.kind, TvKind.samsung);
      expect(found?.name, 'Samsung 7 Series (55)');
      expect(found?.port, 9002);
    });

    test('Roku by device-info', () async {
      final tv = await serve({'/query/device-info': _rokuXml});
      final found = await discovery(
        withPorts: BrandPorts(roku: tv.port, samsungRest: closed, lgWs: closed, lgWss: closed, androidTv: closed),
      ).probe('127.0.0.1');
      expect(found?.kind, TvKind.roku);
      expect(found?.name, 'Kitchen');
    });

    test('LG by a WebSocket upgrade on the plain port', () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      stop.add(() => server.close(force: true));
      server.listen((request) async {
        if (WebSocketTransformer.isUpgradeRequest(request)) {
          final socket = await WebSocketTransformer.upgrade(request);
          await socket.close();
        } else {
          request.response.statusCode = 400;
          await request.response.close();
        }
      });
      final found = await discovery(
        withPorts: BrandPorts(lgWs: server.port, lgWss: closed, samsungRest: closed, roku: closed, androidTv: closed),
      ).probe('127.0.0.1');
      expect(found?.kind, TvKind.lg);
      expect(found?.name, 'LG TV');
    });

    test('LG by TCP 3001 opening, when the plain port does not answer', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      stop.add(() async => server.close().then((_) {}));
      server.listen((s) => s.destroy());
      final found = await discovery(
        withPorts: BrandPorts(lgWs: closed, lgWss: server.port, samsungRest: closed, roku: closed, androidTv: closed),
      ).probe('127.0.0.1');
      expect(found?.kind, TvKind.lg);
      expect(found?.port, server.port);
    });

    test('Android TV by TCP 6466 opening', () async {
      final server = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      stop.add(() async => server.close().then((_) {}));
      server.listen((s) => s.destroy());
      final found = await discovery(
        withPorts: BrandPorts(androidTv: server.port, lgWs: closed, lgWss: closed, samsungRest: closed, roku: closed),
      ).probe('127.0.0.1');
      expect(found?.kind, TvKind.androidtv);
      expect(found?.port, server.port);
    });

    test('order of trust: Samsung beats Roku beats Android TV when several answer', () async {
      final samsung = await serve({'/api/v2/': _samsungJson()});
      final roku = await serve({'/query/device-info': _rokuXml});
      final android = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      stop.add(() async => android.close().then((_) {}));
      android.listen((s) => s.destroy());
      final all = BrandPorts(
        samsungRest: samsung.port,
        roku: roku.port,
        androidTv: android.port,
        lgWs: closed,
        lgWss: closed,
      );
      expect((await discovery(withPorts: all).probe('127.0.0.1'))?.kind, TvKind.samsung);
      final noSamsung = BrandPorts(
        samsungRest: closed,
        roku: roku.port,
        androidTv: android.port,
        lgWs: closed,
        lgWss: closed,
      );
      expect((await discovery(withPorts: noSamsung).probe('127.0.0.1'))?.kind, TvKind.roku);
    });

    test('nothing answering gives null, and an open 5555 alone is not a Fire TV', () async {
      final adb = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
      stop.add(() async => adb.close().then((_) {}));
      adb.listen((s) => s.destroy());
      final p = BrandPorts(
        samsungRest: closed,
        roku: closed,
        lgWs: closed,
        lgWss: closed,
        androidTv: closed,
        fireAdb: adb.port,
      );
      expect(await discovery(withPorts: p).probe('127.0.0.1'), isNull);
      expect(await discovery(withPorts: p).probe('   '), isNull);
    });
  });

  group('UdpSsdpSearch', () {
    test('message is the exact M-SEARCH text', () {
      expect(
        UdpSsdpSearch.message('roku:ecp'),
        'M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: roku:ecp\r\n\r\n',
      );
      expect(UdpSsdpSearch.searchTargets, [
        'urn:samsung.com:device:RemoteControlReceiver:1',
        'urn:lge-com:service:webos-second-screen:1',
        'roku:ecp',
        'urn:dial-multiscreen-org:service:dial:1',
      ]);
    });

    test('sends every ST twice to its target, and reads a unicast answer, all on loopback', () async {
      final receiver = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(receiver.close);
      final got = <String>[];
      receiver.listen((event) {
        if (event != RawSocketEvent.read) return;
        final datagram = receiver.receive();
        if (datagram == null) return;
        got.add(utf8.decode(datagram.data));
        // Answer like a TV: unicast back to the sender's own port.
        receiver.send(
          utf8.encode('HTTP/1.1 200 OK\r\nlocation: http://127.0.0.1:1/x\r\nst: roku:ecp\r\n\r\n'),
          datagram.address,
          datagram.port,
        );
      });
      final search = UdpSsdpSearch(
        target: InternetAddress.loopbackIPv4,
        port: receiver.port,
        gap: const Duration(milliseconds: 50),
      );
      final answers = await search.search(const Duration(milliseconds: 400)).toList();
      expect(got, hasLength(UdpSsdpSearch.searchTargets.length * 2));
      for (final st in UdpSsdpSearch.searchTargets) {
        expect(got.where((m) => m == UdpSsdpSearch.message(st)), hasLength(2), reason: st);
      }
      expect(answers, isNotEmpty);
      expect(answers.first.address, '127.0.0.1');
      expect(answers.first.st, 'roku:ecp');
      expect(answers.first.location, 'http://127.0.0.1:1/x');
    });
  });
}

/// A source that never ends, to show the window cuts it off.
class _Endless implements SsdpSearch {
  @override
  Stream<SsdpResponse> search(Duration window) => StreamController<SsdpResponse>().stream;
}
