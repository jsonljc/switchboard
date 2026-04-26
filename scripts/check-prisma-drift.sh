#!/usr/bin/env bash
# =============================================================================
# Prisma Schema Drift Check
# Wraps `prisma migrate diff --exit-code` with a developer-friendly error
# message when the schema has unmigrated changes.
#
# Requires a running PostgreSQL: Prisma's --from-migrations flag uses a
# shadow database to determine the cumulative schema produced by all
# migrations. DATABASE_URL must be set (or readable from .env / .env.example),
# and the user must have CREATEDB privilege so Prisma can create
# <db>_shadow on demand.
#
# Usage:
#   ./scripts/check-prisma-drift.sh [SCHEMA_PATH] [MIGRATIONS_DIR]
#
# Defaults:
#   SCHEMA_PATH      packages/db/prisma/schema.prisma
#   MIGRATIONS_DIR   packages/db/prisma/migrations
#
# Exit codes:
#   0   no drift
#   2   drift detected
#   *   unexpected error from prisma migrate diff
# =============================================================================

set -uo pipefail

# Resolve repo root from script location so all paths are absolute.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SCHEMA="${1:-$REPO_ROOT/packages/db/prisma/schema.prisma}"
MIGRATIONS="${2:-$REPO_ROOT/packages/db/prisma/migrations}"

# Load DATABASE_URL from .env or .env.example if not already in the environment.
if [[ -z "${DATABASE_URL:-}" ]]; then
  for envfile in "$REPO_ROOT/.env" "$REPO_ROOT/.env.example"; do
    if [[ -f "$envfile" ]]; then
      _line=$(grep '^DATABASE_URL=' "$envfile" | head -1)
      DATABASE_URL="${_line#DATABASE_URL=}"
      break
    fi
  done
fi

# Derive shadow DB URL (strip query params, append _shadow to db name).
if [[ -z "${SHADOW_DATABASE_URL:-}" && -n "${DATABASE_URL:-}" ]]; then
  _base="${DATABASE_URL%%\?*}"
  SHADOW_DATABASE_URL="${_base%/*}/${_base##*/}_shadow"
fi

PRISMA_BIN="$REPO_ROOT/packages/db/node_modules/.bin/prisma"

DATABASE_URL="${DATABASE_URL:-}" \
"$PRISMA_BIN" migrate diff \
  --from-migrations "$MIGRATIONS" \
  --to-schema-datamodel "$SCHEMA" \
  --shadow-database-url "${SHADOW_DATABASE_URL:-}" \
  --exit-code > /dev/null 2>&1
status=$?

case $status in
  0)
    echo "OK: no Prisma schema drift detected"
    exit 0
    ;;
  2)
    cat >&2 <<'MSG'
ERROR: Prisma schema drift detected.
schema.prisma defines models or fields that no committed migration creates.
A fresh clone running `pnpm db:migrate` would NOT get these tables/columns.

Fix:
  pnpm --filter @switchboard/db exec prisma migrate dev --name <descriptive-name>
  git add packages/db/prisma/migrations/
  git commit
MSG
    exit 2
    ;;
  *)
    echo "ERROR: prisma migrate diff failed with unexpected status $status" >&2
    exit "$status"
    ;;
esac
