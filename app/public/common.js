// Общие помощники для экранов сервиса: API, язык, уведомления, форматирование.
(function () {
  var csrf = '';
  var lang = 'ru';
  try { lang = localStorage.getItem('aiyt.lang') || ((navigator.language || '').slice(0, 2) === 'en' ? 'en' : 'ru'); } catch (e) {}

  function api(method, path, body) {
    var opts = { method: method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    if (method !== 'GET' && csrf) opts.headers['X-CSRF'] = csrf;
    return fetch(path, opts).then(function (r) {
      return r.text().then(function (t) {
        var j = {}; try { j = t ? JSON.parse(t) : {}; } catch (e) { j = { error: 'bad_response' }; }
        if (j.csrf) csrf = j.csrf;
        if (!r.ok) { var e = new Error(j.error || ('http_' + r.status)); e.status = r.status; e.data = j; throw e; }
        return j;
      });
    }, function () { var e = new Error('network'); e.status = 0; throw e; });
  }

  var ERR = {
    ru: { email_invalid: 'Проверьте email.', name_required: 'Укажите имя.', password_short: 'Пароль — не короче 8 символов.', password_weak: 'В пароле нужны буква и цифра.', password_is_email: 'Пароль не должен совпадать с email.', password_long: 'Слишком длинный пароль.', consent_required: 'Отметьте оба согласия, чтобы продолжить.', email_taken: 'Этот email уже зарегистрирован. Войдите или восстановите пароль.', bad_credentials: 'Неверный email или пароль.', too_many_attempts: 'Слишком много попыток. Подождите 15 минут.', account_blocked: 'Аккаунт заблокирован. Напишите в поддержку.', token_invalid: 'Ссылка устарела или уже использована. Запросите новую.', bad_code: 'Код не подошёл. Проверьте время на телефоне и введите новый код.', mfa_required: 'Введите код из приложения.', unauthorized: 'Войдите в аккаунт.', forbidden: 'Недостаточно прав.', network: 'Нет связи с сервером. Проверьте интернет.', email_not_verified: 'Сначала подтвердите почту.', method_disabled: 'Этот способ оплаты сейчас выключен.', pack_needs_plan: 'Пакет кредитов доступен на тарифах «Автор» и «Студия».', gateway_error: 'Платёжный сервис не ответил. Деньги не списаны — попробуйте ещё раз.', insufficient_credits: 'Недостаточно кредитов.', reason_required: 'Укажите причину.', bad_amount: 'Проверьте количество.', cannot_demote_self: 'Нельзя понизить собственную роль.', last_admin: 'Нельзя убрать последнего администратора.', cannot_block_self: 'Нельзя заблокировать себя.', not_refundable: 'Этот платёж нельзя вернуть.', registration_closed: 'Регистрация временно закрыта.', google_not_configured: 'Вход через Google ещё не настроен.', state_invalid: 'Вход через Google не удался — попробуйте ещё раз.', google_email_unverified: 'Google не подтвердил эту почту.', csrf: 'Страница устарела — обновите её.', internal: 'Что-то пошло не так. Мы уже разбираемся.', bad_price: 'Проверьте цену.', bad_model_id: 'Проверьте ID модели.', provider_key_missing: 'Ключ провайдера не задан на сервере.', provider_key_invalid: 'Провайдер не принял ключ.', provider_unreachable: 'Провайдер недоступен.', provider_error: 'Провайдер ответил ошибкой.', bad_value: 'Проверьте значение.', too_many_requests: 'Слишком много запросов. Подождите минуту.' },
    en: { email_invalid: 'Check the email.', name_required: 'Enter your name.', password_short: 'Password must be at least 8 characters.', password_weak: 'Password needs a letter and a digit.', password_is_email: 'Password must differ from your email.', password_long: 'Password is too long.', consent_required: 'Tick both consents to continue.', email_taken: 'This email is already registered. Log in or reset your password.', bad_credentials: 'Wrong email or password.', too_many_attempts: 'Too many attempts. Wait 15 minutes.', account_blocked: 'Account blocked. Contact support.', token_invalid: 'The link has expired or was already used. Request a new one.', bad_code: 'Wrong code. Check your phone’s clock and enter a new code.', mfa_required: 'Enter the code from your app.', unauthorized: 'Please log in.', forbidden: 'Not enough rights.', network: 'No connection to the server. Check your internet.', email_not_verified: 'Confirm your email first.', method_disabled: 'This payment method is off right now.', pack_needs_plan: 'Credit packs are available on Creator and Studio.', gateway_error: 'The payment service didn’t respond. You were not charged — try again.', insufficient_credits: 'Not enough credits.', reason_required: 'Enter a reason.', bad_amount: 'Check the amount.', cannot_demote_self: 'You can’t lower your own role.', last_admin: 'You can’t remove the last admin.', cannot_block_self: 'You can’t block yourself.', not_refundable: 'This payment can’t be refunded.', registration_closed: 'Sign-up is temporarily closed.', google_not_configured: 'Google sign-in isn’t set up yet.', state_invalid: 'Google sign-in failed — try again.', google_email_unverified: 'Google hasn’t verified this email.', csrf: 'The page is outdated — reload it.', internal: 'Something went wrong. We’re on it.', bad_price: 'Check the price.', bad_model_id: 'Check the model ID.', provider_key_missing: 'The provider key isn’t set on the server.', provider_key_invalid: 'The provider rejected the key.', provider_unreachable: 'The provider is unreachable.', provider_error: 'The provider returned an error.', bad_value: 'Check the value.', too_many_requests: 'Too many requests. Wait a minute.' }
  };
  function errText(e) { var d = ERR[lang] || ERR.ru; return d[e && e.message] || d.internal; }

  var tt;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg; el.classList.add('on');
    clearTimeout(tt); tt = setTimeout(function () { el.classList.remove('on'); }, 4000);
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rub(kop) { return (kop / 100).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 0 }) + ' ₽'; }
  function num(n) { return Number(n).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU'); }
  function date(s, withTime) {
    if (!s) return '';
    var d = new Date(s.replace(' ', 'T') + 'Z');
    return d.toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', withTime === false ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function setLang(l) { lang = l === 'en' ? 'en' : 'ru'; try { localStorage.setItem('aiyt.lang', lang); } catch (e) {} document.documentElement.lang = lang; }

  window.AIYT = { api: api, errText: errText, toast: toast, esc: esc, rub: rub, num: num, date: date, setLang: setLang, get lang() { return lang; }, setCsrf: function (c) { csrf = c; } };
  document.documentElement.lang = lang;
})();
