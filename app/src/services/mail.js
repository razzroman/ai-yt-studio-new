'use strict';
// Письма сначала кладутся в outbox, затем отправляются. Провайдер log — письмо пишется в журнал сервера
// (для разработки и тестового стенда), unisender — Unisender Go (российский сервис, HTTP API).
module.exports = function makeMail(db, config, fetchImpl, logger = console) {
  const ins = db.prepare('INSERT INTO outbox (to_email, subject, body) VALUES (?, ?, ?)');
  const mark = db.prepare('UPDATE outbox SET status = ?, error = ? WHERE id = ?');

  const T = {
    verify: {
      ru: (link) => ['Подтвердите почту — AI YT Studio', `Здравствуйте!\n\nЧтобы закончить регистрацию и получить 60 кредитов, откройте ссылку:\n${link}\n\nСсылка действует 24 часа. Если вы не регистрировались, просто удалите это письмо.\n\nAI YT Studio`],
      en: (link) => ['Confirm your email — AI YT Studio', `Hello!\n\nTo finish signing up and get 60 credits, open this link:\n${link}\n\nThe link works for 24 hours. If you didn’t sign up, just delete this email.\n\nAI YT Studio`]
    },
    reset: {
      ru: (link) => ['Восстановление пароля — AI YT Studio', `Здравствуйте!\n\nЧтобы задать новый пароль, откройте ссылку:\n${link}\n\nСсылка действует 1 час. Если вы не запрашивали сброс, ничего не делайте — пароль останется прежним.\n\nAI YT Studio`],
      en: (link) => ['Reset your password — AI YT Studio', `Hello!\n\nTo set a new password, open this link:\n${link}\n\nThe link works for 1 hour. If you didn’t ask for a reset, do nothing — your password stays the same.\n\nAI YT Studio`]
    },
    paid: {
      ru: (what) => ['Оплата прошла — AI YT Studio', `Здравствуйте!\n\nОплата прошла: ${what}. Кредиты уже на балансе.\nЧек самозанятого придёт отдельным письмом из «Мой налог».\n\nAI YT Studio`],
      en: (what) => ['Payment received — AI YT Studio', `Hello!\n\nPayment received: ${what}. Credits are already on your balance.\nThe self-employed receipt will arrive in a separate email from “Moy Nalog”.\n\nAI YT Studio`]
    }
  };

  async function deliver(id, to, subject, body) {
    if (config.mail.provider === 'log') {
      logger.log(`[mail] to=${to} subject="${subject}"\n${body}`);
      mark.run('sent', null, id); return;
    }
    if (config.mail.provider === 'unisender') {
      const fromMatch = config.mail.from.match(/^(.*)<(.+)>$/);
      const r = await fetchImpl(config.mail.unisenderUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': config.mail.unisenderKey },
        body: JSON.stringify({ message: { recipients: [{ email: to }], subject, body: { plaintext: body }, from_email: fromMatch ? fromMatch[2].trim() : config.mail.from, from_name: fromMatch ? fromMatch[1].trim() : 'AI YT Studio' } })
      });
      if (!r.ok) throw new Error('unisender ' + r.status + ' ' + (await r.text()).slice(0, 200));
      mark.run('sent', null, id); return;
    }
    throw new Error('unknown mail provider');
  }

  return {
    send(to, kind, lang, arg) {
      const tpl = (T[kind] || {})[lang === 'en' ? 'en' : 'ru'];
      const [subject, body] = tpl(arg);
      const id = Number(ins.run(to, subject, body).lastInsertRowid);
      // Отправка не блокирует ответ пользователю; ошибка сохраняется в outbox.
      return deliver(id, to, subject, body).catch(e => { mark.run('failed', String(e.message).slice(0, 500), id); logger.error('[mail] failed', e.message); });
    },
    last(to) { return db.prepare('SELECT * FROM outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1').get(to); }
  };
};
