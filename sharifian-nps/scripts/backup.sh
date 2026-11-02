#!/bin/sh
# Backup with `sqlite3 .backup` for cron on a VPS (D33). Consistent while the app is running, checked with
# integrity_check, and only the newest $BACKUP_KEEP (default 7) manual-*.db files are kept.
#   Inside the container:   docker compose exec -T app sh scripts/backup.sh
#   On a host with sqlite3: DATABASE_PATH=./data/nps.db sh scripts/backup.sh
set -eu

DB="${DATABASE_PATH:-/data/nps.db}"
DIR="${BACKUP_DIR:-$(dirname "$DB")/backups}"
KEEP="${BACKUP_KEEP:-7}"
OUT="$DIR/manual-$(date -u +%Y-%m-%dT%H%MZ).db"

command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 is not installed (apt install sqlite3)" >&2; exit 1; }
[ -f "$DB" ] || { echo "database not found: $DB" >&2; exit 1; }
mkdir -p "$DIR"

sqlite3 "$DB" ".backup '$OUT.tmp'"
# The copy inherits WAL mode; make it one self-contained file (no -wal/-shm beside it when opened).
sqlite3 "$OUT.tmp" 'PRAGMA journal_mode=DELETE;' >/dev/null
if [ "$(sqlite3 "$OUT.tmp" 'PRAGMA integrity_check;')" != "ok" ]; then
  echo "backup failed integrity_check: $OUT.tmp" >&2
  exit 1
fi
mv "$OUT.tmp" "$OUT"

# Rotate: names sort by date, so the oldest come first.
COUNT=$(ls -1 "$DIR"/manual-*.db 2>/dev/null | wc -l)
if [ "$COUNT" -gt "$KEEP" ]; then
  ls -1 "$DIR"/manual-*.db | sort | head -n "$((COUNT - KEEP))" | while IFS= read -r old; do rm -f -- "$old"; done
fi
echo "backup written: $OUT"
