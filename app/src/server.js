'use strict';
const http = require('node:http');
const config = require('./config');
const { createApp } = require('./app');

if (config.secret === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') {
  console.error('APP_SECRET не задан — сервер не запускается в production.');
  process.exit(1);
}

const app = createApp({ config });
const server = http.createServer((req, res) => { app.handle(req, res); });
server.headersTimeout = 20000;
server.requestTimeout = 30000;
server.listen(config.port, config.host, () => {
  console.log(`AI YT Studio: ${config.baseUrl} (порт ${config.port}, оплата: ${app.services.provider.mode}, почта: ${config.mail.provider})`);
});

// Продление тарифов — раз в час.
const timer = setInterval(() => { app.services.payments.renewDue().catch(e => console.error('[renew]', e.message)); }, 3600e3);
timer.unref();

function shutdown() { server.close(() => { try { app.db.close(); } catch (e) {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
