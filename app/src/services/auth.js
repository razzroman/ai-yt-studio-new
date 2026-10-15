'use strict';
const C = require('../crypto');
const { HttpError } = require('../http');
const { tx } = require('../db');

const SESSION_DAYS = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function passwordProblem(pw, email) {
  pw = String(pw || '');
  if (pw.length < 8) return 'password_short';
  if (pw.length > 200) return 'password_long';
  if (!/[A-Za-zА-Яа-яЁё]/.test(pw) || !/\d/.test(pw)) return 'password_weak';
  if (email && pw.toLowerCase() === String(email).toLowerCase()) return 'password_is_email';
  return null;
}

// Простая защита от перебора: не больше N попыток за окно на ключ (ip+email).
function makeLimiter(max, windowMs, now) {
  const hits = new Map();
  return {
    hit(key) {
      const t = now(); const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
      arr.push(t); hits.set(key, arr);
      if (hits.size > 10000) hits.clear();
      return arr.length <= max;
    },
    reset(key) { hits.delete(key); }
  };
}

module.exports = function makeAuth({ db, config, mail, credits, audit, fetchImpl, now = () => Date.now() }) {
  const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const loginLimiter = makeLimiter(10, 15 * 60 * 1000, now);
  const mailLimiter = makeLimiter(5, 60 * 60 * 1000, now);

  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, email: u.email, name: u.name, role: u.role, plan: u.plan, planUntil: u.plan_until, lang: u.lang, balance: u.balance, emailVerified: !!u.email_verified, totpEnabled: !!u.totp_enabled, hasPassword: !!u.pass_hash, google: !!u.google_sub, autorenew: !!u.autorenew, hasSavedCard: !!u.payment_method_id, createdAt: u.created_at };
  }

  function createSession(userId, req, mfaPending = false) {
    const token = C.randomToken();
    const csrf = C.randomToken(18);
    db.prepare('INSERT INTO sessions (user_id, token_hash, csrf, mfa_pending, user_agent, ip, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(userId, C.sha256(token), csrf, mfaPending ? 1 : 0, String(req.headers['user-agent'] || '').slice(0, 300), req.ip || '', iso(now() + SESSION_DAYS * 864e5));
    return { token, csrf, maxAge: SESSION_DAYS * 86400 };
  }

  function sessionFromToken(token) {
    if (!token) return null;
    const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(C.sha256(token));
    if (!s || s.expires_at < iso(now())) return null;
    const u = userById.get(s.user_id);
    if (!u || u.blocked) return null;
    // Скользящий срок: активный сеанс продлевается, неактивный истекает через 30 дней.
    const exp = s.expires_at < iso(now() + (SESSION_DAYS - 1) * 864e5) ? iso(now() + SESSION_DAYS * 864e5) : s.expires_at;
    db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?').run(iso(now()), exp, s.id);
    return { session: s, user: u };
  }

  function issueToken(userId, kind, hours) {
    const token = C.randomToken();
    db.prepare('INSERT INTO tokens (user_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?)').run(userId, kind, C.sha256(token), iso(now() + hours * 3600e3));
    return token;
  }
  function useToken(token, kind) {
    const t = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?').get(C.sha256(String(token || '')), kind);
    if (!t || t.used_at || t.expires_at < iso(now())) throw new HttpError(400, 'token_invalid');
    db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(iso(now()), t.id);
    return t;
  }

  function sendVerify(u) {
    const token = issueToken(u.id, 'verify', 24);
    return mail.send(u.email, 'verify', u.lang, `${config.baseUrl}/app/verify?token=${token}`);
  }

  function markVerified(u, ip) {
    return tx(db, () => {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(u.id);
      // 60 кредитов «Старта» — один раз на пользователя (ref защищает от повторного начисления).
      const r = credits.apply(u.id, config.startCredits, 'grant', 'start_plan', 'start:' + u.id);
      if (!r.duplicate) db.prepare('INSERT INTO notifications (user_id, text_ru, text_en) VALUES (?, ?, ?)').run(u.id, `Почта подтверждена. Начислено ${config.startCredits} кредитов.`, `Email confirmed. ${config.startCredits} credits added.`);
      if (config.bootstrapAdmin && u.email === config.bootstrapAdmin && u.role !== 'admin') {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
        audit.log(u.id, 'role.bootstrap_admin', u.id, {}, ip);
      }
      audit.log(u.id, 'auth.email_verified', u.id, {}, ip);
    });
  }

  return {
    publicUser, sessionFromToken, passwordProblem,

    async register(body, req) {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.name || '').trim().slice(0, 80);
      const lang = body.lang === 'en' ? 'en' : 'ru';
      if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'email_invalid');
      if (!name) throw new HttpError(400, 'name_required');
      const pp = passwordProblem(body.password, email); if (pp) throw new HttpError(400, pp);
      if (!body.consentTerms || !body.consentPd) throw new HttpError(400, 'consent_required');
      if (!loginLimiter.hit('reg:' + req.ip)) throw new HttpError(429, 'too_many_attempts');
      if (userByEmail.get(email)) throw new HttpError(409, 'email_taken');
      const ts = iso(now());
      const id = Number(db.prepare('INSERT INTO users (email, name, pass_hash, lang, consent_terms_at, consent_pd_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(email, name, C.hashPassword(body.password), lang, ts, ts).lastInsertRowid);
      const u = userById.get(id);
      audit.log(id, 'auth.register', id, { method: 'email' }, req.ip);
      await sendVerify(u);
      return { user: u, session: createSession(id, req) };
    },

    async resendVerify(user) {
      if (user.email_verified) return;
      if (!mailLimiter.hit('verify:' + user.id)) throw new HttpError(429, 'too_many_attempts');
      await sendVerify(user);
    },

    verifyEmail(token, ip) {
      const t = useToken(token, 'verify');
      const u = userById.get(t.user_id);
      if (!u.email_verified) markVerified(u, ip);
      return userById.get(u.id);
    },

    login(body, req) {
      const email = String(body.email || '').trim().toLowerCase();
      const key = req.ip + '|' + email;
      if (!loginLimiter.hit(key)) throw new HttpError(429, 'too_many_attempts');
      const u = userByEmail.get(email);
      if (!u || !C.verifyPassword(body.password, u.pass_hash)) { audit.log(u ? u.id : null, 'auth.login_failed', u ? u.id : null, { email }, req.ip); throw new HttpError(401, 'bad_credentials'); }
      if (u.blocked) throw new HttpError(403, 'account_blocked');
      loginLimiter.reset(key);
      audit.log(u.id, 'auth.login', u.id, { mfa: !!u.totp_enabled }, req.ip);
      return { user: u, session: createSession(u.id, req, !!u.totp_enabled), mfaRequired: !!u.totp_enabled };
    },

    completeMfa(session, code, ip) {
      const u = userById.get(session.user_id);
      if (!session.mfa_pending) return u;
      if (!loginLimiter.hit('mfa:' + session.id)) throw new HttpError(429, 'too_many_attempts');
      if (!C.verifyTotp(u.totp_secret, code, now())) { audit.log(u.id, 'auth.mfa_failed', u.id, {}, ip); throw new HttpError(401, 'bad_code'); }
      db.prepare('UPDATE sessions SET mfa_pending = 0 WHERE id = ?').run(session.id);
      return u;
    },

    logout(session) { db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id); },

    async requestReset(emailRaw, req) {
      const email = String(emailRaw || '').trim().toLowerCase();
      if (!mailLimiter.hit('reset:' + req.ip) || !mailLimiter.hit('reset:' + email)) throw new HttpError(429, 'too_many_attempts');
      const u = userByEmail.get(email);
      // Ответ одинаковый, есть аккаунт или нет, — чтобы нельзя было проверить чужую почту.
      if (!u || u.blocked) return;
      const token = issueToken(u.id, 'reset', 1);
      audit.log(u.id, 'auth.reset_requested', u.id, {}, req.ip);
      await mail.send(u.email, 'reset', u.lang, `${config.baseUrl}/app/reset?token=${token}`);
    },

    resetPassword(token, password, ip) {
      const t = db.prepare('SELECT * FROM tokens WHERE token_hash = ? AND kind = ?').get(C.sha256(String(token || '')), 'reset');
      const u0 = t && userById.get(t.user_id);
      const pp = passwordProblem(password, u0 && u0.email); if (pp) throw new HttpError(400, pp);
      const used = useToken(token, 'reset');
      tx(db, () => {
        db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(C.hashPassword(password), used.user_id);
        // Сброс пароля завершает все сеансы — как обещано на экране.
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(used.user_id);
        // Переход по ссылке из письма подтверждает и почту.
        const u = userById.get(used.user_id);
        if (!u.email_verified) markVerified(u, ip);
      });
      audit.log(used.user_id, 'auth.password_reset', used.user_id, {}, ip);
      return userById.get(used.user_id);
    },

    changePassword(user, oldPw, newPw, keepSessionId, ip) {
      if (user.pass_hash && !C.verifyPassword(oldPw, user.pass_hash)) throw new HttpError(401, 'bad_credentials');
      const pp = passwordProblem(newPw, user.email); if (pp) throw new HttpError(400, pp);
      db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(C.hashPassword(newPw), user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(user.id, keepSessionId);
      audit.log(user.id, 'auth.password_changed', user.id, {}, ip);
    },

    // ---- 2FA
    totpSetup(user) {
      if (user.totp_enabled) throw new HttpError(409, 'totp_already_enabled');
      const secret = C.newTotpSecret();
      db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, user.id);
      return { secret, uri: `otpauth://totp/AI%20YT%20Studio:${encodeURIComponent(user.email)}?secret=${secret}&issuer=AI%20YT%20Studio` };
    },
    totpEnable(user, code, ip) {
      const u = userById.get(user.id);
      if (!u.totp_secret || !C.verifyTotp(u.totp_secret, code, now())) throw new HttpError(400, 'bad_code');
      db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(u.id);
      audit.log(u.id, 'auth.totp_enabled', u.id, {}, ip);
    },
    totpDisable(user, code, ip) {
      const u = userById.get(user.id);
      if (!u.totp_enabled || !C.verifyTotp(u.totp_secret, code, now())) throw new HttpError(400, 'bad_code');
      db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?').run(u.id);
      audit.log(u.id, 'auth.totp_disabled', u.id, {}, ip);
    },

    // ---- Сеансы
    sessions(user, currentId) {
      return db.prepare('SELECT id, user_agent, ip, created_at, last_seen FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC').all(user.id, iso(now()))
        .map(s => Object.assign({}, s, { current: s.id === currentId }));
    },
    revokeSession(user, id, ip) {
      const r = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, user.id);
      if (r.changes) audit.log(user.id, 'auth.session_revoked', user.id, { session: id }, ip);
      return r.changes > 0;
    },

    // ---- Google OAuth (код авторизации; данные берём из userinfo по access token)
    googleStartUrl(stateObj) {
      if (!config.google.clientId) throw new HttpError(503, 'google_not_configured');
      const payload = Buffer.from(JSON.stringify(Object.assign({ n: C.randomToken(9), t: now() }, stateObj))).toString('base64url');
      const state = payload + '.' + C.hmac(config.secret, payload);
      const q = new URLSearchParams({ client_id: config.google.clientId, redirect_uri: config.baseUrl + '/api/auth/google/callback', response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
      return { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, nonce: JSON.parse(Buffer.from(payload, 'base64url')).n };
    },
    async googleCallback(query, nonceCookie, req) {
      const [payload, sig] = String(query.state || '').split('.');
      if (!payload || !C.safeEqual(sig || '', C.hmac(config.secret, payload))) throw new HttpError(400, 'state_invalid');
      const st = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (st.n !== nonceCookie || now() - st.t > 10 * 60e3) throw new HttpError(400, 'state_invalid');
      if (!query.code) throw new HttpError(400, 'google_denied');
      const tr = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: query.code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: config.baseUrl + '/api/auth/google/callback', grant_type: 'authorization_code' }).toString()
      });
      if (!tr.ok) throw new HttpError(502, 'google_token_failed');
      const tok = await tr.json();
      const ir = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } });
      if (!ir.ok) throw new HttpError(502, 'google_userinfo_failed');
      const info = await ir.json();
      if (!info.sub || !info.email || info.email_verified !== true) throw new HttpError(400, 'google_email_unverified');
      const email = String(info.email).toLowerCase();
      let u = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(info.sub) || userByEmail.get(email);
      let created = false;
      if (u && u.blocked) throw new HttpError(403, 'account_blocked');
      if (!u) {
        // Новый аккаунт через Google — только если на лендинге отмечены согласия.
        if (!st.consent) throw new HttpError(400, 'consent_required');
        const ts = iso(now());
        const id = Number(db.prepare('INSERT INTO users (email, name, google_sub, lang, consent_terms_at, consent_pd_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(email, String(info.name || email.split('@')[0]).slice(0, 80), info.sub, st.lang === 'en' ? 'en' : 'ru', ts, ts).lastInsertRowid);
        u = userById.get(id); created = true;
        audit.log(id, 'auth.register', id, { method: 'google' }, req.ip);
      } else if (!u.google_sub) {
        db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(info.sub, u.id);
        audit.log(u.id, 'auth.google_linked', u.id, {}, req.ip);
      }
      // Google уже подтвердил почту.
      if (!u.email_verified) markVerified(u, req.ip);
      u = userById.get(u.id);
      audit.log(u.id, 'auth.login', u.id, { method: 'google', mfa: !!u.totp_enabled }, req.ip);
      return { user: u, created, session: createSession(u.id, req, !!u.totp_enabled), mfaRequired: !!u.totp_enabled };
    }
  };
};
