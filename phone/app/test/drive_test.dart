// Backups in Google Drive (lib/cloud/drive.dart) against a fake HTTP client (package:http's MockClient): the upload's
// file and metadata, the list (pages, appProperties, newest first), opening and deleting, the one retry after a 401, and
// each failure in the words the page shows. No network anywhere.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:orbit/cloud/drive.dart';

/// Hands out "token-1", "token-2"… and remembers which were forgotten. [allowed] false: Drive was never allowed.
class FakeAuthorizer implements DriveAuthorizer {
  int issued = 0;
  final List<String> forgotten = [];
  final List<String> emails = [];
  final List<bool> prompts = [];
  bool allowed = true;
  DriveError? refuse;

  @override
  Future<String?> accessToken(String email, {bool prompt = true}) async {
    emails.add(email);
    prompts.add(prompt);
    final no = refuse;
    if (no != null) throw no;
    if (!allowed && !prompt) return null;
    return 'token-${++issued}';
  }

  @override
  Future<void> forget(String token) async => forgotten.add(token);
}

const String email = 'owner@gmail.com';

String backupText({String tv = 'Family room'}) => jsonEncode({
  'kind': 'orbit-tv-backup',
  'version': 1,
  'made': '2026-11-11T12:04:00.000Z',
  'tv': {'name': tv, 'address': '192.168.1.7', 'model': 'MiTV-AXFU0'},
  'undo': ['home com.google.android.apps.tv.launcherx/.MainActivity', 'enable com.miui.tv.analytics'],
});

BackupUpload upload({String tv = 'Family room'}) => BackupUpload.fromPage(
  text: backupText(tv: tv),
  tv: tv,
  address: '192.168.1.7',
  model: 'MiTV-AXFU0',
  at: DateTime.utc(2026, 11, 11, 12, 4).millisecondsSinceEpoch,
);

http.Response json(Object body, [int status = 200]) =>
    http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json; charset=utf-8'});

http.Response driveError(int status, String reason, {String? status2}) => json({
  'error': {
    'code': status,
    'message': reason,
    'status': ?status2,
    'errors': [
      {'domain': 'global', 'reason': reason, 'message': reason},
    ],
  },
}, status);

