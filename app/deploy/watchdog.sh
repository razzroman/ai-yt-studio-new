#!/usr/bin/env bash
# Проверка каждые 5 минут: сайт отвечает, место на диске есть, ночная копия сделана.
# Уведомление приходит один раз при поломке и один раз при восстановлении.
STATE=/var/lib/aiyt-watchdog; mkdir -p "$STATE"
alert() { /usr/local/bin/aiyt-alert "$1"; }
flag() { # flag <имя> <есть ли проблема 0/1> <текст поломки> <текст восстановления>
  if [ "$2" = 1 ]; then
    [ -f "$STATE/$1" ] || { touch "$STATE/$1"; alert "$3"; }
  else
    [ -f "$STATE/$1" ] && { rm -f "$STATE/$1"; alert "$4"; }
  fi
}

# 1. Сервис отвечает (две попытки подряд, чтобы не будить из-за секундного сбоя).
ok=0; for i in 1 2; do curl -fsS -m 10 http://127.0.0.1:8080/api/health >/dev/null && { ok=1; break; }; sleep 20; done
if [ $ok = 0 ]; then systemctl restart aiyt; sleep 5; curl -fsS -m 10 http://127.0.0.1:8080/api/health >/dev/null && ok=1; fi
flag down $([ $ok = 1 ] && echo 0 || echo 1) "⚠️ Сайт не отвечает даже после перезапуска. journalctl -u aiyt -n 100" "✅ Сайт снова работает."

# 2. Место на диске (больше 85% — предупреждение).
use=$(df --output=pcent / | tail -1 | tr -dc 0-9)
flag disk $([ "${use:-0}" -gt 85 ] && echo 1 || echo 0) "⚠️ Диск заполнен на ${use}%." "✅ Место на диске освободилось (${use}%)."

# 3. Свежая копия базы (не старше 26 часов).
fresh=$(find /var/backups/aiyt -name 'app-*.db.gz' -mmin -1560 | head -1)
flag backup $([ -z "$fresh" ] && echo 1 || echo 0) "⚠️ Нет свежей резервной копии базы за последние сутки." "✅ Резервные копии снова создаются."
exit 0
