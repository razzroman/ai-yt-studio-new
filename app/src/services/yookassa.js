'use strict';
// Клиент ЮKassa API v3 (https://yookassa.ru/developers/api). Тестовый магазин работает через тот же API,
// отличаются только shopId и секретный ключ.
const METHOD_TYPE = { card: 'bank_card', sbp: 'sbp', sberpay: 'sberbank', tpay: 'tinkoff_bank' };

function makeLive(config, fetchImpl) {
  const auth = 'Basic ' + Buffer.from(config.yookassa.shopId + ':' + config.yookassa.secretKey).toString('base64');
  async function call(method, path, body, idemKey) {
    const headers = { Authorization: auth, 'Content-Type': 'application/json' };
    if (idemKey) headers['Idempotence-Key'] = idemKey;
    const r = await fetchImpl(config.yookassa.apiUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error('yookassa ' + r.status + ' ' + (data.description || data.code || '')); e.status = r.status; e.data = data; throw e; }
    return data;
  }
  return {
    mode: 'live',
    createPayment({ amountKop, description, returnUrl, method, savePaymentMethod, paymentMethodId, metadata, idemKey }) {
      const body = {
        amount: { value: (amountKop / 100).toFixed(2), currency: 'RUB' },
        capture: true,
        description: description.slice(0, 128),
        metadata
      };
      if (paymentMethodId) body.payment_method_id = paymentMethodId; // автопродление без участия пользователя
      else {
        body.confirmation = { type: 'redirect', return_url: returnUrl };
        if (method && METHOD_TYPE[method]) body.payment_method_data = { type: METHOD_TYPE[method] };
        if (savePaymentMethod) body.save_payment_method = true;
      }
      // Чек: магазин самозанятого в ЮKassa сам регистрирует доход в «Мой налог» и отправляет чек покупателю,
      // поэтому объект receipt (54-ФЗ) не передаём.
      return call('POST', '/payments', body, idemKey);
    },
    getPayment: (id) => call('GET', '/payments/' + encodeURIComponent(id)),
    createRefund: ({ paymentId, amountKop, idemKey, description }) => call('POST', '/refunds', { payment_id: paymentId, amount: { value: (amountKop / 100).toFixed(2), currency: 'RUB' }, description }, idemKey)
  };
}

// Заглушка шлюза: локальная разработка, демо-стенд и автотесты. Страница /app/mock-pay имитирует банк.
function makeMock() {
  const store = new Map(); let n = 0;
  return {
    mode: 'mock', store,
    async createPayment({ amountKop, description, returnUrl, method, savePaymentMethod, paymentMethodId, metadata }) {
      const id = 'mock-' + (++n) + '-' + Date.now().toString(36);
      const p = { id, status: paymentMethodId ? 'succeeded' : 'pending', paid: !!paymentMethodId, amount: { value: (amountKop / 100).toFixed(2), currency: 'RUB' }, description, metadata,
        payment_method: { type: method || 'bank_card', id: paymentMethodId || ('pm-' + id), saved: !!(savePaymentMethod || paymentMethodId) },
        confirmation: paymentMethodId ? undefined : { type: 'redirect', confirmation_url: '/app/mock-pay?id=' + id, return_url: returnUrl } };
      store.set(id, p);
      return JSON.parse(JSON.stringify(p));
    },
    async getPayment(id) { const p = store.get(id); if (!p) { const e = new Error('not found'); e.status = 404; throw e; } return JSON.parse(JSON.stringify(p)); },
    async createRefund({ paymentId, amountKop }) { const p = store.get(paymentId); if (!p || p.status !== 'succeeded') throw new Error('cannot refund'); p.refunded = true; return { id: 'rf-' + paymentId, status: 'succeeded', amount: { value: (amountKop / 100).toFixed(2) } }; },
    // Действие «банка» на странице имитации.
    decide(id, ok) {
      const p = store.get(id); if (!p || p.status !== 'pending') return null;
      if (ok) { p.status = 'succeeded'; p.paid = true; } else { p.status = 'canceled'; p.cancellation_details = { party: 'payment_network', reason: 'card_expired' }; }
      return p;
    }
  };
}

module.exports = { makeLive, makeMock, METHOD_TYPE };
