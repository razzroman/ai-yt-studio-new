'use strict';
const path = require('node:path');
const { HttpError, parseCookies, cookie, readBody, send: rawSend, serveStatic: rawServe, Router, clientIp, STRICT_CSP } = require('./http');
const dbm = require('./db');

const LANDING_BRIDGE = `<script>
(function () {
  var MAP = { 'Onboarding.dc.html': '/app/register', 'Main.dc.html': '/app/login', 'MApp.dc.html': '/app/', 'Recover.dc.html': '/app/forgot', 'Account.dc.html': '/app/#/billing' };
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var to = MAP[a.getAttribute('href')]; if (!to) return;
    e.preventDefault();
    try { var l = document.documentElement.querySelector('[lang]'); if (l) localStorage.setItem('aiyt.lang', l.getAttribute('lang') === 'en' ? 'en' : 'ru'); } catch (er) {}
    location.href = to;
  }, true);
})();
</script>`;

function createApp(opts = {}) {
  const config = opts.config || require('./config');
  const now = opts.now || (() => Date.now());
  const fetchImpl = opts.fetch || globalThis.fetch;
  const logger = opts.logger || console;
  const db = opts.db || dbm.open(config.dbPath);

  const audit = require('./services/audit')(db);
  const settings = require('./services/settings')(db);
  const credits = require('./services/credits')(db);
  const mail = require('./services/mail')(db, config, fetchImpl, logger);
  const yk = require('./services/yookassa');
  const provider = opts.provider || (config.yookassa.mode === 'live' ? yk.makeLive(config, fetchImpl) : yk.makeMock());
  const auth = require('./services/auth')({ db, config, mail, credits, audit, fetchImpl, now });
  const payments = require('./services/payments')({ db, config, credits, audit, mail, settings, provider, now });
  const admin = require('./services/admin')({ db, credits, audit, settings, payments, now });

  const r = new Router();
  const baseOrigin = new URL(config.baseUrl).origin;

  // ---------- помощники
  const sessCookie = (s) => cookie('sid', s.token, { maxAge: s.maxAge, secure: config.secureCookies });
  const clearCookie = cookie('sid', '', { maxAge: 0, secure: config.secureCookies });
  function needUser(ctx, { allowMfaPending = false } = {}) {
    if (!ctx.auth) throw new HttpError(401, 'unauthorized');
    if (ctx.auth.session.mfa_pending && !allowMfaPending) throw new HttpError(401, 'mfa_required');
    return ctx.auth.user;
  }
  function needRole(ctx, roles) {
    const u = needUser(ctx);
    if (!roles.includes(u.role)) throw new HttpError(403, 'forbidden');
    return u;
  }
  const STAFF = ['moderator', 'admin'], ADMIN = ['admin'];
  function meDto(ctx) {
    const u = ctx.auth.user;
    return { user: auth.publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(u.id)), csrf: ctx.auth.session.csrf, mfaPending: !!ctx.auth.session.mfa_pending };
  }
  function publicConfig() {
    const products = settings.get('products');
    return { products, payMethods: settings.get('payMethods'), platforms: settings.get('platforms'), eridOn: settings.get('eridOn'), registrationOpen: settings.get('registrationOpen'), google: !!config.google.clientId, paymentsMode: provider.mode, startCredits: config.startCredits };
  }

  // ---------- публичное
  r.get('/api/health', () => ({ ok: true }));
  r.get('/api/public/config', () => publicConfig());

  // ---------- вход
  r.post('/api/auth/register', async (ctx) => {
    if (!settings.get('registrationOpen')) throw new HttpError(403, 'registration_closed');
    const out = await auth.register(ctx.body, ctx.req);
    ctx.setCookie(sessCookie(out.session));
    return { user: auth.publicUser(out.user), csrf: out.session.csrf };
  });
  r.post('/api/auth/login', (ctx) => {
    const out = auth.login(ctx.body, ctx.req);
    ctx.setCookie(sessCookie(out.session));
    return { user: out.mfaRequired ? null : auth.publicUser(out.user), mfaRequired: out.mfaRequired, csrf: out.session.csrf };
  });
  r.post('/api/auth/2fa', (ctx) => {
    needUser(ctx, { allowMfaPending: true });
    const u = auth.completeMfa(ctx.auth.session, ctx.body.code, ctx.ip);
    return { user: auth.publicUser(u) };
  });
  r.post('/api/auth/logout', (ctx) => { if (ctx.auth) auth.logout(ctx.auth.session); ctx.setCookie(clearCookie); return { ok: true }; });
  r.post('/api/auth/verify', (ctx) => ({ user: auth.publicUser(auth.verifyEmail(ctx.body.token, ctx.ip)) }));
  r.post('/api/auth/resend-verify', async (ctx) => { await auth.resendVerify(needUser(ctx)); return { ok: true }; });
  r.post('/api/auth/forgot', async (ctx) => { await auth.requestReset(ctx.body.email, ctx.req); return { ok: true }; });
  r.post('/api/auth/reset', (ctx) => { const u = auth.resetPassword(ctx.body.token, ctx.body.password, ctx.ip); ctx.setCookie(clearCookie); return { ok: true, email: u.email }; });
  r.get('/api/auth/google/start', (ctx) => {
    const { url, nonce } = auth.googleStartUrl({ consent: ctx.query.consent === '1', lang: ctx.query.lang === 'en' ? 'en' : 'ru' });
    ctx.setCookie(cookie('gstate', nonce, { maxAge: 600, secure: config.secureCookies }));
    return { redirect: url };
  });
  r.get('/api/auth/google/callback', async (ctx) => {
    try {
      const out = await auth.googleCallback(ctx.query, ctx.cookies.gstate, ctx.req);
      ctx.setCookie(sessCookie(out.session)); ctx.setCookie(cookie('gstate', '', { maxAge: 0 }));
      return { redirect: out.mfaRequired ? '/app/login#2fa' : '/app/' };
    } catch (e) {
      return { redirect: '/app/login?error=' + encodeURIComponent(e.code || 'google_failed') };
    }
  });

  // ---------- аккаунт
  r.get('/api/me', (ctx) => { needUser(ctx, { allowMfaPending: true }); return meDto(ctx); });
  r.post('/api/me', (ctx) => {
    const u = needUser(ctx);
    const b = ctx.body;
    if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 80); if (!n) throw new HttpError(400, 'name_required'); db.prepare('UPDATE users SET name = ? WHERE id = ?').run(n, u.id); }
    if (b.lang !== undefined) db.prepare('UPDATE users SET lang = ? WHERE id = ?').run(b.lang === 'en' ? 'en' : 'ru', u.id);
    if (b.autorenew !== undefined) { db.prepare('UPDATE users SET autorenew = ? WHERE id = ?').run(b.autorenew ? 1 : 0, u.id); audit.log(u.id, b.autorenew ? 'billing.autorenew_on' : 'billing.autorenew_off', u.id, {}, ctx.ip); }
    if (b.forgetCard) { db.prepare('UPDATE users SET payment_method_id = NULL WHERE id = ?').run(u.id); audit.log(u.id, 'billing.card_removed', u.id, {}, ctx.ip); }
    ctx.auth.user = db.prepare('SELECT * FROM users WHERE id = ?').get(u.id);
    return meDto(ctx);
  });
  r.post('/api/me/password', (ctx) => { const u = needUser(ctx); auth.changePassword(u, ctx.body.oldPassword, ctx.body.newPassword, ctx.auth.session.id, ctx.ip); return { ok: true }; });
  r.post('/api/me/totp/setup', (ctx) => auth.totpSetup(needUser(ctx)));
  r.post('/api/me/totp/enable', (ctx) => { auth.totpEnable(needUser(ctx), ctx.body.code, ctx.ip); return { ok: true }; });
  r.post('/api/me/totp/disable', (ctx) => { auth.totpDisable(needUser(ctx), ctx.body.code, ctx.ip); return { ok: true }; });
  r.get('/api/me/sessions', (ctx) => ({ items: auth.sessions(needUser(ctx), ctx.auth.session.id) }));
  r.post('/api/me/sessions/:id/revoke', (ctx) => ({ ok: auth.revokeSession(needUser(ctx), Number(ctx.params.id), ctx.ip) }));
  r.get('/api/notifications', (ctx) => {
    const u = needUser(ctx);
    return { items: db.prepare('SELECT id, text_ru, text_en, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(u.id) };
  });
  r.post('/api/notifications/read', (ctx) => { const u = needUser(ctx); db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(u.id); return { ok: true }; });

  // ---------- кредиты и оплата
  r.get('/api/credits', (ctx) => {
    const u = needUser(ctx);
    return { balance: credits.balance(u.id), items: credits.history(u.id, { kind: String(ctx.query.kind || ''), before: ctx.query.before ? Number(ctx.query.before) : null, limit: 50 }) };
  });
  r.get('/api/credits.csv', (ctx) => {
    const u = needUser(ctx);
    const rows = credits.history(u.id, { limit: 200 });
    const csv = '﻿' + ['id;date;delta;balance_after;kind;reason'].concat(rows.map(x => [x.id, x.created_at, x.delta, x.balance_after, x.kind, '"' + String(x.reason).replace(/"/g, '""') + '"'].join(';'))).join('\r\n');
    return { raw: csv, type: 'text/csv; charset=utf-8', filename: 'credits.csv' };
  });
  r.get('/api/payments', (ctx) => ({ items: payments.list(needUser(ctx).id) }));
  r.post('/api/payments', async (ctx) => {
    const u = needUser(ctx);
    const p = await payments.create(u, String(ctx.body.product || ''), String(ctx.body.method || 'card'), ctx.ip);
    return { id: p.id, status: p.status, confirmationUrl: p.confirmation_url };
  });
  r.get('/api/payments/:id', async (ctx) => {
    const p = await payments.refresh(needUser(ctx), Number(ctx.params.id));
    return { id: p.id, status: p.status, product: p.product, credits: p.credits, cancelReason: p.cancel_reason };
  });
  r.post('/api/payments/webhook', async (ctx) => {
    // Адреса ЮKassa для уведомлений — https://yookassa.ru/developers/using-api/webhooks ; nginx может ограничить их.
    const res = await payments.webhook(ctx.body);
    return { ok: true, result: Object.keys(res)[0] };
  });

  // Имитация банка (только в режиме mock).
  r.post('/api/mock/decide', async (ctx) => {
    if (provider.mode !== 'mock') throw new HttpError(404, 'not_found');
    const p = provider.decide(String(ctx.body.id || ''), !!ctx.body.ok);
    if (!p) throw new HttpError(400, 'bad_payment');
    await payments.webhook({ type: 'notification', event: 'payment.' + p.status, object: { id: p.id } });
    const local = db.prepare('SELECT id FROM payments WHERE provider_id = ?').get(p.id);
    return { ok: true, paymentId: local && local.id };
  });
  r.get('/api/mock/payment', (ctx) => {
    if (provider.mode !== 'mock') throw new HttpError(404, 'not_found');
    const p = provider.store.get(String(ctx.query.id || ''));
    if (!p) throw new HttpError(404, 'not_found');
    return { id: p.id, status: p.status, amount: p.amount.value, description: p.description, returnUrl: p.confirmation && p.confirmation.return_url };
  });

  // ---------- админка
  r.get('/api/admin/dashboard', (ctx) => { needRole(ctx, STAFF); return admin.dashboard(); });
  r.get('/api/admin/users', (ctx) => { needRole(ctx, STAFF); return admin.users({ q: String(ctx.query.q || ''), role: String(ctx.query.role || ''), plan: String(ctx.query.plan || ''), offset: Number(ctx.query.offset || 0) }); });
  r.get('/api/admin/users.csv', (ctx) => { const a = needRole(ctx, ADMIN); audit.log(a.id, 'admin.export_users', null, {}, ctx.ip); return { raw: admin.exportUsersCsv(), type: 'text/csv; charset=utf-8', filename: 'users.csv' }; });
  r.get('/api/admin/users/:id', (ctx) => { needRole(ctx, STAFF); return admin.user(Number(ctx.params.id)); });
  r.post('/api/admin/users/:id/role', (ctx) => admin.setRole(needRole(ctx, ADMIN), Number(ctx.params.id), String(ctx.body.role), ctx.ip));
  r.post('/api/admin/users/:id/plan', (ctx) => admin.setPlan(needRole(ctx, ADMIN), Number(ctx.params.id), String(ctx.body.plan), ctx.body.days, ctx.ip));
  r.post('/api/admin/users/:id/credits', (ctx) => admin.grant(needRole(ctx, ADMIN), Number(ctx.params.id), ctx.body.amount, ctx.body.reason, ctx.ip));
  r.post('/api/admin/users/:id/block', (ctx) => admin.setBlocked(needRole(ctx, ADMIN), Number(ctx.params.id), !!ctx.body.blocked, ctx.ip));
  r.post('/api/admin/payments/:id/refund', async (ctx) => { const p = await payments.refund(needRole(ctx, ADMIN), Number(ctx.params.id), ctx.ip); return { id: p.id, status: p.status }; });
  r.get('/api/admin/audit', (ctx) => { needRole(ctx, STAFF); return { items: audit.list({ q: String(ctx.query.q || ''), action: String(ctx.query.action || ''), before: ctx.query.before ? Number(ctx.query.before) : null, limit: 100 }) }; });
  r.get('/api/admin/settings', (ctx) => { needRole(ctx, STAFF); return settings.all(); });
  r.post('/api/admin/settings', (ctx) => { const a = needRole(ctx, ADMIN); return { [ctx.body.key]: admin.setSetting(a, String(ctx.body.key), ctx.body.value, ctx.ip) }; });
  r.post('/api/admin/renew', async (ctx) => { needRole(ctx, ADMIN); return { results: await payments.renewDue() }; });

  // ---------- обработка запроса
  const appPublic = path.join(__dirname, '..', 'public');
  const siteRoot = opts.siteRoot || path.join(__dirname, '..', '..');
  function sitePath(p) {
    let d; try { d = decodeURIComponent(p || '/'); } catch (e) { return null; }
    if (d === '/') return '/index.html';
    return /^\/[A-Za-z0-9][\w-]*(\.dc)?\.(html|js|mp4|ico)$/.test(d) ? d : null;
  }
  const NO_CSRF = new Set(['/api/auth/register', '/api/auth/login', '/api/auth/verify', '/api/auth/forgot', '/api/auth/reset', '/api/payments/webhook']);

  // Ограничение частоты запросов к API с одного адреса (вторая линия после nginx).
  const apiHits = new Map();
  function apiAllowed(ip) {
    const t = now(), w = 60e3, max = 300;
    let e = apiHits.get(ip);
    if (!e || t - e.start > w) { e = { start: t, n: 0 }; apiHits.set(ip, e); }
    if (apiHits.size > 50000) apiHits.clear();
    return ++e.n <= max;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    // Строгая политика скриптов для кабинета и API; прототипу (холст) нужна мягкая. HSTS — когда сайт на HTTPS.
    const strict = pathname.startsWith('/api/') || pathname.startsWith('/app');
    const sec = Object.assign(strict ? { 'Content-Security-Policy': STRICT_CSP } : {}, config.secureCookies ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {});
    const send = (r, st, body, h = {}) => rawSend(r, st, body, Object.assign({}, sec, h));
    const serveStatic = (roots, p, r) => rawServe(roots, p, r, sec);
    const ctx = { req, res, ip: clientIp(req), query: Object.fromEntries(url.searchParams), cookies: parseCookies(req.headers.cookie), headers: [], setCookie(c) { this.headers.push(c); } };
    req.ip = ctx.ip;
    try {
      if (pathname.startsWith('/api/')) {
        if (pathname !== '/api/payments/webhook' && !apiAllowed(ctx.ip)) throw new HttpError(429, 'too_many_requests');
        const m = r.match(req.method, pathname);
        if (!m) throw new HttpError(404, 'not_found');
        ctx.params = m.params;
        ctx.auth = auth.sessionFromToken(ctx.cookies.sid);
        if (req.method === 'POST') {
          const ct = String(req.headers['content-type'] || '');
          if (!ct.startsWith('application/json')) throw new HttpError(415, 'json_required');
          // Защита от подделки запросов: чужой Origin запрещён (кроме вебхука), а при сессии нужен X-CSRF.
          const origin = req.headers.origin;
          if (pathname !== '/api/payments/webhook' && origin && origin !== baseOrigin) throw new HttpError(403, 'bad_origin');
          if (ctx.auth && !NO_CSRF.has(pathname) && req.headers['x-csrf'] !== ctx.auth.session.csrf) throw new HttpError(403, 'csrf');
          const raw = await readBody(req);
          try { ctx.body = raw ? JSON.parse(raw) : {}; } catch (e) { throw new HttpError(400, 'bad_json'); }
          if (typeof ctx.body !== 'object' || ctx.body === null) ctx.body = {};
        }
        const out = await m.handler(ctx);
        const extra = ctx.headers.length ? { 'Set-Cookie': ctx.headers } : {};
        if (out && out.redirect) return send(res, 302, '', Object.assign({ Location: out.redirect }, extra));
        if (out && out.raw !== undefined) return send(res, 200, out.raw, Object.assign({ 'Content-Type': out.type, 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store' }, extra));
        return send(res, 200, out || {}, extra);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed');
      // /app/* — настоящие экраны сервиса; остальное — сайт и прототип.
      if (pathname === '/app') return send(res, 301, '', { Location: '/app/' });
      if (pathname.startsWith('/app/')) {
        const sub = pathname.slice(4);
        const page = { '/login': '/auth.html', '/register': '/auth.html', '/forgot': '/auth.html', '/reset': '/auth.html', '/verify': '/auth.html', '/mock-pay': '/mock-pay.html' }[sub];
        if (serveStatic([appPublic], page || sub, res)) return;
        if (serveStatic([appPublic], '/index.html', res)) return;
      }
      if (pathname === '/' || pathname === '/MLanding.dc.html') {
        // Главная — лендинг прототипа (на телефоне — мобильный); его кнопки входа и регистрации ведут в настоящие экраны /app/.
        const fs = require('node:fs');
        let html; try { html = fs.readFileSync(path.join(siteRoot, pathname === '/' ? 'Landing.dc.html' : 'MLanding.dc.html'), 'utf8'); } catch (e) { html = null; }
        if (html) return send(res, 200, html.replace('</body>', LANDING_BRIDGE + '</body>'), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      }
      if (pathname === '/prototype') return send(res, 301, '', { Location: '/prototype/' });
      // Прототип целиком доступен по /prototype/ (страница со всеми экранами и демо-видео).
      // Из корня репозитория отдаются только файлы прототипа верхнего уровня (страницы, support.js, видео) —
      // исходники app/, desktop/, .git и служебные файлы наружу не попадают.
      if (pathname.startsWith('/prototype/')) { const sp = sitePath(pathname.slice(10)); if (sp && serveStatic([siteRoot], sp, res)) return; }
      { const sp = sitePath(pathname); if (sp && serveStatic([siteRoot], sp, res)) return; }
      send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, Object.assign({ error: e.code }, e.extra || {}), ctx.headers.length ? { 'Set-Cookie': ctx.headers } : {});
      logger.error('[error]', req.method, pathname, e && e.stack || e);
      send(res, 500, { error: 'internal' });
    }
  }

  return { handle, db, config, services: { audit, settings, credits, mail, auth, payments, admin, provider } };
}

module.exports = { createApp };
