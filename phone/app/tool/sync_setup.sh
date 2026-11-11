#!/bin/sh
# Puts the TV-side install bundle into the app, under phone/app/assets/setup/ (phone/SPEC.md, "Bundled files"):
#
#   launcher/app/build/outputs/apk/release/app-release.apk        -> orbit-home.apk
#   launcher/livetv/build/outputs/apk/release/livetv-release.apk  -> orbit-live.apk
#   setup/tv/orbit-setup.sh                                       -> orbit-setup.sh
#   setup/tv/orbit-undo.sh                                        -> orbit-undo.sh
#
# Run it before `flutter build apk`. Every source must be there already; a missing one is an error (build the
# launcher APKs with launcher/gradlew, and the two scripts come from the main agent's setup/tv/).
set -eu

app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
repo_dir=$(CDPATH='' cd -- "$app_dir/../.." && pwd)
dest="$app_dir/assets/setup"

# source -> bundled name
set -- \
  "$repo_dir/launcher/app/build/outputs/apk/release/app-release.apk:orbit-home.apk" \
  "$repo_dir/launcher/livetv/build/outputs/apk/release/livetv-release.apk:orbit-live.apk" \
  "$repo_dir/setup/tv/orbit-setup.sh:orbit-setup.sh" \
  "$repo_dir/setup/tv/orbit-undo.sh:orbit-undo.sh"

missing=''
for pair do
  src=${pair%:*}
  if [ ! -f "$src" ]; then
    missing="$missing\n  $src"
  fi
done
if [ -n "$missing" ]; then
  printf 'sync_setup: these source files are missing, so the bundle is not complete:%b\n' "$missing" >&2
  printf 'sync_setup: build the launcher APKs (launcher/gradlew :app:assembleRelease :livetv:assembleRelease)\n' >&2
  printf 'sync_setup: and make sure setup/tv/orbit-setup.sh and orbit-undo.sh exist.\n' >&2
  exit 1
fi

mkdir -p "$dest"
for pair do
  src=${pair%:*}
  name=${pair#*:}
  cp -- "$src" "$dest/$name.part"
  mv -- "$dest/$name.part" "$dest/$name"
  bytes=$(wc -c < "$dest/$name" | tr -d ' ')
  echo "sync_setup: $src -> $dest/$name ($bytes bytes)"
done
