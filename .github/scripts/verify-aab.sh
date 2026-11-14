#!/bin/sh
# Checks the Play bundle before it is kept or uploaded: package name, version, and a signature from Orbit's upload key
# (docs/ci-cd.md, "What every build checks").
#
#   .github/scripts/verify-aab.sh AAB PACKAGE SIGNER_SHA256 VERSION_NAME VERSION_CODE
#
# Needs BUNDLETOOL_JAR (Google's bundletool; the workflows fetch a pinned, checksummed copy) and a JDK on PATH.
set -eu

if [ $# -ne 5 ]; then
  echo "usage: $0 AAB PACKAGE SIGNER_SHA256 VERSION_NAME VERSION_CODE" >&2
  exit 2
fi
aab=$1
package=$2
want_signer=$(printf '%s' "$3" | tr -d ':' | tr 'A-F' 'a-f')

fail() {
  echo "::error::verify-aab: $aab: $*" >&2
  exit 1
}

[ -s "$aab" ] || fail "missing or empty"
[ -n "${BUNDLETOOL_JAR:-}" ] && [ -s "$BUNDLETOOL_JAR" ] || fail "set BUNDLETOOL_JAR to bundletool's jar"

manifest() {
  java -jar "$BUNDLETOOL_JAR" dump manifest --bundle "$aab" --xpath "$1" 2>/dev/null | tr -d '\r'
}
got_package=$(manifest /manifest/@package)
got_code=$(manifest /manifest/@android:versionCode)
got_name=$(manifest /manifest/@android:versionName)
[ "$got_package" = "$package" ] || fail "package is '$got_package', expected '$package'"
[ "$got_name" = "$4" ] || fail "versionName is '$got_name', expected '$4'"
[ "$got_code" = "$5" ] || fail "versionCode is '$got_code', expected '$5'"

# A bundle carries a JAR signature: jarsigner checks it, keytool names the certificate.
jarsigner -verify "$aab" 2>/dev/null | grep -q '^jar verified' || fail "jarsigner does not verify its signature"
signer=$(keytool -printcert -jarfile "$aab" 2>/dev/null | sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' |
  head -n 1 | tr -d ':' | tr 'A-F' 'a-f')
[ "$signer" = "$want_signer" ] || fail "signed by '$signer', expected $want_signer"

bytes=$(wc -c < "$aab" | tr -d ' ')
echo "verify-aab: $aab: $got_package $got_name ($got_code), $bytes bytes, signer $signer"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '| `%s` | `%s` | %s (%s) | %s | `%s…` |\n' "$(basename -- "$aab")" "$got_package" "$got_name" "$got_code" \
    "$bytes" "$(printf '%s' "$signer" | cut -c1-16)" >> "$GITHUB_STEP_SUMMARY"
fi
