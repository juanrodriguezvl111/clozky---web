/* ============================================================
   CLOZKY — CARRITO COMPARTIDO
   Una sola fuente de verdad para index, producto y checkout.
   Antes cada página guardaba por su cuenta y ninguna leía de vuelta:
   el contador decía 0 mientras el checkout tenía prendas dentro.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'clzky_cart';

  /* Lee y valida. Un localStorage corrupto no puede tumbar la página. */
  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      return raw.filter(function (i) {
        return i && typeof i.name === 'string'
            && typeof i.price === 'number' && isFinite(i.price)
            && typeof i.size === 'string'
            && typeof i.qty === 'number' && i.qty > 0;
      });
    } catch (e) {
      console.warn('Carrito ilegible, se reinicia', e);
      return [];
    }
  }

  function write(cart) {
    try {
      localStorage.setItem(KEY, JSON.stringify(cart));
    } catch (e) {
      // Modo incógnito o cuota llena: no rompemos la compra por esto.
      console.warn('No se pudo guardar el carrito', e);
    }
  }

  function count(cart) {
    return (cart || read()).reduce(function (a, i) { return a + i.qty; }, 0);
  }

  function total(cart) {
    return (cart || read()).reduce(function (a, i) { return a + i.price * i.qty; }, 0);
  }

  /* Agrega respetando el tope de stock si se conoce. Devuelve el carrito. */
  function add(item) {
    var cart = read();
    var qty = Math.max(1, Math.min(10, parseInt(item.qty, 10) || 1));
    var existente = cart.filter(function (i) {
      return i.name === item.name && i.size === item.size;
    })[0];

    if (existente) {
      existente.qty = Math.min(10, existente.qty + qty);
    } else {
      cart.push({
        productId: item.productId || null,
        name:      String(item.name),
        price:     Number(item.price),
        size:      String(item.size),
        qty:       qty
      });
    }
    write(cart);
    paint();
    return cart;
  }

  /* Pinta el contador del header en cualquier página que lo tenga. */
  function paint() {
    var el = document.getElementById('cart-count');
    if (!el) return;
    var n = count();
    var crecio = n > Number(el.dataset.n || 0);
    el.textContent = n;
    el.dataset.n = n;
    if (crecio) {
      el.classList.add('bump');
      setTimeout(function () { el.classList.remove('bump'); }, 240);
    }
  }

  global.ClozkyCart = {
    KEY: KEY, read: read, write: write,
    count: count, total: total, add: add, paint: paint
  };

  /* El contador se pinta apenas hay DOM, en TODAS las páginas. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else {
    paint();
  }

  /* Si el usuario tiene dos pestañas abiertas, el contador se mantiene al día. */
  global.addEventListener('storage', function (e) {
    if (e.key === KEY) paint();
  });
})(window);