void main() {
  group('the backup file', () {
    test('is checked, and its size is its UTF-8 bytes', () {
      final u = upload(tv: 'बैठक');
      expect(u.bytes, utf8.encode(u.text).length);
      expect(u.bytes, greaterThan(u.text.length), reason: 'a Devanagari name takes more bytes than letters');
      expect(() => BackupUpload.fromPage(text: 'not json', tv: 'x', address: '', at: 0), throwsA(isA<DriveError>()));
      expect(
        () => BackupUpload.fromPage(text: jsonEncode({'kind': 'other'}), tv: 'x', address: '', at: 0),
        throwsA(predicate((e) => e is DriveError && e.reason == 'bad')),
      );
      expect(
        () => BackupUpload.fromPage(text: jsonEncode({'kind': 'orbit-tv-backup', 'undo': <String>[]}), tv: 'x', address: '', at: 0),
        throwsA(predicate((e) => e is DriveError && e.message.contains('no record'))),
      );
    });

    test('goes to the hidden app folder, named for the TV and the time, with what the list needs', () {
      final u = upload();
      expect(u.fileName, 'orbit-backup-family-room-20261111-120400.json');
      expect(u.metadata['parents'], ['appDataFolder']);
      expect(u.metadata['mimeType'], 'application/json');
      expect(u.appProperties, {
        'orbit': 'tv-backup',
        'v': '1',
        'tv': 'Family room',
        'address': '192.168.1.7',
        'model': 'MiTV-AXFU0',
        'at': '${DateTime.utc(2026, 11, 11, 12, 4).millisecondsSinceEpoch}',
      });
      // Drive keeps at most 124 bytes a property: a very long name is cut, by bytes.
      final long = upload(tv: 'A very long name for a television in the living room by the window, next to the lamp');
      expect(utf8.encode(long.appProperties['tv']!).length, lessThanOrEqualTo(80));
    });

    test('is sent as multipart/related: the metadata, then the file byte for byte', () {
      final u = upload();
      final (type, body) = u.multipart(boundary: 'B0UND');
      expect(type, 'multipart/related; boundary=B0UND');
      final text = utf8.decode(body);
      final parts = text.split('--B0UND');
      expect(parts.length, 4, reason: 'before, metadata, file, and the closing "--"');
      expect(parts.last.trim(), '--');
      final meta = jsonDecode(parts[1].split('\r\n\r\n')[1].trim()) as Map;
      expect(meta['parents'], ['appDataFolder']);
      expect(parts[2].split('\r\n\r\n')[1], '${u.text}\r\n');
    });
  });

  group('Drive', () {
    late FakeAuthorizer auth;
    late List<http.Request> requests;

    DriveBackups driveWith(Future<http.Response> Function(http.Request r) answer, {Duration? timeout}) {
      requests = [];
      return DriveBackups(
        authorizer: auth,
        client: MockClient((r) {
          requests.add(r);
          return answer(r);
        }),
        timeout: timeout ?? const Duration(seconds: 5),
      );
    }

    setUp(() => auth = FakeAuthorizer());

    test('save uploads into appDataFolder with the token, and says what the list will show', () async {
      final drive = driveWith(
        (r) async => json({
          'id': 'FILE_id-1234',
          'name': 'orbit-backup-family-room-20261111-120400.json',
          'size': '${upload().bytes}',
          'createdTime': '2026-11-11T12:04:01.000Z',
          'appProperties': upload().appProperties,
        }),
      );
      final saved = await drive.save(email, upload());
      final r = requests.single;
      expect(r.method, 'POST');
      expect(r.url.toString(), startsWith('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'));
      expect(r.headers['Authorization'], 'Bearer token-1');
      expect(r.headers['Content-Type'], startsWith('multipart/related; boundary='));
      expect(r.body, contains('"parents":["appDataFolder"]'));
      expect(r.body, contains(upload().text));
      expect(auth.emails, [email]);
      expect(saved, {
        'id': 'FILE_id-1234',
        'tv': 'Family room',
        'address': '192.168.1.7',
        'model': 'MiTV-AXFU0',
        'at': DateTime.utc(2026, 11, 11, 12, 4).millisecondsSinceEpoch,
        'size': upload().bytes,
      });
    });

    test('list reads every page of the app folder, Orbit backups only, newest first', () async {
      final drive = driveWith((r) async {
        expect(r.method, 'GET');
        expect(r.url.path, '/drive/v3/files');
        expect(r.url.queryParameters['spaces'], 'appDataFolder');
        expect(r.url.queryParameters['q'], contains("appProperties has { key='orbit' and value='tv-backup' }"));
        expect(r.url.queryParameters['q'], contains('trashed = false'));
        if (r.url.queryParameters['pageToken'] == null) {
          return json({
            'nextPageToken': 'P2',
            'files': [
              {'id': 'old-000001', 'size': '6100', 'createdTime': '2026-11-01T10:00:00Z', 'appProperties': {'orbit': 'tv-backup', 'tv': 'Family room', 'address': '192.168.1.7', 'at': '1000'}},
            ],
          });
        }
        expect(r.url.queryParameters['pageToken'], 'P2');
        return json({
          'files': [
            {'id': 'new-000002', 'size': '6200', 'createdTime': '2026-11-11T10:00:00Z', 'appProperties': {'orbit': 'tv-backup', 'tv': 'Bedroom', 'address': '192.168.1.9', 'model': 'Bravia', 'at': '3000'}},
            {'id': 'mid-000003', 'size': '6150', 'createdTime': '2026-11-05T10:00:00Z', 'appProperties': {'orbit': 'tv-backup'}},
          ],
        });
      });
      final list = await drive.list(email);
      expect(requests, hasLength(2));
      // `at` from appProperties, else Drive's createdTime.
      expect(list.map((b) => b['id']), ['mid-000003', 'new-000002', 'old-000001']);
      expect(list.first, {'id': 'mid-000003', 'tv': 'TV', 'address': '', 'model': null, 'at': DateTime.parse('2026-11-05T10:00:00Z').millisecondsSinceEpoch, 'size': 6150});
      expect(list[1], containsPair('tv', 'Bedroom'));
      expect(list.last, containsPair('at', 1000));
    });

    test('load opens a file\'s text; delete removes it', () async {
      final drive = driveWith((r) async {
        if (r.method == 'GET') {
          expect(r.url.toString(), 'https://www.googleapis.com/drive/v3/files/FILE_id-1234?alt=media');
          return http.Response.bytes(utf8.encode(backupText(tv: 'बैठक')), 200);
        }
        expect(r.method, 'DELETE');
        expect(r.url.toString(), 'https://www.googleapis.com/drive/v3/files/FILE_id-1234');
        return http.Response('', 204);
      });
      expect(await drive.load(email, 'FILE_id-1234'), backupText(tv: 'बैठक'));
      await drive.delete(email, 'FILE_id-1234');
      expect(requests.map((r) => r.method), ['GET', 'DELETE']);
      await expectLater(drive.load(email, '../etc/passwd'), throwsA(predicate((e) => e is DriveError && e.reason == 'notFound')));
      expect(requests, hasLength(2), reason: 'an id that is not one is never sent');
    });

    test('a token Google no longer takes is forgotten and asked for once more', () async {
      var calls = 0;
      final drive = driveWith((r) async => ++calls == 1 ? driveError(401, 'authError') : json({'files': <Object?>[]}));
      expect(await drive.list(email), isEmpty);
      expect(auth.forgotten, ['token-1']);
      expect(requests.map((r) => r.headers['Authorization']), ['Bearer token-1', 'Bearer token-2']);

      final never = driveWith((r) async => driveError(401, 'authError'));
      await expectLater(never.list(email), throwsA(predicate((e) => e is DriveError && e.reason == 'auth')));
      expect(requests, hasLength(2), reason: 'one more try, not more');
    });

    test('each failure in plain words, with the reason the page acts on', () async {
      Future<DriveError> failureOf(Future<http.Response> Function(http.Request r) answer, {Duration? timeout}) async {
        try {
          await driveWith(answer, timeout: timeout).save(email, upload());
        } on DriveError catch (e) {
          return e;
        }
        fail('no DriveError');
      }

      final full = await failureOf((r) async => driveError(403, 'storageQuotaExceeded'));
      expect(full.reason, 'full');
      expect(full.message, contains('Google Drive is full'));

      final refused = await failureOf(
        (r) async => json({
          'error': {
            'code': 403,
            'status': 'PERMISSION_DENIED',
            'details': [
              {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'reason': 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'},
            ],
          },
        }, 403),
      );
      expect(refused.reason, 'refused');
      expect(auth.forgotten, isNotEmpty);

      expect((await failureOf((r) async => driveError(404, 'notFound'))).reason, 'notFound');
      expect((await failureOf((r) async => http.Response('oops', 503))).reason, 'server');
      expect((await failureOf((r) async => driveError(403, 'userRateLimitExceeded'))).message, contains('busy'));
      expect((await failureOf((r) async => throw const SocketException('Network is unreachable'))).reason, 'offline');
      expect((await failureOf((r) async => throw http.ClientException('Connection closed'))).reason, 'offline');
      final slow = await failureOf((r) => Completer<http.Response>().future, timeout: const Duration(milliseconds: 50));
      expect(slow.reason, 'offline');
    });

    test('no Google account or no permission stops before any request', () async {
      auth.refuse = const DriveError('refused', 'Google Drive was not allowed.');
      final drive = driveWith((r) async => json({'files': <Object?>[]}));
      await expectLater(drive.list(email), throwsA(predicate((e) => e is DriveError && e.reason == 'refused')));
      expect(requests, isEmpty);
    });

    test('deleteAll removes every backup without asking Google, and is 0 when Drive was never allowed', () async {
      final drive = driveWith((r) async {
        if (r.method == 'GET') {
          return json({
            'files': [
              {'id': 'aaaaaaaa1', 'size': '1', 'appProperties': {'orbit': 'tv-backup', 'at': '2'}},
              {'id': 'bbbbbbbb2', 'size': '1', 'appProperties': {'orbit': 'tv-backup', 'at': '1'}},
            ],
          });
        }
        // One was gone already: that counts as deleted.
        return r.url.path.endsWith('bbbbbbbb2') ? driveError(404, 'notFound') : http.Response('', 204);
      });
      expect(await drive.deleteAll(email), 2);
      expect(requests.map((r) => '${r.method} ${r.url.pathSegments.last}'), ['GET files', 'DELETE aaaaaaaa1', 'DELETE bbbbbbbb2']);
      expect(auth.prompts.every((p) => p == false), isTrue, reason: 'no Google sheet while deleting the account');

      auth = FakeAuthorizer()..allowed = false;
      final never = driveWith((r) async => fail('nothing is asked of Drive'));
      expect(await never.deleteAll(email), 0);
      expect(requests, isEmpty);
    });
  });
}
