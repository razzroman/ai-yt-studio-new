'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

test('права доступа: пользователь и модератор не меняют роли и кредиты', async () => {
  const t = await start();
  const a = t.client(); const boss = await t.signup(a, 'boss@example.com');
  const m = t.client(); const mod = await t.signup(m, 'mod@x.ru');
  const u = t.client(); const usr = await t.signup(u, 'u@x.ru');
  assert.equal((await u.get('/api/admin/users')).status, 403);
  assert.equal((await u.post('/api/admin/users/' + usr.id + '/credits', { amount: 100, reason: 'хочу' })).status, 403);
  assert.equal((await a.post('/api/admin/users/' + mod.id + '/role', { role: 'moderator' })).status, 200);
  assert.equal((await m.get('/api/admin/users')).status, 200, 'модератор видит пользователей');
  assert.equal((await m.post('/api/admin/users/' + usr.id + '/credits', { amount: 100, reason: 'x' })).status, 403);
  assert.equal((await m.post('/api/admin/users/' + mod.id + '/role', { role: 'admin' })).status, 403);
  assert.equal((await m.post('/api/admin/settings', { key: 'eridOn', value: false })).status, 403);
  // Админ не может сам себя понизить и не может убрать последнего администратора.
  assert.equal((await a.post('/api/admin/users/' + boss.id + '/role', { role: 'user' })).body.error, 'cannot_demote_self');
  await t.close();
});

test('администратор: поиск, тариф, начисление с причиной, блокировка — всё в журнале', async () => {
  const t = await start();
  const a = t.client(); await t.signup(a, 'boss@example.com');
  const u = t.client(); const usr = await t.signup(u, 'olga@x.ru');
  const s = await a.get('/api/admin/users?q=olga');
  assert.equal(s.body.total, 1);
  assert.equal((await a.post('/api/admin/users/' + usr.id + '/plan', { plan: 'studio', days: 14 })).body.plan, 'studio');
  assert.equal((await a.post('/api/admin/users/' + usr.id + '/credits', { amount: 250, reason: '' })).body.error, 'reason_required');
  assert.equal((await a.post('/api/admin/users/' + usr.id + '/credits', { amount: 250, reason: 'Компенсация сбоя' })).body.balance, 310);
  assert.equal((await a.post('/api/admin/users/' + usr.id + '/credits', { amount: -1000, reason: 'Ошибка' })).body.error, 'insufficient_credits');
  assert.equal((await a.post('/api/admin/users/' + usr.id + '/block', { blocked: true })).body.blocked, true);
  assert.equal((await u.get('/api/me')).status, 401, 'заблокированного выбрасывает');
  assert.equal((await t.client().post('/api/auth/login', { email: 'olga@x.ru', password: 'secret123' })).body.error, 'account_blocked');
  const log = await a.get('/api/admin/audit');
  const actions = log.body.items.map(x => x.action);
  ['admin.plan', 'admin.credits', 'admin.block'].forEach(x => assert.ok(actions.includes(x), x));
  const credit = log.body.items.find(x => x.action === 'admin.credits');
  assert.equal(credit.details.reason, 'Компенсация сбоя');
  assert.equal(credit.target_email, 'olga@x.ru');
  const card = await a.get('/api/admin/users/' + usr.id);
  assert.equal(card.body.credits[0].kind, 'admin');
  const csv = await a.get('/api/admin/users.csv');
  assert.match(csv.text, /olga@x\.ru/);
  await t.close();
});

test('настройки: цены меняются и сразу видны пользователям, мусор не принимается', async () => {
  const t = await start();
  const a = t.client(); await t.signup(a, 'boss@example.com');
  const cur = (await a.get('/api/admin/settings')).body.products;
  cur.author.priceKop = 199000;
  assert.equal((await a.post('/api/admin/settings', { key: 'products', value: cur })).status, 200);
  assert.equal((await t.client().get('/api/public/config')).body.products.author.priceKop, 199000);
  cur.author.priceKop = -5;
  assert.equal((await a.post('/api/admin/settings', { key: 'products', value: cur })).body.error, 'bad_product_author');
  assert.equal((await a.post('/api/admin/settings', { key: 'payMethods', value: { card: false, sbp: false, sberpay: false, tpay: false } })).body.error, 'need_one_method');
  assert.equal((await a.post('/api/admin/settings', { key: 'hack', value: 1 })).body.error, 'unknown_key');
  await t.close();
});
