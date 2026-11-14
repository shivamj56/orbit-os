import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_database/firebase_database.dart';
import 'package:flutter/foundation.dart';

import 'backend.dart';

/// [CloudAuth] and [CloudDb] on Firebase (the app's values come from android/app/google-services.json through the
/// google-services Gradle plugin, and on an iPhone from GoogleService-Info.plist, tool/ios_firebase.sh).
class FirebaseBackend implements CloudAuth, CloudDb {
  FirebaseBackend._(this._app);

  final FirebaseApp _app;

  late final FirebaseAuth _auth = FirebaseAuth.instanceFor(app: _app);
  late final FirebaseDatabase _db = FirebaseDatabase.instanceFor(app: _app, databaseURL: CloudConfig.databaseUrl);

  /// Firebase, or null when it did not start (then only the home Wi-Fi path works).
  static Future<FirebaseBackend?> start() async {
    try {
      final app = await Firebase.initializeApp().timeout(const Duration(seconds: 15));
      return FirebaseBackend._(app);
    } on Object catch (e) {
      debugPrint('orbit: Firebase did not start, the cloud path is off: $e');
      return null;
    }
  }

  // ---- Authentication ----

  static CloudUser? _user(User? user) {
    if (user == null) return null;
    final apple = user.providerData.any((p) => p.providerId == kAppleProvider);
    return CloudUser(uid: user.uid, email: user.email, provider: apple ? kAppleProvider : kGoogleProvider);
  }

  @override
  CloudUser? get currentUser => _user(_auth.currentUser);

  @override
  Stream<CloudUser?> userChanges() => _auth.authStateChanges().map(_user);

  @override
  Future<CloudUser> signInWithGoogleIdToken(String idToken) async {
    try {
      final result = await _auth.signInWithCredential(GoogleAuthProvider.credential(idToken: idToken));
      final user = _user(result.user);
      if (user == null) throw const SignInFailed('Firebase did not sign you in. Try again.');
      return user;
    } on FirebaseAuthException catch (e) {
      throw switch (e.code) {
        'network-request-failed' => const SignInFailed(
          'No internet on the phone. Try again when it is back.',
          offline: true,
        ),
        'user-disabled' => const SignInFailed('This Google account is turned off in Orbit\'s Firebase.'),
        'invalid-credential' => const SignInFailed('Google\'s sign-in was not accepted. Try again.'),
        _ => SignInFailed('Firebase could not sign you in (${e.code}).'),
      };
    }
  }

  @override
  Future<CloudUser> signInWithAppleIdToken(
    String idToken,
    String rawNonce, {
    String? givenName,
    String? familyName,
  }) async {
    try {
      final name = AppleFullPersonName(givenName: givenName, familyName: familyName);
      final result = await _auth.signInWithCredential(AppleAuthProvider.credentialWithIDToken(idToken, rawNonce, name));
      final signedIn = result.user;
      // Apple tells the name the first time only; kept as the display name, it is in the TV's token too (its greeting).
      final display = [givenName, familyName].whereType<String>().join(' ').trim();
      if (signedIn != null && display.isNotEmpty && (signedIn.displayName ?? '').isEmpty) {
        try {
          await signedIn.updateDisplayName(display);
        } on Object catch (e) {
          debugPrint('orbit: display name not kept: $e');
        }
      }
      final user = _user(signedIn);
      if (user == null) throw const SignInFailed('Firebase did not sign you in. Try again.');
      return user;
    } on FirebaseAuthException catch (e) {
      throw switch (e.code) {
        'network-request-failed' => const SignInFailed(
          'No internet on the phone. Try again when it is back.',
          offline: true,
        ),
        'user-disabled' => const SignInFailed('This Apple ID is turned off in Orbit\'s Firebase.'),
        'invalid-credential' => const SignInFailed('Apple\'s sign-in was not accepted. Try again.'),
        'operation-not-allowed' => const SignInFailed('Sign in with Apple is not switched on for Orbit yet.'),
        _ => SignInFailed('Firebase could not sign you in (${e.code}).'),
      };
    }
  }

  @override
  Future<void> reauthenticateWithAppleIdToken(String idToken, String rawNonce) async {
    final user = _auth.currentUser;
    if (user == null) throw const SignInFailed('Sign in first.');
    try {
      await user.reauthenticateWithCredential(AppleAuthProvider.credentialWithIDToken(idToken, rawNonce, AppleFullPersonName()));
    } on FirebaseAuthException catch (e) {
      throw switch (e.code) {
        'network-request-failed' => const SignInFailed('No internet on the phone. Try again when it is back.', offline: true),
        'user-mismatch' => const SignInFailed('That is another Apple ID. Use the one Orbit is signed in with.'),
        _ => SignInFailed('Apple\'s sign-in was not accepted (${e.code}). Try again.'),
      };
    }
  }

  @override
  Future<void> revokeAppleAuthorization(String authorizationCode) =>
      _auth.revokeTokenWithAuthorizationCode(authorizationCode);

  @override
  Future<void> signOut() => _auth.signOut();

  @override
  Future<void> deleteUser() async {
    final user = _auth.currentUser;
    if (user == null) return;
    try {
      await user.delete();
    } on FirebaseAuthException catch (e) {
      throw switch (e.code) {
        'requires-recent-login' => const RecentLoginRequired(),
        'network-request-failed' => const SignInFailed('No internet on the phone. Try again when it is back.', offline: true),
        _ => SignInFailed('Firebase did not delete the account (${e.code}). Try again.'),
      };
    }
  }

  @override
  Future<void> reauthenticateWithGoogleIdToken(String idToken) async {
    final user = _auth.currentUser;
    if (user == null) throw const SignInFailed('Sign in first.');
    try {
      await user.reauthenticateWithCredential(GoogleAuthProvider.credential(idToken: idToken));
    } on FirebaseAuthException catch (e) {
      throw switch (e.code) {
        'network-request-failed' => const SignInFailed('No internet on the phone. Try again when it is back.', offline: true),
        'user-mismatch' => const SignInFailed('That is another Google account. Choose the one Orbit is signed in with.'),
        _ => SignInFailed('Google\'s sign-in was not accepted (${e.code}). Try again.'),
      };
    }
  }

  // ---- Realtime Database ----

  @override
  Stream<Object?> values(String path) => _db.ref(path).onValue.map((event) => event.snapshot.value);

  @override
  Future<Object?> get(String path) async => (await _guard(() => _db.ref(path).get())).value;

  @override
  Future<void> set(String path, Object? value) => _guard(() => _db.ref(path).set(value));

  @override
  Future<void> update(String path, Map<String, Object?> values) => _guard(() => _db.ref(path).update(values));

  @override
  Future<void> remove(String path) => _guard(() => _db.ref(path).remove());

  @override
  String pushId(String path) => _db.ref(path).push().key!;

  @override
  Stream<bool> connected() => _db.ref('.info/connected').onValue.map((event) => event.snapshot.value == true);

  @override
  Stream<int> serverTimeOffset() =>
      _db.ref('.info/serverTimeOffset').onValue.map((event) => (event.snapshot.value as num?)?.toInt() ?? 0);

  static Future<T> _guard<T>(Future<T> Function() write) async {
    try {
      return await write();
    } on FirebaseException catch (e) {
      if (e.code == 'permission-denied') throw CloudDenied(e.message);
      rethrow;
    }
  }
}
