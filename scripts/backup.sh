#!/usr/bin/env bash
# =============================================================================
# Switchboard Database Backup
# Dumps PostgreSQL to a timestamped file and retains the last 30 days.
# Usage: ./scripts/backup.sh
# =============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/switchboard}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/switchboard_${TIMESTAMP}.sql.gz"

# Source .env if present and DATABASE_URL is not already set
if [[ -z "${DATABASE_URL:-}" ]] && [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^DATABASE_URL=(.+)$ ]]; then
      export DATABASE_URL="${BASH_REMATCH[1]}"
      break
    fi
  done < .env
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is not set. Export it or add it to .env." >&2
  exit 1
fi

# Ensure backup directory exists
mkdir -p "${BACKUP_DIR}"

echo "Starting backup → ${BACKUP_FILE}"

# Run pg_dump and compress
pg_dump "${DATABASE_URL}" | gzip > "${BACKUP_FILE}"

FILESIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "Backup complete: ${BACKUP_FILE} (${FILESIZE})"

# Remove backups older than retention period
DELETED=$(find "${BACKUP_DIR}" -name "switchboard_*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete | wc -l | tr -d ' ')
if [[ "${DELETED}" -gt 0 ]]; then
  echo "Cleaned up ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

REMAINING=$(find "${BACKUP_DIR}" -name "switchboard_*.sql.gz" | wc -l | tr -d ' ')
echo "Backups retained: ${REMAINING}"
echo "Done."
