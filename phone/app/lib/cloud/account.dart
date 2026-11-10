import 'dart:async';

import 'package:flutter/foundation.dart';

import 'backend.dart';
import 'google_identity.dart';

/// The phone's Google account in Firebase: signing in and out, and a Google ID token that is still good for linking the
/// TV (the TV signs in with it; Google's tokens last about an hour).
class CloudAccount {
  CloudAccount({
    required this._auth,
    required this._google,
    this.tokenMargin = const Duration(minutes: 5),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final CloudAuth _auth;
  final GoogleIdentity _google;
  final DateTime Function() _clock;

  /// A kept ID token is used only while it has at least this long left.
  final Duration tokenMargin;

  /// Every change of [user].
  void Function()? onChange;

  CloudUser? _user;
  GoogleIdToken? _idToken;
  StreamSubscription<CloudUser?>? _changes;

  CloudUser? get user => _user;

  bool get signedIn => _user != null;

  String? get email => _user?.email;

  String? get uid => _user?.uid;

  /// Follows Firebase's signed-in user (it stays signed in across runs).
  void start() {
    _user = _auth.currentUser;
    _changes ??= _auth.userChanges().listen(_take, onError: (Object e) => debugPrint('orbit: auth: $e'));
  }

  /// Google's account sheet, then Firebase. Throws [SignInFailed].
  Future<void> signIn() async {
    final google = await _google.signIn();
    _idToken = google;
    _take(await _auth.signInWithGoogleIdToken(google.token));
  }

  Future<void> signOut() async {
    _idToken = null;
    try {
      await _auth.signOut();
    } finally {
      await _google.signOut();
      _take(null);
    }
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
    if (user == null) _idToken = null;
    if (user == _user) return;
    _user = user;
    onChange?.call();
  }

  void dispose() {
    unawaited(_changes?.cancel());
    _changes = null;
  }
}
