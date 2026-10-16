'use strict';
const { HttpError } = require('../http');
const { tx } = require('../db');

const ROLES = ['user', 'moderator', 'admin'];
const PLANS = ['start', 'author', 'studio'];

module.exports = function makeAdmin({ db, credits, audit, settings, payments, now = () => Date.now() }) {
  const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const row = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, planUntil: u.plan_until, balance: u.balance, emailVerified: !!u.email_verified, totpEnabled: !!u.totp_enabled, blocked: !!u.blocked, createdAt: u.created_at });
  const must = (id) => { const u = userById.get(id); if (!u) throw new HttpError(404, 'user_not_found'); return u; };

  return {
    dashboard() {
      const one = (sql, ...a) => db.prepare(sql).get(...a);
      const day = iso(now() - 864e5), month = iso(now() - 30 * 864e5);
      return {
        users: one('SELECT COUNT(*) n FROM users').n,
        usersNew7d: one('SELECT COUNT(*) n FROM users WHERE created_at > ?', iso(now() - 7 * 864e5)).n,
        paid: one("SELECT COUNT(*) n FROM users WHERE plan != 'start'").n,
        revenue30dKop: one("SELECT COALESCE(SUM(amount_kop),0) s FROM payments WHERE status = 'succeeded' AND updated_at > ?", month).s,
        payments24h: one("SELECT COUNT(*) n FROM payments WHERE status = 'succeeded' AND updated_at > ?", day).n,
        failed24h: one("SELECT COUNT(*) n FROM payments WHERE status = 'canceled' AND updated_at > ?", day).n,
        creditsOutstanding: one('SELECT COALESCE(SUM(balance),0) s FROM users').s,
        mailFailed: one("SELECT COUNT(*) n FROM outbox WHERE status = 'failed'").n
      };
    },
    users({ q = '', role = '', plan = '', limit = 50, offset = 0 } = {}) {
      const where = [], args = [];
      if (q) { where.push('(email LIKE ? OR name LIKE ? OR CAST(id AS TEXT) = ?)'); args.push('%' + q + '%', '%' + q + '%', q); }
      if (ROLES.includes(role)) { where.push('role = ?'); args.push(role); }
      if (PLANS.includes(plan)) { where.push('plan = ?'); args.push(plan); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) n FROM users ${w}`).get(...args).n;
      const items = db.prepare(`SELECT * FROM users ${w} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(limit, 200), offset).map(row);
      return { total, items };
    },
    user(id) {
      const u = must(id);
      return { user: row(u), credits: credits.history(id, { limit: 30 }), payments: payments.list(id, 30), audit: audit.list({ userId: id, limit: 30 }) };
    },
    setRole(actor, id, role, ip) {
      if (!ROLES.includes(role)) throw new HttpError(400, 'bad_role');
      const u = must(id);
      if (u.id === actor.id && role !== 'admin') throw new HttpError(400, 'cannot_demote_self');
      if (u.role === 'admin' && role !== 'admin' && db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'admin'").get().n <= 1) throw new HttpError(400, 'last_admin');
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
      audit.log(actor.id, 'admin.role', id, { from: u.role, to: role }, ip);
      return row(userById.get(id));
    },
    setPlan(actor, id, plan, days, ip) {
      if (!PLANS.includes(plan)) throw new HttpError(400, 'bad_plan');
      const u = must(id);
      const until = plan === 'start' ? null : iso(now() + Math.max(1, Math.min(Number(days) || 30, 366)) * 864e5);
      db.prepare('UPDATE users SET plan = ?, plan_until = ? WHERE id = ?').run(plan, until, id);
      audit.log(actor.id, 'admin.plan', id, { from: u.plan, to: plan, until }, ip);
      return row(userById.get(id));
    },
    grant(actor, id, amount, reason, ip) {
      amount = Number(amount);
      if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) throw new HttpError(400, 'bad_amount');
      reason = String(reason || '').trim().slice(0, 200);
      if (!reason) throw new HttpError(400, 'reason_required');
      must(id);
      return tx(db, () => {
        const r = credits.apply(id, amount, 'admin', reason);
        audit.log(actor.id, 'admin.credits', id, { amount, reason, balance: r.tx.balance_after }, ip);
        return row(userById.get(id));
      });
    },
    setBlocked(actor, id, blocked, ip) {
      const u = must(id);
      if (u.id === actor.id) throw new HttpError(400, 'cannot_block_self');
      db.prepare('UPDATE users SET blocked = ? WHERE id = ?').run(blocked ? 1 : 0, id);
      if (blocked) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      audit.log(actor.id, blocked ? 'admin.block' : 'admin.unblock', id, {}, ip);
      return row(userById.get(id));
    },
    setSetting(actor, key, value, ip) {
      if (!settings.KEYS.includes(key)) throw new HttpError(400, 'unknown_key'); // каталог и себестоимость — только своими методами
      const before = settings.get(key);
      const err = settings.set(key, value);
      if (err) throw new HttpError(400, err);
      audit.log(actor.id, 'admin.settings', null, { key, before, after: settings.get(key) }, ip);
      return settings.get(key);
    },
    exportUsersCsv() {
      const rows = db.prepare('SELECT id, email, name, role, plan, plan_until, balance, email_verified, blocked, created_at FROM users ORDER BY id').all();
      const esc = (x) => { x = String(x == null ? '' : x); return /[",;\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
      const head = ['id', 'email', 'name', 'role', 'plan', 'plan_until', 'balance', 'email_verified', 'blocked', 'created_at'];
      return '﻿' + [head].concat(rows.map(r => head.map(h => r[h]))).map(r => r.map(esc).join(';')).join('\r\n');
    }
  };
};
module.exports.ROLES = ROLES;
module.exports.PLANS = PLANS;
