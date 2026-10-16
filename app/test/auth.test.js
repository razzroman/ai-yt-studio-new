'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');
const C = require('../src/crypto');

test('регистрация → письмо → подтверждение → 60 кредитов ровно один раз', async () => {
  const t = await start();
  const c = t.client();
  const r = await c.post('/api/auth/register', { email: 'Anna@Example.com', password: 'secret123', name: 'Анна', consentTerms: true, consentPd: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, 'anna@example.com');
  assert.equal(r.body.user.balance, 0, 'до подтверждения кредитов нет');
  const link = t.lastLink('verify');
  assert.ok(link, 'письмо с подтверждением ушло');
  const v = await c.post('/api/auth/verify', { token: t.tokenFrom(link) });
  assert.equal(v.status, 200);
  assert.equal(v.body.user.balance, 60);
  // Повторный переход по той же ссылке не начисляет ещё раз.
  const v2 = await c.post('/api/auth/verify', { token: t.tokenFrom(link) });
  assert.equal(v2.status, 400);
  const me = await c.get('/api/me');
  assert.equal(me.body.user.balance, 60);
  const h = await c.get('/api/credits');
  assert.equal(h.body.items.length, 1);
  assert.equal(h.body.items[0].kind, 'grant');
  await t.close();
});

test('регистрация требует согласий, хорошего пароля и уникальной почты', async () => {
  const t = await start();
  const c = t.client();
  const base = { email: 'a@b.ru', password: 'secret123', name: 'A', consentTerms: true, consentPd: true };
  assert.equal((await c.post('/api/auth/register', Object.assign({}, base, { consentPd: false }))).body.error, 'consent_required');
  assert.equal((await c.post('/api/auth/register', Object.assign({}, base, { password: 'short1' }))).body.error, 'password_short');
  assert.equal((await c.post('/api/auth/register', Object.assign({}, base, { password: 'onlyletters' }))).body.error, 'password_weak');
  assert.equal((await c.post('/api/auth/register', Object.assign({}, base, { email: 'bad' }))).body.error, 'email_invalid');
  assert.equal((await c.post('/api/auth/register', base)).status, 200);
  assert.equal((await t.client().post('/api/auth/register', base)).body.error, 'email_taken');
  await t.close();
});

test('вход, неверный пароль, выход', async () => {
  const t = await start();
  await t.signup(t.client(), 'u@x.ru');
  const c = t.client();
  assert.equal((await c.post('/api/auth/login', { email: 'u@x.ru', password: 'wrong123' })).status, 401);
  const ok = await c.post('/api/auth/login', { email: 'U@x.ru', password: 'secret123' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'u@x.ru');
  assert.equal((await c.get('/api/me')).status, 200);
  await c.post('/api/auth/logout', {});
  assert.equal((await c.get('/api/me')).status, 401);
  await t.close();
});

test('перебор пароля ограничен', async () => {
  const t = await start();
  await t.signup(t.client(), 'v@x.ru');
  const c = t.client();
  let last;
  for (let i = 0; i < 11; i++) last = await c.post('/api/auth/login', { email: 'v@x.ru', password: 'nope' + i });
  assert.equal(last.status, 429);
  await t.close();
});

test('сброс пароля: одинаковый ответ для чужой почты, ссылка одноразовая, сеансы завершаются', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'r@x.ru');
  const before = t.mails.length;
  assert.equal((await t.client().post('/api/auth/forgot', { email: 'nobody@x.ru' })).status, 200);
  assert.equal(t.mails.length, before, 'на несуществующую почту письмо не уходит');
  await t.client().post('/api/auth/forgot', { email: 'r@x.ru' });
  const tok = t.tokenFrom(t.lastLink('reset'));
  assert.equal((await t.client().post('/api/auth/reset', { token: tok, password: 'short' })).body.error, 'password_short');
  assert.equal((await t.client().post('/api/auth/reset', { token: tok, password: 'newpass123' })).status, 200);
  assert.equal((await t.client().post('/api/auth/reset', { token: tok, password: 'other123x' })).body.error, 'token_invalid');
  assert.equal((await c.get('/api/me')).status, 401, 'старый сеанс завершён');
  assert.equal((await t.client().post('/api/auth/login', { email: 'r@x.ru', password: 'newpass123' })).status, 200);
  await t.close();
});

