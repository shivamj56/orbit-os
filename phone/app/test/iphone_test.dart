import 'package:flutter_test/flutter_test.dart';
import 'package:orbit/app/orbit_screen.dart';
import 'package:orbit/bridge/orbit_bridge.dart';
import 'package:orbit/cloud/apple_identity.dart';
import 'package:orbit/cloud/backend.dart';
import 'package:orbit/cloud/drive.dart';
import 'package:orbit/cloud/google_identity.dart';
import 'package:orbit/tv/icon_cache.dart';
import 'package:orbit/tv/models.dart';
import 'package:orbit/tv/remote.dart';

import 'cloud_fakes.dart';
import 'mock_tv.dart';
import 'support.dart';

Matcher opError(int status, String message) =>
    isA<OpError>().having((e) => e.status, 'status', status).having((e) => e.message, 'message', message);

/// The iPhone's differences: Sign in with Apple beside Google (linking the TV, Drive backups and deleting the account
/// with it), the `phone` op, and where the page may load from.
void main() {
  group('Sign in with Apple', () {
    test('signs in to Firebase with Apple\'s token and nonce; the name goes along the first time', () async {
      final rig = CloudRig(iphone: true).started();
      expect(rig.cloud.accountJson(), containsPair('provider', null));
      await rig.account.signIn(apple: true);
      expect(rig.apple.sheets, 1);
      expect(rig.google.sheets, 0, reason: 'Google is not asked');
      expect(rig.auth.appleNames, ['Asha']);
      expect(rig.cloud.accountJson(), {
        'available': true,
        'signedIn': true,
        'provider': 'apple',
        'email': 'asha.k@privaterelay.appleid.com',
        'tvLinked': false,
        'tvOnline': false,
        'tvName': null,
      });
      expect(rig.account.signInFirst, 'Sign in first.');
    });

    test('a closed sheet is a cancelled sign-in, and nothing changes', () async {
      final rig = CloudRig(iphone: true).started();
      rig.apple.cancel = true;
      await expectLater(
        rig.account.signIn(apple: true),
        throwsA(isA<SignInFailed>().having((e) => e.cancelled, 'cancelled', isTrue)),
      );
      expect(rig.account.signedIn, isFalse);
    });

    test('on Android there is no Apple: the account says so and keeps Google\'s words', () async {
      final rig = CloudRig().started();
      expect(rig.account.offersApple, isFalse);
      expect(rig.account.signInFirst, 'Sign in with Google first.');
      await expectLater(rig.account.signIn(apple: true), throwsA(isA<SignInFailed>()));
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      await expectLater(remote.signIn(apple: true), throwsA(opError(400, 'Sign in with Apple is only on iPhone.')));
      remote.dispose();
    });
  });

  group('linking the TV with an Apple account', () {
    test('the TV is given apple.com|nonce|token, signs in as the same account, and comes online', () async {
      final rig = CloudRig(iphone: true).started();
      await rig.account.signIn(apple: true);
      final tv = FakeTvSide(rig.db)..showCode('12345678');
      await eventually(() => rig.cloud.connected);
      await rig.cloud.link('12345678');
      expect(tv.tokenSeen, startsWith('apple.com|'));
      expect(tv.tokenSeen!.split('|'), hasLength(3));
      expect(tv.uid, rig.uid);
      expect(rig.apple.sheets, 1, reason: 'the token from signing in a moment ago is still fresh');
      expect(rig.cloud.accountJson(), containsPair('tvLinked', true));
    });

    test('Apple\'s token from signing in goes to one TV only: the next link asks Apple again', () async {
      final rig = CloudRig(iphone: true).started();
      await rig.account.signIn(apple: true);
      final first = await rig.account.linkToken();
      final second = await rig.account.linkToken();
      expect(rig.apple.sheets, 2);
      expect(second, isNot(first));
    });

    test('a token too near its end is not handed on: Apple\'s sheet gives a new one', () async {
      final rig = CloudRig(iphone: true).started();
      rig.apple.life = const Duration(minutes: 3); // under the 5-minute margin
      await rig.account.signIn(apple: true);
      rig.apple.life = const Duration(minutes: 10);
      final token = await rig.account.linkToken();
      expect(rig.apple.sheets, 2);
      final idToken = token.split('|')[2];
      expect(jwtExpiry(idToken)!.isAfter(DateTime.now().add(const Duration(minutes: 9))), isTrue);
    });

    test('a Google account on an iPhone still gives the TV a Google ID token', () async {
      final rig = CloudRig(iphone: true).started();
      await rig.account.signIn();
      expect(rig.account.provider, 'google');
      final token = await rig.account.linkToken();
      expect(token.contains('|'), isFalse);
      expect(jwtEmail(token), 'owner@gmail.com');
    });
  });

  group('deleting an Apple account', () {
    test('Apple\'s sheet once: its code takes Sign in with Apple back, then the user goes', () async {
      final rig = CloudRig(iphone: true).started();
      await rig.account.signIn(apple: true);
      await rig.account.deleteUser();
      expect(rig.apple.sheets, 2);
      expect(rig.auth.revokedCodes, ['code-2']);
      expect(rig.auth.deletes, 1);
      expect(rig.google.revokes, 1, reason: 'Google forgets Orbit too (a Drive used for backups)');
      expect(rig.account.signedIn, isFalse);
    });

    test('when Firebase wants a recent sign-in, the same fresh Apple token gives it', () async {
      final rig = CloudRig(iphone: true).started();
      await rig.account.signIn(apple: true);
      rig.auth.wantsRecentLogin = true;
      await rig.account.deleteUser();
      expect(rig.apple.sheets, 2, reason: 'one sheet for the code and the recent sign-in');
      expect(rig.auth.reauths, 1);
      expect(rig.auth.deletes, 1);
    });

    test('a closed sheet stops it before anything is deleted', () async {
      final rig = CloudRig(iphone: true).started();
      await rig.account.signIn(apple: true);
      rig.apple.cancel = true;
      await expectLater(rig.account.deleteUser(), throwsA(isA<SignInFailed>()));
      expect(rig.auth.deletes, 0);
      expect(rig.auth.revokedCodes, isEmpty);
      expect(rig.account.signedIn, isTrue);
    });
  });

  group('backups with an Apple account', () {
    test('they go to the Google account this phone uses (Google\'s sheet the first time)', () async {
      final rig = CloudRig(iphone: true);
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      await rig.account.signIn(apple: true);
      rig.google.quietWorks = false;
      expect(await remote.backupEmail(), 'owner@gmail.com');
      expect(rig.google.accountAsks, 1);
      expect(rig.google.sheets, 1, reason: 'no quiet account yet: Google\'s sheet');
      expect(await rig.account.driveEmail(prompt: false), isNull, reason: 'nothing is shown without a prompt');
      remote.dispose();
    });

    test('signed out on an iPhone: sign in first, in a Drive of your own', () async {
      final rig = CloudRig(iphone: true);
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      await expectLater(
        remote.backupEmail(),
        throwsA(
          isA<DriveError>().having(
            (e) => e.message,
            'message',
            'Sign in first. Orbit keeps the backups in a Google Drive of your own.',
          ),
        ),
      );
      remote.dispose();
    });
  });

  group('the bridge on an iPhone', () {
    late List<Map<String, Object?>> sent;

    OrbitBridge bridgeFor(TvRemote remote, FakeNative native) => OrbitBridge(
      remote: remote,
      native: native,
      icons: IconCache(directory: native.cacheDirectory),
    )..attach((script) async => sent.add(messageOf(script)));
    Map<String, Object?> reply(int id) => sent.lastWhere((m) => m['id'] == id);

    setUp(() => sent = []);

    test('`phone` says what this phone can do, in demo mode too', () async {
      final ios = bridgeFor(wifiOnly(linkFor(null)), FakeNative(platform: 'ios'));
      await ios.handle('{"id":1,"op":"phone"}');
      expect(reply(1)['data'], {
        'platform': 'ios',
        'volumeKeys': false,
        'signIn': ['apple', 'google'],
      });
      await ios.handle('{"id":2,"op":"demo","args":{"on":true}}');
      await ios.handle('{"id":3,"op":"phone"}');
      expect(reply(3)['ok'], isTrue, reason: 'one of the phone\'s own ops');

      final android = bridgeFor(wifiOnly(linkFor(null)), FakeNative());
      await android.handle('{"id":4,"op":"phone"}');
      expect(reply(4)['data'], {
        'platform': 'android',
        'volumeKeys': true,
        'signIn': ['google'],
      });
    });

    test('signIn with Apple, and a way Orbit does not know', () async {
      final rig = CloudRig(iphone: true);
      final remote = TvRemote(wifi: linkFor(null))..attachCloud(rig.account, rig.cloud);
      final bridge = bridgeFor(remote, FakeNative(platform: 'ios'));
      await bridge.handle('{"id":1,"op":"signIn","args":{"with":"apple"}}');
      expect(reply(1)['data'], containsPair('provider', 'apple'));
      expect(rig.apple.sheets, 1);
      await bridge.handle('{"id":2,"op":"signIn","args":{"with":"facebook"}}');
      expect(reply(2), {'id': 2, 'ok': false, 'error': 'No sign-in called "facebook".', 'status': 400});
      remote.dispose();
    });

    test('without Firebase the account says it is not available, as an event too', () async {
      final remote = TvRemote(wifi: linkFor(null));
      expect(remote.accountJson['available'], isTrue, reason: 'Firebase may still start');
      final accounts = <Map<String, Object?>>[];
      remote.onAccount = accounts.add;
      remote.cloudUnavailable();
      expect(remote.accountJson['available'], isFalse);
      expect(accounts.single['available'], isFalse);
      remote.dispose();
    });
  });

  group('the page\'s address', () {
    const bundle = 'file:///private/var/containers/Bundle/Application/0B1C2D3E-1111-2222-3333-444455556666/Runner.app';

    test('on an iPhone: only the app\'s own assets/ui folder', () {
      bool own(String url) => isOwnPageUrl(url, ios: true);
      expect(own('$bundle/Frameworks/App.framework/flutter_assets/assets/ui/index.html'), isTrue);
      expect(own('$bundle/Frameworks/App.framework/flutter_assets/assets/ui/index.html#remote'), isTrue);
      expect(own('about:blank'), isTrue);
      expect(own('data:text/html,hi'), isTrue);
      expect(own('$bundle/Frameworks/App.framework/flutter_assets/assets/setup/orbit-setup.sh'), isFalse);
      expect(own('$bundle/Frameworks/App.framework/flutter_assets/assets/ui/../setup/x.html'), isFalse);
      expect(own('file:///etc/hosts'), isFalse);
      expect(own('https://example.com/flutter_assets/assets/ui/index.html'), isFalse);
      expect(own('file:///android_asset/flutter_assets/assets/ui/index.html'), isFalse);
    });

    test('on Android: the asset prefix, as before', () {
      bool own(String url) => isOwnPageUrl(url, ios: false);
      expect(own('file:///android_asset/flutter_assets/assets/ui/index.html'), isTrue);
      expect(own('$bundle/Frameworks/App.framework/flutter_assets/assets/ui/index.html'), isFalse);
      expect(own('https://shivamj56.github.io/orbit-os-site/'), isFalse);
    });
  });

  test('a nonce is 32 random bytes in base64url, with no | in it', () {
    final a = makeNonce();
    final b = makeNonce();
    expect(a, hasLength(43));
    expect(a, matches(RegExp(r'^[A-Za-z0-9_-]+$')));
    expect(a, isNot(b));
  });
}
