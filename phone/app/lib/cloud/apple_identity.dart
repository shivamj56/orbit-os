import 'dart:convert';
import 'dart:math';

import 'package:flutter/services.dart';

import 'backend.dart';
import 'google_identity.dart';

/// What Apple's sheet answers (Sign in with Apple): the identity token (a JWT for Firebase, and for the TV when it
/// links), the nonce the token carries the SHA-256 of, a one-time authorization code (for taking Sign in with Apple back
/// when the account is deleted), and the e-mail and name, which Apple tells only the first time.
class AppleCredential {
  const AppleCredential({
    required this.identityToken,
    required this.rawNonce,
    required this.authorizationCode,
    this.email,
    this.givenName,
    this.familyName,
  });

  final String identityToken;
  final String rawNonce;
  final String authorizationCode;
  final String? email;
  final String? givenName;
  final String? familyName;

  /// When Apple says the token stops being good (ten minutes after the sheet).
  DateTime? get expires => jwtExpiry(identityToken);

  /// What the TV is given to sign in as the same account (`/link/{code}/token`, phone/SPEC.md "Sign in with Apple"):
  /// `apple.com|<nonce>|<identity token>`. A Google ID token is written as it is; neither the nonce (base64url) nor a
  /// JWT holds a `|`.
  String get linkToken => '$kAppleProvider|$rawNonce|$identityToken';
}

/// Sign in with Apple, as Orbit uses it (only on an iPhone).
abstract interface class AppleIdentity {
  /// Apple's sheet, each time (Apple has no quiet sign-in). Throws [SignInFailed], `cancelled` when it was closed.
  Future<AppleCredential> signIn();
}

/// [AppleIdentity] through the phone's own channel (ios/Runner/NativeChannel.swift, `appleSignIn`): the nonce is made
/// here, and the phone hands Apple its SHA-256.
class PlatformAppleIdentity implements AppleIdentity {
  const PlatformAppleIdentity();

  static const MethodChannel _channel = MethodChannel('dev.shiv.orbit/native');

  @override
  Future<AppleCredential> signIn() async {
    final nonce = makeNonce();
    final Map<String, Object?>? answer;
    try {
      answer = await _channel.invokeMapMethod<String, Object?>('appleSignIn', nonce);
    } on PlatformException catch (e) {
      throw describe(e.code);
    } on MissingPluginException {
      throw const SignInFailed('Sign in with Apple is only on iPhone.');
    }
    final token = answer?['identityToken'];
    final code = answer?['authorizationCode'];
    if (token is! String || code is! String) throw const SignInFailed('Apple did not say who you are. Try again.');
    String? text(String key) {
      final value = answer?[key];
      return value is String && value.trim().isNotEmpty ? value.trim() : null;
    }

    return AppleCredential(
      identityToken: token,
      rawNonce: nonce,
      authorizationCode: code,
      email: text('email') ?? jwtEmail(token),
      givenName: text('givenName'),
      familyName: text('familyName'),
    );
  }

  /// Apple's refusal (ASAuthorizationError, as NativeChannel.swift names it) in words for the person.
  static SignInFailed describe(String code) => switch (code) {
    'canceled' => const SignInFailed('Sign-in was closed before Apple said who you are.', cancelled: true),
    'busy' => const SignInFailed('Apple\'s sign-in is already open.', cancelled: true),
    'notInteractive' => const SignInFailed('Apple could not show its sign-in here. Try again.'),
    _ => const SignInFailed('Apple could not sign you in. Check that this iPhone is signed in to an Apple Account.'),
  };
}

/// 32 random bytes, base64url without padding: the nonce Firebase checks Apple's token against.
String makeNonce([Random? random]) {
  final source = random ?? Random.secure();
  return base64Url.encode([for (var i = 0; i < 32; i++) source.nextInt(256)]).replaceAll('=', '');
}