test('2FA: без кода кабинет закрыт, с кодом открыт', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'm@x.ru');
  const s = await c.post('/api/me/totp/setup', {});
  assert.ok(s.body.secret);
  assert.equal((await c.post('/api/me/totp/enable', { code: '000000' })).body.error, 'bad_code');
  assert.equal((await c.post('/api/me/totp/enable', { code: C.totp(s.body.secret, Date.parse('2026-10-16T10:00:00Z')) })).status, 200);
  const d = t.client();
  const l = await d.post('/api/auth/login', { email: 'm@x.ru', password: 'secret123' });
  assert.equal(l.body.mfaRequired, true);
  assert.equal((await d.get('/api/credits')).body.error, 'mfa_required');
  assert.equal((await d.post('/api/auth/2fa', { code: '123456' })).status, 401);
  assert.equal((await d.post('/api/auth/2fa', { code: C.totp(s.body.secret, Date.parse('2026-10-16T10:00:00Z')) })).status, 200);
  assert.equal((await d.get('/api/credits')).status, 200);
  await t.close();
});

test('сеансы: видно список, можно завершить чужой', async () => {
  const t = await start();
  const a = t.client();
  await t.signup(a, 's@x.ru');
  const b = t.client();
  await b.post('/api/auth/login', { email: 's@x.ru', password: 'secret123' });
  const list = await a.get('/api/me/sessions');
  assert.equal(list.body.items.length, 2);
  const other = list.body.items.find(x => !x.current);
  assert.equal((await a.post('/api/me/sessions/' + other.id + '/revoke', {})).body.ok, true);
  assert.equal((await b.get('/api/me')).status, 401);
  await t.close();
});

test('CSRF: без заголовка и с чужого сайта запросы отклоняются', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'c@x.ru');
  c.setCsrf('wrong');
  assert.equal((await c.post('/api/me', { name: 'X' })).body.error, 'csrf');
  const evil = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(evil.status, 403);
  const form = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=a' });
  assert.equal(form.status, 415);
  await t.close();
});

test('TOTP совпадает с эталоном RFC 6238', () => {
  // Секрет "12345678901234567890" (ASCII), время 59 c → 94287082 (8 цифр) → последние 6: 287082
  const secret = C.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(C.totp(secret, 59 * 1000), '287082');
});

test('Google: новый пользователь без согласий не создаётся, с согласиями — создаётся и подтверждён', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push(url);
    if (url.includes('oauth2.googleapis.com/token')) return { ok: true, json: async () => ({ access_token: 'at' }) };
    if (url.includes('userinfo')) return { ok: true, json: async () => ({ sub: 'g-1', email: 'G@gmail.com', email_verified: true, name: 'Гоша' }) };
    throw new Error('unexpected ' + url);
  };
  const t = await start({ fetch: fakeFetch, config: { google: { clientId: 'cid', clientSecret: 'cs' } } });
  const go = async (consent) => {
    const s = await fetch(t.base + '/api/auth/google/start?consent=' + (consent ? 1 : 0), { redirect: 'manual' });
    const loc = new URL(s.headers.get('location'));
    const nonce = s.headers.getSetCookie().find(x => x.startsWith('gstate=')).split(';')[0].split('=')[1];
    return fetch(t.base + '/api/auth/google/callback?code=abc&state=' + encodeURIComponent(loc.searchParams.get('state')), { redirect: 'manual', headers: { Cookie: 'gstate=' + nonce } });
  };
  const no = await go(false);
  assert.match(no.headers.get('location'), /error=consent_required/);
  const yes = await go(true);
  assert.equal(yes.headers.get('location'), '/app/');
  const sid = yes.headers.getSetCookie().find(x => x.startsWith('sid=')).split(';')[0];
  const me = await (await fetch(t.base + '/api/me', { headers: { Cookie: sid } })).json();
  assert.equal(me.user.email, 'g@gmail.com');
  assert.equal(me.user.balance, 60);
  // Подделанный state отклоняется.
  const bad = await fetch(t.base + '/api/auth/google/callback?code=abc&state=xxx.yyy', { redirect: 'manual' });
  assert.match(bad.headers.get('location'), /error=state_invalid/);
  await t.close();
});

test('защита: строгая политика скриптов для кабинета, лимит запросов к API', async () => {
  const t = await start();
  const page = await fetch(t.base + '/app/login');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self';/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  let last;
  for (let i = 0; i < 305; i++) last = await fetch(t.base + '/api/health');
  assert.equal(last.status, 429, 'после 300 запросов в минуту с одного адреса — отказ');
  // Уведомления ЮKassa под лимит не попадают.
  const wh = await fetch(t.base + '/api/payments/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(wh.status, 200);
  await t.close();
});
