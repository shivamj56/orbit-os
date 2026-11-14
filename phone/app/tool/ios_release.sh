#!/bin/sh
# Orbit for iPhone, signed for the App Store, on a Mac with Xcode (docs/ios.md). Signing goes through the App Store
# Connect API key, so nobody has to sign in to Xcode: Xcode makes or fetches the certificate and the provisioning
# profile itself (-allowProvisioningUpdates).
#
#   tool/ios_release.sh            # build/ios/ipa/Orbit.ipa, checked
#   tool/ios_release.sh --upload   # the same, then sent to App Store Connect (TestFlight); never to App Review
#
# Needs: Xcode (xcode-select pointing at it), Flutter 3.47.9 on PATH, the key file AuthKey_<id>.p8 in
# ~/.appstoreconnect/private_keys/, and ASC_KEY_ID and ASC_ISSUER_ID in the environment. Before it: the page in
# assets/ui (tool/sync_ui.sh), the TV bundle in assets/setup (tool/sync_setup.sh, after the launcher APKs), and
# Firebase's plist (tool/ios_firebase.sh). Nothing here prints the key.
set -eu

app=$(cd "$(dirname "$0")/.." && pwd)
upload=false
case "${1:-}" in
  --upload) upload=true ;;
  '') ;;
  *) echo "usage: tool/ios_release.sh [--upload]" >&2; exit 2 ;;
esac

fail() { echo "ios_release: $*" >&2; exit 1; }

: "${ASC_KEY_ID:?ios_release: set ASC_KEY_ID (the App Store Connect API key id)}"
: "${ASC_ISSUER_ID:?ios_release: set ASC_ISSUER_ID (the issuer id of that key)}"
key="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
[ -f "$key" ] || fail "no API key file at $key"

xcodebuild -version >/dev/null 2>&1 || fail "Xcode is not selected: sudo xcode-select -s /Applications/Xcode.app"
want_flutter=3.47.9
have_flutter=$(flutter --version 2>/dev/null | sed -n 's/^Flutter \([0-9.]*\).*/\1/p')
[ "$have_flutter" = "$want_flutter" ] || fail "Flutter is ${have_flutter:-missing}, not $want_flutter (pubspec.lock was made with it)"

[ -s "$app/assets/ui/index.html" ] || fail "assets/ui/index.html is missing: build phone/ui, then tool/sync_ui.sh"
for f in orbit-home.apk orbit-live.apk orbit-setup.sh orbit-undo.sh; do
  [ -s "$app/assets/setup/$f" ] || fail "assets/setup/$f is missing: build the launcher APKs, then tool/sync_setup.sh"
done
grep -q "Orbit's placeholder page" "$app/assets/ui/index.html" && fail "assets/ui holds the placeholder page, not the real one"
[ -f "$app/ios/Runner/GoogleService-Info.plist" ] && [ -f "$app/ios/Flutter/Firebase.xcconfig" ] ||
  fail "Firebase's iPhone settings are missing: tool/ios_firebase.sh path/to/GoogleService-Info.plist"

version=$(sed -n 's/^version: *\([0-9][0-9.]*+[0-9][0-9]*\).*$/\1/p' "$app/pubspec.yaml")
echo "ios_release: Orbit $version"

auth="-allowProvisioningUpdates -authenticationKeyPath $key -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
archive="$app/build/ios/archive/Orbit.xcarchive"
out="$app/build/ios/ipa"
rm -rf "$archive" "$out"

cd "$app"
flutter pub get --enforce-lockfile >/dev/null
# The Xcode project's Flutter settings for a release build (Generated.xcconfig: version, build number, Dart defines).
flutter build ios --release --config-only
# shellcheck disable=SC2086 # $auth is a list of flags
xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$archive" $auth archive | tail -n 25
[ -d "$archive" ] || fail "the archive was not made (the lines above say why)"

# shellcheck disable=SC2086
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist ios/ExportOptions.plist -exportPath "$out" \
  $auth | tail -n 15
ipa=$(ls "$out"/*.ipa 2>/dev/null | head -n 1)
[ -n "$ipa" ] || fail "no IPA was exported"
mv "$ipa" "$out/Orbit.ipa"
ipa="$out/Orbit.ipa"

# What went into it: bundle id, version, the Firebase plist, and the Sign in with Apple entitlement.
check=$(mktemp -d)
unzip -q "$ipa" -d "$check"
plist="$check/Payload/Runner.app/Info.plist"
bundle=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")
short=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")
[ "$bundle" = dev.shiv.orbit ] || fail "the IPA is $bundle, not dev.shiv.orbit"
[ "$short+$build" = "$version" ] || fail "the IPA says $short+$build, pubspec.yaml $version"
[ -f "$check/Payload/Runner.app/GoogleService-Info.plist" ] || fail "the IPA has no GoogleService-Info.plist"
codesign -d --entitlements :- "$check/Payload/Runner.app" 2>/dev/null | grep -q com.apple.developer.applesignin ||
  fail "the IPA is not signed with the Sign in with Apple entitlement"
rm -rf "$check"
echo "ios_release: $ipa ($(wc -c < "$ipa" | tr -d ' ') bytes), dev.shiv.orbit $short ($build), checked"

if $upload; then
  upload_plist=$(mktemp -d)/ExportOptions.plist
  cp ios/ExportOptions.plist "$upload_plist"
  /usr/libexec/PlistBuddy -c 'Set :destination upload' "$upload_plist"
  # shellcheck disable=SC2086
  xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$upload_plist" -exportPath "$out/upload" \
    $auth | tail -n 15
  echo "ios_release: sent to App Store Connect. TestFlight shows it after Apple's processing (usually 5-30 minutes)."
fi
