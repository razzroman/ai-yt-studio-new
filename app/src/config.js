'use strict';
// Все настройки — из переменных окружения (файл /etc/aiyt/app.env на сервере).
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const config = {
  port: Number(env('PORT', 8080)),
  host: env('HOST', '127.0.0.1'),
  baseUrl: env('BASE_URL', 'http://localhost:8080').replace(/\/$/, ''),
  dbPath: env('DB_PATH', './data/app.db'),
  // Секрет для подписи OAuth-state и CSRF. На сервере — длинная случайная строка.
  secret: env('APP_SECRET', 'dev-secret-change-me'),
  secureCookies: env('SECURE_COOKIES', '') === '1',
  // Почта: log — письма пишутся в журнал (для разработки); unisender — Unisender Go HTTP API.
  mail: {
    provider: env('MAIL_PROVIDER', 'log'),
    from: env('MAIL_FROM', 'AI YT Studio <no-reply@buykurs.ru>'),
    unisenderKey: env('UNISENDER_API_KEY', ''),
    unisenderUrl: env('UNISENDER_URL', 'https://go1.unisender.ru/ru/transactional/api/v1/email/send.json')
  },
  google: {
    clientId: env('GOOGLE_CLIENT_ID', ''),
    clientSecret: env('GOOGLE_CLIENT_SECRET', '')
  },
  yookassa: {
    shopId: env('YOOKASSA_SHOP_ID', ''),
    secretKey: env('YOOKASSA_SECRET_KEY', ''),
    apiUrl: env('YOOKASSA_API_URL', 'https://api.yookassa.ru/v3'),
    // mock — платежи без шлюза (локально и в автотестах); live — настоящий API ЮKassa (тестовый магазин тоже live).
    mode: env('YOOKASSA_MODE', 'mock')
  },
  // Кредиты при подтверждении почты (тариф «Старт»).
  // Генерация фото через OpenAI. OPENAI_BASE_URL — если запросы идут через свой шлюз (OpenAI не принимает запросы с российских адресов).
  ai: {
    openaiKey: env('OPENAI_API_KEY', ''),
    openaiBase: env('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
    imagesDir: env('IMAGES_DIR', '')
  },
  startCredits: Number(env('START_CREDITS', 60)),
  // Первый администратор: при подтверждении этой почты пользователь получает роль admin.
  bootstrapAdmin: env('BOOTSTRAP_ADMIN_EMAIL', '').toLowerCase()
};

module.exports = config;
