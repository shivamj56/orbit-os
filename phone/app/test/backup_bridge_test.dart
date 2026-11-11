// Backups and account deletion through OrbitBridge (phone/SPEC.md, "Backups in Google Drive" and "Deleting the
// account"): the backup ops against an in-memory Drive behind a fake HTTP client, signed in with the cloud fakes, and
// deleteAccount taking the backups, the cloud's data and the account in that order. No network anywhere.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/cloud/drive.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/remote.dart';

import 'cloud_fakes.dart';
import 'drive_test.dart' show FakeAuthorizer, backupText;
import 'support.dart';

/// The hidden app folder of one Google Drive, answering the REST calls DriveBackups makes.
class FakeDrive {
  final Map<String, Map<String, Object?>> files = {};
  int _n = 0;

  /// Answer every request with this instead (a full Drive, an outage).
  http.Response? Function(http.Request r)? override;

  late final MockClient client = MockClient((r) async {
    final forced = override?.call(r);
    if (forced != null) return forced;
    final path = r.url.path;
    if (r.method == 'POST' && path == '/upload/drive/v3/files') {
      final boundary = RegExp(r'boundary=(\S+)').firstMatch(r.headers['Content-Type'] ?? '')!.group(1)!;
      final parts = r.body.split('--$boundary');
      final meta = jsonDecode(parts[1].split('\r\n\r\n')[1].trim()) as Map<String, Object?>;
      final text = parts[2].split('\r\n\r\n')[1];
      final body = text.substring(0, text.length - 2);
      final id = 'file-${(++_n).toString().padLeft(6, '0')}';
      files[id] = {
        'id': id,
        'name': meta['name'],
        'size': '${utf8.encode(body).length}',
        'createdTime': DateTime.now().toUtc().toIso8601String(),
        'appProperties': meta['appProperties'],
        'parents': meta['parents'],
        'text': body,
      };
      return _json(_public(files[id]!));
    }
    if (r.method == 'GET' && path == '/drive/v3/files') return _json({'files': [for (final f in files.values) _public(f)]});
    final id = path.split('/').last;
    final file = files[id];
    if (file == null) return _json({'error': {'code': 404, 'errors': [{'reason': 'notFound'}]}}, 404);
    if (r.method == 'GET') return http.Response.bytes(utf8.encode(file['text'] as String), 200);
    if (r.method == 'DELETE') {
      files.remove(id);
      return http.Response('', 204);
    }
    return http.Response('', 400);
  });

  static Map<String, Object?> _public(Map<String, Object?> f) => {for (final e in f.entries) if (e.key != 'text' && e.key != 'parents') e.key: e.value};

  static http.Response _json(Object body, [int status = 200]) =>
      http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});
}

