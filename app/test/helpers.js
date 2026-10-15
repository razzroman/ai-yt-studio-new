'use strict';
const http = require('node:http');
const { createApp } = require('../src/app');
const dbm = require('../src/db');

// Поднимает сервис на случайном порту с базой в памяти и заглушкой шлюза.
async function start(over = {}) {
  const mails = [];
  const logger = { log: (m) => { if (String(m).startsWith('[mail]')) mails.push(String(m)); }, error: () => {} };
  let clock = over.startTime || Date.parse('2026-10-16T10:00:00Z');
  const config = Object.assign({
    port: 0, host: '127.0.0.1', baseUrl: 'http://127.0.0.1', dbPath: ':memory:', secret: 'test-secret', secureCookies: false,
    mail: { provider: 'log', from: 'x <x@x.ru>' }, google: { clientId: '', clientSecret: '' },
    yookassa: { mode: 'mock' }, startCredits: 60, bootstrapAdmin: 'boss@example.com'
  }, over.config || {});
  const app = createApp({ config, db: dbm.open(':memory:'), logger, now: () => clock, fetch: over.fetch, provider: over.provider });
  const server = http.createServer((q, s) => app.handle(q, s));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  config.baseUrl = base;

  // Простой клиент с cookie-банкой.
  function client() {
    let sid = '', csrf = '';
    async function call(method, path, body, headers = {}) {
      const h = Object.assign({}, headers);
      if (sid) h.Cookie = 'sid=' + sid;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      if (csrf && method === 'POST') h['X-CSRF'] = csrf;
      const res = await fetch(base + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
      const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      sc.forEach(c => { const m = c.match(/^sid=([^;]*)/); if (m) sid = decodeURIComponent(m[1]); });
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch (e) {}
      if (json && json.csrf) csrf = json.csrf;
      return { status: res.status, body: json, text, headers: res.headers };
    }
    return { get: (p, h) => call('GET', p, undefined, h), post: (p, b = {}, h) => call('POST', p, b, h), get sid() { return sid; }, setCsrf(v) { csrf = v; } };
  }

  const lastLink = (kind) => { const m = mails.slice().reverse().join('\n').match(new RegExp('(/app/' + kind + '\\?token=[\\w-]+)')); return m && m[1]; };
  const tokenFrom = (link) => link.split('token=')[1];

  async function signup(c, email, extra = {}) {
    const r = await c.post('/api/auth/register', Object.assign({ email, password: 'secret123', name: 'Тест', consentTerms: true, consentPd: true }, extra));
    if (r.status !== 200) throw new Error('signup failed ' + JSON.stringify(r.body));
    const v = await c.post('/api/auth/verify', { token: tokenFrom(lastLink('verify')) });
    if (v.status !== 200) throw new Error('verify failed');
    await c.get('/api/me');
    return r.body.user;
  }

  return { app, base, client, mails, lastLink, tokenFrom, signup, tick: (ms) => { clock += ms; }, close: () => new Promise(r => server.close(r)) };
}

module.exports = { start };
