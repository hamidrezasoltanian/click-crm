#!/bin/bash
# Automated PostgreSQL backup for Atena CRM
# Runs every 10 minutes via cron, keeps 30 days of backups.
#
# Setup:
#   chmod +x ~/Sales-Portal/scripts/backup_db.sh
#   crontab -e
#   Add: */10 * * * * /home/hamidreza/Sales-Portal/scripts/backup_db.sh >> /home/hamidreza/db_backups/backup.log 2>&1

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
BACKUP_DIR="/home/hamidreza/db_backups"
KEEP_DAYS=30

# Load .env
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | sed "s/'//g" | xargs)
fi

DB_HOST="${PG_HOST:-localhost}"
DB_PORT="${PG_PORT:-5432}"
DB_NAME="${PG_DATABASE:-atena_crm}"
DB_USER="${PG_USER:-postgres}"
export PGPASSWORD="${PG_PASSWORD:-}"

# ── Backup ────────────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

pg_dump \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  "$DB_NAME" \
  | gzip > "$BACKUP_FILE"

SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Backup saved: $BACKUP_FILE ($SIZE)"

# ── Cleanup old backups ───────────────────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +${KEEP_DAYS} -print -delete | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 🗑  Deleted $DELETED backup(s) older than ${KEEP_DAYS} days"
fi

# ── Stats ─────────────────────────────────────────────────────────────────────
COUNT=$(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" | wc -l)
TOTAL=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 📦 Total: $COUNT backup(s), $TOTAL used"
