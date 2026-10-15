'use strict';
const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, len: 64 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(pw), salt, SCRYPT.len, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), h.toString('base64')].join('$');
}

function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(want, got);
}

const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (secret, s) => crypto.createHmac('sha256', secret).update(String(s)).digest('base64url');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- TOTP (RFC 6238): 6 цифр, шаг 30 с, SHA-1 — совместимо с Google Authenticator, Яндекс Ключом и др.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, t = Date.now(), step = 30) {
  const counter = Math.floor(t / 1000 / step);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1000000).toString();
  return code.padStart(6, '0');
}
function verifyTotp(secret, code, t = Date.now()) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some(w => safeEqual(totp(secret, t + w * 30000), code));
}
const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

module.exports = { hashPassword, verifyPassword, randomToken, sha256, hmac, safeEqual, totp, verifyTotp, newTotpSecret, base32Encode, base32Decode, uuid: () => crypto.randomUUID() };
