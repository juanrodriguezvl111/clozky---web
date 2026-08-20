/* Bloqueo de scroll con contador: soporta varias capas abiertas a la vez.
   Sin esto, cerrar el menú devolvía el scroll aunque el visor siguiera abierto. */
(function (w) {
  var n = 0;
  w.ClozkyScroll = {
    lock: function () { if (n++ === 0) document.body.style.overflow = 'hidden'; },
    unlock: function () { if (n > 0 && --n === 0) document.body.style.overflow = ''; }
  };
})(window);

/* CLOZKY — shell: menú lateral + estado del header. */
(function () {
  var drawer = document.getElementById('drawer');
  var scrim  = document.getElementById('drawer-scrim');
  var burger = document.getElementById('burger');
  var hdr    = document.querySelector('.hdr');
  if (!drawer || !scrim || !burger) return;

  var lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    drawer.classList.add('is-open');
    scrim.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    burger.setAttribute('aria-expanded', 'true');
    window.ClozkyScroll.lock();
    var first = drawer.querySelector('a, button');
    if (first) first.focus({ preventScroll: true });
  }

  function close() {
    drawer.classList.remove('is-open');
    scrim.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    burger.setAttribute('aria-expanded', 'false');
    window.ClozkyScroll.unlock();
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  burger.addEventListener('click', open);
  scrim.addEventListener('click', close);
  document.querySelectorAll('[data-drawer-close]').forEach(function (el) {
    el.addEventListener('click', close);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) close();
  });

  /* Header: sombra sólo cuando ya se bajó */
  if (hdr) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        hdr.classList.toggle('is-scrolled', window.scrollY > 24);
        ticking = false;
      });
    }, { passive: true });
  }
})();
