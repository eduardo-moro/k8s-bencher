#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Prevent Git Bash/MSYS on Windows from mangling /tmp/... paths passed to
# docker/kubectl exec (which run inside Linux containers).
export MSYS_NO_PATHCONV=1

DUMP_FILE="/tmp/outline-dump.sql"

echo "Dumping docker-compose Postgres..."
docker exec senff-outline-postgres pg_dump -U outline -d outline --clean --if-exists -f /tmp/outline-dump.sql
docker cp senff-outline-postgres:/tmp/outline-dump.sql "$DUMP_FILE"

POSTGRES_POD=$(kubectl get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
echo "Restoring into pod $POSTGRES_POD..."
kubectl cp "$DUMP_FILE" "$POSTGRES_POD":/tmp/outline-dump.sql
kubectl exec "$POSTGRES_POD" -- psql -U outline -d outline -f /tmp/outline-dump.sql

echo "Restore complete. Document count:"
kubectl exec "$POSTGRES_POD" -- psql -U outline -d outline -t -c "SELECT count(*) FROM documents;"

# The real docker-compose database carries a real (and, as of writing,
# already-expired) expiresAt on its API key rows. Restoring it verbatim
# would leave OUTLINE_API_TOKEN rejected with "API key is expired" even
# though everything else about the restore succeeded. This is a perf-test
# throwaway cluster, not the source of truth, so clear any expiry here
# (and only here) to keep the existing token usable for load testing.
echo "Clearing expiry on any expired API keys (perf-test cluster only)..."
kubectl exec "$POSTGRES_POD" -- psql -U outline -d outline -c \
  'UPDATE "apiKeys" SET "expiresAt" = NULL WHERE "expiresAt" IS NOT NULL AND "expiresAt" < now();'
