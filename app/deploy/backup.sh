#!/usr/bin/env bash
# Резервная копия базы без остановки сервиса: на сервере 14 дней + зашифрованная копия во внешнее хранилище S3.
# Внешнее хранилище и шифрование настраиваются в /etc/aiyt/backup.env (см. backup.env.example).
set -euo pipefail
DB=/var/lib/aiyt/app.db
DIR=/var/backups/aiyt
STAMP=$(date +%Y%m%d-%H%M)
OUT="$DIR/app-$STAMP.db"
[ -f /etc/aiyt/backup.env ] && set -a && . /etc/aiyt/backup.env && set +a

alert() { [ -x /usr/local/bin/aiyt-alert ] && /usr/local/bin/aiyt-alert "$1" || true; }
trap 'alert "Резервная копия базы не создана ($(hostname), $STAMP). Проверьте: journalctl -t aiyt-backup"' ERR

sqlite3 "$DB" ".backup '$OUT'"
sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -qx ok
gzip -f "$OUT"
find "$DIR" -name 'app-*.db.gz' -mtime +14 -delete

if [ -n "${S3_BUCKET:-}" ]; then
  [ -n "${BACKUP_PASSPHRASE:-}" ] || { echo "BACKUP_PASSPHRASE не задан — во внешнее хранилище копия не отправлена"; exit 1; }
  ENC="$OUT.gz.enc"
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$OUT.gz" -out "$ENC" -pass env:BACKUP_PASSPHRASE
  RCLONE_CONFIG_AIYT_TYPE=s3 RCLONE_CONFIG_AIYT_PROVIDER=Other \
  RCLONE_CONFIG_AIYT_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_AIYT_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  RCLONE_CONFIG_AIYT_SECRET_ACCESS_KEY="$S3_SECRET_KEY" RCLONE_CONFIG_AIYT_REGION="${S3_REGION:-ru-1}" \
    rclone copy "$ENC" "aiyt:$S3_BUCKET/db/" --s3-no-check-bucket
  rm -f "$ENC"
  # Во внешнем хранилище держим 60 дней.
  RCLONE_CONFIG_AIYT_TYPE=s3 RCLONE_CONFIG_AIYT_PROVIDER=Other \
  RCLONE_CONFIG_AIYT_ENDPOINT="$S3_ENDPOINT" RCLONE_CONFIG_AIYT_ACCESS_KEY_ID="$S3_ACCESS_KEY" \
  RCLONE_CONFIG_AIYT_SECRET_ACCESS_KEY="$S3_SECRET_KEY" RCLONE_CONFIG_AIYT_REGION="${S3_REGION:-ru-1}" \
    rclone delete "aiyt:$S3_BUCKET/db/" --min-age 60d || true
fi
echo "Копия готова: $OUT.gz"
