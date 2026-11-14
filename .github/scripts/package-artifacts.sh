#!/bin/sh
# Gathers built files under their release names into one folder for upload, with SHA256SUMS and build-info.json
# (the commit, the run, the version and each file's size and SHA-256).
#
#   .github/scripts/package-artifacts.sh OUT_DIR SOURCE=NAME [SOURCE=NAME ...]
#
# ORBIT_VERSION (e.g. 1.4.0+5) goes into build-info.json when it is set; the GITHUB_* values when Actions runs it.
set -eu

if [ $# -lt 2 ]; then
  echo "usage: $0 OUT_DIR SOURCE=NAME [SOURCE=NAME ...]" >&2
  exit 2
fi
out=$1
shift

if command -v sha256sum > /dev/null 2>&1; then
  sha256() { sha256sum -- "$1" | cut -d' ' -f1; }
else
  sha256() { shasum -a 256 -- "$1" | cut -d' ' -f1; }
fi
# JSON string contents: backslashes and double quotes escaped.
json() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

mkdir -p "$out"
: > "$out/SHA256SUMS"
files=''
for pair do
  src=${pair%%=*}
  name=${pair#*=}
  if [ ! -s "$src" ]; then
    echo "::error::package-artifacts: $src is missing or empty" >&2
    exit 1
  fi
  cp -- "$src" "$out/$name"
  sum=$(sha256 "$out/$name")
  bytes=$(wc -c < "$out/$name" | tr -d ' ')
  printf '%s  %s\n' "$sum" "$name" >> "$out/SHA256SUMS"
  files="$files${files:+,}
    { \"name\": \"$(json "$name")\", \"bytes\": $bytes, \"sha256\": \"$sum\" }"
  echo "package-artifacts: $name  $bytes bytes  sha256 $sum"
done

cat > "$out/build-info.json" <<EOF
{
  "version": "$(json "${ORBIT_VERSION:-}")",
  "commit": "$(json "${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}")",
  "ref": "$(json "${GITHUB_REF:-}")",
  "workflow": "$(json "${GITHUB_WORKFLOW:-}")",
  "run_id": "$(json "${GITHUB_RUN_ID:-}")",
  "run_number": "$(json "${GITHUB_RUN_NUMBER:-}")",
  "run_attempt": "$(json "${GITHUB_RUN_ATTEMPT:-}")",
  "built_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": [$files
  ]
}
EOF
