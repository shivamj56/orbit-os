#!/bin/sh
# Puts Orbit's signing keys and Firebase file in place for a build on GitHub, from base64 secrets, and takes them away
# again afterwards (docs/ci-cd.md, "Secrets"). It never prints a secret: only file names and the certificates' public
# SHA-256 fingerprints.
#
#   .github/scripts/signing.sh phone   ORBIT_GOOGLE_SERVICES_JSON_BASE64, ORBIT_RELEASE_KEYSTORE_BASE64,
#                                      ORBIT_KEYSTORE_PASSWORD, ORBIT_KEY_ALIAS and ORBIT_KEY_PASSWORD become
#                                      phone/app/android/app/google-services.json, android/app/orbit-release.jks and
#                                      android/key.properties, the files a release build reads (app/build.gradle.kts)
#   .github/scripts/signing.sh tv      ORBIT_TV_DEBUG_KEYSTORE_BASE64 becomes $ANDROID_USER_HOME/debug.keystore, the
#                                      key both TV apps are signed with (launcher/*/build.gradle: signingConfigs.debug)
#   .github/scripts/signing.sh clean   removes every file the two above wrote, and nothing else
#
# A file that is already there is never overwritten, so a run on a computer that holds the real files stops instead of
# replacing them. With ORBIT_PHONE_SIGNER_SHA256 / ORBIT_TV_SIGNER_SHA256 set, a key whose certificate is another one
# stops here, before the build: an APK signed with another key cannot update Orbit on a phone or the apps on a TV.
set -eu

repo_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)
android_dir="$repo_dir/phone/app/android"
# The list of files this script wrote, for `clean`.
written="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/orbit-signing-files"

fail() {
  echo "::error::signing: $*" >&2
  exit 1
}

# value NAME: the value of the environment variable NAME (empty when it is not set).
value() {
  eval "printf '%s' \"\${$1:-}\""
}

# decode NAME FILE: the base64 secret in $NAME, written to FILE with mode 0600. Spaces and line breaks from a pasted
# value are dropped first.
decode() {
  [ -n "$(value "$1")" ] || fail "the secret $1 is empty or not set (docs/ci-cd.md, \"Secrets\")"
  [ ! -e "$2" ] || fail "$2 is already there; it is left alone (signing.sh only writes into a fresh checkout)"
  mkdir -p "$(dirname -- "$2")"
  umask 077
  printf '%s\n' "$2" >> "$written"
  value "$1" | tr -d ' \t\r\n' | base64 -d > "$2" 2>/dev/null || fail "the secret $1 is not valid base64"
  [ -s "$2" ] || fail "the secret $1 decodes to an empty file"
}

# fingerprint KEYSTORE PASSWORD_VARIABLE ALIAS: the certificate's SHA-256 in lowercase hex, without colons (keytool
# reads the password from the variable, so it is not on any command line).
fingerprint() {
  keytool -list -v -keystore "$1" -storepass:env "$2" -alias "$3" 2>/dev/null |
    sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' | head -n 1 | tr -d ':' | tr 'A-F' 'a-f'
}

# check_signer LABEL FINGERPRINT EXPECTED_VARIABLE
check_signer() {
  [ -n "$2" ] || fail "the $1 keystore does not open with its password and alias"
  echo "signing: $1 certificate SHA-256 $2"
  expected=$(value "$3" | tr -d ':' | tr 'A-F' 'a-f')
  if [ -n "$expected" ] && [ "$2" != "$expected" ]; then
    fail "the $1 key's certificate is $2, not $expected ($3): builds signed with it could not update the installed apps"
  fi
}

phone() {
  decode ORBIT_GOOGLE_SERVICES_JSON_BASE64 "$android_dir/app/google-services.json"
  grep -q '"package_name":[[:space:]]*"dev.shiv.orbit"' "$android_dir/app/google-services.json" ||
    fail "ORBIT_GOOGLE_SERVICES_JSON_BASE64 has no Android app dev.shiv.orbit: is it this project's google-services.json?"
  decode ORBIT_RELEASE_KEYSTORE_BASE64 "$android_dir/app/orbit-release.jks"
  for name in ORBIT_KEYSTORE_PASSWORD ORBIT_KEY_ALIAS ORBIT_KEY_PASSWORD; do
    [ -n "$(value "$name")" ] || fail "the secret $name is empty or not set (docs/ci-cd.md, \"Secrets\")"
  done
  # A value piped into `gh secret set` can end in a line break: command substitution drops it (and tr any \r).
  ORBIT_KEYSTORE_PASSWORD=$(value ORBIT_KEYSTORE_PASSWORD | tr -d '\r')
  ORBIT_KEY_PASSWORD=$(value ORBIT_KEY_PASSWORD | tr -d '\r')
  ORBIT_KEY_ALIAS=$(value ORBIT_KEY_ALIAS | tr -d '\r')
  export ORBIT_KEYSTORE_PASSWORD ORBIT_KEY_PASSWORD ORBIT_KEY_ALIAS
  [ ! -e "$android_dir/key.properties" ] || fail "$android_dir/key.properties is already there; it is left alone"
  umask 077
  printf '%s\n' "$android_dir/key.properties" >> "$written"
  # The same four lines as android/key.properties on the Mac; storeFile is read relative to android/app.
  {
    printf 'storePassword=%s\n' "$ORBIT_KEYSTORE_PASSWORD"
    printf 'keyPassword=%s\n' "$ORBIT_KEY_PASSWORD"
    printf 'keyAlias=%s\n' "$ORBIT_KEY_ALIAS"
    printf 'storeFile=orbit-release.jks\n'
  } > "$android_dir/key.properties"
  check_signer "phone release" \
    "$(fingerprint "$android_dir/app/orbit-release.jks" ORBIT_KEYSTORE_PASSWORD "$ORBIT_KEY_ALIAS")" \
    ORBIT_PHONE_SIGNER_SHA256
  echo "signing: google-services.json, orbit-release.jks and key.properties are in place (mode 0600)"
}

tv() {
  [ -n "${ANDROID_USER_HOME:-}" ] || fail "set ANDROID_USER_HOME first: Gradle signs the TV apps with its debug.keystore"
  decode ORBIT_TV_DEBUG_KEYSTORE_BASE64 "$ANDROID_USER_HOME/debug.keystore"
  # Android's own fixed password for every debug keystore.
  ORBIT_DEBUG_STOREPASS=android
  export ORBIT_DEBUG_STOREPASS
  check_signer "TV" "$(fingerprint "$ANDROID_USER_HOME/debug.keystore" ORBIT_DEBUG_STOREPASS androiddebugkey)" \
    ORBIT_TV_SIGNER_SHA256
  echo "signing: the TV apps' key is in $ANDROID_USER_HOME (mode 0600)"
}

clean() {
  if [ -f "$written" ]; then
    while IFS= read -r file; do
      rm -f -- "$file"
    done < "$written"
    rm -f -- "$written"
  fi
  echo "signing: the keys and the Firebase file written for this build are gone"
}

case "${1:-}" in
  phone) phone ;;
  tv) tv ;;
  clean) clean ;;
  *)
    echo "usage: $0 phone|tv|clean" >&2
    exit 2
    ;;
esac
