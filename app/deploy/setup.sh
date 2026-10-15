#!/usr/bin/env bash
# Первичная настройка VPS (Ubuntu 22.04/24.04) под AI YT Studio.
# Запуск на сервере от root:  bash setup.sh buykurs.ru you@example.com
set -euo pipefail
DOMAIN="${1:?Укажите домен, например buykurs.ru}"
EMAIL="${2:?Укажите email для HTTPS-сертификата}"
REPO="https://github.com/razzroman/ai-yt-studio-new.git"

echo "== Пакеты"
apt-get update -y
apt-get install -y curl git nginx sqlite3 certbot python3-certbot-nginx ufw
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Пользователь и папки"
id aiyt >/dev/null 2>&1 || useradd --system --home /opt/aiyt --shell /usr/sbin/nologin aiyt
mkdir -p /opt/aiyt /var/lib/aiyt /var/backups/aiyt /etc/aiyt
if [ ! -d /opt/aiyt/site/.git ]; then git clone --depth 1 "$REPO" /opt/aiyt/site; else git -C /opt/aiyt/site pull --ff-only; fi
chown -R aiyt:aiyt /var/lib/aiyt /var/backups/aiyt
chown -R root:root /opt/aiyt/site

echo "== Настройки"
if [ ! -f /etc/aiyt/app.env ]; then
  cp /opt/aiyt/site/app/deploy/app.env.example /etc/aiyt/app.env
  sed -i "s#^BASE_URL=.*#BASE_URL=https://$DOMAIN#; s#^APP_SECRET=.*#APP_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n')#" /etc/aiyt/app.env
  echo "!! Заполните /etc/aiyt/app.env (ключи ЮKassa, почты, Google) и перезапустите: systemctl restart aiyt"
fi
chown root:aiyt /etc/aiyt/app.env; chmod 640 /etc/aiyt/app.env

echo "== Служба"
cp /opt/aiyt/site/app/deploy/aiyt.service /etc/systemd/system/aiyt.service
systemctl daemon-reload
systemctl enable --now aiyt

echo "== nginx и HTTPS"
sed "s#__DOMAIN__#$DOMAIN#g" /opt/aiyt/site/app/deploy/nginx.conf > /etc/nginx/sites-available/aiyt
ln -sf /etc/nginx/sites-available/aiyt /etc/nginx/sites-enabled/aiyt
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "== Резервные копии (каждую ночь, 14 дней)"
cp /opt/aiyt/site/app/deploy/backup.sh /usr/local/bin/aiyt-backup && chmod +x /usr/local/bin/aiyt-backup
echo "17 3 * * * aiyt /usr/local/bin/aiyt-backup" > /etc/cron.d/aiyt-backup

echo "== Файрвол"
ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw --force enable

echo "Готово: https://$DOMAIN — проверка: curl -s https://$DOMAIN/api/health"
