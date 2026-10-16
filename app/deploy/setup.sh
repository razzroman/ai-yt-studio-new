#!/usr/bin/env bash
# Первичная настройка VPS (Ubuntu 22.04/24.04) под AI YT Studio — сразу с защитой.
# Запуск на сервере от root:
#   bash setup.sh buykurs.ru you@example.com ["ssh-ed25519 AAAA... ваш-ключ"]
# Третий параметр (необязательный) — ваш публичный SSH-ключ: тогда вход по паролю отключается.
# Скрипт можно запускать повторно — он обновит настройки, не трогая базу и заполненные ключи.
set -euo pipefail
DOMAIN="${1:?Укажите домен, например buykurs.ru}"
EMAIL="${2:?Укажите email для HTTPS-сертификата}"
SSHKEY="${3:-}"
REPO="https://github.com/razzroman/ai-yt-studio-new.git"
D=/opt/aiyt/site/app/deploy

echo "== Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git nginx sqlite3 certbot python3-certbot-nginx ufw fail2ban unattended-upgrades rclone openssl
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "== Автоматические обновления безопасности"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

echo "== Пользователь и папки"
id aiyt >/dev/null 2>&1 || useradd --system --home /opt/aiyt --shell /usr/sbin/nologin aiyt
mkdir -p /opt/aiyt /var/lib/aiyt /var/backups/aiyt /etc/aiyt
if [ ! -d /opt/aiyt/site/.git ]; then git clone --depth 1 "$REPO" /opt/aiyt/site; else git -C /opt/aiyt/site pull --ff-only; fi
chown -R aiyt:aiyt /var/lib/aiyt
chown -R root:root /opt/aiyt/site /var/backups/aiyt
chmod 700 /var/backups/aiyt

echo "== Настройки"
if [ ! -f /etc/aiyt/app.env ]; then
  cp $D/app.env.example /etc/aiyt/app.env
  sed -i "s#^BASE_URL=.*#BASE_URL=https://$DOMAIN#; s#^APP_SECRET=.*#APP_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n')#" /etc/aiyt/app.env
  echo "!! Заполните /etc/aiyt/app.env (ключи ЮKassa, почты, Google) и перезапустите: systemctl restart aiyt"
fi
chown root:aiyt /etc/aiyt/app.env; chmod 640 /etc/aiyt/app.env
if [ ! -f /etc/aiyt/backup.env ]; then
  cp $D/backup.env.example /etc/aiyt/backup.env
  sed -i "s#^BACKUP_PASSPHRASE=.*#BACKUP_PASSPHRASE=$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n')#" /etc/aiyt/backup.env
  echo "!! Пароль шифрования копий записан в /etc/aiyt/backup.env (BACKUP_PASSPHRASE) — сохраните его в надёжном месте."
fi
chown root:root /etc/aiyt/backup.env; chmod 600 /etc/aiyt/backup.env

echo "== Служба"
cp $D/aiyt.service /etc/systemd/system/aiyt.service
systemctl daemon-reload
systemctl enable aiyt
systemctl restart aiyt

echo "== nginx (лимиты запросов и соединений) и HTTPS"
sed "s#__DOMAIN__#$DOMAIN#g" $D/nginx.conf > /etc/nginx/sites-available/aiyt
ln -sf /etc/nginx/sites-available/aiyt /etc/nginx/sites-enabled/aiyt
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring
systemctl reload nginx

echo "== Защита SSH"
mkdir -p /etc/ssh/sshd_config.d
SSHD=/etc/ssh/sshd_config.d/10-aiyt.conf
if [ -n "$SSHKEY" ]; then
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  grep -qxF "$SSHKEY" /root/.ssh/authorized_keys 2>/dev/null || echo "$SSHKEY" >> /root/.ssh/authorized_keys
  chmod 600 /root/.ssh/authorized_keys
fi
if [ -s /root/.ssh/authorized_keys ]; then
  # Ключ есть — пароль больше не нужен. Аварийный вход остаётся через консоль в панели хостинга.
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\nMaxAuthTries 3\nLoginGraceTime 30\n' > $SSHD
  SSH_NOTE="вход только по ключу"
else
  printf 'MaxAuthTries 3\nLoginGraceTime 30\n' > $SSHD
  SSH_NOTE="ВХОД ПО ПАРОЛЮ ОСТАВЛЕН — добавьте SSH-ключ и запустите скрипт ещё раз"
fi
sshd -t && (systemctl reload ssh 2>/dev/null || systemctl reload sshd)

echo "== fail2ban: блокировка подбора пароля SSH и тех, кто упирается в лимиты сайта"
cat > /etc/fail2ban/jail.d/aiyt.local <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
backend = systemd

[sshd]
enabled = true

[nginx-limit-req]
enabled = true
backend = auto
logpath = /var/log/nginx/error.log
maxretry = 20
bantime = 30m
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

echo "== Резервные копии (каждую ночь) и наблюдение (каждые 5 минут)"
install -m 750 $D/backup.sh /usr/local/bin/aiyt-backup
install -m 750 $D/alert.sh /usr/local/bin/aiyt-alert
install -m 750 $D/watchdog.sh /usr/local/bin/aiyt-watchdog
cat > /etc/cron.d/aiyt <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root /usr/local/bin/aiyt-backup 2>&1 | logger -t aiyt-backup
*/5 * * * * root /usr/local/bin/aiyt-watchdog
EOF
rm -f /etc/cron.d/aiyt-backup
/usr/local/bin/aiyt-backup 2>&1 | logger -t aiyt-backup || true

echo "== Файрвол"
ufw default deny incoming
ufw allow OpenSSH; ufw allow 'Nginx Full'; ufw --force enable

echo
echo "Готово: https://$DOMAIN — проверка: curl -s https://$DOMAIN/api/health"
echo "SSH: $SSH_NOTE"
echo "Уведомления в Telegram и внешнее хранилище копий: заполните /etc/aiyt/backup.env, проверка: aiyt-alert 'тест'"
