'use strict';
const { tx } = require('../db');
const { HttpError } = require('../http');

// Баланс и журнал операций меняются в одной транзакции. Баланс не может уйти в минус
// (проверка здесь + CHECK в схеме). Операция с ref выполняется ровно один раз.
module.exports = function makeCredits(db) {
  const getBal = db.prepare('SELECT balance FROM users WHERE id = ?');
  const setBal = db.prepare('UPDATE users SET balance = ? WHERE id = ?');
  const ins = db.prepare('INSERT INTO credit_tx (user_id, delta, balance_after, kind, reason, ref) VALUES (?, ?, ?, ?, ?, ?)');
  const byRef = db.prepare('SELECT * FROM credit_tx WHERE kind = ? AND ref = ?');

  function apply(userId, delta, kind, reason = '', ref = null) {
    if (!Number.isInteger(delta) || delta === 0) throw new HttpError(400, 'bad_amount');
    return tx(db, () => {
      if (ref) { const ex = byRef.get(kind, ref); if (ex) return { tx: ex, duplicate: true }; }
      const row = getBal.get(userId);
      if (!row) throw new HttpError(404, 'user_not_found');
      const next = row.balance + delta;
      if (next < 0) throw new HttpError(402, 'insufficient_credits', { balance: row.balance, need: -delta });
      setBal.run(next, userId);
      const id = Number(ins.run(userId, delta, next, kind, reason, ref).lastInsertRowid);
      return { tx: db.prepare('SELECT * FROM credit_tx WHERE id = ?').get(id), duplicate: false };
    });
  }

  return {
    apply,
    balance: (userId) => (getBal.get(userId) || { balance: 0 }).balance,
    // Списание за генерацию (этап 2 будет вызывать его из очереди задач).
    spend: (userId, amount, reason, ref) => apply(userId, -Math.abs(amount), 'spend', reason, ref),
    // Возврат списания при сбое генерации — ровно на сумму исходного списания.
    refundSpend(userId, spendRef, reason) {
      const orig = byRef.get('spend', spendRef);
      if (!orig || orig.user_id !== userId) throw new HttpError(404, 'spend_not_found');
      return apply(userId, -orig.delta, 'refund', reason || orig.reason, spendRef);
    },
    history(userId, { kind = '', limit = 50, before = null } = {}) {
      const where = ['user_id = ?'], args = [userId];
      if (kind === 'in') where.push('delta > 0'); else if (kind === 'out') where.push('delta < 0'); else if (kind) { where.push('kind = ?'); args.push(kind); }
      if (before) { where.push('id < ?'); args.push(before); }
      return db.prepare(`SELECT id, delta, balance_after, kind, reason, ref, created_at FROM credit_tx WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, Math.min(limit, 200));
    }
  };
};
