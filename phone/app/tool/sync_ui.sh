#!/bin/sh
# Puts the web interface into the app: phone/ui/dist/index.html -> phone/app/assets/ui/index.html.
#
#   tool/sync_ui.sh                 copy the built interface (run `npm run build` in phone/ui first)
#   tool/sync_ui.sh --placeholder   put the small bridge-test page back (tool/placeholder/index.html)
#
# Then build: flutter build apk --release
set -eu

app_dir=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
dest="$app_dir/assets/ui/index.html"

if [ "${1:-}" = "--placeholder" ]; then
  src="$app_dir/tool/placeholder/index.html"
else
  src="$app_dir/../ui/dist/index.html"
  if [ ! -f "$src" ]; then
    echo "sync_ui: $src is not built yet; $dest is left as it is." >&2
    exit 0
  fi
fi

mkdir -p "$(dirname -- "$dest")"
cp -- "$src" "$dest.part"
mv -- "$dest.part" "$dest"
bytes=$(wc -c < "$dest" | tr -d ' ')
echo "sync_ui: $src -> $dest ($bytes bytes)"
