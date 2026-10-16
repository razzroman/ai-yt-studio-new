#!/usr/bin/env bash
# Отправка уведомления в Telegram. Использование: aiyt-alert "текст"
[ -f /etc/aiyt/backup.env ] && set -a && . /etc/aiyt/backup.env && set +a
MSG="AI YT Studio: ${1:-без текста}"
logger -t aiyt-alert "$MSG"
[ -n "${TG_BOT_TOKEN:-}" ] && [ -n "${TG_CHAT_ID:-}" ] || exit 0
curl -fsS -m 15 "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TG_CHAT_ID}" --data-urlencode "text=${MSG}" >/dev/null || logger -t aiyt-alert "Telegram недоступен"
