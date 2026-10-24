/* ============================================================
   CLOZKY — BOLSA (barra lateral del carrito)
   Una sola bolsa para todas las páginas con header. Antes vivía
   sólo en index: en producto el ícono llevaba directo al pago.
   Necesita cart.js cargado antes (los <script defer> van en orden).
   ============================================================ */
(function (global) {
  'use strict';

  /* Miniatura y id de catálogo de Meta por productId (los de inventario). */
  var FICHAS = {
    1: { img: 'assets/product1-cut.webp', catalogId: 'CLZ001' },
    2: { img: 'assets/product2-cut.webp', catalogId: 'CLZ002' },
    3: { img: 'assets/product3-cut.webp', catalogId: 'CLZ003' }
  };

  var Cart = global.ClozkyCart;
  var panel, dim, body, ftr, totalEl, lastFocus = null;

  var fmt = function (n) { return '$' + Number(n).toLocaleString('es-CO'); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* inventario.js sólo está en index y producto. Donde no está, el tope es
     el de cart.js (10); el servidor vuelve a validar stock antes de cobrar. */
  function tope(item) {
    return typeof global.stockDe === 'function' ? global.stockDe(item.productId, item.size) : 10;
  }

  function montar() {
    dim = document.createElement('div');
    dim.className = 'bolsa-dim';
    dim.addEventListener('click', cerrar);

    panel = document.createElement('aside');
    panel.className = 'cart-sidebar';
    panel.setAttribute('aria-label', 'Tu bolsa');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;               /* cerrada: fuera del orden de tabulación */
    panel.innerHTML =
      '<div class="cart-hdr">' +
        '<h3>Tu Bolsa</h3>' +
        '<button class="cart-close" type="button" aria-label="Cerrar bolsa">×</button>' +
      '</div>' +
      '<div class="cart-body"></div>' +
      '<div class="cart-ftr" hidden>' +
        '<div class="cart-total-row"><span>Total</span><span class="cart-total-price">$0</span></div>' +
        '<button class="checkout-btn" type="button">Finalizar Compra</button>' +
        '<p class="checkout-note">Pago seguro con Wompi · Envíos nacionales</p>' +
      '</div>';

    body    = panel.querySelector('.cart-body');
    ftr     = panel.querySelector('.cart-ftr');
    totalEl = panel.querySelector('.cart-total-price');

    panel.querySelector('.cart-close').addEventListener('click', cerrar);
    panel.querySelector('.checkout-btn').addEventListener('click', irAPagar);

    /* Un solo listener para −, + y X: el HTML de la lista se repinta entero. */
    body.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-accion]');
      if (!btn) return;
      var i = Number(btn.dataset.i);
      var cart = Cart.read();
      var item = cart[i];
      if (!item) return;
      if (btn.dataset.accion === 'mas') {
        if (item.qty >= tope(item)) return;
        item.qty += 1;
      } else if (btn.dataset.accion === 'menos') {
        item.qty -= 1;
        if (item.qty <= 0) cart.splice(i, 1);
      } else if (btn.dataset.accion === 'quitar') {
        cart.splice(i, 1);
      }
      Cart.write(cart);
      Cart.paint();
      pintar();
    });

    document.body.appendChild(dim);
    document.body.appendChild(panel);
  }

  function pintar() {
    var cart = Cart.read();
    if (!cart.length) {
      body.innerHTML = '<div class="cart-empty"><p>Tu bolsa está vacía</p></div>';
      ftr.hidden = true;
      return;
    }
    ftr.hidden = false;
    body.innerHTML = cart.map(function (item, i) {
      var ficha = FICHAS[item.productId];
      var nombre = esc(item.name), talla = esc(item.size);
      var thumb = ficha
        ? '<img src="' + ficha.img + '" alt="' + nombre + '">'
        : '';
      return '' +
        '<div class="cart-item">' +
          '<div class="ci-thumb">' + thumb + '</div>' +
          '<div>' +
            '<p class="ci-name">' + nombre + '</p>' +
            '<p class="ci-detail">Talla: ' + talla + '</p>' +
            '<div class="ci-qty-row">' +
              '<button class="ci-qty-btn" type="button" data-accion="menos" data-i="' + i + '" aria-label="Quitar una">−</button>' +
              '<span class="ci-qty-num">' + item.qty + '</span>' +
              '<button class="ci-qty-btn" type="button" data-accion="mas" data-i="' + i + '" aria-label="Agregar una">+</button>' +
            '</div>' +
          '</div>' +
          '<div class="ci-side">' +
            '<span class="ci-price">' + fmt(item.price * item.qty) + '</span>' +
            '<button class="ci-remove" type="button" data-accion="quitar" data-i="' + i + '" aria-label="Quitar ' + nombre + ' talla ' + talla + ' de la bolsa">' +
              '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l10 10M11 1L1 11"/></svg>' +
            '</button>' +
          '</div>' +
        '</div>';
    }).join('');
    totalEl.textContent = fmt(Cart.total(cart));
  }

  function abrir() {
    if (panel.classList.contains('open')) return;
    lastFocus = document.activeElement;
    pintar();
    panel.classList.add('open');
    dim.classList.add('on');
    panel.setAttribute('aria-hidden', 'false');
    panel.inert = false;
    global.ClozkyScroll.lock();
    panel.querySelector('.cart-close').focus({ preventScroll: true });
  }

  function cerrar() {
    if (!panel.classList.contains('open')) return;
    panel.classList.remove('open');
    dim.classList.remove('on');
    panel.setAttribute('aria-hidden', 'true');
    panel.inert = true;
    global.ClozkyScroll.unlock();
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  function irAPagar() {
    var cart = Cart.read();
    if (!cart.length) return;
    /* Meta Pixel: inicio de pago (Purchase sólo se dispara con pago aprobado) */
    if (global.fbq) {
      global.fbq('track', 'InitiateCheckout', {
        content_ids: cart.map(function (i) { return FICHAS[i.productId] && FICHAS[i.productId].catalogId; }).filter(Boolean),
        content_type: 'product',
        num_items: Cart.count(cart),
        value: Cart.total(cart),
        currency: 'COP'
      });
    }
    global.location.href = 'checkout.html';
  }

  montar();

  /* Ícono del header y cualquier enlace marcado con data-bolsa-open.
     Los enlaces conservan href="checkout.html" por si este script falla. */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('.cartbtn, [data-bolsa-open]');
    if (!t) return;
    e.preventDefault();
    abrir();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') cerrar();
  });

  global.ClozkyBolsa = { abrir: abrir, cerrar: cerrar };
})(window);