void main() {
  late List<Map<String, Object?>> sent;
  late FakeNative native;
  late Directory cache;
  late FakeDrive drive;
  late FakeAuthorizer auth;

  setUp(() async {
    sent = [];
    native = FakeNative();
    cache = await Directory.systemTemp.createTemp('orbit-backup-icons');
    native.cache = cache;
    drive = FakeDrive();
    auth = FakeAuthorizer();
  });
  tearDown(() async => cache.delete(recursive: true));

  OrbitBridge bridgeFor(TvRemote remote) => OrbitBridge(
    remote: remote,
    native: native,
    icons: IconCache(directory: native.cacheDirectory),
    drive: DriveBackups(authorizer: auth, client: drive.client),
  )..attach((script) async => sent.add(messageOf(script)));
  Map<String, Object?> reply(int id) => sent.lastWhere((m) => m['id'] == id);

  String save(int id, {String tv = 'Family room'}) => jsonEncode({
    'id': id,
    'op': 'backupSave',
    'args': {'text': backupText(tv: tv), 'tv': tv, 'address': '192.168.1.7', 'model': 'MiTV-AXFU0', 'at': 1762862640000},
  });

  test('before Google sign-in, a backup is "noAccount" and nothing reaches Drive', () async {
    final rig = CloudRig();
    final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
    final bridge = bridgeFor(remote);
    await bridge.handle(save(1));
    expect(reply(1), {
      'id': 1,
      'ok': false,
      'reason': 'noAccount',
      'error': 'Sign in with Google first. Orbit keeps the backups in that account\'s own Google Drive.',
      'status': 401,
    });
    expect(auth.emails, isEmpty);
    remote.dispose();
  });

  test('signed in: save, list, open and delete, in the signed-in account\'s Drive', () async {
    final rig = CloudRig();
    final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
    final bridge = bridgeFor(remote);
    await bridge.handle('{"id":1,"op":"signIn"}');

    await bridge.handle(save(2, tv: 'बैठक'));
    final saved = reply(2)['data'] as Map;
    expect(saved['tv'], 'बैठक');
    expect(saved['size'], utf8.encode(backupText(tv: 'बैठक')).length);
    final file = drive.files.values.single;
    expect(file['text'], backupText(tv: 'बैठक'), reason: 'the page\'s file, byte for byte');
    expect(file['parents'], ['appDataFolder']);
    expect(auth.emails.toSet(), {'owner@gmail.com'});

    await bridge.handle('{"id":3,"op":"backupList"}');
    expect(reply(3)['data'], {
      'backups': [saved],
      'email': 'owner@gmail.com',
    });

    await bridge.handle(jsonEncode({'id': 4, 'op': 'backupLoad', 'args': {'id': saved['id']}}));
    expect(reply(4)['data'], {'text': backupText(tv: 'बैठक')});

    await bridge.handle(jsonEncode({'id': 5, 'op': 'backupDelete', 'args': {'id': saved['id']}}));
    expect(reply(5), containsPair('ok', true));
    expect(drive.files, isEmpty);

    await bridge.handle(jsonEncode({'id': 6, 'op': 'backupLoad', 'args': {'id': saved['id']}}));
    expect(reply(6), containsPair('reason', 'notFound'));

    await bridge.handle('{"id":7,"op":"backupSave","args":{"text":"{}","tv":"x","address":"y"}}');
    expect(reply(7), containsPair('reason', 'bad'), reason: 'the bridge checks the file before Drive sees it');
    remote.dispose();
  });

  test('a full Drive and a refusal keep their reasons and words', () async {
    final rig = CloudRig();
    final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
    final bridge = bridgeFor(remote);
    await bridge.handle('{"id":1,"op":"signIn"}');
    drive.override = (r) => http.Response(
      jsonEncode({'error': {'code': 403, 'errors': [{'reason': 'storageQuotaExceeded'}]}}),
      403,
    );
    await bridge.handle(save(2));
    expect(reply(2)['reason'], 'full');
    expect(reply(2)['status'], 507);
    expect(reply(2)['error'], contains('Google Drive is full'));

    drive.override = null;
    auth.refuse = const DriveError('refused', 'Google Drive was not allowed, so nothing was saved there.');
    await bridge.handle(save(3));
    expect(reply(3), {'id': 3, 'ok': false, 'reason': 'refused', 'error': 'Google Drive was not allowed, so nothing was saved there.', 'status': 403});
    remote.dispose();
  });

  group('deleteAccount', () {
    test('takes the backups, unlinks the TV, deletes the cloud\'s data and the account, and signs out', () async {
      final rig = CloudRig();
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      final bridge = bridgeFor(remote);
      final tv = await rig.linkedTv();
      final uid = rig.uid;
      await bridge.handle(save(1));
      await bridge.handle(save(2, tv: 'Bedroom'));
      expect(drive.files, hasLength(2));
      expect(rig.db.read('orbit/$uid/tv/name'), 'Family room');

      final asked = auth.prompts.length;
      await bridge.handle('{"id":3,"op":"deleteAccount","args":{"backups":true}}');
      expect(reply(3), containsPair('ok', true), reason: '${reply(3)}');
      final data = reply(3)['data'] as Map;
      expect(data['removed'], 2);
      expect(data['account'], containsPair('signedIn', false));
      expect(drive.files, isEmpty);
      expect(rig.db.writes, contains('orbit/$uid/tv/unlink'), reason: 'the TV is asked to unlink first');
      expect(rig.db.read('orbit/$uid'), isNull, reason: 'nothing of the account is left in the cloud');
      expect(rig.auth.deletes, 1);
      expect(rig.auth.currentUser, isNull);
      expect(rig.google.revokes, 1, reason: 'Google forgets Orbit\'s permissions too');
      expect(auth.prompts.skip(asked), everyElement(isFalse), reason: 'no Google sheet for the backups');
      final accountEvents = [for (final m in sent) if (m['event'] == 'account') m['data'] as Map];
      expect(accountEvents, isEmpty, reason: 'events wait for hello');
      tv.close();
      remote.dispose();
    });

    test('asks Google once more when Firebase wants a recent sign-in, and leaves Drive alone without the box', () async {
      final rig = CloudRig();
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      final bridge = bridgeFor(remote);
      await bridge.handle('{"id":1,"op":"hello"}');
      await bridge.handle('{"id":2,"op":"signIn"}');
      await bridge.handle(save(3));
      rig.auth.wantsRecentLogin = true;

      await bridge.handle('{"id":4,"op":"deleteAccount","args":{"backups":false}}');
      expect(reply(4), containsPair('ok', true), reason: '${reply(4)}');
      expect((reply(4)['data'] as Map)['removed'], isNull);
      expect(rig.auth.reauths, 1);
      expect(rig.auth.deletes, 1);
      expect(drive.files, hasLength(1), reason: 'the backups were to stay');
      expect([for (final m in sent) if (m['event'] == 'account') m['data'] as Map].last, containsPair('signedIn', false));
      remote.dispose();
    });

    test('stops before anything is deleted when Drive says no, and needs an account', () async {
      final rig = CloudRig();
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      final bridge = bridgeFor(remote);
      await bridge.handle('{"id":1,"op":"deleteAccount","args":{"backups":true}}');
      expect(reply(1), containsPair('status', 401));

      await bridge.handle('{"id":2,"op":"signIn"}');
      drive.override = (r) => http.Response('down', 503);
      await bridge.handle('{"id":3,"op":"deleteAccount","args":{"backups":true}}');
      expect(reply(3), containsPair('reason', 'server'));
      expect(rig.auth.deletes, 0);
      expect(rig.auth.currentUser, isNotNull, reason: 'the account stays when its backups could not go');
      remote.dispose();
    });
  });
}
