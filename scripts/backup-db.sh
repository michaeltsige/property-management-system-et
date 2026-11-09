#!/usr/bin/env bash
# Nightly database backup, one gzip file per run, with a 14-day retention sweep.
#
# Install on the host (crontab -e):
#   15 3 * * * /opt/pms/scripts/backup-db.sh >> /var/log/pms-backup.log 2>&1
#
# Required environment (or export before running):
#   DATABASE_URL   — the same postgres URL the API uses
#   BACKUP_DIR     — where dumps land (default: /var/backups/pms)
#   RETENTION_DAYS — how many days of dumps to keep (default: 14)
#
# The script refuses to run when the dump is empty, so a broken credential
# never silently replaces the last good backup.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pms}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup-db.sh: DATABASE_URL is not set" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/pms-$STAMP.sql.gz"

# Run pg_dump wherever it lives; the compose service is "postgres", but the
# script also works against a managed database (plain pg_dump over the URL).
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'pms-postgres'; then
  docker exec pms-postgres pg_dump "$DATABASE_URL" | gzip > "$TARGET"
else
  pg_dump "$DATABASE_URL" | gzip > "$TARGET"
fi

# Empty dump = broken run; remove it and fail loudly instead of keeping junk.
if [[ ! -s "$TARGET" ]]; then
  rm -f "$TARGET"
  echo "backup-db.sh: dump was empty — aborting" >&2
  exit 1
fi

# Retention: keep the newest RETENTION_DAYS daily dumps.
find "$BACKUP_DIR" -name 'pms-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "backup-db.sh: wrote $TARGET ($(du -h "$TARGET" | cut -f1))"
