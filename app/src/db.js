'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Схема этапа 1. Деньги — в копейках, кредиты — целые числа.
const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL DEFAULT '',
     pass_hash TEXT,
     google_sub TEXT UNIQUE,
     email_verified INTEGER NOT NULL DEFAULT 0,
     role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','moderator','admin')),
     plan TEXT NOT NULL DEFAULT 'start',
     plan_until TEXT,
     lang TEXT NOT NULL DEFAULT 'ru',
     balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
     totp_secret TEXT,
     totp_enabled INTEGER NOT NULL DEFAULT 0,
     autorenew INTEGER NOT NULL DEFAULT 1,
     payment_method_id TEXT,
     consent_terms_at TEXT,
     consent_pd_at TEXT,
     blocked INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE sessions (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     token_hash TEXT NOT NULL UNIQUE,
     csrf TEXT NOT NULL,
     mfa_pending INTEGER NOT NULL DEFAULT 0,
     user_agent TEXT NOT NULL DEFAULT '',
     ip TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     last_seen TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE tokens (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
     token_hash TEXT NOT NULL UNIQUE,
     expires_at TEXT NOT NULL,
     used_at TEXT
   )`,
  `CREATE TABLE credit_tx (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     delta INTEGER NOT NULL,
     balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
     kind TEXT NOT NULL CHECK (kind IN ('grant','purchase','spend','refund','admin','expire')),
     reason TEXT NOT NULL DEFAULT '',
     ref TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE UNIQUE INDEX credit_tx_ref ON credit_tx(kind, ref) WHERE ref IS NOT NULL`,
  `CREATE INDEX credit_tx_user ON credit_tx(user_id, id DESC)`,
  `CREATE TABLE payments (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     provider_id TEXT UNIQUE,
     product TEXT NOT NULL,
     amount_kop INTEGER NOT NULL,
     credits INTEGER NOT NULL,
     method TEXT NOT NULL DEFAULT 'card',
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','waiting_for_capture','succeeded','canceled','refunded')),
     recurring INTEGER NOT NULL DEFAULT 0,
     confirmation_url TEXT,
     cancel_reason TEXT,
     idem_key TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX payments_user ON payments(user_id, id DESC)`,
  `CREATE TABLE audit (
     id INTEGER PRIMARY KEY,
     actor_id INTEGER,
     action TEXT NOT NULL,
     target_user_id INTEGER,
     details TEXT NOT NULL DEFAULT '{}',
     ip TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX audit_time ON audit(id DESC)`,
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE outbox (
     id INTEGER PRIMARY KEY,
     to_email TEXT NOT NULL,
     subject TEXT NOT NULL,
     body TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'queued',
     error TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE notifications (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     text_ru TEXT NOT NULL,
     text_en TEXT NOT NULL,
     read_at TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  // Генерация фото (модуль OpenAI): одна строка — одна картинка; файл лежит в папке images рядом с базой.
  `CREATE TABLE images (
     id INTEGER PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     prompt TEXT NOT NULL,
     model TEXT NOT NULL,
     quality TEXT NOT NULL,
     size TEXT NOT NULL,
     credits INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     error TEXT,
     file TEXT,
     bytes INTEGER,
     spend_ref TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX images_user ON images(user_id, id)`
];

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (n INTEGER PRIMARY KEY)');
  const done = new Set(db.prepare('SELECT n FROM _migrations').all().map(r => r.n));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i)) return;
    db.exec('BEGIN');
    try { db.exec(sql); db.prepare('INSERT INTO _migrations (n) VALUES (?)').run(i); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  return db;
}

// Выполнить функцию в одной транзакции (BEGIN IMMEDIATE — запись блокируется сразу).
// Вложенный вызов работает через SAVEPOINT, поэтому функции можно комбинировать.
function tx(db, fn) {
  db._txDepth = db._txDepth || 0;
  const sp = 'sp' + db._txDepth;
  db.exec(db._txDepth === 0 ? 'BEGIN IMMEDIATE' : 'SAVEPOINT ' + sp);
  db._txDepth++;
  try {
    const r = fn();
    db._txDepth--;
    db.exec(db._txDepth === 0 ? 'COMMIT' : 'RELEASE ' + sp);
    return r;
  } catch (e) {
    db._txDepth--;
    db.exec(db._txDepth === 0 ? 'ROLLBACK' : 'ROLLBACK TO ' + sp + '; RELEASE ' + sp);
    throw e;
  }
}

module.exports = { open, tx };
