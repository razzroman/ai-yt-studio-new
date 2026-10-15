'use strict';
const { tx } = require('../db');
const { HttpError } = require('../http');
const C = require('../crypto');

// Правило ТЗ: тариф и кредиты открываются только после подтверждённой оплаты.
// Уведомлению ЮKassa не верим на слово — статус всегда перезапрашиваем у API по id платежа.
module.exports = function makePayments({ db, config, credits, audit, mail, settings, provider, now = () => Date.now() }) {
  const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const byProvider = db.prepare('SELECT * FROM payments WHERE provider_id = ?');
  const byId = db.prepare('SELECT * FROM payments WHERE id = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const notify = (uid, ru, en) => db.prepare('INSERT INTO notifications (user_id, text_ru, text_en) VALUES (?, ?, ?)').run(uid, ru, en);
  const PLAN_NAMES = { start: ['Старт', 'Start'], author: ['Автор', 'Creator'], studio: ['Студия', 'Studio'] };

  function productLabel(id, lang) {
    const p = settings.get('products')[id];
    const i = lang === 'en' ? 1 : 0;
    return p.kind === 'plan' ? (lang === 'en' ? 'Plan “' : 'Тариф «') + PLAN_NAMES[p.plan][i] + (lang === 'en' ? '”' : '»') + ', ' + p.credits + (lang === 'en' ? ' credits' : ' кредитов')
      : (lang === 'en' ? 'Credit pack, ' : 'Пакет кредитов, ') + p.credits;
  }

  async function create(user, productId, method, ip) {
    const products = settings.get('products');
    const prod = products[productId];
    if (!prod) throw new HttpError(400, 'bad_product');
    if (!user.email_verified) throw new HttpError(403, 'email_not_verified');
    const methods = settings.get('payMethods');
    if (!methods[method]) throw new HttpError(400, 'method_disabled');
    // Пакет кредитов доступен только на платном тарифе (как в прототипе и ТЗ).
    if (prod.kind === 'pack' && user.plan === 'start') throw new HttpError(400, 'pack_needs_plan');
    // Не плодим одинаковые ожидающие платежи: если такой уже есть — отдаём его ссылку.
    const pend = db.prepare("SELECT * FROM payments WHERE user_id = ? AND product = ? AND status = 'pending' AND created_at > ? ORDER BY id DESC LIMIT 1").get(user.id, productId, iso(now() - 30 * 60e3));
    if (pend && pend.confirmation_url && pend.method === method) return pend;
    const idem = C.uuid();
    const pid = Number(db.prepare('INSERT INTO payments (user_id, product, amount_kop, credits, method, idem_key) VALUES (?, ?, ?, ?, ?, ?)')
      .run(user.id, productId, prod.priceKop, prod.credits, method, idem).lastInsertRowid);
    let remote;
    try {
      remote = await provider.createPayment({
        amountKop: prod.priceKop, description: productLabel(productId, 'ru') + ' — AI YT Studio', method,
        returnUrl: config.baseUrl + '/app/#/billing?payment=' + pid,
        savePaymentMethod: prod.kind === 'plan' && method === 'card' && !!user.autorenew,
        metadata: { payment_id: String(pid), user_id: String(user.id), product: productId }, idemKey: idem
      });
    } catch (e) {
      db.prepare("UPDATE payments SET status = 'canceled', cancel_reason = ?, updated_at = ? WHERE id = ?").run('gateway_error', iso(now()), pid);
      audit.log(user.id, 'payment.gateway_error', user.id, { payment: pid, error: String(e.message).slice(0, 200) }, ip);
      throw new HttpError(502, 'gateway_error');
    }
    db.prepare('UPDATE payments SET provider_id = ?, confirmation_url = ?, updated_at = ? WHERE id = ?')
      .run(remote.id, remote.confirmation && remote.confirmation.confirmation_url, iso(now()), pid);
    audit.log(user.id, 'payment.created', user.id, { payment: pid, product: productId, amountKop: prod.priceKop, method }, ip);
    return byId.get(pid);
  }

  // Применить подтверждённый статус платежа. Вызывается из вебхука, со страницы возврата и из автопродления.
  function applyRemote(remote, source) {
    const p = byProvider.get(remote.id);
    if (!p) return { ignored: 'unknown_payment' };
    const amountOk = Math.round(parseFloat(remote.amount && remote.amount.value) * 100) === p.amount_kop && (!remote.amount.currency || remote.amount.currency === 'RUB');
    if (remote.status === 'succeeded') {
      if (!amountOk) { audit.log(null, 'payment.amount_mismatch', p.user_id, { payment: p.id, remote: remote.amount }); return { ignored: 'amount_mismatch' }; }
      if (p.status === 'succeeded' || p.status === 'refunded') return { already: true, payment: p };
      const prod = settings.get('products')[p.product] || { kind: p.product === 'pack' ? 'pack' : 'plan', plan: p.product, days: 30 };
      tx(db, () => {
        db.prepare("UPDATE payments SET status = 'succeeded', updated_at = ? WHERE id = ?").run(iso(now()), p.id);
        credits.apply(p.user_id, p.credits, 'purchase', productLabel(p.product, 'ru'), 'pay:' + p.id);
        if (prod.kind === 'plan') {
          const u = userById.get(p.user_id);
          const from = u.plan === prod.plan && u.plan_until && u.plan_until > iso(now()) ? Date.parse(u.plan_until.replace(' ', 'T') + 'Z') : now();
          db.prepare('UPDATE users SET plan = ?, plan_until = ? WHERE id = ?').run(prod.plan, iso(from + (prod.days || 30) * 864e5), p.user_id);
        }
        if (remote.payment_method && remote.payment_method.saved && remote.payment_method.id) db.prepare('UPDATE users SET payment_method_id = ? WHERE id = ?').run(remote.payment_method.id, p.user_id);
        notify(p.user_id, 'Оплата прошла: ' + productLabel(p.product, 'ru') + '.', 'Payment received: ' + productLabel(p.product, 'en') + '.');
        audit.log(null, 'payment.succeeded', p.user_id, { payment: p.id, product: p.product, amountKop: p.amount_kop, source });
      });
      const u = userById.get(p.user_id);
      mail.send(u.email, 'paid', u.lang, productLabel(p.product, u.lang));
      return { succeeded: true, payment: byId.get(p.id) };
    }
    if (remote.status === 'canceled') {
      if (p.status !== 'pending' && p.status !== 'waiting_for_capture') return { already: true, payment: p };
      const reason = (remote.cancellation_details && remote.cancellation_details.reason) || 'canceled';
      db.prepare("UPDATE payments SET status = 'canceled', cancel_reason = ?, updated_at = ? WHERE id = ?").run(reason, iso(now()), p.id);
      notify(p.user_id, 'Оплата не прошла — тариф и кредиты не изменились.', 'Payment failed — your plan and credits did not change.');
      audit.log(null, 'payment.canceled', p.user_id, { payment: p.id, reason, source });
      return { canceled: true, payment: byId.get(p.id) };
    }
    if (remote.status === 'waiting_for_capture') {
      db.prepare("UPDATE payments SET status = 'waiting_for_capture', updated_at = ? WHERE id = ?").run(iso(now()), p.id);
    }
    return { pending: true, payment: byId.get(p.id) };
  }

  async function webhook(body) {
    // Формат ЮKassa: { type: 'notification', event: 'payment.succeeded' | 'payment.canceled' | ..., object: { id, ... } }
    if (!body || body.type !== 'notification' || !body.object || !body.object.id) return { ignored: 'bad_body' };
    if (String(body.event).startsWith('refund.')) return { ignored: 'refund_event' }; // возвраты обрабатываем синхронно в refund()
    const remote = await provider.getPayment(body.object.id);
    return applyRemote(remote, 'webhook:' + body.event);
  }

  // Пользователь вернулся со страницы оплаты — уточняем статус, не дожидаясь вебхука.
  async function refresh(user, paymentId) {
    const p = byId.get(paymentId);
    if (!p || p.user_id !== user.id) throw new HttpError(404, 'not_found');
    if (p.status === 'pending' && p.provider_id) {
      try { applyRemote(await provider.getPayment(p.provider_id), 'return'); } catch (e) { /* статус придёт вебхуком */ }
    }
    return byId.get(p.id);
  }

  async function refund(actor, paymentId, ip) {
    const p = byId.get(paymentId);
    if (!p) throw new HttpError(404, 'not_found');
    if (p.status !== 'succeeded') throw new HttpError(400, 'not_refundable');
    const r = await provider.createRefund({ paymentId: p.provider_id, amountKop: p.amount_kop, idemKey: 'refund-' + p.id, description: 'Возврат по заказу ' + p.id });
    if (r.status !== 'succeeded' && r.status !== 'pending') throw new HttpError(502, 'refund_failed');
    tx(db, () => {
      db.prepare("UPDATE payments SET status = 'refunded', updated_at = ? WHERE id = ?").run(iso(now()), p.id);
      // Забираем купленные кредиты, но не больше остатка — баланс не уходит в минус.
      const bal = credits.balance(p.user_id);
      const take = Math.min(bal, p.credits);
      if (take > 0) credits.apply(p.user_id, -take, 'refund', 'Возврат оплаты №' + p.id, 'payrefund:' + p.id);
      const prod = settings.get('products')[p.product];
      if (prod && prod.kind === 'plan') db.prepare("UPDATE users SET plan = 'start', plan_until = NULL WHERE id = ? AND plan = ?").run(p.user_id, prod.plan);
      notify(p.user_id, 'Оплата возвращена. Чек в «Мой налог» аннулирован.', 'Payment refunded. The “Moy Nalog” receipt was cancelled.');
      audit.log(actor.id, 'payment.refunded', p.user_id, { payment: p.id, creditsTaken: take, refund: r.id }, ip);
    });
    // Чек самозанятого при возврате аннулирует ЮKassa (магазин самозанятого) — отдельный вызов не нужен.
    return byId.get(p.id);
  }

  // Продление тарифов: вызывается раз в час. Сохранённая карта → списание без участия пользователя;
  // без карты или с выключенным автопродлением → возврат на «Старт» (кредиты остаются).
  async function renewDue() {
    const due = db.prepare("SELECT * FROM users WHERE plan != 'start' AND plan_until IS NOT NULL AND plan_until <= ?").all(iso(now()));
    const out = [];
    for (const u of due) {
      const prodId = u.plan; const prod = settings.get('products')[prodId];
      const recent = db.prepare("SELECT * FROM payments WHERE user_id = ? AND product = ? AND recurring = 1 AND created_at > ? ORDER BY id DESC LIMIT 1").get(u.id, prodId, iso(now() - 864e5));
      if (u.autorenew && u.payment_method_id && prod && !recent) {
        const idem = C.uuid();
        const pid = Number(db.prepare('INSERT INTO payments (user_id, product, amount_kop, credits, method, recurring, idem_key) VALUES (?, ?, ?, ?, ?, 1, ?)').run(u.id, prodId, prod.priceKop, prod.credits, 'card', idem).lastInsertRowid);
        try {
          const remote = await provider.createPayment({ amountKop: prod.priceKop, description: productLabel(prodId, 'ru') + ' — продление', method: 'card', paymentMethodId: u.payment_method_id, metadata: { payment_id: String(pid), user_id: String(u.id), product: prodId, renew: '1' }, idemKey: idem });
          db.prepare('UPDATE payments SET provider_id = ? WHERE id = ?').run(remote.id, pid);
          out.push({ user: u.id, result: applyRemote(remote, 'renew') });
        } catch (e) {
          db.prepare("UPDATE payments SET status = 'canceled', cancel_reason = 'renew_failed' WHERE id = ?").run(pid);
          out.push({ user: u.id, error: e.message });
        }
        continue;
      }
      if (recent && recent.status === 'pending') continue;
      // Дали сутки на повторную попытку; дальше — «Старт».
      if (!u.autorenew || !u.payment_method_id || (recent && recent.status === 'canceled' && u.plan_until <= iso(now() - 864e5))) {
        db.prepare("UPDATE users SET plan = 'start', plan_until = NULL WHERE id = ?").run(u.id);
        notify(u.id, 'Тариф закончился — вы на «Старте». Кредиты сохранены.', 'Your plan ended — you are on Start. Credits are kept.');
        audit.log(null, 'plan.expired', u.id, { plan: u.plan });
        out.push({ user: u.id, downgraded: true });
      }
    }
    return out;
  }

  function list(userId, limit = 20) {
    return db.prepare('SELECT id, product, amount_kop, credits, method, status, recurring, cancel_reason, created_at FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
  }

  return { create, webhook, refresh, refund, renewDue, applyRemote, list, productLabel };
};
