(function () {
  var A = window.AIYT, E = A.esc;
  var me = null, cfg = null;
  var view = document.getElementById('view');
  function t() { return window.AIYT_T[A.lang] || window.AIYT_T.ru; }
  function $(id) { return document.getElementById(id); }
  function isStaff() { return me && (me.role === 'admin' || me.role === 'moderator'); }
  function isAdmin() { return me && me.role === 'admin'; }
  function planName(p) { return t().plans[p] || p; }
  function route() { var h = location.hash.replace(/^#\/?/, ''); var i = h.indexOf('?'); return { path: (i < 0 ? h : h.slice(0, i)) || 'home', q: new URLSearchParams(i < 0 ? '' : h.slice(i + 1)) }; }
  function fail(e) { A.toast(A.errText(e)); if (e && e.status === 401) location.href = '/app/login?next=' + encodeURIComponent('/app/' + location.hash); }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>'; } else if (btn.dataset.l) btn.innerHTML = btn.dataset.l; }

  // ---------- оболочка
  var NAV = [['home', 'home', 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z'], ['history', 'history', 'M12 8v4l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5'], ['billing', 'billing', 'M2 7h20v12H2zM2 11h20'], ['models', 'models', 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'], ['account', 'account', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0']];
  var ADM = [['admin', 'aDash'], ['admin/users', 'aUsers'], ['admin/models', 'aModels'], ['admin/audit', 'aAudit'], ['admin/settings', 'aSettings']];
  function shell() {
    var r = route().path;
    var ico = function (d) { return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>'; };
    var h = NAV.map(function (n) { return '<a href="#/' + (n[0] === 'home' ? '' : n[0]) + '"' + (r === n[0] ? ' aria-current="page"' : '') + '>' + ico(n[2]) + t()[n[1]] + '</a>'; }).join('');
    if (isStaff()) h += '<div class="grp">' + t().adminGrp + '</div>' + ADM.map(function (n) { return '<a href="#/' + n[0] + '"' + (r === n[0] ? ' aria-current="page"' : '') + '>' + t()[n[1]] + '</a>'; }).join('');
    $('nav').innerHTML = h;
    $('aside').setAttribute('aria-label', t().menu);
    $('sideFoot').innerHTML = '<span>' + E(me.email) + '</span><a href="/">' + t().site + '</a><a href="/Main.dc.html">' + t().proto + '</a><button type="button" class="link" id="logoutBtn" style="color:#CFCBC2;text-align:left">' + t().logout + '</button>';
    $('logoutBtn').onclick = function () { A.api('POST', '/api/auth/logout', {}).then(function () { location.href = '/app/login'; }, function () { location.href = '/app/login'; }); };
    $('langBtn').textContent = t().lang; $('langBtn').setAttribute('aria-label', t().langL);
    $('menuL').textContent = t().menu; $('ntL').textContent = t().notif;
    $('balPill').textContent = A.num(me.balance) + ' ' + t().credits;
    var titles = { home: t().home, history: t().history, billing: t().billing, account: t().account, models: t().models, 'admin/models': t().aModels, admin: t().aDash, 'admin/users': t().aUsers, 'admin/audit': t().aAudit, 'admin/settings': t().aSettings };
    $('title').textContent = titles[r] || t().home;
    document.title = 'AI YT Studio — ' + (titles[r] || t().home);
  }
  $('menuBtn').onclick = function () { var o = $('aside').classList.toggle('open'); this.setAttribute('aria-expanded', String(o)); if (o) $('nav').querySelector('a').focus(); };
  $('nav').addEventListener('click', function () { $('aside').classList.remove('open'); $('menuBtn').setAttribute('aria-expanded', 'false'); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('aside').classList.remove('open'); $('ntPanel').hidden = true; $('ntBtn').setAttribute('aria-expanded', 'false'); var d = document.querySelector('.drawer'); if (d) d.remove(); } });
  $('langBtn').onclick = function () { A.setLang(A.lang === 'ru' ? 'en' : 'ru'); A.api('POST', '/api/me', { lang: A.lang }).catch(function () {}); render(); };

  // ---------- уведомления
  function loadNotif() {
    A.api('GET', '/api/notifications').then(function (r) {
      var unread = r.items.filter(function (x) { return !x.read_at; }).length;
      $('ntBadge').hidden = !unread; $('ntBadge').textContent = unread;
      $('ntPanel').innerHTML = '<h3 style="padding:8px 10px">' + t().notif + '</h3>' + (r.items.length ? '<ul>' + r.items.map(function (n) { return '<li' + (n.read_at ? '' : ' style="font-weight:500"') + '>' + E(A.lang === 'en' ? n.text_en : n.text_ru) + '<div class="hint">' + A.date(n.created_at) + '</div></li>'; }).join('') + '</ul>' : '<p class="empty">' + t().noNotif + '</p>');
    }, function () {});
  }
  $('ntBtn').onclick = function () {
    var p = $('ntPanel'); p.hidden = !p.hidden; this.setAttribute('aria-expanded', String(!p.hidden));
    if (!p.hidden && !$('ntBadge').hidden) A.api('POST', '/api/notifications/read', {}).then(function () { $('ntBadge').hidden = true; }, function () {});
  };

  function verifyBanner() {
    if (me.emailVerified) return '';
    return '<div class="alert warn row" style="justify-content:space-between"><span>' + E(t().verifyBanner.replace('{e}', me.email)) + '</span><button type="button" class="btn s sm" id="resendBtn">' + t().resend + '</button></div>';
  }
  function bindBanner() {
    var b = $('resendBtn'); if (!b) return;
    b.onclick = function () { busy(b, true); A.api('POST', '/api/auth/resend-verify', {}).then(function () { busy(b, false); A.toast(t().resent); }, function (e) { busy(b, false); fail(e); }); };
  }

  // ---------- главная
  function vHome() {
    var until = me.planUntil ? ' · ' + t().until + ' ' + A.date(me.planUntil, false) : '';
    view.innerHTML = verifyBanner() +
      '<div><h2>' + E(t().hello.replace('{n}', me.name || '')) + '</h2><p class="muted" style="margin-top:6px;max-width:720px">' + t().homeP + '</p></div>' +
      '<div class="stats"><div class="stat"><span class="muted">' + t().balance + '</span><b>' + A.num(me.balance) + '</b><span class="hint">' + t().credits + '</span></div>' +
      '<div class="stat"><span class="muted">' + t().plan + '</span><b>' + planName(me.plan) + '</b><span class="hint">' + E(until.replace(/^ · /, '')) + '</span></div></div>' +
      '<div class="row"><a class="btn p" href="#/billing">' + t().topUp + '</a><a class="btn s" href="#/history">' + t().toHistory + '</a></div>' +
      '<div class="mods">' + t().mods.map(function (m) { return '<a class="card mod" href="/Main.dc.html"><span class="mono" style="color:var(--accent);font-size:13px">' + m[0] + ' · ' + t().soon + '</span><b>' + m[1] + '</b><span class="hint">' + m[2] + '</span><span style="font-size:14px;text-decoration:underline;margin-top:auto">' + t().openProto + '</span></a>'; }).join('') + '</div>';
    bindBanner();
  }

  // ---------- история
  function vHistory() {
    var q = route().q, kind = q.get('kind') || '';
    var items = [], before = null;
    view.innerHTML = '<div class="row" style="justify-content:space-between"><div class="seg" role="tablist" aria-label="' + t().history + '">' +
      [['', 'hAll'], ['in', 'hIn'], ['out', 'hOut']].map(function (k) { return '<button type="button" role="tab" aria-selected="' + (kind === k[0]) + '" data-k="' + k[0] + '">' + t()[k[1]] + '</button>'; }).join('') +
      '</div><a class="btn s sm" href="/api/credits.csv" download>' + t().csv + '</a></div><div class="tbl"><table><thead><tr><th>' + t().hDate + '</th><th>' + t().hWhat + '</th><th class="num">' + t().hDelta + '</th><th class="num">' + t().hBal + '</th></tr></thead><tbody id="rows"></tbody></table></div><button type="button" class="btn s" id="moreBtn" hidden>' + t().more + '</button>';
    view.querySelectorAll('[data-k]').forEach(function (b) { b.onclick = function () { location.hash = '#/history' + (b.dataset.k ? '?kind=' + b.dataset.k : ''); }; });
    function load() {
      A.api('GET', '/api/credits?kind=' + kind + (before ? '&before=' + before : '')).then(function (r) {
        items = items.concat(r.items);
        $('rows').innerHTML = items.length ? items.map(function (x) {
          var reason = t().reasons[x.reason] || x.reason;
          return '<tr><td style="white-space:nowrap">' + A.date(x.created_at) + '</td><td><b style="font-weight:500">' + (t().kinds[x.kind] || x.kind) + '</b>' + (reason ? '<div class="hint">' + E(reason) + '</div>' : '') + '</td><td class="num ' + (x.delta > 0 ? 'plus' : 'minus') + '">' + (x.delta > 0 ? '+' : '−') + A.num(Math.abs(x.delta)) + '</td><td class="num">' + A.num(x.balance_after) + '</td></tr>';
        }).join('') : '<tr><td colspan="4" class="empty">' + t().empty + '</td></tr>';
        before = r.items.length === 50 ? r.items[r.items.length - 1].id : null;
        $('moreBtn').hidden = !before;
      }, fail);
    }
    $('moreBtn').onclick = load;
    load();
  }

  // ---------- тариф и оплата
  function vBilling() {
    var q = route().q, products = cfg.products, methods = Object.keys(cfg.payMethods).filter(function (k) { return cfg.payMethods[k]; });
    var method = methods[0];
    var until = me.planUntil ? t().until + ' ' + A.date(me.planUntil, false) : '';
    var cards = ['author', 'studio'].map(function (id) {
      var p = products[id], cur = me.plan === p.plan;
      return '<div class="card prod' + (cur ? ' cur' : '') + '"><span class="mono" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">' + (cur ? t().current : t().plan) + '</span><h3>' + planName(p.plan) + '</h3><div><span class="price">' + A.rub(p.priceKop) + '</span> <span class="muted">' + t().month + '</span></div><span>' + A.num(p.credits) + ' ' + t().credits + '</span><button type="button" class="btn ' + (cur ? 's' : 'p') + ' w" data-buy="' + id + '"' + (me.emailVerified ? '' : ' disabled') + '>' + (cur ? t().extend : t().choose) + '</button></div>';
    }).join('');
    var pk = products.pack;
    cards += '<div class="card prod"><span class="mono" style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)">' + t().pack + '</span><h3>+' + A.num(pk.credits) + ' ' + t().credits + '</h3><div><span class="price">' + A.rub(pk.priceKop) + '</span></div><span class="hint">' + t().packP + '</span><button type="button" class="btn s w" data-buy="pack"' + (me.emailVerified && me.plan !== 'start' ? '' : ' disabled') + '>' + t().buy + '</button>' + (me.plan === 'start' ? '<span class="hint">' + A.errText({ message: 'pack_needs_plan' }) + '</span>' : '') + '</div>';
    view.innerHTML = verifyBanner() + '<div id="payStatus"></div>' +
      '<div class="card"><div class="row" style="justify-content:space-between"><div><span class="muted">' + t().curPlan + '</span><h2 style="margin-top:4px">' + planName(me.plan) + '</h2><span class="hint">' + E(until) + '</span></div><div style="text-align:right"><span class="muted">' + t().balance + '</span><h2 style="margin-top:4px">' + A.num(me.balance) + '</h2><span class="hint">' + t().credits + '</span></div></div>' +
      (me.plan !== 'start' ? '<div class="setrow" style="margin-top:12px"><div><b style="font-weight:500">' + t().autorenew + '</b><div class="hint">' + t().autorenewH + (me.hasSavedCard ? ' ' + t().savedCard + '.' : '') + '</div></div><button type="button" class="switch" role="switch" aria-checked="' + me.autorenew + '" aria-label="' + t().autorenew + '" id="arSw"><span></span></button></div>' + (me.hasSavedCard ? '<button type="button" class="link" id="forgetBtn">' + t().forgetCard + '</button>' : '') : '') + '</div>' +
      '<div><h3 style="margin-bottom:8px">' + t().method + '</h3><div class="seg" role="radiogroup" aria-label="' + t().method + '">' + methods.map(function (m, i) { return '<button type="button" role="radio" aria-checked="' + (i === 0) + '" aria-pressed="' + (i === 0) + '" data-m="' + m + '">' + t().methods[m] + '</button>'; }).join('') + '</div></div>' +
      '<div class="prods">' + cards + '</div><p class="hint">' + t().payNote + (cfg.paymentsMode === 'mock' ? ' <b>' + t().mockNote + '</b>' : '') + '</p>' +
      '<div><h3 style="margin-bottom:8px">' + t().payments + '</h3><div class="tbl"><table><tbody id="payRows"><tr><td class="empty"><span class="spinner"></span></td></tr></tbody></table></div></div>';
    bindBanner();
    view.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { method = b.dataset.m; view.querySelectorAll('[data-m]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); x.setAttribute('aria-checked', String(x === b)); }); }; });
    view.querySelectorAll('[data-buy]').forEach(function (b) {
      b.onclick = function () {
        busy(b, true);
        A.api('POST', '/api/payments', { product: b.dataset.buy, method: method }).then(function (r) { A.toast(t().redirecting); location.href = r.confirmationUrl; }, function (e) { busy(b, false); fail(e); });
      };
    });
    var sw = $('arSw'); if (sw) sw.onclick = function () { A.api('POST', '/api/me', { autorenew: !me.autorenew }).then(function (r) { me = r.user; vBilling(); }, fail); };
    var fg = $('forgetBtn'); if (fg) fg.onclick = function () { A.api('POST', '/api/me', { forgetCard: true }).then(function (r) { me = r.user; vBilling(); }, fail); };
    A.api('GET', '/api/payments').then(function (r) {
      $('payRows').innerHTML = r.items.length ? r.items.map(function (p) {
        var cls = p.status === 'succeeded' ? 'ok' : p.status === 'canceled' ? 'err' : p.status === 'refunded' ? 'warn' : '';
        return '<tr><td style="white-space:nowrap">' + A.date(p.created_at) + '</td><td>' + (t().products[p.product] || p.product) + (p.recurring ? ' · ' + t().renewal : '') + '<div class="hint">' + t().methods[p.method] + '</div></td><td class="num">' + A.rub(p.amount_kop) + '</td><td><span class="pill ' + cls + '">' + t().pStatus[p.status] + '</span></td></tr>';
      }).join('') : '<tr><td class="empty">' + t().empty + '</td></tr>';
    }, function () {});
    // Возврат со страницы оплаты: уточняем статус, пока банк не ответит.
    var pid = q.get('payment');
    if (pid) {
      var tries = 0;
      var poll = function () {
        A.api('GET', '/api/payments/' + pid).then(function (p) {
          var box = $('payStatus'); if (!box) return;
          if (p.status === 'succeeded') { box.innerHTML = '<div class="alert ok" role="status">' + t().payOk + '</div>'; refreshMe().then(function () { history.replaceState(null, '', '#/billing'); setTimeout(vBilling, 1500); }); }
          else if (p.status === 'canceled') box.innerHTML = '<div class="alert err" role="alert">' + t().payFail + '</div>';
          else { box.innerHTML = '<div class="alert warn" role="status"><span class="spinner" aria-hidden="true"></span> ' + t().payWait + '</div>'; if (++tries < 40) setTimeout(poll, 3000); }
        }, function () {});
      };
      poll();
    }
  }

  // ---------- аккаунт
  function vAccount() {
    view.innerHTML = verifyBanner() +
      '<section class="card grid"><h3>' + t().profile + '</h3><div class="fld"><label for="nm">' + t().name + '</label><input class="in" id="nm" value="' + E(me.name) + '" autocomplete="name"></div><div class="fld"><label for="em">' + t().email + '</label><input class="in" id="em" value="' + E(me.email) + '" disabled></div><div><button type="button" class="btn d sm" id="saveP">' + t().save + '</button></div></section>' +
      (me.hasPassword ? '<section class="card grid"><h3>' + t().password + '</h3><div class="fld"><label for="op">' + t().oldPass + '</label><input class="in" id="op" type="password" autocomplete="current-password"></div><div class="fld"><label for="np">' + t().newPass + '</label><input class="in" id="np" type="password" autocomplete="new-password" aria-describedby="nph"><span class="hint" id="nph">' + t().passHint + '</span></div><div><button type="button" class="btn d sm" id="saveW">' + t().changePass + '</button></div></section>' : '') +
      '<section class="card grid" id="tfaBox"></section>' +
      '<section class="card grid"><h3>' + t().sessions + '</h3><div id="sess"><span class="spinner"></span></div></section>';
    bindBanner();
    $('saveP').onclick = function () { A.api('POST', '/api/me', { name: $('nm').value }).then(function (r) { me = r.user; A.toast(t().saved); shell(); }, fail); };
    if ($('saveW')) $('saveW').onclick = function () { var b = this; busy(b, true); A.api('POST', '/api/me/password', { oldPassword: $('op').value, newPassword: $('np').value }).then(function () { busy(b, false); $('op').value = $('np').value = ''; A.toast(t().passChanged); loadSess(); }, function (e) { busy(b, false); fail(e); }); };
    function tfa() {
      var bx = $('tfaBox');
      bx.innerHTML = '<h3>' + t().tfa + '</h3><p class="muted">' + (me.totpEnabled ? t().tfaOn : t().tfaOff) + '</p>' + (me.totpEnabled ? '<div class="fld"><label for="tc">' + t().code + '</label><input class="in mono" id="tc" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><div><button type="button" class="btn s sm" id="tOff">' + t().tfaDisable + '</button></div>' : '<div><button type="button" class="btn d sm" id="tOn">' + t().tfaSetup + '</button></div>');
      if ($('tOff')) $('tOff').onclick = function () { A.api('POST', '/api/me/totp/disable', { code: $('tc').value }).then(function () { me.totpEnabled = false; A.toast(t().tfaDisabled); tfa(); }, fail); };
      if ($('tOn')) $('tOn').onclick = function () {
        A.api('POST', '/api/me/totp/setup', {}).then(function (s) {
          bx.innerHTML = '<h3>' + t().tfa + '</h3><p class="muted">' + t().tfaStep + '</p><div class="fld"><span class="hint">' + t().tfaKey + '</span><code class="mono" style="font-size:15px;word-break:break-all;background:var(--bg);padding:10px;border-radius:8px">' + E(s.secret.replace(/(.{4})/g, '$1 ').trim()) + '</code><a href="' + E(s.uri) + '" style="font-size:14px">' + t().tfaOpen + '</a></div><div class="fld"><label for="tc">' + t().code + '</label><input class="in mono" id="tc" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><div><button type="button" class="btn p sm" id="tCf">' + t().confirm + '</button></div>';
          $('tCf').onclick = function () { A.api('POST', '/api/me/totp/enable', { code: $('tc').value }).then(function () { me.totpEnabled = true; A.toast(t().tfaEnabled); tfa(); }, fail); };
        }, fail);
      };
    }
    function loadSess() {
      A.api('GET', '/api/me/sessions').then(function (r) {
        $('sess').innerHTML = r.items.map(function (s) {
          return '<div class="setrow"><div><b style="font-weight:500">' + E(uaName(s.user_agent)) + '</b>' + (s.current ? ' <span class="pill ok">' + t().thisDev + '</span>' : '') + '<div class="hint">' + E(s.ip) + ' · ' + t().lastSeen + ' ' + A.date(s.last_seen) + '</div></div>' + (s.current ? '' : '<button type="button" class="btn s sm" data-s="' + s.id + '">' + t().endSess + '</button>') + '</div>';
        }).join('');
        $('sess').querySelectorAll('[data-s]').forEach(function (b) { b.onclick = function () { A.api('POST', '/api/me/sessions/' + b.dataset.s + '/revoke', {}).then(function () { A.toast(t().sessEnded); loadSess(); }, fail); }; });
      }, fail);
    }
    tfa(); loadSess();
  }
  function uaName(ua) {
    var os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
    var br = /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return br + (os ? ' · ' + os : '');
  }

  // ---------- админка
  function vAdminDash() {
    A.api('GET', '/api/admin/dashboard').then(function (d) {
      var tile = function (l, v, h) { return '<div class="stat"><span class="muted">' + l + '</span><b>' + v + '</b>' + (h ? '<span class="hint">' + h + '</span>' : '') + '</div>'; };
      view.innerHTML = '<div class="stats">' + tile(t().users, A.num(d.users), '+' + d.usersNew7d + ' ' + t().new7) + tile(t().paid, A.num(d.paid)) + tile(t().revenue, A.rub(d.revenue30dKop)) + tile(t().pay24, A.num(d.payments24h)) + tile(t().fail24, A.num(d.failed24h)) + tile(t().outstanding, A.num(d.creditsOutstanding)) + tile(t().mailFail, A.num(d.mailFailed)) + '</div>' +
        '<div class="row"><a class="btn s" href="#/admin/users">' + t().aUsers + '</a><a class="btn s" href="#/admin/audit">' + t().aAudit + '</a><a class="btn s" href="#/admin/settings">' + t().aSettings + '</a></div>';
    }, fail);
  }
  function vAdminUsers() {
    var q = route().q;
    view.innerHTML = '<div class="row"><label class="vh" for="uq">' + t().search + '</label><input class="in" id="uq" placeholder="' + t().search + '" value="' + E(q.get('q') || '') + '" style="flex:1 1 260px"><label class="vh" for="ur">' + t().uRole + '</label><select class="in" id="ur" style="width:auto">' + '<option value="">' + t().allRoles + '</option>' + ['user', 'moderator', 'admin'].map(function (r) { return '<option value="' + r + '"' + (q.get('role') === r ? ' selected' : '') + '>' + t().roles[r] + '</option>'; }).join('') + '</select><label class="vh" for="up">' + t().uPlan + '</label><select class="in" id="up" style="width:auto"><option value="">' + t().allPlans + '</option>' + ['start', 'author', 'studio'].map(function (p) { return '<option value="' + p + '"' + (q.get('plan') === p ? ' selected' : '') + '>' + planName(p) + '</option>'; }).join('') + '</select>' + (isAdmin() ? '<a class="btn s sm" href="/api/admin/users.csv" download>' + t().exportCsv + '</a>' : '') + '</div><div class="hint" id="utotal"></div><div class="tbl"><table><thead><tr><th>' + t().uEmail + '</th><th class="hide-m">' + t().uRole + '</th><th>' + t().uPlan + '</th><th class="num">' + t().uBal + '</th><th class="hide-m">' + t().uCreated + '</th><th><span class="vh">' + t().open + '</span></th></tr></thead><tbody id="urows"></tbody></table></div>';
    var go = function () { var p = new URLSearchParams(); if ($('uq').value) p.set('q', $('uq').value); if ($('ur').value) p.set('role', $('ur').value); if ($('up').value) p.set('plan', $('up').value); location.hash = '#/admin/users' + (p.toString() ? '?' + p : ''); };
    var tm; $('uq').oninput = function () { clearTimeout(tm); tm = setTimeout(go, 400); };
    $('ur').onchange = go; $('up').onchange = go;
    A.api('GET', '/api/admin/users?' + q.toString()).then(function (r) {
      $('utotal').textContent = t().users + ': ' + A.num(r.total);
      $('urows').innerHTML = r.items.length ? r.items.map(function (u) {
        return '<tr><td><b style="font-weight:500">' + E(u.email) + '</b><div class="hint">' + E(u.name) + (u.blocked ? ' · <span class="minus">' + t().blocked + '</span>' : '') + (u.emailVerified ? '' : ' · ' + t().notVerified) + '</div></td><td class="hide-m">' + t().roles[u.role] + '</td><td>' + planName(u.plan) + '</td><td class="num">' + A.num(u.balance) + '</td><td class="hide-m" style="white-space:nowrap">' + A.date(u.createdAt, false) + '</td><td><button type="button" class="btn s sm" data-u="' + u.id + '">' + t().open + '</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">' + t().empty + '</td></tr>';
      $('urows').querySelectorAll('[data-u]').forEach(function (b) { b.onclick = function () { userDrawer(Number(b.dataset.u), b); }; });
    }, fail);
  }
  function userDrawer(id, opener) {
    var d = document.createElement('div'); d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true');
    d.innerHTML = '<div id="dIn"><span class="spinner"></span></div>';
    document.body.appendChild(d);
    var close = function () { d.remove(); if (opener) opener.focus(); vAdminUsers(); };
    d.onclick = function (e) { if (e.target === d) close(); };
    function load() {
      A.api('GET', '/api/admin/users/' + id).then(function (r) {
        var u = r.user, ro = !isAdmin();
        $('dIn').innerHTML = '<div class="row" style="justify-content:space-between"><div><h2 style="word-break:break-all">' + E(u.email) + '</h2><span class="hint">ID ' + u.id + ' · ' + E(u.name) + ' · ' + A.date(u.createdAt, false) + (u.blocked ? ' · <span class="minus">' + t().blocked + '</span>' : '') + '</span></div><button type="button" class="btn s sm" id="dClose">' + t().close + '</button></div>' +
          (ro ? '<div class="alert warn">' + t().readOnly + '</div>' : '') +
          '<div class="stats"><div class="stat"><span class="muted">' + t().uBal + '</span><b>' + A.num(u.balance) + '</b></div><div class="stat"><span class="muted">' + t().uPlan + '</span><b>' + planName(u.plan) + '</b><span class="hint">' + (u.planUntil ? t().until + ' ' + A.date(u.planUntil, false) : '') + '</span></div></div>' +
          (ro ? '' : '<section class="card grid"><div class="row"><div class="fld" style="flex:1 1 160px"><label for="dRole">' + t().setRole + '</label><select class="in" id="dRole">' + ['user', 'moderator', 'admin'].map(function (x) { return '<option value="' + x + '"' + (u.role === x ? ' selected' : '') + '>' + t().roles[x] + '</option>'; }).join('') + '</select></div><button type="button" class="btn d sm" id="dRoleB" style="align-self:flex-end">' + t().apply + '</button></div>' +
            '<div class="row"><div class="fld" style="flex:1 1 140px"><label for="dPlan">' + t().setPlan + '</label><select class="in" id="dPlan">' + ['start', 'author', 'studio'].map(function (x) { return '<option value="' + x + '"' + (u.plan === x ? ' selected' : '') + '>' + planName(x) + '</option>'; }).join('') + '</select></div><div class="fld" style="width:96px"><label for="dDays">' + t().days + '</label><input class="in" id="dDays" type="number" min="1" max="366" value="30"></div><button type="button" class="btn d sm" id="dPlanB" style="align-self:flex-end">' + t().apply + '</button></div></section>' +
            '<section class="card grid"><h3>' + t().grant + '</h3><div class="fld"><label for="dAmt">' + t().amount + '</label><input class="in" id="dAmt" type="number" step="1"></div><div class="fld"><label for="dRsn">' + t().reason + '</label><input class="in" id="dRsn" maxlength="200"></div><div><button type="button" class="btn p sm" id="dGrant">' + t().apply + '</button></div></section>' +
            '<div><button type="button" class="btn s sm" id="dBlock">' + (u.blocked ? t().unblock : t().block) + '</button></div>') +
          '<section class="grid"><h3>' + t().payments + '</h3><div class="tbl"><table><tbody>' + (r.payments.length ? r.payments.map(function (p) { return '<tr><td style="white-space:nowrap">' + A.date(p.created_at) + '</td><td>' + (t().products[p.product] || p.product) + '</td><td class="num">' + A.rub(p.amount_kop) + '</td><td><span class="pill">' + t().pStatus[p.status] + '</span></td><td>' + (!ro && p.status === 'succeeded' ? '<button type="button" class="btn s sm" data-rf="' + p.id + '">' + t().refund + '</button>' : '') + '</td></tr>'; }).join('') : '<tr><td class="empty">' + t().empty + '</td></tr>') + '</tbody></table></div></section>' +
          '<section class="grid"><h3>' + t().history + '</h3><div class="tbl"><table><tbody>' + (r.credits.length ? r.credits.map(function (x) { return '<tr><td style="white-space:nowrap">' + A.date(x.created_at) + '</td><td>' + (t().kinds[x.kind] || x.kind) + '<div class="hint">' + E(t().reasons[x.reason] || x.reason) + '</div></td><td class="num ' + (x.delta > 0 ? 'plus' : 'minus') + '">' + (x.delta > 0 ? '+' : '−') + A.num(Math.abs(x.delta)) + '</td><td class="num">' + A.num(x.balance_after) + '</td></tr>'; }).join('') : '<tr><td class="empty">' + t().empty + '</td></tr>') + '</tbody></table></div></section>' +
          '<section class="grid"><h3>' + t().aAudit + '</h3><div class="tbl"><table><tbody>' + r.audit.map(auditRow).join('') + '</tbody></table></div></section>';
        $('dClose').onclick = close; $('dClose').focus();
        var post = function (path, body, btn) { busy(btn, true); return A.api('POST', '/api/admin/users/' + id + path, body).then(function () { A.toast(t().done); load(); }, function (e) { busy(btn, false); fail(e); }); };
        if (!ro) {
          $('dRoleB').onclick = function () { post('/role', { role: $('dRole').value }, this); };
          $('dPlanB').onclick = function () { post('/plan', { plan: $('dPlan').value, days: Number($('dDays').value) }, this); };
          $('dGrant').onclick = function () { post('/credits', { amount: Number($('dAmt').value), reason: $('dRsn').value }, this); };
          $('dBlock').onclick = function () { post('/block', { blocked: !u.blocked }, this); };
          $('dIn').querySelectorAll('[data-rf]').forEach(function (b) { b.onclick = function () { if (!confirm(t().refundQ)) return; busy(b, true); A.api('POST', '/api/admin/payments/' + b.dataset.rf + '/refund', {}).then(function () { A.toast(t().done); load(); }, function (e) { busy(b, false); fail(e); }); }; });
        }
      }, function (e) { fail(e); d.remove(); });
    }
    load();
  }
  function auditRow(a) {
    var det = Object.keys(a.details || {}).map(function (k) { var v = a.details[k]; return k + ': ' + (typeof v === 'object' ? JSON.stringify(v) : v); }).join(', ');
    return '<tr><td style="white-space:nowrap">' + A.date(a.created_at) + '</td><td class="mono" style="font-size:13px">' + E(a.action) + '</td><td>' + E(a.actor_email || t().system) + (a.target_email && a.target_email !== a.actor_email ? ' → ' + E(a.target_email) : '') + '<div class="hint" style="word-break:break-word">' + E(det) + (a.ip ? ' · ' + E(a.ip) : '') + '</div></td></tr>';
  }
  function vAdminAudit() {
    var q = route().q;
    view.innerHTML = '<div class="row"><label class="vh" for="aq">' + t().aSearch + '</label><input class="in" id="aq" placeholder="' + t().aSearch + '" value="' + E(q.get('q') || '') + '" style="flex:1 1 260px"></div><div class="tbl"><table><thead><tr><th>' + t().aWhen + '</th><th>' + t().aAction + '</th><th>' + t().aWho + '</th></tr></thead><tbody id="arows"></tbody></table></div>';
    var tm; $('aq').oninput = function () { clearTimeout(tm); var v = this.value; tm = setTimeout(function () { location.hash = '#/admin/audit' + (v ? '?q=' + encodeURIComponent(v) : ''); }, 400); };
    A.api('GET', '/api/admin/audit?q=' + encodeURIComponent(q.get('q') || '')).then(function (r) { $('arows').innerHTML = r.items.length ? r.items.map(auditRow).join('') : '<tr><td colspan="3" class="empty">' + t().empty + '</td></tr>'; }, fail);
  }
  function vAdminSettings() {
    A.api('GET', '/api/admin/settings').then(function (s) {
      var ro = !isAdmin();
      var sw = function (id, on, label, hint) { return '<div class="setrow"><div><b style="font-weight:500">' + label + '</b>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div><button type="button" class="switch" role="switch" aria-checked="' + on + '" aria-label="' + E(label) + '" data-sw="' + id + '"' + (ro ? ' disabled' : '') + '><span></span></button></div>'; };
      view.innerHTML = (ro ? '<div class="alert warn">' + t().readOnly + '</div>' : '') +
        '<section class="card"><h3>' + t().sMethods + '</h3><p class="hint" style="margin:4px 0 6px">' + t().sMethodsH + '</p>' + Object.keys(s.payMethods).map(function (k) { return sw('payMethods.' + k, s.payMethods[k], t().methods[k]); }).join('') + '</section>' +
        '<section class="card grid"><h3>' + t().sPrices + '</h3>' + ['author', 'studio', 'pack'].map(function (id) { var p = s.products[id]; return '<div class="row" style="align-items:flex-end"><b style="flex:1 1 140px;font-weight:500">' + t().products[id] + '</b><div class="fld" style="width:140px"><label for="pr_' + id + '">' + t().sPriceRub + '</label><input class="in" id="pr_' + id + '" type="number" min="1" step="1" value="' + p.priceKop / 100 + '"' + (ro ? ' disabled' : '') + '></div><div class="fld" style="width:120px"><label for="cr_' + id + '">' + t().sCredits + '</label><input class="in" id="cr_' + id + '" type="number" min="1" step="1" value="' + p.credits + '"' + (ro ? ' disabled' : '') + '></div></div>'; }).join('') + (ro ? '' : '<div><button type="button" class="btn d sm" id="savePr">' + t().save + '</button></div>') + '</section>' +
        '<section class="card"><h3>' + t().sPlatforms + '</h3>' + Object.keys(s.platforms).map(function (k) { return sw('platforms.' + k, s.platforms[k], t().platformNames[k]); }).join('') + sw('eridOn', s.eridOn, t().sErid) + sw('registrationOpen', s.registrationOpen, t().sReg) + '</section>';
      view.querySelectorAll('[data-sw]').forEach(function (b) {
        b.onclick = function () {
          var parts = b.dataset.sw.split('.'), key = parts[0], val;
          if (parts.length > 1) { val = Object.assign({}, s[key]); val[parts[1]] = !val[parts[1]]; } else val = !s[key];
          A.api('POST', '/api/admin/settings', { key: key, value: val }).then(function (r) { s[key] = r[key]; A.toast(t().saved); vAdminSettings(); refreshCfg(); }, fail);
        };
      });
      if ($('savePr')) $('savePr').onclick = function () {
        var v = JSON.parse(JSON.stringify(s.products));
        ['author', 'studio', 'pack'].forEach(function (id) { v[id].priceKop = Math.round(Number($('pr_' + id).value) * 100); v[id].credits = Math.round(Number($('cr_' + id).value)); });
        A.api('POST', '/api/admin/settings', { key: 'products', value: v }).then(function () { A.toast(t().saved); refreshCfg(); }, fail);
      };
    }, fail);
  }


  // ---------- модели и цены (пользователь)
  function vModels() {
    view.innerHTML = '<p class="muted" style="max-width:720px">' + t().modelsP + '</p><div class="grid" id="mSec" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))"><span class="spinner"></span></div><p class="hint">' + t().modelsNote + '</p>';
    A.api('GET', '/api/public/models?lang=' + A.lang).then(function (r) {
      $('mSec').innerHTML = Object.keys(r.sections).map(function (k) {
        var sec = r.sections[k];
        return '<section class="card grid" style="gap:8px" aria-label="' + E(sec.title) + '"><h3>' + E(sec.title) + '</h3>' + (sec.items.length ? sec.items.map(function (m) {
          return '<div class="setrow"><div><b style="font-weight:500">' + E(m.name) + '</b>' + (m.ru ? ' <span class="pill">' + t().ruModel + '</span>' : '') + '<div class="hint">' + E(m.vendor) + '</div></div><span class="mono" style="white-space:nowrap">' + m.credits + ' ' + t().cr + ' <span class="hint">' + E(m.unit) + '</span></span></div>';
        }).join('') : '<p class="hint">' + t().noModels + '</p>') + '</section>';
      }).join('');
    }, fail);
  }

  // ---------- модели и цены (админка)
  function vAdminModels() {
    A.api('GET', '/api/admin/catalog').then(function (c) {
      var ro = !isAdmin(), L = A.lang === 'en' ? 'en' : 'ru';
      var types = ['text', 'image', 'tts', 'stt', 'video'];
      var prov = c.providers.map(function (p) { return '<div class="setrow"><div><b style="font-weight:500">' + E(p.name) + '</b><div class="hint">' + E(p.note) + (p.base ? ' · <span class="mono">' + E(p.base) + '</span>' : '') + '</div></div><span class="pill ' + (p.ready ? 'ok' : 'warn') + '">' + (p.ready ? t().mcKeyOk : t().mcKeyNo) + '</span></div>'; }).join('');
      var rows = function (type) {
        return c.items.filter(function (m) { return m.type === type; }).map(function (m) {
          var price = m.type === 'text'
            ? '<div class="row" style="gap:6px;flex-wrap:nowrap"><label class="vh" for="pi_' + m.id + '">' + t().mcIn + '</label><input class="in" style="width:96px;min-height:40px" id="pi_' + m.id + '" type="number" step="0.01" min="0" value="' + m.in + '"' + (ro ? ' disabled' : '') + ' title="' + t().mcIn + '"><label class="vh" for="po_' + m.id + '">' + t().mcOut + '</label><input class="in" style="width:96px;min-height:40px" id="po_' + m.id + '" type="number" step="0.01" min="0" value="' + m.out + '"' + (ro ? ' disabled' : '') + ' title="' + t().mcOut + '"></div><div class="hint">' + t().mcIn + ' / ' + t().mcOut + '</div>'
            : '<div class="row" style="gap:6px;flex-wrap:nowrap"><label class="vh" for="pp_' + m.id + '">' + t().mcPrice + '</label><input class="in" style="width:96px;min-height:40px" id="pp_' + m.id + '" type="number" step="0.01" min="0.01" value="' + m.price + '"' + (ro ? ' disabled' : '') + '><span class="hint">' + t().mcRub + ' ' + E(m.unit[L]) + '</span></div>';
          var secs = m.sections.map(function (sc) {
            var p = m.per[sc];
            return '<div class="row" style="gap:6px;flex-wrap:nowrap;font-size:13px"><span style="min-width:150px">' + E(c.sections[sc][L]) + '</span><span class="hint" style="white-space:nowrap">' + p.costRub.toLocaleString(L === 'en' ? 'en-US' : 'ru-RU') + ' ₽ →</span><label class="vh" for="cr_' + m.id + '_' + sc + '">' + E(c.sections[sc][L]) + ', ' + t().cr + '</label><input class="in" style="width:70px;min-height:36px" id="cr_' + m.id + '_' + sc + '" type="number" min="1" step="1" placeholder="' + p.autoCredits + '" value="' + (p.override ? p.credits : '') + '"' + (ro ? ' disabled' : '') + '><span class="hint">' + t().cr + (p.override ? '' : ' (' + t().mcAuto + ')') + '</span></div>';
          }).join('');
          return '<tr><td><button type="button" class="switch" role="switch" aria-checked="' + m.enabled + '" aria-label="' + t().mcOn + ': ' + E(m.name) + '" data-tg="' + m.id + '"' + (ro ? ' disabled' : '') + '><span></span></button></td>' +
            '<td style="min-width:200px"><b style="font-weight:500">' + E(m.name) + '</b>' + (m.est ? ' <span class="pill warn" title="' + E(t().mcEstH) + '">' + t().mcEst + '</span>' : '') + '<div class="hint">' + E(m.vendor) + ' · ' + E(m.providerName) + '</div><div class="hint mono" style="font-size:11px;word-break:break-all">' + E(m.model) + '</div>' + (m.note ? '<div class="hint" style="max-width:260px">' + E(m.note) + '</div>' : '') + '</td>' +
            '<td>' + price + '</td><td>' + secs + '</td><td>' + (ro ? '' : '<button type="button" class="btn d sm" data-sv="' + m.id + '">' + t().mcSave + '</button>') + '</td></tr>';
        }).join('');
      };
      view.innerHTML = (ro ? '<div class="alert warn">' + t().readOnly + '</div>' : '') +
        '<section class="card grid"><div class="row" style="align-items:flex-end"><div class="fld" style="width:180px"><label for="ccost">' + t().mcCost + ', ₽</label><input class="in" id="ccost" type="number" step="0.01" min="0.1" value="' + c.creditCost + '"' + (ro ? ' disabled' : '') + '></div>' + (ro ? '' : '<button type="button" class="btn d sm" id="ccSave">' + t().mcSave + '</button>') + '</div><p class="hint">' + t().mcCostH + '</p></section>' +
        '<section class="card"><h3>' + t().mcProviders + '</h3>' + prov + (ro ? '' : '<div style="margin-top:10px"><button type="button" class="btn s sm" id="ckBtn">' + t().mcCheck + '</button> <span class="hint" id="ckRes"></span></div>') + '</section>' +
        types.map(function (ty) { return '<section class="grid" style="gap:8px"><h3>' + t().mcTypes[ty] + '</h3><div class="tbl"><table><thead><tr><th>' + t().mcOn + '</th><th>' + t().mcModel + '</th><th>' + t().mcPrice + '</th><th>' + t().mcSections + '</th><th><span class="vh">' + t().mcSave + '</span></th></tr></thead><tbody>' + rows(ty) + '</tbody></table></div></section>'; }).join('');
      var post = function (path, body, btn) { busy(btn, true); return A.api('POST', path, body).then(function () { A.toast(t().saved); vAdminModels(); }, function (e) { busy(btn, false); fail(e); }); };
      view.querySelectorAll('[data-tg]').forEach(function (b) { b.onclick = function () { post('/api/admin/catalog/' + b.dataset.tg, { enabled: b.getAttribute('aria-checked') !== 'true' }, null); }; });
      view.querySelectorAll('[data-sv]').forEach(function (b) {
        b.onclick = function () {
          var id = b.dataset.sv, m = c.items.filter(function (x) { return x.id === id; })[0], body = { credits: {} };
          if (m.type === 'text') { body.in = Number($('pi_' + id).value); body.out = Number($('po_' + id).value); } else body.price = Number($('pp_' + id).value);
          m.sections.forEach(function (sc) { var v = $('cr_' + id + '_' + sc).value; body.credits[sc] = v ? Number(v) : null; });
          post('/api/admin/catalog/' + id, body, b);
        };
      });
      if ($('ccSave')) $('ccSave').onclick = function () { post('/api/admin/catalog/credit-cost', { value: Number($('ccost').value) }, this); };
      if ($('ckBtn')) $('ckBtn').onclick = function () {
        var b = this; busy(b, true);
        A.api('POST', '/api/admin/catalog-check', {}).then(function (r) { busy(b, false); $('ckRes').textContent = t().mcCheckRes.replace('{n}', r.total).replace('{m}', r.missingInProvider.length ? r.missingInProvider.join(', ') : '—'); }, function (e) { busy(b, false); $('ckRes').textContent = A.errText(e); });
      };
    }, fail);
  }

  // ---------- запуск
  var VIEWS = { home: vHome, history: vHistory, billing: vBilling, account: vAccount, models: vModels, 'admin/models': vAdminModels, admin: vAdminDash, 'admin/users': vAdminUsers, 'admin/audit': vAdminAudit, 'admin/settings': vAdminSettings };
  function render() {
    var r = route().path;
    if (r.indexOf('admin') === 0 && !isStaff()) { location.hash = '#/'; return; }
    shell(); loadNotif();
    (VIEWS[r] || vHome)();
  }
  function refreshMe() { return A.api('GET', '/api/me').then(function (m) { me = m.user; shell(); }); }
  function refreshCfg() { return A.api('GET', '/api/public/config').then(function (c) { cfg = c; }); }
  window.addEventListener('hashchange', function () { render(); view.focus({ preventScroll: true }); });
  Promise.all([A.api('GET', '/api/me'), A.api('GET', '/api/public/config')]).then(function (res) {
    if (res[0].mfaPending) { location.href = '/app/login#2fa'; return; }
    me = res[0].user; cfg = res[1];
    if (me.lang && me.lang !== A.lang) { try { if (!localStorage.getItem('aiyt.lang')) A.setLang(me.lang); } catch (e) {} }
    render();
  }, function (e) { if (e.status === 401) location.href = '/app/login?next=' + encodeURIComponent('/app/' + location.hash); else view.innerHTML = '<div class="alert err">' + E(A.errText(e)) + '</div>'; });
})();
