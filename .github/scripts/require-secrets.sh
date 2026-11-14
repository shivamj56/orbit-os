#!/bin/sh
# Stops a job early, with one clear line per missing secret, before any build time is spent (the values are passed in
# as environment variables of the same names, and are never printed).
#
#   .github/scripts/require-secrets.sh NAME [NAME ...]
set -eu

missing=0
for name do
  eval "set_value=\${$name:-}"
  if [ -z "$set_value" ]; then
    echo "::error title=Missing secret $name::The repository secret $name is not set. Add it under Settings > Secrets and variables > Actions (docs/ci-cd.md, \"Secrets\")."
    missing=$((missing + 1))
  fi
done
if [ "$missing" -gt 0 ]; then
  echo "require-secrets: $missing of $# secrets missing" >&2
  exit 1
fi
echo "require-secrets: all $# secrets are set"
