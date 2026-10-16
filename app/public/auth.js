(function () {
  var A = window.AIYT;
  var T = {
    ru: { login: 'Вход', register: 'Регистрация', email: 'Email', pass: 'Пароль', name: 'Имя', passHint: 'Минимум 8 символов, буква и цифра', terms1: 'Я принимаю ', terms2: 'Пользовательское соглашение', terms3: ' и ', terms4: 'Политику конфиденциальности', pd1: 'Даю ', pd2: 'согласие на обработку персональных данных', create: 'Создать аккаунт', enter: 'Войти', google: 'Продолжить с Google', or: 'или', forgot: 'Забыли пароль?', haveAcc: 'Уже есть аккаунт?', noAcc: 'Нет аккаунта?', regH: 'Создайте аккаунт', regP: 'После подтверждения почты — 60 кредитов на первый ролик.', loginH: 'С возвращением', forgotH: 'Восстановление пароля', forgotP: 'Укажите email, с которым регистрировались. Пришлём ссылку для нового пароля — она действует 1 час.', send: 'Прислать ссылку', back: 'Вернуться ко входу', sentH: 'Проверьте почту', sentP: 'Если аккаунт с адресом {e} существует, мы отправили на него ссылку. Письма нет? Проверьте «Спам».', resetH: 'Новый пароль', repeat: 'Повторите пароль', mismatch: 'Пароли не совпадают', save: 'Сохранить пароль', doneH: 'Пароль изменён', doneP: 'Мы завершили все сеансы входа. Войдите с новым паролем.', verifyH: 'Подтверждаем почту…', verifiedH: 'Почта подтверждена', verifiedP: 'На баланс начислено 60 кредитов. Можно начинать.', toApp: 'Перейти в кабинет', mfaH: 'Код подтверждения', mfaP: 'Откройте приложение-аутентификатор и введите 6 цифр.', code: 'Код', confirm: 'Подтвердить', checkH: 'Проверьте почту', checkP: 'Мы отправили письмо на {e}. Перейдите по ссылке, чтобы подтвердить почту и получить 60 кредитов.', toCabinet: 'Пока перейти в кабинет', googleNeedConsent: 'Отметьте оба согласия — без них аккаунт через Google не создаётся.', lang: 'EN', langL: 'Switch to English' },
    en: { login: 'Log in', register: 'Sign up', email: 'Email', pass: 'Password', name: 'Name', passHint: 'At least 8 characters, a letter and a digit', terms1: 'I accept the ', terms2: 'Terms of Service', terms3: ' and the ', terms4: 'Privacy Policy', pd1: 'I give ', pd2: 'consent to personal data processing', create: 'Create account', enter: 'Log in', google: 'Continue with Google', or: 'or', forgot: 'Forgot password?', haveAcc: 'Already have an account?', noAcc: 'No account?', regH: 'Create your account', regP: 'Confirm your email to get 60 credits for your first video.', loginH: 'Welcome back', forgotH: 'Reset your password', forgotP: 'Enter the email you signed up with. We’ll send a link to set a new password — it works for 1 hour.', send: 'Send link', back: 'Back to log in', sentH: 'Check your email', sentP: 'If an account with {e} exists, we’ve sent it a link. No email? Check spam.', resetH: 'New password', repeat: 'Repeat password', mismatch: 'Passwords don’t match', save: 'Save password', doneH: 'Password changed', doneP: 'We signed out all sessions. Log in with your new password.', verifyH: 'Confirming your email…', verifiedH: 'Email confirmed', verifiedP: '60 credits were added to your balance. You can start.', toApp: 'Go to dashboard', mfaH: 'Verification code', mfaP: 'Open your authenticator app and enter the 6 digits.', code: 'Code', confirm: 'Confirm', checkH: 'Check your email', checkP: 'We sent an email to {e}. Open the link to confirm your email and get 60 credits.', toCabinet: 'Go to dashboard for now', googleNeedConsent: 'Tick both consents — a Google account isn’t created without them.', lang: 'RU', langL: 'Переключить на русский' }
  };
  var box = document.getElementById('box');
  var q = new URLSearchParams(location.search);
  var mode = location.pathname.replace(/^\/app\//, '').replace(/\/$/, '') || 'login';
  if (location.hash === '#2fa') mode = 'mfa';
  var cfg = { google: false };
  var t = function () { return T[A.lang] || T.ru; };
  var E = A.esc;

  function err(id, msg) { var el = document.getElementById(id); if (el) { el.textContent = msg || ''; el.hidden = !msg; } }
  function busy(btn, on) { btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>'; } else if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }
  function tabs(active) { return '<nav class="tabs" aria-label="' + t().login + ' / ' + t().register + '"><a href="/app/register"' + (active === 'register' ? ' aria-current="page"' : '') + '>' + t().register + '</a><a href="/app/login"' + (active === 'login' ? ' aria-current="page"' : '') + '>' + t().login + '</a></nav>'; }
  function googleBtn() { return cfg.google ? '<button type="button" class="btn s w" id="gBtn"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>' + t().google + '</button><div class="or">' + t().or + '</div>' : ''; }
  function errBox(id) { return '<div class="alert err" id="' + id + '" role="alert" hidden></div>'; }

  var views = {
    register: function () {
      box.innerHTML = tabs('register') + '<h1>' + t().regH + '</h1><p class="muted">' + t().regP + '</p>' + googleBtn() +
        '<form id="f" class="grid" novalidate>' +
        '<div class="fld"><label for="name">' + t().name + '</label><input class="in" id="name" autocomplete="name" required></div>' +
        '<div class="fld"><label for="email">' + t().email + '</label><input class="in" id="email" type="email" autocomplete="email" placeholder="you@example.com" required></div>' +
        '<div class="fld"><label for="pass">' + t().pass + '</label><input class="in" id="pass" type="password" autocomplete="new-password" aria-describedby="ph" required><span class="hint" id="ph">' + t().passHint + '</span></div>' +
        '<label class="chk"><input type="checkbox" id="c1"><span>' + t().terms1 + '<a href="/Legal.dc.html" target="_blank" rel="noopener">' + t().terms2 + '</a>' + t().terms3 + '<a href="/Legal.dc.html" target="_blank" rel="noopener">' + t().terms4 + '</a></span></label>' +
        '<label class="chk"><input type="checkbox" id="c2"><span>' + t().pd1 + '<a href="/Legal.dc.html" target="_blank" rel="noopener">' + t().pd2 + '</a></span></label>' +
        errBox('e') + '<button class="btn p w" id="sb">' + t().create + '</button></form><p class="muted" style="text-align:center;font-size:14px">' + t().haveAcc + ' <a href="/app/login">' + t().login + '</a></p>';
      var g = document.getElementById('gBtn');
      if (g) g.onclick = function () {
        if (!document.getElementById('c1').checked || !document.getElementById('c2').checked) return err('e', t().googleNeedConsent);
        location.href = '/api/auth/google/start?consent=1&lang=' + A.lang;
      };
      document.getElementById('f').onsubmit = function (ev) {
        ev.preventDefault(); err('e');
        var b = document.getElementById('sb'), email = document.getElementById('email').value.trim();
        busy(b, true);
        A.api('POST', '/api/auth/register', { name: document.getElementById('name').value, email: email, password: document.getElementById('pass').value, consentTerms: document.getElementById('c1').checked, consentPd: document.getElementById('c2').checked, lang: A.lang })
          .then(function () { views.check(email); }, function (e) { busy(b, false); err('e', A.errText(e)); });
      };
    },
    check: function (email) {
      box.innerHTML = '<div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16161A" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div><h1>' + t().checkH + '</h1><p class="muted">' + E(t().checkP.replace('{e}', email)) + '</p><a class="btn d w" href="/app/">' + t().toCabinet + '</a>';
    },
    login: function () {
      box.innerHTML = tabs('login') + '<h1>' + t().loginH + '</h1>' + googleBtn() +
        '<form id="f" class="grid" novalidate>' +
        '<div class="fld"><label for="email">' + t().email + '</label><input class="in" id="email" type="email" autocomplete="email" required></div>' +
        '<div class="fld"><label for="pass">' + t().pass + '</label><input class="in" id="pass" type="password" autocomplete="current-password" required></div>' +
        errBox('e') + '<button class="btn p w" id="sb">' + t().enter + '</button></form>' +
        '<div class="row" style="justify-content:space-between"><a href="/app/forgot" style="font-size:14px">' + t().forgot + '</a><span class="muted" style="font-size:14px">' + t().noAcc + ' <a href="/app/register">' + t().register + '</a></span></div>';
      var g = document.getElementById('gBtn');
      if (g) g.onclick = function () { location.href = '/api/auth/google/start?consent=0&lang=' + A.lang; };
      if (q.get('error')) err('e', A.errText({ message: q.get('error') }));
      document.getElementById('f').onsubmit = function (ev) {
        ev.preventDefault(); err('e');
        var b = document.getElementById('sb'); busy(b, true);
        A.api('POST', '/api/auth/login', { email: document.getElementById('email').value, password: document.getElementById('pass').value })
          .then(function (r) { if (r.mfaRequired) { history.replaceState(null, '', '/app/login#2fa'); views.mfa(); } else location.href = q.get('next') && q.get('next').charAt(0) === '/' ? q.get('next') : '/app/'; },
            function (e) { busy(b, false); err('e', A.errText(e)); });
      };
    },
    mfa: function () {
      box.innerHTML = '<h1>' + t().mfaH + '</h1><p class="muted">' + t().mfaP + '</p><form id="f" class="grid" novalidate><div class="fld"><label for="code">' + t().code + '</label><input class="in mono" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" style="font-size:22px;letter-spacing:.3em"></div>' + errBox('e') + '<button class="btn p w" id="sb">' + t().confirm + '</button></form>';
      document.getElementById('code').focus();
      document.getElementById('f').onsubmit = function (ev) {
        ev.preventDefault(); err('e'); var b = document.getElementById('sb'); busy(b, true);
        A.api('GET', '/api/me').then(function () { return A.api('POST', '/api/auth/2fa', { code: document.getElementById('code').value }); })
          .then(function () { location.href = '/app/'; }, function (e) { busy(b, false); err('e', A.errText(e)); });
      };
    },
    forgot: function () {
      box.innerHTML = '<h1>' + t().forgotH + '</h1><p class="muted">' + t().forgotP + '</p><form id="f" class="grid" novalidate><div class="fld"><label for="email">' + t().email + '</label><input class="in" id="email" type="email" autocomplete="email"></div>' + errBox('e') + '<button class="btn p w" id="sb">' + t().send + '</button></form><a href="/app/login" style="text-align:center;font-size:14px">' + t().back + '</a>';
      document.getElementById('f').onsubmit = function (ev) {
        ev.preventDefault(); err('e'); var b = document.getElementById('sb'), email = document.getElementById('email').value.trim(); busy(b, true);
        A.api('POST', '/api/auth/forgot', { email: email }).then(function () {
          box.innerHTML = '<div class="icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16161A" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></div><h1>' + t().sentH + '</h1><p class="muted">' + E(t().sentP.replace('{e}', email)) + '</p><a class="btn s w" href="/app/login">' + t().back + '</a>';
        }, function (e) { busy(b, false); err('e', A.errText(e)); });
      };
    },
    reset: function () {
      box.innerHTML = '<h1>' + t().resetH + '</h1><form id="f" class="grid" novalidate><div class="fld"><label for="p1">' + t().pass + '</label><input class="in" id="p1" type="password" autocomplete="new-password" aria-describedby="ph"><span class="hint" id="ph">' + t().passHint + '</span></div><div class="fld"><label for="p2">' + t().repeat + '</label><input class="in" id="p2" type="password" autocomplete="new-password"></div>' + errBox('e') + '<button class="btn p w" id="sb">' + t().save + '</button></form>';
      document.getElementById('f').onsubmit = function (ev) {
        ev.preventDefault(); err('e');
        var p1 = document.getElementById('p1').value, p2 = document.getElementById('p2').value;
        if (p1 !== p2) return err('e', t().mismatch);
        var b = document.getElementById('sb'); busy(b, true);
        A.api('POST', '/api/auth/reset', { token: q.get('token'), password: p1 }).then(function () {
          box.innerHTML = '<div class="icon" style="background:var(--ok-bg)"><svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#0B5A45" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg></div><h1>' + t().doneH + '</h1><p class="muted">' + t().doneP + '</p><a class="btn p w" href="/app/login">' + t().enter + '</a>';
        }, function (e) { busy(b, false); err('e', A.errText(e)); });
      };
    },
    verify: function () {
      box.innerHTML = '<h1>' + t().verifyH + '</h1><span class="spinner" aria-hidden="true"></span>';
      A.api('POST', '/api/auth/verify', { token: q.get('token') }).then(function () {
        box.innerHTML = '<div class="icon" style="background:var(--ok-bg)"><svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="#0B5A45" stroke-width="2" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg></div><h1>' + t().verifiedH + '</h1><p class="muted">' + t().verifiedP + '</p><a class="btn p w" href="/app/">' + t().toApp + '</a>';
      }, function (e) { box.innerHTML = '<h1>' + t().verifyH.replace('…', '') + '</h1><div class="alert err" role="alert">' + E(A.errText(e)) + '</div><a class="btn s w" href="/app/">' + t().toApp + '</a>'; });
    }
  };

  function render() {
    document.getElementById('langBtn').textContent = t().lang;
    document.getElementById('langBtn').setAttribute('aria-label', t().langL);
    document.title = 'AI YT Studio — ' + (mode === 'register' ? t().register : t().login);
    (views[mode] || views.login)();
  }
  document.getElementById('langBtn').onclick = function () { A.setLang(A.lang === 'ru' ? 'en' : 'ru'); render(); };
  A.api('GET', '/api/public/config').then(function (c) { cfg = c; }, function () {}).then(function () {
    // Уже вошли — сразу в кабинет (кроме ссылок из писем).
    if (mode === 'login' || mode === 'register') {
      A.api('GET', '/api/me').then(function (m) { if (m.mfaPending) { mode = 'mfa'; render(); } else location.replace('/app/'); }, function () { render(); });
    } else render();
  });
})();
