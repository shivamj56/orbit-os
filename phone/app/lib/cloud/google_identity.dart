import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'backend.dart';

/// A Google ID token (a JWT, audience = the web client) and the account it is for.
class GoogleIdToken {
  const GoogleIdToken(this.token, {this.email});

  final String token;
  final String? email;

  /// When Google says it stops being good (about an hour after it was issued).
  DateTime? get expires => jwtExpiry(token);

  /// The account's e-mail, from Google or from the token itself.
  String? get accountEmail => email ?? jwtEmail(token);
}

/// Google's own sign-in (Android's Credential Manager), as Orbit uses it.
abstract interface class GoogleIdentity {
  /// Google's account sheet. Throws [SignInFailed].
  Future<GoogleIdToken> signIn();

  /// A new ID token without asking, when Google allows it; null when it does not.
  Future<GoogleIdToken?> refresh();

  Future<void> signOut();
}

/// [GoogleIdentity] with google_sign_in 7 (Credential Manager), serverClientId = the web client, so the ID token's
/// audience is what Firebase (on the phone and on the TV) accepts.
class PluginGoogleIdentity implements GoogleIdentity {
  PluginGoogleIdentity({required this.serverClientId});

  final String serverClientId;
  Future<void>? _initializing;

  Future<void> _ready() {
    final pending = _initializing ??= GoogleSignIn.instance.initialize(serverClientId: serverClientId);
    return pending.catchError((Object e) {
      // Not ready: the next call tries again.
      _initializing = null;
      throw e;
    });
  }

  @override
  Future<GoogleIdToken> signIn() async {
    try {
      await _ready();
      final account = await GoogleSignIn.instance.authenticate();
      final token = account.authentication.idToken;
      if (token == null) throw const SignInFailed('Google did not vouch for this account. Try again.');
      return GoogleIdToken(token, email: account.email);
    } on GoogleSignInException catch (e) {
      throw describe(e);
    }
  }

  @override
  Future<GoogleIdToken?> refresh() async {
    try {
      await _ready();
      final account = await GoogleSignIn.instance.attemptLightweightAuthentication();
      final token = account?.authentication.idToken;
      return token == null ? null : GoogleIdToken(token, email: account!.email);
    } on Object catch (e) {
      debugPrint('orbit: no quiet Google sign-in: $e');
      return null;
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await _ready();
      await GoogleSignIn.instance.signOut();
    } on Object catch (e) {
      debugPrint('orbit: Google sign-out: $e');
    }
  }

  /// Google's refusal in words for the person.
  static SignInFailed describe(GoogleSignInException e) => switch (e.code) {
    GoogleSignInExceptionCode.canceled => const SignInFailed(
      'Sign-in was closed before an account was chosen.',
      cancelled: true,
    ),
    GoogleSignInExceptionCode.interrupted => const SignInFailed('Sign-in was interrupted. Try again.', cancelled: true),
    GoogleSignInExceptionCode.uiUnavailable => const SignInFailed(
      'This phone could not show Google\'s sign-in. Is a Google account added in its Settings?',
    ),
    GoogleSignInExceptionCode.clientConfigurationError || GoogleSignInExceptionCode.providerConfigurationError =>
      SignInFailed('Google sign-in is not set up for this app (${e.description ?? e.code.name}).'),
    _ => SignInFailed('Google could not sign you in${e.description == null ? '' : ': ${e.description}'}.'),
  };
}

/// A JWT's payload, read but not verified (the database and the TV verify; the phone only needs `exp` and `email`).
Map<String, Object?>? jwtPayload(String token) {
  final parts = token.split('.');
  if (parts.length != 3) return null;
  try {
    final decoded = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))));
    return decoded is Map ? {for (final e in decoded.entries) '${e.key}': e.value} : null;
  } on FormatException {
    return null;
  }
}

DateTime? jwtExpiry(String token) {
  final exp = jwtPayload(token)?['exp'];
  return exp is num ? DateTime.fromMillisecondsSinceEpoch((exp * 1000).round()) : null;
}

String? jwtEmail(String token) {
  final email = jwtPayload(token)?['email'];
  return email is String && email.isNotEmpty ? email : null;
}
