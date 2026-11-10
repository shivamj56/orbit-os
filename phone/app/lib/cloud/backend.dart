/// What Orbit's cloud path needs from Firebase (phone/SPEC.md, "From anywhere: Firebase"), as interfaces: the app uses
/// FirebaseBackend (firebase_backend.dart), tests use fakes.
library;

/// Orbit's Firebase project (phone/firebase/config.json). Not secrets: these ship inside every Firebase app.
abstract final class CloudConfig {
  /// The web OAuth client: the audience of the Google ID token the TV signs in with.
  static const String webClientId = '560561223032-82e4tpd2lvqt286ocp9cp1hqiln1kutn.apps.googleusercontent.com';

  /// The Realtime Database (Singapore).
  static const String databaseUrl = 'https://orbit-family-room-default-rtdb.asia-southeast1.firebasedatabase.app';
}

/// `{".sv":"timestamp"}`: filled in with the database's own clock when the write reaches it (ServerValue.timestamp).
const Map<String, String> kServerTimestamp = {'.sv': 'timestamp'};

/// The Firebase user (the owner's Google account): the same uid on the phone and on the linked TV.
class CloudUser {
  const CloudUser({required this.uid, this.email});

  final String uid;
  final String? email;

  @override
  bool operator ==(Object other) => other is CloudUser && other.uid == uid && other.email == email;

  @override
  int get hashCode => Object.hash(uid, email);
}

/// The database's rules refused a write: a link code that is not on the TV, or a path that is not this account's.
class CloudDenied implements Exception {
  const CloudDenied([this.message]);

  final String? message;

  @override
  String toString() => 'CloudDenied(${message ?? ''})';
}

/// Signing in did not work; [words] are for the person.
class SignInFailed implements Exception {
  const SignInFailed(this.words, {this.cancelled = false, this.offline = false});

  final String words;

  /// The person closed Google's sheet.
  final bool cancelled;

  /// No internet.
  final bool offline;

  @override
  String toString() => 'SignInFailed($words)';
}

/// Firebase Authentication, as Orbit uses it.
abstract interface class CloudAuth {
  CloudUser? get currentUser;

  /// The signed-in user (or null) at once, and after every change.
  Stream<CloudUser?> userChanges();

  /// Signs in to Firebase with a Google ID token. Throws [SignInFailed].
  Future<CloudUser> signInWithGoogleIdToken(String idToken);

  Future<void> signOut();
}

/// The Realtime Database, as Orbit uses it. Paths have no leading slash (`orbit/{uid}/tv/name`).
abstract interface class CloudDb {
  /// The value at [path] at once, then after every change (null when there is none). A refusal arrives as an error.
  Stream<Object?> values(String path);

  Future<Object?> get(String path);

  /// Throws [CloudDenied] when the rules refuse it.
  Future<void> set(String path, Object? value);

  /// Several children of [path] in one write (a null value deletes that child). Throws [CloudDenied].
  Future<void> update(String path, Map<String, Object?> values);

  Future<void> remove(String path);

  /// A new chronological key for a child of [path] (a push id); nothing is written.
  String pushId(String path);

  /// Whether this phone is connected to the database (`.info/connected`), at once and on every change.
  Stream<bool> connected();

  /// The database's clock minus this phone's, in ms (`.info/serverTimeOffset`).
  Stream<int> serverTimeOffset();
}

/// A JSON-like value from the database as plain Dart: maps with String keys, lists, and the rest as they are.
Object? plainJson(Object? value) {
  if (value is Map) return {for (final e in value.entries) '${e.key}': plainJson(e.value)};
  if (value is List) return [for (final v in value) plainJson(v)];
  return value;
}
