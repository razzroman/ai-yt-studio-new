// Данные исполнителя для всех юридических страниц. Заполните один раз — они подставятся везде.
window.AIYT_OPERATOR = {
  name: '',                    // ФИО полностью, например: Иванов Иван Иванович
  inn: '',                     // ИНН самозанятого, 12 цифр
  email: 'support@buykurs.ru', // почта поддержки
  phone: '',                   // телефон (необязательно; пусто — строка скрывается)
  site: 'buykurs.ru'
};

(function () {
  var O = window.AIYT_OPERATOR, LBL = { name: 'ФИО исполнителя', inn: 'ИНН', email: 'email', phone: 'телефон', site: 'сайт' };
  function fill() {
    document.querySelectorAll('[data-optional]').forEach(function (el) { if (!O[el.getAttribute('data-optional')]) el.hidden = true; });
    document.querySelectorAll('.op').forEach(function (el) {
      var k = el.getAttribute('data-op'), v = O[k];
      if (v) {
        el.textContent = v; el.classList.remove('miss');
        if (k === 'email' && !el.closest('a')) { el.innerHTML = ''; var a = document.createElement('a'); a.href = 'mailto:' + v; a.textContent = v; el.appendChild(a); }
      } else { el.textContent = '[' + LBL[k] + ' — заполнить]'; el.classList.add('miss'); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fill); else fill();
})();
