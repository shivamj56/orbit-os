// A small stand-in for the TV's door (phone/SPEC.md, "The TV's door"), on 127.0.0.1 with a random port, plus its
// pointer datagram port. It behaves like launcher/.../PortalHttp.java + PhonePortal.java where the app can tell:
// 401 without a known token, 409/403/429 when pairing, 415 for a body that is not JSON, 501 for a chunked body, 403
// for a foreign Origin. Tests can revoke tokens, make it drop connections (offline) or hang (timeouts).
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

class RecordedRequest {
  RecordedRequest(this.method, this.path, this.query, this.headers, this.body);

  final String method;
  final String path;
  final Map<String, String> query;

  /// Lower-case names, as the door reads them.
  final Map<String, String> headers;
  final String body;
}

class MockTv {
  MockTv._(this._server, this._udp);

  final HttpServer _server;
  final RawDatagramSocket _udp;

  String name = 'Family room';

  /// The code the next askcode shows.
  String nextCode = '123456';
  String? shownCode;
  int wrongCodes = 0;
  final Set<String> tokens = {};
  final List<RecordedRequest> requests = [];
  final List<String> keys = [];
  final List<String> datagrams = [];
  int volume = 12;

  /// Close every connection without an answer (the TV went away).
  bool unreachable = false;

  /// Never answer (a TV that hangs).
  bool hang = false;

  /// Help mode (POST /api/help): while on, GET /api/screen answers [screen] with `x-screen-seq: [screenSeq]`.
  bool helpOn = false;
  int screenSeq = 1;
  Uint8List screen = fakeJpeg;

  int get port => _server.port;

  int get udpPort => _udp.port;

