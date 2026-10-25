'use strict';
// Модуль «Генерация фото — OpenAI»: кредиты списываются до запроса и возвращаются, если OpenAI не вернул картинку.
// Ключ API хранится только в окружении (OPENAI_API_KEY), в базу и в ответы API не попадает.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { HttpError } = require('../http');
const { IMAGE } = require('./settings');

// Ориентир себестоимости за картинку 1024×1024 в долларах (прайс OpenAI, октябрь 2026). Нужен админке для расчёта цены в кредитах.
const COST_USD = {
  'gpt-image-2': { low: 0.006, medium: 0.053, high: 0.211 },
  'gpt-image-2.5-flare': { low: null, medium: 0.013, high: 0.053 },
  'gpt-image-2.5-sunburst': { low: null, medium: 0.013, high: 0.053 }
};


module.exports = function makeImages({ db, config, credits, settings, audit, fetchImpl, logger = console }) {
  const ai = config.ai || {};
  const key = () => ai.openaiKey || '';
  const base = () => (ai.openaiBase || 'https://api.openai.com/v1').replace(/\/$/, '');
  const dir = ai.imagesDir || (config.dbPath && config.dbPath !== ':memory:' ? path.join(path.dirname(path.resolve(config.dbPath)), 'images') : path.join(os.tmpdir(), 'aiyt-images-' + process.pid));
  fs.mkdirSync(dir, { recursive: true });

  function status() {
    let host = '';
    try { host = new URL(base()).host; } catch (e) { host = base(); }
    return { keySet: !!key(), host, models: IMAGE.MODELS, qualities: IMAGE.QUALITIES, sizes: IMAGE.SIZES, costUsd: COST_USD };
  }

  function publicInfo() {
    const c = settings.get('imageGen');
    return { enabled: c.enabled && !!key(), quality: c.quality, size: c.size, credits: c.credits, sizes: IMAGE.SIZES };
  }

  async function call(url, opts, timeoutMs) {
    try { return await fetchImpl(url, Object.assign({ signal: AbortSignal.timeout(timeoutMs) }, opts)); }
    catch (e) { throw new HttpError(502, 'provider_unreachable'); }
  }

  // Проверка подключения из админки: ключ принят и выбранная модель доступна.
  async function check(actor, ip) {
    if (!key()) throw new HttpError(400, 'provider_key_missing');
    const model = settings.get('imageGen').model;
    const r = await call(base() + '/models/' + encodeURIComponent(model), { headers: { Authorization: 'Bearer ' + key() } }, 15000);
    audit.log(actor.id, 'admin.image_check', null, { model, status: r.status }, ip);
    if (r.status === 401 || r.status === 403) throw new HttpError(400, 'provider_key_invalid');
    if (r.status === 404) throw new HttpError(400, 'model_unavailable');
    if (!r.ok) throw new HttpError(502, 'provider_error');
    return { ok: true, model };
  }

  async function generate(user, body) {
    const c = settings.get('imageGen');
    if (!c.enabled) throw new HttpError(403, 'module_disabled');
    if (!key()) throw new HttpError(503, 'provider_key_missing');
    if (!user.email_verified) throw new HttpError(403, 'email_not_verified');
    const prompt = String(body.prompt || '').trim();
    if (prompt.length < 3 || prompt.length > 4000) throw new HttpError(400, 'bad_prompt');
    const quality = body.quality === undefined ? c.quality : String(body.quality);
    const size = body.size === undefined ? c.size : String(body.size);
    if (!IMAGE.QUALITIES.includes(quality)) throw new HttpError(400, 'bad_quality');
    if (!IMAGE.SIZES.includes(size)) throw new HttpError(400, 'bad_size');
    const cost = c.credits[quality];

    const ref = 'img_' + crypto.randomBytes(9).toString('hex');
    credits.spend(user.id, cost, 'Фото · OpenAI ' + c.model + ' · ' + quality, ref); // 402, если кредитов не хватает
    const id = Number(db.prepare('INSERT INTO images (user_id, prompt, model, quality, size, credits, spend_ref) VALUES (?, ?, ?, ?, ?, ?, ?)').run(user.id, prompt, c.model, quality, size, cost, ref).lastInsertRowid);

    const fail = (code, status) => {
      credits.refundSpend(user.id, ref, 'Возврат: фото не создано');
      db.prepare("UPDATE images SET status = 'failed', error = ? WHERE id = ?").run(code, id);
      return new HttpError(status, code, { refunded: cost });
    };

    let r;
    try {
      r = await call(base() + '/images/generations', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.model, prompt, size, quality, n: 1, output_format: 'webp', user: 'u' + crypto.createHash('sha256').update(String(user.id) + (config.secret || '')).digest('hex').slice(0, 16) })
      }, 180000);
    } catch (e) { throw fail('provider_unreachable', 502); }

    let j = {};
    try { j = await r.json(); } catch (e) { j = {}; }
    if (!r.ok) {
      const errCode = (j.error && (j.error.code || j.error.type)) || '';
      logger.error('[images] OpenAI', r.status, errCode);
      if (r.status === 400 && /moderation|safety|content_policy/.test(errCode)) throw fail('content_blocked', 400);
      if (r.status === 401 || r.status === 403) throw fail('provider_key_invalid', 502);
      if (r.status === 429) throw fail('provider_busy', 503);
      throw fail('provider_error', 502);
    }
    const b64 = j.data && j.data[0] && j.data[0].b64_json;
    if (!b64) throw fail('provider_error', 502);
    const buf = Buffer.from(b64, 'base64');
    const file = id + '.webp';
    try { fs.writeFileSync(path.join(dir, file), buf); } catch (e) { logger.error('[images] write', e.message); throw fail('internal', 500); }
    db.prepare("UPDATE images SET status = 'done', file = ?, bytes = ? WHERE id = ?").run(file, buf.length, id);
    return { id, url: '/api/images/' + id + '/file', model: c.model, quality, size, credits: cost, balance: credits.balance(user.id) };
  }

  function list(userId, limit = 30) {
    return db.prepare('SELECT id, prompt, model, quality, size, credits, status, error, created_at FROM images WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, Math.min(limit, 100))
      .map(x => Object.assign(x, { url: x.status === 'done' ? '/api/images/' + x.id + '/file' : null }));
  }

  // Файл отдаётся только владельцу.
  function file(userId, id) {
    const row = db.prepare("SELECT file FROM images WHERE id = ? AND user_id = ? AND status = 'done'").get(id, userId);
    if (!row || !/^\d+\.webp$/.test(row.file)) throw new HttpError(404, 'not_found');
    try { return fs.readFileSync(path.join(dir, row.file)); } catch (e) { throw new HttpError(404, 'not_found'); }
  }

  return { status, publicInfo, check, generate, list, file, dir };
};
module.exports.COST_USD = COST_USD;
