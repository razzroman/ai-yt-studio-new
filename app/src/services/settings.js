'use strict';
// Настройки, которые меняет администратор и которые сразу применяются у пользователей.
const DEFAULTS = {
  // Цены в копейках и кредиты; EN-цены — только для показа (оплата в рублях, см. ТЗ).
  products: {
    author: { kind: 'plan', plan: 'author', priceKop: 249000, credits: 1000, days: 30, usd: 29 },
    studio: { kind: 'plan', plan: 'studio', priceKop: 649000, credits: 3500, days: 30, usd: 79 },
    pack: { kind: 'pack', priceKop: 119000, credits: 500, usd: 15 }
  },
  payMethods: { card: true, sbp: true, sberpay: true, tpay: true },
  platforms: { youtube: true, vk: true, rutube: true, dzen: true },
  eridOn: true,
  registrationOpen: true,
  // Модуль «Генерация фото — OpenAI». Ключ API — только в /etc/aiyt/app.env (OPENAI_API_KEY), не в базе.
  imageGen: { enabled: false, model: 'gpt-image-2', quality: 'medium', size: '1024x1024', credits: { low: 1, medium: 4, high: 12 } }
};
const IMAGE_MODELS = ['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'];
const IMAGE_QUALITIES = ['low', 'medium', 'high'];
const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'];
const KEYS = Object.keys(DEFAULTS);

module.exports = function makeSettings(db) {
  const get1 = db.prepare('SELECT value FROM settings WHERE key = ?');
  const put1 = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  function get(key) { const r = get1.get(key); return r ? JSON.parse(r.value) : JSON.parse(JSON.stringify(DEFAULTS[key])); }
  function all() { const o = {}; KEYS.forEach(k => { o[k] = get(k); }); return o; }

  function validate(key, v) {
    if (!KEYS.includes(key)) return 'unknown_key';
    if (key === 'products') {
      for (const id of Object.keys(DEFAULTS.products)) {
        const p = v[id];
        if (!p || !Number.isInteger(p.priceKop) || p.priceKop < 100 || !Number.isInteger(p.credits) || p.credits < 1) return 'bad_product_' + id;
      }
      return null;
    }
    if (key === 'imageGen') {
      if (!v || typeof v !== 'object' || typeof v.enabled !== 'boolean') return 'bad_value';
      if (!IMAGE_MODELS.includes(v.model)) return 'bad_model';
      if (!IMAGE_QUALITIES.includes(v.quality)) return 'bad_quality';
      if (!IMAGE_SIZES.includes(v.size)) return 'bad_size';
      if (!v.credits || IMAGE_QUALITIES.some(q => !Number.isInteger(v.credits[q]) || v.credits[q] < 1 || v.credits[q] > 1000)) return 'bad_credits';
      return null;
    }
    if (typeof DEFAULTS[key] === 'boolean') return typeof v === 'boolean' ? null : 'bad_value';
    if (typeof v !== 'object' || !v) return 'bad_value';
    for (const k of Object.keys(DEFAULTS[key])) if (typeof v[k] !== 'boolean') return 'bad_value';
    if (key === 'payMethods' && !Object.values(v).some(Boolean)) return 'need_one_method';
    return null;
  }

  return {
    get, all, KEYS, validate,
    set(key, value) {
      const err = validate(key, value);
      if (err) return err;
      // Сохраняем только известные поля, чтобы в настройки не попал мусор.
      let clean = value;
      if (key === 'products') { clean = {}; Object.keys(DEFAULTS.products).forEach(id => { clean[id] = Object.assign({}, DEFAULTS.products[id], { priceKop: value[id].priceKop, credits: value[id].credits }); }); }
      else if (key === 'imageGen') { clean = { enabled: value.enabled, model: value.model, quality: value.quality, size: value.size, credits: {} }; IMAGE_QUALITIES.forEach(q => { clean.credits[q] = value.credits[q]; }); }
      else if (typeof DEFAULTS[key] === 'object') { clean = {}; Object.keys(DEFAULTS[key]).forEach(k => { clean[k] = value[k]; }); }
      put1.run(key, JSON.stringify(clean));
      return null;
    }
  };
};
module.exports.DEFAULTS = DEFAULTS;
module.exports.IMAGE = { MODELS: IMAGE_MODELS, QUALITIES: IMAGE_QUALITIES, SIZES: IMAGE_SIZES };
