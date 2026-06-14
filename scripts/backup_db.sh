#!/bin/bash
# Atena CRM backup — two strategies:
#
#  1. app_data only (هر 10 دقیقه، نگه می‌داره 30 روز) — چند صد KB
#     */10 * * * * /home/hamidreza/Sales-Portal/scripts/backup_db.sh appdata >> /home/hamidreza/db_backups/backup.log 2>&1
#
#  2. Full pg_dump (روزانه ساعت 2 صبح، نگه می‌داره 30 روز) — 35MB
#     0 2 * * * /home/hamidreza/Sales-Portal/scripts/backup_db.sh full >> /home/hamidreza/db_backups/backup.log 2>&1
#
# بازیابی app_data:
#   psql -U postgres atena_crm < ~/db_backups/appdata_YYYYMMDD_HHMMSS.sql
#
# بازیابی full:
#   gunzip -c ~/db_backups/full_YYYYMMDD_HHMMSS.sql.gz | psql -U postgres atena_crm

set -euo pipefail

MODE="${1:-appdata}"  # appdata | full

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
BACKUP_DIR="/home/hamidreza/db_backups"

# Load .env
if [ -f "$ENV_FILE" ]; then
  set +u
  while IFS= read -r line; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    line="${line//\'/}"
    export "$line" 2>/dev/null || true
  done < <(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$')
  set -u
fi

DB_HOST="${PG_HOST:-localhost}"
DB_PORT="${PG_PORT:-5432}"
DB_NAME="${PG_DATABASE:-atena_crm}"
DB_USER="${PG_USER:-postgres}"
export PGPASSWORD="${PG_PASSWORD:-}"

mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ "$MODE" = "full" ]; then
  # ── Full DB backup (daily) ─────────────────────────────────────────────────
  FILE="$BACKUP_DIR/full_${TIMESTAMP}.sql.gz"
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" | gzip > "$FILE"
  SIZE=$(du -sh "$FILE" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Full backup: $FILE ($SIZE)"
  find "$BACKUP_DIR" -name "full_*.sql.gz" -mtime +30 -delete

else
  # ── app_data only (every 10 min) ───────────────────────────────────────────
  FILE="$BACKUP_DIR/appdata_${TIMESTAMP}.sql"
  pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" \
    --table=app_data --table=app_data_history \
    --data-only --column-inserts \
    > "$FILE"
  gzip "$FILE"
  FILE="${FILE}.gz"
  SIZE=$(du -sh "$FILE" | cut -f1)
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ App-data backup: $FILE ($SIZE)"
  find "$BACKUP_DIR" -name "appdata_*.sql.gz" -mtime +30 -delete
fi

# Stats
COUNT_APP=$(find "$BACKUP_DIR" -name "appdata_*.sql.gz" 2>/dev/null | wc -l)
COUNT_FULL=$(find "$BACKUP_DIR" -name "full_*.sql.gz" 2>/dev/null | wc -l)
TOTAL=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📦 appdata: ${COUNT_APP} | full: ${COUNT_FULL} | total: ${TOTAL}"
