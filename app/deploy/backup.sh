#!/usr/bin/env bash
# Резервная копия базы (без остановки сервиса) и хранение 14 дней.
set -euo pipefail
DB=/var/lib/aiyt/app.db
OUT=/var/backups/aiyt/app-$(date +%Y%m%d-%H%M).db
sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"
find /var/backups/aiyt -name 'app-*.db.gz' -mtime +14 -delete
