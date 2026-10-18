#!/bin/sh
# Daily backup: database dump + uploaded files. Keeps 14 days locally.
# Run from the digital-district folder on the server, e.g. via cron:
#   15 3 * * * cd /opt/digital-district && sh scripts/backup.sh >> backups/backup.log 2>&1
# Copy the backups folder off the server too (another machine or cloud storage) — a backup on the same disk is not enough.
set -eu
STAMP=$(date +%Y%m%d-%H%M%S)
DEST=${BACKUP_DIR:-./backups}
mkdir -p "$DEST"
docker compose exec -T db pg_dump -U dd -d digital_district --format=custom > "$DEST/db-$STAMP.dump"
docker compose run --rm --no-deps -v "$(cd "$DEST" && pwd)":/backup --entrypoint sh app -c "tar -czf /backup/storage-$STAMP.tar.gz -C /data storage"
find "$DEST" -name 'db-*.dump' -mtime +14 -delete
find "$DEST" -name 'storage-*.tar.gz' -mtime +14 -delete
echo "Backup complete: $DEST/db-$STAMP.dump"
