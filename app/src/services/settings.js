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
  registrationOpen: true
};
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
      else if (typeof DEFAULTS[key] === 'object') { clean = {}; Object.keys(DEFAULTS[key]).forEach(k => { clean[k] = value[k]; }); }
      put1.run(key, JSON.stringify(clean));
      return null;
    }
  };
};
module.exports.DEFAULTS = DEFAULTS;
