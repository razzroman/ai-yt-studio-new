'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

async function pay(t, c, product, ok = true, method = 'card') {
  const p = await c.post('/api/payments', { product, method });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const providerId = new URL(p.body.confirmationUrl, t.base).searchParams.get('id');
  const d = await c.post('/api/mock/decide', { id: providerId, ok });
  assert.equal(d.status, 200);
  return { id: p.body.id, providerId };
}

test('«Автор»: кредиты и тариф — только после успешной оплаты, повторный вебхук ничего не дублирует', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'p@x.ru');
  const p = await c.post('/api/payments', { product: 'author', method: 'card' });
  assert.ok(p.body.confirmationUrl);
  let me = await c.get('/api/me');
  assert.equal(me.body.user.plan, 'start', 'до оплаты тариф не меняется');
  assert.equal(me.body.user.balance, 60);
  const pid = new URL(p.body.confirmationUrl, t.base).searchParams.get('id');
  // Поддельный вебхук без реальной оплаты — статус перезапрашивается у шлюза и остаётся pending.
  await t.client().post('/api/payments/webhook', { type: 'notification', event: 'payment.succeeded', object: { id: pid, status: 'succeeded' } });
  me = await c.get('/api/me');
  assert.equal(me.body.user.plan, 'start', 'вебхуку не верим на слово');
  await c.post('/api/mock/decide', { id: pid, ok: true });
  me = await c.get('/api/me');
  assert.equal(me.body.user.plan, 'author');
  assert.equal(me.body.user.balance, 1060);
  assert.ok(me.body.user.planUntil);
  // Повтор уведомления — без второго начисления.
  await t.client().post('/api/payments/webhook', { type: 'notification', event: 'payment.succeeded', object: { id: pid } });
  assert.equal((await c.get('/api/me')).body.user.balance, 1060);
  const hist = await c.get('/api/credits');
  assert.equal(hist.body.items.filter(x => x.kind === 'purchase').length, 1);
  assert.ok(t.mails.some(m => m.includes('Оплата прошла')), 'письмо об оплате с упоминанием чека');
  await t.close();
});

test('отказ банка ничего не открывает', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'f@x.ru');
  const { id } = await pay(t, c, 'studio', false);
  const me = await c.get('/api/me');
  assert.equal(me.body.user.plan, 'start');
  assert.equal(me.body.user.balance, 60);
  const st = await c.get('/api/payments/' + id);
  assert.equal(st.body.status, 'canceled');
  await t.close();
});

test('сумма в уведомлении не совпала — оплата не засчитывается', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'sum@x.ru');
  const p = await c.post('/api/payments', { product: 'author', method: 'card' });
  const pid = new URL(p.body.confirmationUrl, t.base).searchParams.get('id');
  const remote = t.app.services.provider.store.get(pid);
  remote.amount.value = '1.00'; remote.status = 'succeeded';
  await t.client().post('/api/payments/webhook', { type: 'notification', event: 'payment.succeeded', object: { id: pid } });
  assert.equal((await c.get('/api/me')).body.user.plan, 'start');
  await t.close();
});

test('пакет кредитов — только на платном тарифе; неподтверждённая почта не платит; выключенный способ недоступен', async () => {
  const t = await start();
  const c = t.client();
  await t.signup(c, 'k@x.ru');
  assert.equal((await c.post('/api/payments', { product: 'pack', method: 'card' })).body.error, 'pack_needs_plan');
  await pay(t, c, 'author');
  await pay(t, c, 'pack', true, 'sbp');
  assert.equal((await c.get('/api/me')).body.user.balance, 60 + 1000 + 500);
  const n = t.client();
  await n.post('/api/auth/register', { email: 'nv@x.ru', password: 'secret123', name: 'N', consentTerms: true, consentPd: true });
  assert.equal((await n.post('/api/payments', { product: 'author', method: 'card' })).body.error, 'email_not_verified');
  // Администратор выключает СБП — у пользователя способ сразу недоступен.
  const a = t.client();
  await t.signup(a, 'boss@example.com');
  await a.post('/api/admin/settings', { key: 'payMethods', value: { card: true, sbp: false, sberpay: true, tpay: true } });
  assert.equal((await c.post('/api/payments', { product: 'pack', method: 'sbp' })).body.error, 'method_disabled');
  assert.equal((await t.client().get('/api/public/config')).body.payMethods.sbp, false);
  await t.close();
});

test('списание не уводит баланс в минус; возврат списания — ровно на сумму и один раз', async () => {
  const t = await start();
  const c = t.client();
  const u = await t.signup(c, 'sp@x.ru');
  const cr = t.app.services.credits;
  cr.spend(u.id, 40, 'Сценарий', 'job:1');
  assert.throws(() => cr.spend(u.id, 40, 'Озвучка', 'job:2'), (e) => e.code === 'insufficient_credits');
  assert.equal(cr.balance(u.id), 20);
  cr.refundSpend(u.id, 'job:1', 'Сбой генерации');
  cr.refundSpend(u.id, 'job:1', 'Сбой генерации');
  assert.equal(cr.balance(u.id), 60);
  const h = await c.get('/api/credits?kind=out');
  assert.equal(h.body.items.length, 1);
  assert.equal(h.body.items[0].kind, 'spend');
  const all = await c.get('/api/credits');
  assert.deepEqual(all.body.items.map(x => x.kind), ['refund', 'spend', 'grant']);
  // Одновременные списания не уходят в минус.
  const results = await Promise.allSettled([1, 2, 3, 4].map(i => Promise.resolve().then(() => cr.spend(u.id, 20, 'x', 'p' + i))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 3);
  assert.equal(cr.balance(u.id), 0);
  await t.close();
});

test('возврат оплаты администратором: кредиты забираются не больше остатка, тариф снимается', async () => {
  const t = await start();
  const a = t.client(); await t.signup(a, 'boss@example.com');
  const c = t.client(); const u = await t.signup(c, 'rf@x.ru');
  const { id } = await pay(t, c, 'author');
  t.app.services.credits.spend(u.id, 900, 'Видео', 'job:v');
  const r = await a.post('/api/admin/payments/' + id + '/refund', {});
  assert.equal(r.body.status, 'refunded');
  const me = (await c.get('/api/me')).body.user;
  assert.equal(me.balance, 0);
  assert.equal(me.plan, 'start');
  assert.equal((await a.post('/api/admin/payments/' + id + '/refund', {})).body.error, 'not_refundable');
  await t.close();
});

test('продление: сохранённая карта списывается автоматически; без карты — возврат на «Старт»', async () => {
  const t = await start();
  const c = t.client(); await t.signup(c, 'ren@x.ru');
  await pay(t, c, 'author');
  let me = (await c.get('/api/me')).body.user;
  assert.equal(me.hasSavedCard, true);
  t.tick(20 * 864e5); await c.get('/api/me'); t.tick(11 * 864e5);
  await t.app.services.payments.renewDue();
  me = (await c.get('/api/me')).body.user;
  assert.equal(me.plan, 'author');
  assert.equal(me.balance, 60 + 1000 + 1000);
  // Пользователь выключил автопродление.
  await c.post('/api/me', { autorenew: false });
  t.tick(20 * 864e5); await c.get('/api/me'); t.tick(11 * 864e5);
  await t.app.services.payments.renewDue();
  me = (await c.get('/api/me')).body.user;
  assert.equal(me.plan, 'start');
  assert.equal(me.balance, 2060, 'кредиты сохраняются');
  await t.close();
});
