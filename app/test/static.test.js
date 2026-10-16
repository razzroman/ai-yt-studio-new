'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

test('прототип: наружу отдаются только его страницы, исходники и служебные файлы закрыты', async () => {
  const t = await start();
  const st = async (p) => { const r = await fetch(t.base + p); await r.arrayBuffer(); return r.status; };
  for (const p of ['/prototype/', '/prototype/Main.dc.html', '/prototype/support.js', '/Main.dc.html', '/phone.html', '/favicon.ico']) assert.equal(await st(p), 200, p);
  for (const p of ['/prototype/.git/config', '/.git/config', '/prototype/README.md', '/README.md', '/prototype/CNAME', '/CNAME',
    '/prototype/app/src/config.js', '/prototype/app/deploy/app.env.example', '/prototype/desktop/app/main.js',
    '/prototype/.nojekyll', '/prototype/%2E%2E%2Fapp%2Fsrc%2Fconfig.js', '/prototype/app%2Fsrc%2Fconfig.js']) {
    const s = await st(p); assert.ok(s === 404 || s === 400, p + ' → ' + s);
  }
  await t.close();
});
