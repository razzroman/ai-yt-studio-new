'use strict';
module.exports = function makeAudit(db) {
  const ins = db.prepare('INSERT INTO audit (actor_id, action, target_user_id, details, ip) VALUES (?, ?, ?, ?, ?)');
  return {
    log(actorId, action, targetUserId, details = {}, ip = '') {
      ins.run(actorId ?? null, action, targetUserId ?? null, JSON.stringify(details), ip || '');
    },
    list({ q = '', action = '', userId = null, limit = 50, before = null } = {}) {
      const where = [], args = [];
      if (action) { where.push('a.action = ?'); args.push(action); }
      if (userId) { where.push('(a.target_user_id = ? OR a.actor_id = ?)'); args.push(userId, userId); }
      if (q) { where.push('(t.email LIKE ? OR ac.email LIKE ? OR a.details LIKE ?)'); args.push('%' + q + '%', '%' + q + '%', '%' + q + '%'); }
      if (before) { where.push('a.id < ?'); args.push(before); }
      const sql = `SELECT a.id, a.action, a.details, a.ip, a.created_at, a.actor_id, ac.email AS actor_email, a.target_user_id, t.email AS target_email
                   FROM audit a LEFT JOIN users ac ON ac.id = a.actor_id LEFT JOIN users t ON t.id = a.target_user_id
                   ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`;
      return db.prepare(sql).all(...args, Math.min(limit, 500)).map(r => Object.assign({}, r, { details: JSON.parse(r.details) }));
    }
  };
};
