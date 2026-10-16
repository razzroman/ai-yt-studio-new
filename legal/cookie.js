// Уведомление о cookie. Сервис использует только необходимые cookie (вход и язык), поэтому достаточно уведомления с кнопкой «Понятно».
(function () {
  var KEY = 'aiyt.cookie';
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }
  var lang = 'ru';
  try { lang = localStorage.getItem('aiyt.lang') || (document.documentElement.lang === 'en' ? 'en' : 'ru'); } catch (e) {}
  var T = lang === 'en'
    ? { t: 'We use only essential cookies — to keep you signed in and remember your language. No ads or tracking.', l: 'Details', b: 'Got it' }
    : { t: 'Мы используем только необходимые cookie — чтобы вы оставались в аккаунте и сайт помнил язык. Без рекламы и слежки.', l: 'Подробнее', b: 'Понятно' };
  function show() {
    if (document.getElementById('aiyt-cookie')) return;
    var d = document.createElement('div');
    d.id = 'aiyt-cookie'; d.setAttribute('role', 'region'); d.setAttribute('aria-label', 'Cookie');
    d.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;max-width:640px;margin:0 auto;background:#16161A;color:#F4F3EF;border-radius:12px;padding:14px 16px;display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;font:14px/1.5 "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25)';
    var p = document.createElement('span'); p.style.cssText = 'flex:1 1 260px'; p.textContent = T.t + ' ';
    var a = document.createElement('a'); a.href = '/legal/privacy.html#cookie'; a.textContent = T.l; a.style.cssText = 'color:#F0A58C'; p.appendChild(a);
    var b = document.createElement('button'); b.type = 'button'; b.textContent = T.b;
    b.style.cssText = 'min-height:40px;padding:0 18px;border:0;border-radius:8px;background:#C93C14;color:#fff;font:600 14px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer';
    b.onclick = function () { try { localStorage.setItem(KEY, '1'); } catch (e) {} d.remove(); };
    d.appendChild(p); d.appendChild(b); document.body.appendChild(d);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show); else show();
})();
