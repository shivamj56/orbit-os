import 'dart:async';

import 'package:flutter/foundation.dart';

import 'apple_identity.dart';
import 'backend.dart';
import 'google_identity.dart';

/// The phone's account in Firebase — a Google account, or on an iPhone an Apple ID too (Sign in with Apple): signing in
/// and out, and what the TV is given to sign in as the same account when it is linked (a Google ID token, which lasts
/// about an hour; or Apple's identity token with its nonce, which lasts ten minutes).
class CloudAccount {
  CloudAccount({
    required this._auth,
    required this._google,
    this._apple,
    this.tokenMargin = const Duration(minutes: 5),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final CloudAuth _auth;
  final GoogleIdentity _google;

  /// Sign in with Apple; null where it is not offered (Android).
  final AppleIdentity? _apple;
  final DateTime Function() _clock;

  /// A kept ID token is used only while it has at least this long left.
  final Duration tokenMargin;

  /// Every change of [user].
  void Function()? onChange;

  CloudUser? _user;
  GoogleIdToken? _idToken;

  /// Apple's answer from signing in, until a TV is given it or it gets too old.
  AppleCredential? _appleCredential;
  StreamSubscription<CloudUser?>? _changes;

  CloudUser? get user => _user;

  bool get signedIn => _user != null;

  String? get email => _user?.email;

  String? get uid => _user?.uid;

  /// Sign in with Apple is offered on this phone.
  bool get offersApple => _apple != null;

  /// How the account signed in, as the page names it: "apple" or "google"; null when signed out.
  String? get provider => switch (_user) {
    null => null,
    final user when user.isApple => 'apple',
    _ => 'google',
  };

  /// The words when something needs an account and there is none.
  String get signInFirst => offersApple ? 'Sign in first.' : 'Sign in with Google first.';

  /// Follows Firebase's signed-in user (it stays signed in across runs).
  void start() {
    _user = _auth.currentUser;
    _changes ??= _auth.userChanges().listen(_take, onError: (Object e) => debugPrint('orbit: auth: $e'));
  }

  /// Google's account sheet (or with [apple], Apple's), then Firebase. Throws [SignInFailed].
  Future<void> signIn({bool apple = false}) async {
    if (apple) {
      final credential = await _appleIdentity().signIn();
      _take(
        await _auth.signInWithAppleIdToken(
          credential.identityToken,
          credential.rawNonce,
          givenName: credential.givenName,
          familyName: credential.familyName,
        ),
      );
      _appleCredential = credential;
      return;
    }
    final google = await _google.signIn();
    _idToken = google;
    _take(await _auth.signInWithGoogleIdToken(google.token));
  }

  AppleIdentity _appleIdentity() =>
      _apple ?? (throw const SignInFailed('Sign in with Apple is only on iPhone. Continue with Google instead.'));

  Future<void> signOut() async {
    _idToken = null;
    _appleCredential = null;
    try {
      await _auth.signOut();
    } finally {
      await _google.signOut();
      _take(null);
    }
  }

  /// Deletes this Firebase user (phone/SPEC.md, "Deleting the account"). When Firebase wants a recent sign-in, Google
  /// vouches again (quietly if it can, else its sheet), for the same account only. An Apple account goes through Apple's
  /// sheet once instead ([_deleteApple]). Then Google forgets Orbit (its permissions too, Drive's included) and this
  /// phone is signed out. Throws [SignInFailed].
  Future<void> deleteUser() async {
    if (!signedIn) return;
    if (_user!.isApple) {
      await _deleteApple();
    } else {
      await _deleteGoogle();
    }
    _idToken = null;
    _appleCredential = null;
    await _google.revoke();
    try {
      await _auth.signOut();
    } on Object catch (e) {
      debugPrint('orbit: sign-out after delete: $e');
    }
    _take(null);
  }

  Future<void> _deleteGoogle() async {
    try {
      await _auth.deleteUser();
    } on RecentLoginRequired {
      final google = await _google.refresh() ?? await _google.signIn();
      if (!_sameAccount(google)) {
        throw SignInFailed('Choose ${_user?.email ?? 'the account Orbit is signed in with'} to delete it.');
      }
      await _auth.reauthenticateWithGoogleIdToken(google.token);
      try {
        await _auth.deleteUser();
      } on RecentLoginRequired {
        throw const SignInFailed('Google did not confirm it is you. Try again.');
      }
    }
  }

  /// An Apple account: Apple's sheet once, for a fresh authorization code and identity token. With the code Apple is
  /// asked to stop Sign in with Apple for Orbit (Apple's rule for deleted accounts); the token is the recent sign-in if
  /// Firebase wants one.
  Future<void> _deleteApple() async {
    final apple = await _appleIdentity().signIn();
    try {
      await _auth.revokeAppleAuthorization(apple.authorizationCode);
    } on Object catch (e) {
      // The account still goes; Orbit can also be removed under Sign in with Apple in the iPhone's Settings.
      debugPrint('orbit: Sign in with Apple not revoked: $e');
    }
    try {
      await _auth.deleteUser();
    } on RecentLoginRequired {
      await _auth.reauthenticateWithAppleIdToken(apple.identityToken, apple.rawNonce);
      try {
        await _auth.deleteUser();
      } on RecentLoginRequired {
        throw const SignInFailed('Apple did not confirm it is you. Try again.');
      }
    }
  }

  /// What the TV signs in with as this account when it is linked (`/link/{code}/token`): a Google account's ID token
  /// ([freshIdToken]); an Apple account's identity token with its nonce ([AppleCredential.linkToken]), the one from
  /// signing in while it has at least [tokenMargin] left and no TV has had it, else from Apple's sheet once more.
  /// Throws [SignInFailed].
  Future<String> linkToken() async {
    final user = _user;
    if (user == null || !user.isApple) return freshIdToken();
    final kept = _appleCredential;
    _appleCredential = null;
    final expires = kept?.expires;
    if (kept != null && expires != null && expires.difference(_clock()) > tokenMargin) return kept.linkToken;
    return (await _appleIdentity().signIn()).linkToken;
  }

  /// The Google account whose Drive keeps the backups: a Google account's own; for an Apple account the Google account
  /// this phone uses with Orbit, which Google's sheet asks for the first time (null when there is none and [prompt] is
  /// false). Throws [DriveError] when Google says no.
  Future<String?> driveEmail({bool prompt = true}) async {
    final user = _user;
    if (user == null) return null;
    if (!user.isApple) return user.email;
    return _google.accountEmail(prompt: prompt);
  }

  /// A Google ID token for this account with at least [tokenMargin] left: the kept one, else a new one from Google
  /// without asking, else from Google's sheet. Throws [SignInFailed].
  ///
  /// If the account Google answers for is not the one signed in to Firebase (another account chosen in the sheet),
  /// Firebase is signed in again with it, so the TV and the phone end up as the same user.
  Future<String> freshIdToken() async {
    final kept = _idToken;
    if (kept != null && _goodFor(kept) && _sameAccount(kept)) return kept.token;
    final token = await _google.refresh() ?? await _google.signIn();
    _idToken = token;
    if (!_sameAccount(token)) _take(await _auth.signInWithGoogleIdToken(token.token));
    return token.token;
  }

  bool _goodFor(GoogleIdToken token) {
    final expires = token.expires;
    return expires != null && expires.difference(_clock()) > tokenMargin;
  }

  bool _sameAccount(GoogleIdToken token) {
    final mine = _user?.email;
    final theirs = token.accountEmail;
    return mine != null && theirs != null && mine.toLowerCase() == theirs.toLowerCase();
  }

  void _take(CloudUser? user) {
    if (user == null) {
      _idToken = null;
      _appleCredential = null;
    }
    if (user == _user) return;
    _user = user;
    onChange?.call();
  }

  void dispose() {
    unawaited(_changes?.cancel());
    _changes = null;
  }
}
