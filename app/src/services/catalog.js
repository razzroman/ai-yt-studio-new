'use strict';
// Каталог AI-моделей: где показываются, сколько стоят нам и сколько кредитов берём с пользователя.
// Цены Timeweb AI Gateway (₽): текстовые — с сайта Timeweb на 02.10.2026; картинки, озвучка и распознавание —
// оценка «цена производителя × 135 ₽/$» (такое соотношение дают текстовые цены Timeweb), их нужно сверить
// в панели Timeweb → AI Gateway → «Модели» и поправить в админке. Видео в Timeweb AI Gateway нет.
const { HttpError } = require('../http');

// Разделы кабинета, где модель появляется.
const SECTIONS = {
  script: { ru: 'Сценарий', en: 'Script' },
  seo: { ru: 'Заголовки и SEO', en: 'Titles & SEO' },
  assistant: { ru: 'AI-ассистент', en: 'AI assistant' },
  frames: { ru: 'Раскадровка и обложки', en: 'Storyboard & thumbnails' },
  voice: { ru: 'Озвучка', en: 'Voiceover' },
  stt: { ru: 'Распознавание речи (субтитры)', en: 'Speech recognition (subtitles)' },
  video: { ru: 'Видеоклипы', en: 'Video clips' }
};
// Типовой расход токенов на одну операцию — для показа цены в кредитах заранее.
const TEXT_USAGE = { script: [4000, 5000], seo: [1500, 1500], assistant: [2000, 1000] };

const PROVIDERS = {
  timeweb: { name: 'Timeweb AI Gateway', base: 'https://api.timeweb.ai/v1', env: 'TIMEWEB_AI_KEY', note: 'OpenAI-совместимый API, оплата в рублях, договор с российской компанией' },
  gateway: { name: 'AI-шлюз (Казахстан)', base: '', env: 'AI_GATEWAY_URL', note: 'Модели, которых нет в Timeweb (видео); подключается на этапе 2' }
};

