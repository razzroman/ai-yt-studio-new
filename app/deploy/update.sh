#!/usr/bin/env bash
# Обновление сервиса до последней версии из GitHub (запуск от root): bash /opt/aiyt/site/app/deploy/update.sh
set -euo pipefail
/usr/local/bin/aiyt-backup || true
git -C /opt/aiyt/site pull --ff-only
cd /opt/aiyt/site/app && node --disable-warning=ExperimentalWarning --test test/*.test.js
systemctl restart aiyt
sleep 1
curl -fsS http://127.0.0.1:8080/api/health && echo " — обновлено"