  static final Uint8List fakePng = Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4]);

  /// The head of a 640 x 360 JPEG: SOI, a JFIF APP0, a baseline frame header (SOF0), then EOI.
  static final Uint8List fakeJpeg = Uint8List.fromList([
    0xFF, 0xD8, //
    0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xFF, 0xC0, 0x00, 0x11, 0x08, 0x01, 0x68, 0x02, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xFF, 0xD9,
  ]);

  /// The TV's screen changed: the next picture (another seq, other bytes).
  void nextScreen() {
    screenSeq++;
    screen = Uint8List.fromList([...fakeJpeg.sublist(0, fakeJpeg.length - 2), screenSeq & 0xFF, 0xFF, 0xD9]);
  }

  static Future<MockTv> start() async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final udp = await RawDatagramSocket.bind(InternetAddress.loopbackIPv4, 0);
    final tv = MockTv._(server, udp);
    server.listen(tv._handle);
    udp.listen((event) {
      if (event != RawSocketEvent.read) return;
      final datagram = udp.receive();
      if (datagram != null) tv.datagrams.add(ascii.decode(datagram.data));
    });
    return tv;
  }

  void revokeAll() => tokens.clear();

  List<RecordedRequest> to(String path) => [
    for (final r in requests)
      if (r.path == path) r,
  ];

  Future<void> close() async {
    await _server.close(force: true);
    _udp.close();
  }

  Future<void> _handle(HttpRequest request) async {
    final body = await utf8.decodeStream(request);
    final headers = <String, String>{};
    request.headers.forEach((name, values) => headers[name.toLowerCase()] = values.join(','));
    requests.add(RecordedRequest(request.method, request.uri.path, request.uri.queryParameters, headers, body));
    if (unreachable) {
      final socket = await request.response.detachSocket(writeHeaders: false);
      socket.destroy();
      return;
    }
    if (hang) return;
    final response = request.response;
    try {
      final answer = _answer(request.method, request.uri, headers, body);
      response.statusCode = answer.status;
      response.headers.contentType = answer.type;
      answer.headers.forEach(response.headers.set);
      response.add(answer.bytes);
    } finally {
      await response.close();
    }
  }

  _Answer _answer(String method, Uri uri, Map<String, String> headers, String body) {
    final origin = headers['origin'];
    if (origin != null && origin != 'http://${headers['host']}') {
      return _fail(403, 'Requests from other pages are not taken.');
    }
    if (headers.containsKey('transfer-encoding')) return _fail(501, 'Send the body with a Content-Length.');
    Map<String, Object?> json = const {};
    if (body.isNotEmpty) {
      if (!(headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
        return _fail(415, 'Send the body as JSON.');
      }
      final decoded = jsonDecode(body);
      if (decoded is! Map) return _fail(400, 'The request was not a JSON object.');
      json = {for (final e in decoded.entries) '${e.key}': e.value};
    }
    final path = uri.path;
    if (method == 'POST' && path == '/api/askcode') {
      shownCode = nextCode;
      wrongCodes = 0;
      return _ok();
    }
    if (method == 'POST' && path == '/api/pair') {
      final code = shownCode;
      if (code == null) return _fail(409, 'There is no pairing code on the TV now. Ask the TV for one.');
      if (json['code'] != code) {
        wrongCodes++;
        if (wrongCodes >= 5) {
          shownCode = null;
          return _fail(429, 'Too many wrong codes. Ask the TV for a new one.');
        }
        final left = 5 - wrongCodes;
        return _fail(403, 'That is not the code on the TV. ${left == 1 ? 'One try left.' : '$left tries left.'}');
      }
      shownCode = null;
      final random = Random.secure();
      final token = List.generate(16, (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
      tokens.add(token);
      return _ok({'token': token});
    }
    final token = headers['x-portal-token'] ?? uri.queryParameters['t'];
    if (token == null || !tokens.contains(token)) return _fail(401, 'This phone is not paired with the TV.');
    switch ((method, path)) {
      case ('GET', '/api/state'):
        return _ok({
          'tv': name,
          'app': 'YouTube',
          'pkg': 'com.google.android.youtube.tv',
          'title': 'A "quoted" title\n</script>',
          'artist': 'Someone',
          'playing': true,
          'position': 12345,
          'duration': 600000,
          'player': 'YouTube',
          'volume': volume,
          'max': 100,
          'muted': false,
          'udp': udpPort,
          'pointer': true,
        });
      case ('GET', '/api/apps'):
        return _Answer(
          200,
          ContentType.json,
          utf8.encode(
            jsonEncode([
              {'pkg': 'com.netflix.ninja', 'label': 'Netflix'},
              {'pkg': 'com.google.android.youtube.tv', 'label': 'YouTube'},
            ]),
          ),
        );
      case ('GET', '/api/icon'):
        final pkg = uri.queryParameters['pkg'];
        if (pkg != 'com.netflix.ninja') return _fail(404, 'That app has no picture.');
        return _Answer(200, ContentType('image', 'png'), fakePng);
      case ('POST', '/api/key'):
        final key = json['key'];
        if (key is! String) return _fail(400, 'Unknown key.');
        keys.add(key);
        if (key == 'volup') volume = min(100, volume + 3);
        if (key == 'voldown') volume = max(0, volume - 3);
        return key == 'volup' || key == 'voldown' ? _ok({'volume': volume, 'max': 100, 'muted': false}) : _ok();
      case ('POST', '/api/volume'):
        final level = json['level'];
        if (level is! num) return _fail(400, 'The level must be a number.');
        volume = level.round().clamp(0, 100);
        return _ok({'volume': volume, 'max': 100});
      case ('POST', '/api/help'):
        final on = json['on'];
        if (on is! bool) return _fail(400, 'Send "on" as true or false.');
        helpOn = on;
        return _ok({'on': on});
      case ('GET', '/api/screen'):
        if (!helpOn) return _fail(404, 'Help is off.');
        return _Answer(200, ContentType('image', 'jpeg'), screen, headers: {'x-screen-seq': '$screenSeq'});
      case ('POST', '/api/media' || '/api/type' || '/api/open' || '/api/launch' || '/api/sleep' || '/api/pointer'):
        return _ok();
      default:
        return _fail(404, 'There is nothing here.');
    }
  }

  static _Answer _ok([Map<String, Object?> more = const {}]) =>
      _Answer(200, ContentType.json, utf8.encode(jsonEncode({'ok': true, ...more})));

  static _Answer _fail(int status, String error) =>
      _Answer(status, ContentType.json, utf8.encode(jsonEncode({'ok': false, 'error': error})));
}

class _Answer {
  _Answer(this.status, this.type, this.bytes, {this.headers = const {}});

  final int status;
  final ContentType type;
  final List<int> bytes;
  final Map<String, String> headers;
}

/// Waits until [condition] holds (polling every 10 ms), failing after [timeout].
Future<void> eventually(
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 5),
  String? what,
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) throw TimeoutException('never happened: ${what ?? 'condition'}', timeout);
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}
