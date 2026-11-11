/// Backups of a TV's own setup in the person's own Google Drive (phone/SPEC.md, "Backups in Google Drive"): one small
/// JSON file per backup in Drive's hidden appDataFolder, through the Drive REST API v3 with an OAuth access token for
/// the drive.appdata scope (Google's own sheet asks for it once). Plain `http`; no Drive SDK.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

/// Drive's scope for an app's own hidden folder: Orbit sees only the files it made there, nothing else in the Drive.
/// Google lists it as non-sensitive.
const String kDriveAppDataScope = 'https://www.googleapis.com/auth/drive.appdata';

/// Why a Drive op failed. [reason] is for the page to choose its way out by; [message] is for the person.
///
/// Reasons: `noAccount` (not signed in, or no Google account on the phone), `refused` (Drive access was not allowed),
/// `full` (the Drive has no room), `offline`, `auth` (Google did not accept the access), `server`, `notFound`, `bad`.
class DriveError implements Exception {
  const DriveError(this.reason, this.message);

  final String reason;
  final String message;

  @override
  String toString() => 'DriveError($reason, $message)';
}

/// Access tokens for drive.appdata, for the Google account Orbit is signed in with.
abstract interface class DriveAuthorizer {
  /// A token for [email]'s Drive; Google's sheet asks the first time. With [prompt] false nothing is shown, and null
  /// means Drive was never allowed for Orbit (so Orbit has nothing there). Throws [DriveError].
  Future<String?> accessToken(String email, {bool prompt = true});

  /// Google said [token] is no good any more: the next [accessToken] gets a new one.
  Future<void> forget(String token);
}

/// One backup as the page hands it over, checked: the file's text, and what the list shows without opening the file
/// (Drive's appProperties).
class BackupUpload {
  BackupUpload._(this.text, this.bytes, this.tv, this.address, this.model, this.at);

  /// The page's file (`backupSave`): a JSON object of kind "orbit-tv-backup" with an undo record. Throws [DriveError]
  /// `bad` otherwise.
  factory BackupUpload.fromPage({
    required String text,
    required String tv,
    required String address,
    String? model,
    required int at,
  }) {
    Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException {
      throw const DriveError('bad', 'That is not an Orbit backup.');
    }
    if (decoded is! Map || decoded['kind'] != 'orbit-tv-backup') {
      throw const DriveError('bad', 'That is not an Orbit backup.');
    }
    final undo = decoded['undo'];
    if (undo is! List || undo.isEmpty || undo.any((l) => l is! String)) {
      throw const DriveError('bad', 'The backup has no record of what Orbit changed.');
    }
    final bytes = utf8.encode(text).length;
    if (bytes > maxBytes) throw const DriveError('bad', 'The backup is larger than Orbit allows.');
    return BackupUpload._(text, bytes, _short(tv.trim(), 80), _short(address.trim(), 64), _maybe(model), at);
  }

  /// Far more than a TV's record needs (one is about 6 KB).
  static const int maxBytes = 512 * 1024;

  /// The file as it goes to Drive, byte for byte.
  final String text;

  /// Its size: what it takes in the person's Drive.
  final int bytes;
  final String tv;
  final String address;
  final String? model;

  /// When the backup was made, ms since 1970.
  final int at;

  static String? _maybe(String? s) {
    final t = s?.trim();
    return t == null || t.isEmpty ? null : _short(t, 64);
  }

  /// Drive keeps at most 124 bytes per property, key and value together.
  static String _short(String s, int max) {
    var out = s;
    while (utf8.encode(out).length > max) {
      out = out.substring(0, out.length - 1);
    }
    return out;
  }

  /// "orbit-backup-family-room-20261111-120400.json" (UTC).
  String get fileName {
    final slug = tv.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-+|-+$'), '');
    final d = DateTime.fromMillisecondsSinceEpoch(at, isUtc: true);
    String two(int n) => n.toString().padLeft(2, '0');
    final stamp = '${d.year}${two(d.month)}${two(d.day)}-${two(d.hour)}${two(d.minute)}${two(d.second)}';
    return 'orbit-backup-${slug.isEmpty ? 'tv' : slug}-$stamp.json';
  }

  /// What the list reads without opening the file.
  Map<String, String> get appProperties => {
    'orbit': 'tv-backup',
    'v': '1',
    'tv': tv,
    'address': address,
    'model': ?model,
    'at': '$at',
  };

  /// files.create's metadata: in the hidden app folder.
  Map<String, Object?> get metadata => {
    'name': fileName,
    'parents': ['appDataFolder'],
    'mimeType': 'application/json',
    'appProperties': appProperties,
  };

