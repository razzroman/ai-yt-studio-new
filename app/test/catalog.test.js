'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('./helpers');

const find = (secs, sec, id) => secs[sec].items.find((m) => m.id === id);

test('каталог: кредиты считаются от себестоимости, выключенная модель пропадает у пользователей', async () => {
  const t = await start();
  const a = t.client(); await t.signup(a, 'boss@example.com');
  let pub = (await t.client().get('/api/public/models')).body.sections;
  // Claude 5 Sonnet: сценарий 4k×405 + 5k×2025 ₽/1М = 11,745 ₽ → ⌈11,745 / 0,85⌉ = 14 кредитов.
  assert.equal(find(pub, 'script', 'tw-claude5-sonnet').credits, 14);
  assert.equal(find(pub, 'frames', 'tw-flux2-klein').credits, 3);
  assert.ok(!find(pub, 'script', 'tw-claude-opus55'), 'выключенная по умолчанию модель не видна');
  // Выключаем Sonnet — пропадает и из сценария, и из ассистента.
  assert.equal((await a.post('/api/admin/catalog/tw-claude5-sonnet', { enabled: false })).body.enabled, false);
  pub = (await t.client().get('/api/public/models')).body.sections;
  assert.ok(!find(pub, 'script', 'tw-claude5-sonnet') && !find(pub, 'assistant', 'tw-claude5-sonnet'));
  // Точная цена из панели Timeweb меняет кредиты, метка «оценка» снимается.
  const gi = (await a.post('/api/admin/catalog/tw-gpt-image-2', { price: 4.2 })).body;
  assert.equal(gi.est, false);
  assert.equal(gi.per.frames.credits, 5);
  // Ручная цена в кредитах по разделу важнее расчёта.
  assert.equal((await a.post('/api/admin/catalog/tw-gpt-image-2', { credits: { frames: 9 } })).body.per.frames.credits, 9);
  // Себестоимость кредита пересчитывает всё.
  await a.post('/api/admin/catalog/credit-cost', { value: 1 });
  pub = (await t.client().get('/api/public/models')).body.sections;
  assert.equal(find(pub, 'frames', 'tw-flux2-klein').credits, 2); // ⌈1,89 / 1⌉
  const log = (await a.get('/api/admin/audit')).body.items.map((x) => x.action);
  assert.ok(log.includes('admin.catalog') && log.includes('admin.credit_cost'));
  await t.close();
});

test('каталог: только администратор меняет, мусор не принимается, обходной путь через общие настройки закрыт', async () => {
  const t = await start();
  const a = t.client(); await t.signup(a, 'boss@example.com');
  const u = t.client(); await t.signup(u, 'u@x.ru');
  assert.equal((await u.post('/api/admin/catalog/tw-flux2-pro', { enabled: false })).status, 403);
  assert.equal((await u.get('/api/admin/catalog')).status, 403);
  assert.equal((await a.post('/api/admin/catalog/tw-flux2-pro', { price: -1 })).body.error, 'bad_price');
  assert.equal((await a.post('/api/admin/catalog/tw-flux2-pro', { model: 'x; rm -rf' })).body.error, 'bad_model_id');
  assert.equal((await a.post('/api/admin/catalog/nope', { enabled: true })).body.error, 'model_not_found');
  assert.equal((await a.post('/api/admin/catalog/tw-flux2-pro', { credits: { script: 3 } })).body.error, 'bad_section');
  assert.equal((await a.post('/api/admin/settings', { key: 'catalog', value: {} })).body.error, 'unknown_key');
  assert.equal((await a.post('/api/admin/catalog/credit-cost', { value: 0 })).body.error, 'bad_value');
  await t.close();
});

test('проверка подключения Timeweb: сравнение нашего списка с моделями провайдера', async () => {
  const fakeFetch = async (url, opts) => {
    assert.equal(url, 'https://api.timeweb.ai/v1/models');
    assert.equal(opts.headers.Authorization, 'Bearer tw-key');
    return { ok: true, status: 200, json: async () => ({ data: [{ id: 'openai/gpt-image-2' }, { id: 'qwen/qwen3.5-flash' }, { id: 'new/model' }] }) };
  };
  const t = await start({ fetch: fakeFetch, config: { ai: { timewebKey: 'tw-key' } } });
  const a = t.client(); await t.signup(a, 'boss@example.com');
  const r = (await a.post('/api/admin/catalog-check', {})).body;
  assert.equal(r.total, 3);
  assert.ok(r.newAtProvider.includes('new/model'));
  assert.ok(r.missingInProvider.includes('anthropic/claude-5-sonnet'));
  const cat = (await a.get('/api/admin/catalog')).body;
  assert.equal(cat.providers.find((p) => p.id === 'timeweb').ready, true);
  await t.close();
});
