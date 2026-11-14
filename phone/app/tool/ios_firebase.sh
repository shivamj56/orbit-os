#!/bin/sh
# Firebase's iPhone settings for the Xcode project, from a GoogleService-Info.plist that stays out of git (like
# android/app/google-services.json):
#   - ios/Runner/GoogleService-Info.plist, copied into the app by the Runner target's "Firebase settings" build phase;
#   - ios/Flutter/Firebase.xcconfig, Google Sign-In's URL scheme (the plist's REVERSED_CLIENT_ID).
#
#   tool/ios_firebase.sh path/to/GoogleService-Info.plist     # before building on a Mac (or in CI)
#   tool/ios_firebase.sh --clean                              # both gone again
#
# Without them Orbit builds with the cloud path off. Both paths are git-ignored.
set -eu
app=$(cd "$(dirname "$0")/.." && pwd)
plist="$app/ios/Runner/GoogleService-Info.plist"
xcconfig="$app/ios/Flutter/Firebase.xcconfig"

if [ "${1:-}" = "--clean" ]; then
  rm -f "$plist" "$xcconfig"
  echo "ios_firebase: removed GoogleService-Info.plist and Firebase.xcconfig"
  exit 0
fi
src=${1:?usage: tool/ios_firebase.sh path/to/GoogleService-Info.plist | --clean}
[ -f "$src" ] || { echo "ios_firebase: no file at $src" >&2; exit 1; }

read_key() { /usr/libexec/PlistBuddy -c "Print :$1" "$src" 2>/dev/null || true; }
bundle=$(read_key BUNDLE_ID)
reversed=$(read_key REVERSED_CLIENT_ID)
if [ "$bundle" != "dev.shiv.orbit" ]; then
  echo "ios_firebase: this plist is for '$bundle', not dev.shiv.orbit" >&2
  exit 1
fi
case "$reversed" in
  com.googleusercontent.apps.*) ;;
  *)
    echo "ios_firebase: the plist has no REVERSED_CLIENT_ID: turn on Google sign-in in Firebase, then download it again" >&2
    exit 1 ;;
esac

if [ "$(cd "$(dirname "$src")" && pwd)/$(basename "$src")" != "$plist" ]; then
  cp "$src" "$plist"
fi
chmod 600 "$plist"
printf '// Written by tool/ios_firebase.sh from GoogleService-Info.plist. Not in git.\nGOOGLE_REVERSED_CLIENT_ID = %s\n' \
  "$reversed" > "$xcconfig"
echo "ios_firebase: GoogleService-Info.plist and Firebase.xcconfig are in place (bundle $bundle)"
