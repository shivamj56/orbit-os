import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// The TV answered, but not with a 2xx: [message] is the TV's own `error` text when it sent one.
class TvHttpException implements Exception {
  const TvHttpException(this.status, this.message, {this.body});

  final int status;
  final String message;

  /// The answer's body as JSON, when it was JSON.
  final Object? body;

  /// True when the answer came from the TV's door: a JSON object whose `ok` is false.
  bool get fromDoor {
    final json = body;
    return json is Map && json['ok'] == false;
  }

  @override
  String toString() => 'TvHttpException($status, $message)';
}

/// No answer to use: refused, reset, timed out, or the phone is not on a network that reaches the TV.
class TvUnreachableException implements Exception {
  const TvUnreachableException(this.cause);

  final Object cause;

  @override
  String toString() => 'TvUnreachableException($cause)';
}

/// A 2xx answer from the TV.
class TvReply {
  TvReply(this.status, this.contentType, this.bytes, {this.headers = const {}});

  final int status;

  /// The media type without parameters, lower case ("application/json", "image/png").
  final String contentType;
  final Uint8List bytes;

  /// The answer's headers, names in lower case (`x-screen-seq` on a picture of the TV's screen).
  final Map<String, String> headers;

  /// The body as JSON, or null when it is not JSON.
  Object? get json => decodeJson(bytes);

  static Object? decodeJson(List<int> bytes) {
    if (bytes.isEmpty) return null;
    try {
      return jsonDecode(utf8.decode(bytes));
    } on FormatException {
      return null;
    }
  }
}

/// The TV's door (phone/SPEC.md, "The TV's door"): plain HTTP/1.1, one request per connection.
///
/// Every request names the TV by address in Host (dart:io does that), carries JSON bodies with exactly
/// `Content-Type: application/json` and a Content-Length (the door refuses chunked bodies), sends `x-portal-token`
/// once paired, and never sends an Origin header. Each request gets a fresh connection (`Connection: close`), which is
/// what the door does anyway, so a closed keep-alive socket can never fail the next request.
class TvClient {
  TvClient({http.Client? client, this.timeout = const Duration(seconds: 4), this.maxBody = 8 << 20})
    : _client = client ?? IOClient(_defaultHttpClient(const Duration(seconds: 4)));

  /// The whole request, connect to last byte.
  final Duration timeout;

  /// A body larger than this is not read (an app banner is ~50 kB, the apps list a few kB).
  final int maxBody;
  final http.Client _client;

  static HttpClient _defaultHttpClient(Duration connect) => HttpClient()
    ..connectionTimeout = connect
    ..idleTimeout = const Duration(seconds: 1)
    ..maxConnectionsPerHost = 6
    ..autoUncompress = true
    ..userAgent = 'Orbit/1.0 (Android)';

  /// One request to `http://[address]:[port][path]`. Throws [TvHttpException] for a non-2xx answer and
  /// [TvUnreachableException] when nothing usable came back within [timeout].
  Future<TvReply> request(
    String method,
    String address,
    int port,
    String path, {
    Map<String, String>? query,
    Object? json,
    String? token,
    Duration? timeout,
  }) async {
    final limit = timeout ?? this.timeout;
    final Uri uri;
    try {
      uri = Uri(scheme: 'http', host: address, port: port, path: path, queryParameters: query);
    } on FormatException catch (e) {
      throw TvUnreachableException(e);
    }
    final abort = Completer<void>();
    final request = http.AbortableRequest(method, uri, abortTrigger: abort.future)
      ..persistentConnection = false
      ..followRedirects = false;
    if (token != null) request.headers['x-portal-token'] = token;
    if (json != null) {
      // bodyBytes, not body: the body setter would add "; charset=utf-8" to the content type.
      request.headers['content-type'] = 'application/json';
      request.bodyBytes = utf8.encode(jsonEncode(json));
    }
    final timer = Timer(limit, () {
      if (!abort.isCompleted) abort.complete();
    });
    try {
      final response = await _client.send(request).timeout(limit + const Duration(milliseconds: 500));
      final bytes = await _readCapped(response.stream, maxBody).timeout(limit + const Duration(milliseconds: 500));
      final type = (response.headers['content-type'] ?? '').split(';').first.trim().toLowerCase();
      if (response.statusCode < 200 || response.statusCode > 299) {
        final body = TvReply.decodeJson(bytes);
        throw TvHttpException(response.statusCode, errorText(response.statusCode, body), body: body);
      }
      return TvReply(response.statusCode, type, bytes, headers: response.headers);
    } on TvHttpException {
      rethrow;
    } on TimeoutException catch (e) {
      throw TvUnreachableException(e);
    } on SocketException catch (e) {
      throw TvUnreachableException(e);
    } on HttpException catch (e) {
      throw TvUnreachableException(e);
    } on http.ClientException catch (e) {
      throw TvUnreachableException(e);
    } on OSError catch (e) {
      throw TvUnreachableException(e);
    } finally {
      timer.cancel();
      if (!abort.isCompleted) abort.complete();
    }
  }

  /// GET, and the body as JSON (throws [TvHttpException] 502 when it is not JSON).
  Future<Object?> getJson(String address, int port, String path, {String? token, Map<String, String>? query}) async {
    final reply = await request('GET', address, port, path, token: token, query: query);
    return _jsonOf(reply);
  }

  /// POST a JSON body, and the answer as JSON.
  Future<Object?> postJson(String address, int port, String path, Object body, {String? token}) async {
    final reply = await request('POST', address, port, path, json: body, token: token);
    return _jsonOf(reply);
  }

  void close() => _client.close();

  static Object? _jsonOf(TvReply reply) {
    final json = reply.json;
    if (json == null) throw const TvHttpException(502, 'The TV sent an answer Orbit cannot read.');
    return json;
  }

  static Future<Uint8List> _readCapped(Stream<List<int>> stream, int cap) async {
    final out = BytesBuilder(copy: false);
    await for (final chunk in stream) {
      out.add(chunk);
      if (out.length > cap) throw const TvHttpException(502, 'The TV sent more than Orbit takes.');
    }
    return out.takeBytes();
  }

  /// The TV's own `error` text, or a plain sentence for the status.
  static String errorText(int status, Object? body) {
    if (body is Map) {
      final error = body['error'];
      if (error is String && error.trim().isNotEmpty) return error.trim();
    }
    return switch (status) {
      400 => 'The TV did not understand that.',
      401 => 'This phone is not paired with the TV.',
      403 => 'The TV said no.',
      404 => 'The TV does not have that.',
      405 => 'The TV does not take that request.',
      409 => 'The TV could not do that right now.',
      413 => 'That is more than the TV takes.',
      415 => 'The TV wants that as JSON.',
      429 => 'Too many tries. Wait a moment and try again.',
      >= 500 => 'Something went wrong on the TV.',
      _ => 'The TV answered $status.',
    };
  }
}
