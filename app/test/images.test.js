'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('./helpers');

const PNG1 = Buffer.from('UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAEX/I/of', 'base64'); // крошечный webp
function fakeOpenAI(log, mode = 'ok') {
  return async (url, opts = {}) => {
    log.push({ url, opts });
    if (url.endsWith('/models/gpt-image-2')) return { ok: mode !== 'badkey', status: mode === 'badkey' ? 401 : 200, json: async () => ({ id: 'gpt-image-2' }) };
    if (url.endsWith('/images/generations')) {
      if (mode === 'blocked') return { ok: false, status: 400, json: async () => ({ error: { code: 'moderation_blocked' } }) };
      if (mode === 'down') throw new Error('ECONNRESET');
      return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG1.toString('base64') }] }) };
    }
    throw new Error('unexpected ' + url);
  };
}
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aiyt-img-'));
const cfg = (over = {}) => ({ ai: Object.assign({ openaiKey: 'sk-test', openaiBase: 'https://api.openai.com/v1', imagesDir: dir() }, over) });

test('генерация фото: админ включает модуль, кредиты списываются, файл виден только владельцу', async () => {
  const log = [];
  const t = await start({ fetch: fakeOpenAI(log), config: cfg() });
  try {
    const a = t.client(); await t.signup(a, 'boss@example.com');
    const u = t.client(); await t.signup(u, 'u@x.ru');
    // По умолчанию выключен — у пользователей модуля нет.
    assert.equal((await u.get('/api/public/config')).body.imageGen.enabled, false);
    assert.equal((await u.post('/api/images', { prompt: 'Батискаф в глубине океана' })).body.error, 'module_disabled');
    // Админ видит статус ключа (но не сам ключ) и включает модуль.
    const s = (await a.get('/api/admin/settings')).body;
    assert.equal(s.imageGenStatus.keySet, true);
    assert.ok(!JSON.stringify(s).includes('sk-test'), 'ключ не уходит в браузер');
    const on = Object.assign({}, s.imageGen, { enabled: true, credits: { low: 1, medium: 5, high: 12 } });
    assert.equal((await a.post('/api/admin/settings', { key: 'imageGen', value: on })).status, 200);
    assert.equal((await u.get('/api/public/config')).body.imageGen.enabled, true);
    // Пользователь создаёт картинку: −5 кредитов, запрос в OpenAI с ключом и выбранной моделью.
    const r = (await u.post('/api/images', { prompt: 'Батискаф в глубине океана', size: '1536x1024' })).body;
    assert.equal(r.credits, 5); assert.equal(r.balance, 55);
    const call = log.find(x => x.url.endsWith('/images/generations'));
    assert.equal(call.opts.headers.Authorization, 'Bearer sk-test');
    const sent = JSON.parse(call.opts.body);
    assert.equal(sent.model, 'gpt-image-2'); assert.equal(sent.quality, 'medium'); assert.equal(sent.size, '1536x1024');
    const f = await u.get(r.url); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/webp');
    assert.equal((await a.get(r.url)).status, 404, 'чужую картинку не отдаём');
    assert.equal((await u.get('/api/images')).body.items[0].status, 'done');
    // Проверка подключения в админке.
    assert.equal((await a.post('/api/admin/image-gen/check', {})).body.ok, true);
    assert.equal((await u.post('/api/admin/image-gen/check', {})).status, 403);
    assert.equal((await u.post('/api/admin/settings', { key: 'imageGen', value: on })).status, 403);
  } finally { await t.close(); }
});

test('генерация фото: при отказе OpenAI кредиты возвращаются; неверные настройки не принимаются', async () => {
  for (const mode of ['blocked', 'down']) {
    const t = await start({ fetch: fakeOpenAI([], mode), config: cfg() });
    try {
      const a = t.client(); await t.signup(a, 'boss@example.com');
      const s = (await a.get('/api/admin/settings')).body;
      await a.post('/api/admin/settings', { key: 'imageGen', value: Object.assign({}, s.imageGen, { enabled: true }) });
      const r = await a.post('/api/images', { prompt: 'Что-то', quality: 'high' });
      assert.equal(r.body.error, mode === 'blocked' ? 'content_blocked' : 'provider_unreachable');
      assert.equal((await a.get('/api/me')).body.user.balance, 60, 'кредиты возвращены');
      const h = (await a.get('/api/credits?limit=5')).body;
      assert.ok(JSON.stringify(h).includes('Возврат'), 'возврат виден в истории');
      assert.equal((await a.get('/api/images')).body.items[0].status, 'failed');
    } finally { await t.close(); }
  }
  const t = await start({ fetch: fakeOpenAI([]), config: cfg() });
  try {
    const a = t.client(); await t.signup(a, 'boss@example.com');
    const g = (await a.get('/api/admin/settings')).body.imageGen;
    for (const [bad, code] of [[{ model: 'dall-e-3' }, 'bad_model'], [{ quality: 'ultra' }, 'bad_quality'], [{ size: '4000x4000' }, 'bad_size'], [{ credits: { low: 0, medium: 1, high: 1 } }, 'bad_credits']]) {
      assert.equal((await a.post('/api/admin/settings', { key: 'imageGen', value: Object.assign({}, g, bad) })).body.error, code);
    }
    await a.post('/api/admin/settings', { key: 'imageGen', value: Object.assign({}, g, { enabled: true, credits: { low: 1, medium: 4, high: 100 } }) });
    assert.equal((await a.post('/api/images', { prompt: 'Слишком дорого', quality: 'high' })).body.error, 'insufficient_credits');
    assert.equal((await a.post('/api/images', { prompt: 'ок' })).body.error, 'bad_prompt');
  } finally { await t.close(); }
  // Без ключа модуль у пользователей не появляется, проверка подключения сообщает причину.
  const t2 = await start({ fetch: fakeOpenAI([]), config: cfg({ openaiKey: '' }) });
  try {
    const a = t2.client(); await t2.signup(a, 'boss@example.com');
    const g = (await a.get('/api/admin/settings')).body.imageGen;
    await a.post('/api/admin/settings', { key: 'imageGen', value: Object.assign({}, g, { enabled: true }) });
    assert.equal((await a.get('/api/public/config')).body.imageGen.enabled, false);
    assert.equal((await a.post('/api/admin/image-gen/check', {})).body.error, 'provider_key_missing');
  } finally { await t2.close(); }
});
