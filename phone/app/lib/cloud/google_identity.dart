import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import 'backend.dart';
import 'drive.dart';

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

  /// Signs out and takes back every permission this app was given (Drive too): when the account is deleted.
  Future<void> revoke();
}

/// [GoogleIdentity] with google_sign_in 7 (Credential Manager), serverClientId = the web client, so the ID token's
/// audience is what Firebase (on the phone and on the TV) accepts. It is also the [DriveAuthorizer] for backups: the
/// 7.x authorization API, for drive.appdata, on the same account.
class PluginGoogleIdentity implements GoogleIdentity, DriveAuthorizer {
  PluginGoogleIdentity({required this.serverClientId});

  final String serverClientId;
  Future<void>? _initializing;

  /// The account Google last vouched for in this run (authorization is asked for on it).
  GoogleSignInAccount? _account;

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
      _account = account;
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
      if (account != null) _account = account;
      final token = account?.authentication.idToken;
      return token == null ? null : GoogleIdToken(token, email: account!.email);
    } on Object catch (e) {
      debugPrint('orbit: no quiet Google sign-in: $e');
      return null;
    }
  }

  @override
  Future<void> signOut() async {
    _account = null;
    try {
      await _ready();
      await GoogleSignIn.instance.signOut();
    } on Object catch (e) {
      debugPrint('orbit: Google sign-out: $e');
    }
  }

  @override
  Future<void> revoke() async {
    _account = null;
    try {
      await _ready();
      await GoogleSignIn.instance.disconnect();
    } on Object catch (e) {
      debugPrint('orbit: Google disconnect: $e');
      await signOut();
    }
  }

  // ---- Drive (backups) ----

  @override
  Future<String?> accessToken(String email, {bool prompt = true}) async {
    try {
      await _ready();
      final account = await _accountFor(email, prompt: prompt);
      if (account == null) return null;
      final client = account.authorizationClient;
      final have = await client.authorizationForScopes(const [kDriveAppDataScope]);
      if (have != null) return have.accessToken;
      if (!prompt) return null;
      // Google's own sheet: "Orbit wants to see, create and delete its own configuration data in your Google Drive".
      return (await client.authorizeScopes(const [kDriveAppDataScope])).accessToken;
    } on GoogleSignInException catch (e) {
      throw describeDrive(e);
    } on DriveError {
      rethrow;
    } on Object catch (e) {
      debugPrint('orbit: drive authorization: $e');
      throw const DriveError('auth', 'Google could not give Orbit access to your Drive. Try again.');
    }
  }

  /// The signed-in account, as google_sign_in knows it: the one kept from this run, else Google's quiet sign-in, else
  /// Google's account sheet. Another account chosen there is refused (the backups go to the signed-in one's Drive).
  Future<GoogleSignInAccount?> _accountFor(String email, {required bool prompt}) async {
    bool same(GoogleSignInAccount? a) => a != null && a.email.toLowerCase() == email.toLowerCase();
    if (same(_account)) return _account!;
    final quiet = GoogleSignIn.instance.attemptLightweightAuthentication();
    final found = quiet == null ? null : await quiet;
    if (same(found)) return _account = found!;
    if (!prompt) return null;
    final chosen = await GoogleSignIn.instance.authenticate(scopeHint: const [kDriveAppDataScope]);
    if (same(chosen)) return _account = chosen;
    throw DriveError(
      'noAccount',
      'Choose $email in Google\'s sheet: the backups go to the Drive of the account Orbit is signed in with.',
    );
  }

  @override
  Future<void> forget(String token) async {
    try {
      await GoogleSignIn.instance.authorizationClient.clearAuthorizationToken(accessToken: token);
    } on Object catch (e) {
      debugPrint('orbit: drive token not cleared: $e');
    }
  }

  /// Google's refusal of Drive, in words for the person. Android reports a closed consent sheet as an API exception with
  /// status 16 (CANCELED), and no network as status 7.
  static DriveError describeDrive(GoogleSignInException e) {
    final said = (e.description ?? '').toLowerCase();
    switch (e.code) {
      case GoogleSignInExceptionCode.canceled || GoogleSignInExceptionCode.interrupted:
        return _refused;
      case GoogleSignInExceptionCode.uiUnavailable:
        return const DriveError('noAccount', 'This phone could not show Google\'s sheet. Is a Google account added in its Settings?');
      case GoogleSignInExceptionCode.clientConfigurationError || GoogleSignInExceptionCode.providerConfigurationError:
        return DriveError('auth', 'Google Drive is not set up for this app yet (${e.description ?? e.code.name}).');
      default:
        if (said.contains('network') || RegExp(r'(^|\D)7:').hasMatch(said)) {
          return const DriveError('offline', 'No internet on this phone. Try again when it is back.');
        }
        if (RegExp(r'(^|\D)16:').hasMatch(said) || said.contains('cancel')) return _refused;
        return DriveError('auth', 'Google could not give Orbit access to your Drive${e.description == null ? '' : ': ${e.description}'}.');
    }
  }

  static const DriveError _refused = DriveError(
    'refused',
    'Google Drive was not allowed, so nothing was saved there. Orbit only asks for its own hidden folder in your Drive, '
        'which no other app can see.',
  );

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
