'use strict';
// Служебные команды на сервере:
//   npm run admin -- make-admin you@example.com   — выдать роль администратора
//   npm run admin -- stats                        — короткая сводка
const config = require('./config');
const db = require('./db').open(config.dbPath);
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'make-admin') {
  const u = db.prepare('SELECT id, role FROM users WHERE email = ?').get(String(arg || '').toLowerCase());
  if (!u) { console.error('Пользователь не найден. Сначала зарегистрируйтесь на сайте.'); process.exit(1); }
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(u.id);
  db.prepare('INSERT INTO audit (actor_id, action, target_user_id, details) VALUES (NULL, ?, ?, ?)').run('cli.make_admin', u.id, JSON.stringify({ from: u.role }));
  console.log('Готово: ' + arg + ' теперь администратор.');
} else if (cmd === 'stats') {
  const one = (s) => db.prepare(s).get();
  console.log({ users: one('SELECT COUNT(*) n FROM users').n, paid: one("SELECT COUNT(*) n FROM users WHERE plan != 'start'").n, payments: one("SELECT COUNT(*) n FROM payments WHERE status = 'succeeded'").n });
} else {
  console.log('Команды: make-admin <email>, stats');
}