  /// A multipart/related upload body: the metadata, then the file. Returns the Content-Type (with its boundary) and the
  /// body.
  (String, List<int>) multipart({String? boundary}) {
    final b = boundary ?? 'orbit-${math.Random.secure().nextInt(1 << 32).toRadixString(16)}${DateTime.now().microsecondsSinceEpoch}';
    final body = StringBuffer()
      ..write('--$b\r\n')
      ..write('Content-Type: application/json; charset=UTF-8\r\n\r\n')
      ..write(jsonEncode(metadata))
      ..write('\r\n--$b\r\n')
      ..write('Content-Type: application/json; charset=UTF-8\r\n\r\n')
      ..write(text)
      ..write('\r\n--$b--\r\n');
    return ('multipart/related; boundary=$b', utf8.encode(body.toString()));
  }
}

/// One backup as `backupList` lists it: `{"id","tv","address","model","at","size"}`.
Map<String, Object?> listedBackup(Map<String, Object?> file) {
  final props = file['appProperties'];
  final p = props is Map ? props : const <String, Object?>{};
  String? text(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
  final created = DateTime.tryParse('${file['createdTime'] ?? ''}')?.millisecondsSinceEpoch;
  return {
    'id': file['id'],
    'tv': text(p['tv']) ?? 'TV',
    'address': text(p['address']) ?? '',
    'model': text(p['model']),
    'at': int.tryParse('${p['at'] ?? ''}') ?? created ?? 0,
    'size': int.tryParse('${file['size'] ?? ''}') ?? 0,
  };
}

/// The Drive REST API v3, as Orbit's backups use it.
class DriveBackups {
  DriveBackups({required this.authorizer, http.Client? client, this.timeout = const Duration(seconds: 30)})
    : _client = client ?? http.Client();

  final DriveAuthorizer authorizer;
  final http.Client _client;
  final Duration timeout;

  static const String _api = 'https://www.googleapis.com/drive/v3';
  static const String _upload = 'https://www.googleapis.com/upload/drive/v3';
  static const String _fields = 'id,name,size,createdTime,appProperties';

  /// A Drive file id: what the page may hand back to [load] and [delete].
  static final RegExp fileId = RegExp(r'^[A-Za-z0-9_-]{8,200}$');

  /// The orbit backups only: other files in the folder (none today) are left alone.
  static const String _query = "appProperties has { key='orbit' and value='tv-backup' } and trashed = false";

  /// Uploads [upload] into [email]'s hidden app folder; the listed backup it became.
  Future<Map<String, Object?>> save(String email, BackupUpload upload) async {
    final response = await _send(email, (token) {
      final (type, body) = upload.multipart();
      return _client.post(
        Uri.parse('$_upload/files?uploadType=multipart&fields=$_fields'),
        headers: {'Authorization': 'Bearer $token', 'Content-Type': type},
        body: body,
      );
    });
    return listedBackup(_object(response));
  }

  /// Every Orbit backup in [email]'s app folder, newest first.
  Future<List<Map<String, Object?>>> list(String email, {bool prompt = true}) async {
    final out = <Map<String, Object?>>[];
    String? page;
    for (var round = 0; round < 20; round++) {
      final uri = Uri.parse('$_api/files').replace(
        queryParameters: {
          'spaces': 'appDataFolder',
          'q': _query,
          'fields': 'nextPageToken,files($_fields)',
          'orderBy': 'createdTime desc',
          'pageSize': '100',
          'pageToken': ?page,
        },
      );
      final answer = _object(
        await _send(email, (token) => _client.get(uri, headers: {'Authorization': 'Bearer $token'}), prompt: prompt),
      );
      final files = answer['files'];
      if (files is List) {
        for (final f in files) {
          if (f is Map) out.add(listedBackup({for (final e in f.entries) '${e.key}': e.value}));
        }
      }
      final next = answer['nextPageToken'];
      if (next is! String || next.isEmpty) break;
      page = next;
    }
    out.sort((a, b) => ((b['at'] as int?) ?? 0).compareTo((a['at'] as int?) ?? 0));
    return out;
  }

  /// One backup's text.
  Future<String> load(String email, String id) async {
    _checkId(id);
    final response = await _send(
      email,
      (token) => _client.get(Uri.parse('$_api/files/$id?alt=media'), headers: {'Authorization': 'Bearer $token'}),
    );
    if (response.bodyBytes.length > BackupUpload.maxBytes) throw const DriveError('bad', 'That file is not an Orbit backup.');
    return utf8.decode(response.bodyBytes, allowMalformed: true);
  }

  Future<void> delete(String email, String id, {bool prompt = true}) async {
    _checkId(id);
    await _send(
      email,
      (token) => _client.delete(Uri.parse('$_api/files/$id'), headers: {'Authorization': 'Bearer $token'}),
      prompt: prompt,
    );
  }

  /// Every Orbit backup in [email]'s Drive gone (account deletion): how many there were. Drive is not asked for when it
  /// was never allowed: Orbit cannot have put anything there.
  Future<int> deleteAll(String email) async {
    final List<Map<String, Object?>> all;
    try {
      all = await list(email, prompt: false);
    } on DriveError catch (e) {
      if (e.reason == 'notAllowed') return 0;
      rethrow;
    }
    for (final b in all) {
      final id = b['id'];
      if (id is String && fileId.hasMatch(id)) {
        try {
          await delete(email, id, prompt: false);
        } on DriveError catch (e) {
          // Gone already is as good as deleted.
          if (e.reason != 'notFound') rethrow;
        }
      }
    }
    return all.length;
  }

  static void _checkId(String id) {
    if (!fileId.hasMatch(id)) throw const DriveError('notFound', 'That backup is no longer in your Google Drive.');
  }

  /// One request with a token; a 401 gets one more try with a new token. Every failure becomes a [DriveError].
  Future<http.Response> _send(
    String email,
    Future<http.Response> Function(String token) request, {
    bool prompt = true,
  }) async {
    for (var attempt = 0; ; attempt++) {
      final token = await authorizer.accessToken(email, prompt: prompt);
      if (token == null) throw const DriveError('notAllowed', 'Google Drive was never allowed for Orbit.');
      final http.Response response;
      try {
        response = await request(token).timeout(timeout);
      } on TimeoutException {
        throw const DriveError('offline', 'Google Drive did not answer in time. Is the internet on?');
      } on SocketException {
        throw const DriveError('offline', 'No internet on this phone. Try again when it is back.');
      } on HandshakeException {
        throw const DriveError('offline', 'No internet on this phone. Try again when it is back.');
      } on http.ClientException catch (e) {
        debugPrint('orbit: drive: $e');
        throw const DriveError('offline', 'No internet on this phone. Try again when it is back.');
      }
      final status = response.statusCode;
      if (status >= 200 && status < 300) return response;
      final why = _reasons(response);
      if (status == 401 || why.contains('authError')) {
        await authorizer.forget(token);
        if (attempt == 0) continue;
        throw const DriveError('auth', 'Google did not accept Orbit\'s access to your Drive. Try again.');
      }
      if (why.contains('storageQuotaExceeded')) {
        throw const DriveError(
          'full',
          'Your Google Drive is full, so the backup was not saved. Free up some space in Google Drive (or add storage), '
              'then try again.',
        );
      }
      if (status == 403 &&
          (why.contains('insufficientPermissions') ||
              why.contains('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
              why.contains('insufficientScopes'))) {
        await authorizer.forget(token);
        throw const DriveError(
          'refused',
          'Orbit was not allowed into Google Drive, so nothing changed there. Orbit only asks for its own hidden folder.',
        );
      }
      if (status == 403 && (why.contains('rateLimitExceeded') || why.contains('userRateLimitExceeded'))) {
        throw const DriveError('server', 'Google Drive is busy. Try again in a minute.');
      }
      if (status == 404) throw const DriveError('notFound', 'That backup is no longer in your Google Drive.');
      if (status == 403 && why.contains('accessNotConfigured')) {
        throw const DriveError('auth', 'Google Drive is not switched on for Orbit yet. The developer has to turn it on.');
      }
      if (status >= 500) throw const DriveError('server', 'Google Drive did not answer. Try again in a moment.');
      throw DriveError('server', 'Google Drive said no ($status). Try again in a moment.');
    }
  }

  /// The error reasons in a Drive answer: `error.errors[].reason`, `error.status` and `error.details[].reason`.
  static Set<String> _reasons(http.Response response) {
    final out = <String>{};
    try {
      final body = jsonDecode(utf8.decode(response.bodyBytes, allowMalformed: true));
      final error = body is Map ? body['error'] : null;
      if (error is Map) {
        final status = error['status'];
        if (status is String) out.add(status);
        for (final key in ['errors', 'details']) {
          final list = error[key];
          if (list is List) {
            for (final e in list) {
              final reason = e is Map ? e['reason'] : null;
              if (reason is String) out.add(reason);
            }
          }
        }
      }
    } on FormatException {
      // not JSON: the status alone says it
    }
    return out;
  }

  static Map<String, Object?> _object(http.Response response) {
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map) return {for (final e in decoded.entries) '${e.key}': e.value};
    } on FormatException {
      // below
    }
    throw const DriveError('server', 'Google Drive gave an answer Orbit could not read. Try again.');
  }

  void close() => _client.close();
}