// type: text — цены за 1 млн токенов (in/out); image — ₽ за кадр; tts/stt — ₽ за минуту; video — ₽ за секунду.
const DEFAULTS = [
  // ---- Тексты (точные цены Timeweb)
  { id: 'tw-qwen35-flash', provider: 'timeweb', model: 'qwen/qwen3.5-flash', name: 'Qwen 3.5 Flash', vendor: 'Alibaba', type: 'text', in: 14, out: 52, sections: ['script', 'seo', 'assistant'], enabled: true },
  { id: 'tw-deepseek-v41-flash', provider: 'timeweb', model: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek', type: 'text', in: 40.5, out: 162, sections: ['script', 'seo', 'assistant'], enabled: true },
  { id: 'tw-gemini38-flash', provider: 'timeweb', model: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', vendor: 'Google', type: 'text', in: 101.25, out: 506.25, sections: ['script', 'seo', 'assistant'], enabled: true },
  { id: 'tw-gpt54-mini', provider: 'timeweb', model: 'openai/gpt-5.4-mini', name: 'GPT 5.4 Mini', vendor: 'OpenAI', type: 'text', in: 101, out: 608, sections: ['script', 'seo', 'assistant'], enabled: true },
  { id: 'tw-yandexgpt51-pro', provider: 'timeweb', model: 'yandex/yandexgpt-5.1-pro', name: 'YandexGPT 5.1 Pro', vendor: 'Яндекс', type: 'text', in: 410, out: 410, sections: ['script', 'seo', 'assistant'], enabled: true, ru: true },
  { id: 'tw-gpt6-sol', provider: 'timeweb', model: 'openai/gpt-6-sol', name: 'GPT-6 Sol', vendor: 'OpenAI', type: 'text', in: 270, out: 1350, sections: ['script', 'assistant'], enabled: true },
  { id: 'tw-claude5-sonnet', provider: 'timeweb', model: 'anthropic/claude-5-sonnet', name: 'Claude 5 Sonnet', vendor: 'Anthropic', type: 'text', in: 405, out: 2025, sections: ['script', 'assistant'], enabled: true },
  { id: 'tw-claude-opus55', provider: 'timeweb', model: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', vendor: 'Anthropic', type: 'text', in: 540, out: 2700, sections: ['script', 'assistant'], enabled: false },
  // ---- Картинки (оценка)
  { id: 'tw-flux2-klein', provider: 'timeweb', model: 'bfl/flux-2-klein-9b', name: 'FLUX.2 [klein] 9B', vendor: 'Black Forest Labs', type: 'image', price: 1.89, est: true, sections: ['frames'], enabled: true },
  { id: 'tw-flux2-pro', provider: 'timeweb', model: 'bfl/flux-2-pro', name: 'FLUX.2 [pro]', vendor: 'Black Forest Labs', type: 'image', price: 4.05, est: true, sections: ['frames'], enabled: true },
  { id: 'tw-gemini31-flash-image', provider: 'timeweb', model: 'google/gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image', vendor: 'Google', type: 'image', price: 5.26, est: true, sections: ['frames'], enabled: true },
  { id: 'tw-gpt-image-2', provider: 'timeweb', model: 'openai/gpt-image-2', name: 'GPT Image 2', vendor: 'OpenAI', type: 'image', price: 7.15, est: true, sections: ['frames'], enabled: true },
  { id: 'tw-flux2-max', provider: 'timeweb', model: 'bfl/flux-2-max', name: 'FLUX.2 [max]', vendor: 'Black Forest Labs', type: 'image', price: 9.45, est: true, sections: ['frames'], enabled: false },
  { id: 'tw-gpt-image-25', provider: 'timeweb', model: 'openai/gpt-image-2.5', name: 'GPT Image 2.5 (Flare, Sunburst)', vendor: 'OpenAI', type: 'image', price: 10.8, est: true, sections: ['frames'], enabled: false },
  { id: 'tw-gemini3-pro-image', provider: 'timeweb', model: 'google/gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image', vendor: 'Google', type: 'image', price: 18.09, est: true, sections: ['frames'], enabled: false },
  // ---- Озвучка и распознавание (оценка)
  { id: 'tw-gpt4o-mini-tts', provider: 'timeweb', model: 'openai/gpt-4o-mini-tts', name: 'GPT-4o mini TTS', vendor: 'OpenAI', type: 'tts', price: 2.03, est: true, sections: ['voice'], enabled: true },
  { id: 'tw-gpt4o-mini-transcribe', provider: 'timeweb', model: 'openai/gpt-4o-mini-transcribe', name: 'GPT-4o mini Transcribe', vendor: 'OpenAI', type: 'stt', price: 0.41, est: true, sections: ['stt'], enabled: true, note: 'Без времени слов: для выделения слова в субтитрах нужен распознаватель с таймингами (SpeechKit, SaluteSpeech, whisper-1).' },
  { id: 'tw-gpt4o-transcribe', provider: 'timeweb', model: 'openai/gpt-4o-transcribe', name: 'GPT-4o Transcribe', vendor: 'OpenAI', type: 'stt', price: 0.81, est: true, sections: ['stt'], enabled: false, note: 'Без времени слов — см. выше.' },
  // ---- Видео: в Timeweb AI Gateway нет, через AI-шлюз (оценка: цена производителя × 92 ₽/$ с учётом оплаты за рубежом)
  { id: 'gw-seedance2-fast', provider: 'gateway', model: 'bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast', vendor: 'ByteDance', type: 'video', price: 8.28, est: true, sections: ['video'], enabled: false },
  { id: 'gw-veo31', provider: 'gateway', model: 'google/veo-3.1', name: 'Veo 3.1', vendor: 'Google', type: 'video', price: 8.28, est: true, sections: ['video'], enabled: false },
  { id: 'gw-kling3', provider: 'gateway', model: 'kling/kling-3.0', name: 'Kling 3.0', vendor: 'Kuaishou', type: 'video', price: 14.08, est: true, sections: ['video'], enabled: false }
];
const UNITS = { text: { ru: 'за операцию', en: 'per run' }, image: { ru: 'за кадр', en: 'per frame' }, tts: { ru: 'за минуту', en: 'per minute' }, stt: { ru: 'за минуту', en: 'per minute' }, video: { ru: 'за секунду', en: 'per second' } };

module.exports = function makeCatalog({ settings, config = {} }) {
  const r2 = (x) => Math.round(x * 100) / 100;
  function creditCost() { const v = settings.get('creditCost'); return typeof v === 'number' && v > 0 ? v : 0.85; }
  const toCredits = (rub) => Math.max(1, Math.ceil(rub / creditCost() - 1e-9));

  // Себестоимость и кредиты по разделам. Для текста — по типовому расходу токенов на операцию.
  function priced(m) {
    const per = {};
    m.sections.forEach((sec) => {
      let rub;
      if (m.type === 'text') { const u = TEXT_USAGE[sec] || TEXT_USAGE.assistant; rub = u[0] * m.in / 1e6 + u[1] * m.out / 1e6; }
      else rub = m.price;
      const auto = toCredits(rub);
      const ov = m.credits && m.credits[sec];
      per[sec] = { costRub: r2(rub), credits: Number.isInteger(ov) && ov > 0 ? ov : auto, autoCredits: auto, override: !!(Number.isInteger(ov) && ov > 0) };
    });
    return per;
  }

  function all() {
    const ov = settings.get('catalog') || {};
    return DEFAULTS.map((d) => {
      const o = ov[d.id] || {};
      const m = Object.assign({}, d, {
        enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
        in: typeof o.in === 'number' ? o.in : d.in, out: typeof o.out === 'number' ? o.out : d.out,
        price: typeof o.price === 'number' ? o.price : d.price,
        est: typeof o.price === 'number' || typeof o.in === 'number' ? false : !!d.est,
        model: typeof o.model === 'string' && o.model ? o.model : d.model,
        credits: o.credits || {}
      });
      const prov = PROVIDERS[m.provider];
      m.providerName = prov.name;
      m.providerReady = !!(config.providerKeys && config.providerKeys[m.provider]);
      m.unit = UNITS[m.type];
      m.per = priced(m);
      return m;
    });
  }

  return {
    SECTIONS, PROVIDERS, DEFAULTS, creditCost, all,
    // Для пользователя: только включённые модели, по разделам, с ценой в кредитах.
    publicList(lang) {
      const L = lang === 'en' ? 'en' : 'ru';
      const out = {};
      Object.keys(SECTIONS).forEach((s) => { out[s] = { title: SECTIONS[s][L], items: [] }; });
      all().filter((m) => m.enabled).forEach((m) => {
        m.sections.forEach((s) => out[s].items.push({ id: m.id, name: m.name, vendor: m.vendor, credits: m.per[s].credits, unit: m.unit[L], ru: !!m.ru }));
      });
      Object.values(out).forEach((s) => s.items.sort((a, b) => a.credits - b.credits));
      return out;
    },
    // Изменение из админки: включение, цена (₽), id модели у провайдера, ручная цена в кредитах по разделу.
    update(id, patch) {
      const d = DEFAULTS.find((x) => x.id === id);
      if (!d) throw new HttpError(404, 'model_not_found');
      const ov = settings.get('catalog') || {};
      const cur = Object.assign({}, ov[id] || {});
      const num = (v) => typeof v === 'number' && isFinite(v) && v >= 0 && v < 1e6;
      if (patch.enabled !== undefined) { if (typeof patch.enabled !== 'boolean') throw new HttpError(400, 'bad_value'); cur.enabled = patch.enabled; }
      if (d.type === 'text') {
        if (patch.in !== undefined) { if (!num(patch.in)) throw new HttpError(400, 'bad_price'); cur.in = patch.in; }
        if (patch.out !== undefined) { if (!num(patch.out)) throw new HttpError(400, 'bad_price'); cur.out = patch.out; }
      } else if (patch.price !== undefined) { if (!num(patch.price) || patch.price === 0) throw new HttpError(400, 'bad_price'); cur.price = patch.price; }
      if (patch.model !== undefined) { const s = String(patch.model).trim(); if (!/^[\w.\-/:]{1,120}$/.test(s)) throw new HttpError(400, 'bad_model_id'); cur.model = s; }
      if (patch.credits !== undefined) {
        const c = {};
        Object.keys(patch.credits || {}).forEach((sec) => {
          if (!d.sections.includes(sec)) throw new HttpError(400, 'bad_section');
          const v = patch.credits[sec];
          if (v === null || v === 0) return;
          if (!Number.isInteger(v) || v < 1 || v > 100000) throw new HttpError(400, 'bad_amount');
          c[sec] = v;
        });
        cur.credits = c;
      }
      ov[id] = cur;
      settings.setRaw('catalog', ov);
      return all().find((m) => m.id === id);
    },
    setCreditCost(v) {
      if (typeof v !== 'number' || !(v >= 0.1 && v <= 100)) throw new HttpError(400, 'bad_value');
      settings.setRaw('creditCost', Math.round(v * 100) / 100);
    }
  };
};
module.exports.SECTIONS = SECTIONS;
