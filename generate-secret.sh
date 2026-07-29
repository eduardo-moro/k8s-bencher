#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

SITE_OUTLINE_ENV="../site-outline/.env"

if [ ! -f "$SITE_OUTLINE_ENV" ]; then
  echo "Error: $SITE_OUTLINE_ENV not found" >&2
  exit 1
fi

kubectl create secret generic outline-env \
  --from-env-file="$SITE_OUTLINE_ENV" \
  --dry-run=client -o yaml > manifests/outline-secret.yaml

echo "Wrote manifests/outline-secret.yaml"
