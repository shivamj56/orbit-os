#!/bin/sh
# Checks a built APK before it goes anywhere: its package name, its version, and a valid signature from the one
# expected key (docs/ci-cd.md, "What every build checks").
#
#   .github/scripts/verify-apk.sh APK PACKAGE SIGNER_SHA256 [VERSION_NAME VERSION_CODE]
#
# aapt2 and apksigner come from the newest build-tools in $ANDROID_HOME (or $ANDROID_SDK_ROOT); apksigner needs a JDK.
# Under GitHub Actions it also writes version_name= and version_code= to the step's outputs and a row to the summary.
set -eu

if [ $# -ne 3 ] && [ $# -ne 5 ]; then
  echo "usage: $0 APK PACKAGE SIGNER_SHA256 [VERSION_NAME VERSION_CODE]" >&2
  exit 2
fi
apk=$1
package=$2
want_signer=$(printf '%s' "$3" | tr -d ':' | tr 'A-F' 'a-f')

fail() {
  echo "::error::verify-apk: $apk: $*" >&2
  exit 1
}

[ -s "$apk" ] || fail "missing or empty"
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$sdk" ] && [ -d "$sdk/build-tools" ] || fail "set ANDROID_HOME to an Android SDK with build-tools"
tools="$sdk/build-tools/$(ls "$sdk/build-tools" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)"

# package: name='dev.shiv.orbit' versionCode='5' versionName='1.4.0' platformBuildVersionName=...
line=$("$tools/aapt2" dump badging "$apk" 2>/dev/null | sed -n '1p') || true
[ -n "$line" ] || fail "aapt2 cannot read it"
got_package=$(printf '%s\n' "$line" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
got_code=$(printf '%s\n' "$line" | sed -n "s/.* versionCode='\([^']*\)'.*/\1/p")
got_name=$(printf '%s\n' "$line" | sed -n "s/.* versionName='\([^']*\)'.*/\1/p")

[ "$got_package" = "$package" ] || fail "package is '$got_package', expected '$package'"
if [ $# -eq 5 ]; then
  [ "$got_name" = "$4" ] || fail "versionName is '$got_name', expected '$4'"
  [ "$got_code" = "$5" ] || fail "versionCode is '$got_code', expected '$5'"
fi

certs=$("$tools/apksigner" verify --print-certs "$apk" 2>&1) || fail "the signature does not verify: $certs"
# "Signer #1 certificate SHA-256 digest: …", or "Signer (minSdkVersion=…) certificate …" from newer apksigners,
# which list a certificate once per Android version range: the same certificate counts once.
signers=$(printf '%s\n' "$certs" | sed -n 's/^Signer.* certificate SHA-256 digest: *//p' | sort -u)
count=$(printf '%s\n' "$signers" | grep -c . || true)
[ "$count" -eq 1 ] ||
  fail "expected one signing certificate, found $count; $(basename -- "$tools")/apksigner said: $(printf '%s' "$certs" | head -n 12 | tr '\n' '|')"
[ "$signers" = "$want_signer" ] || fail "signed by $signers, expected $want_signer"

bytes=$(wc -c < "$apk" | tr -d ' ')
echo "verify-apk: $apk: $got_package $got_name ($got_code), $bytes bytes, signer $signers"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'version_name=%s\nversion_code=%s\n' "$got_name" "$got_code" >> "$GITHUB_OUTPUT"
fi
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '| `%s` | `%s` | %s (%s) | %s | `%s…` |\n' "$(basename -- "$apk")" "$got_package" "$got_name" "$got_code" \
    "$bytes" "$(printf '%s' "$signers" | cut -c1-16)" >> "$GITHUB_STEP_SUMMARY"
fi
