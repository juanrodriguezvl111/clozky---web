# Clozky Studios — Tienda online (PRODUCCIÓN)

Tienda e-commerce real de Clozky Studios (streetwear high-end, Colombia).
Nació del kit "web-scrolling" pero ya es una tienda en producción — **no** actuar
como asistente de creación de webs.

## Deploy y stack

- **Live:** https://tranquil-beignet-2ef138.netlify.app (Netlify, publish raíz)
- **Páginas:** `index.html` (hero → shop → brand → tiquete Gallery → instagram),
  `producto.html?p=<slug>`, `gallery.html`, `cambios.html`,
  `checkout.html`, `gracias.html`
- **Compartido:** `shell.css` (atmósfera + header + menú lateral),
  `shell.js` (menú + bloqueo de scroll), `cart.js` (carrito, fuente única)
- **Pagos:** Wompi PRODUCCIÓN (`pub_prod_...`). Firma server-side en
  `netlify/functions/create-payment.js`; confirmación en
  `netlify/functions/wompi-webhook.js` (auth obligatoria vía `WOMPI_EVENTOS_SECRET`)
- **Datos:** Supabase (`opcnglllvppfavjjpjkf`) — tabla `inventario` (stock por talla,
  fallback local en `inventario.js`) y pedidos
- **Env vars (Netlify):** `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTOS_SECRET`,
  `SUPABASE_SERVICE_KEY`
- **Meta:** Pixel web ADSM `2256599795114564` con eventos de catálogo, feed de
  6 productos (`catalogo-clozky-feed.csv`), deep-links por producto

## Productos (precios = fuente de verdad en create-payment.js)

| id | Producto | Precio COP |
|----|----------|-----------|
| 1 | Worthless Sacrifice | 260.000 |
| 2 | No Grace | 220.000 |
| 3 | Devil's F*cking Evil | 240.000 |

Envío: 12.000 — gratis desde 200.000.

## Reglas de trabajo

- Precios y montos SIEMPRE se validan en servidor, nunca confiar en el cliente.
- Evento Purchase del Pixel solo se dispara con pago APROBADO.
- Usar Pixel web ADSM real, NUNCA el App ID.
- Copy de marca: luxury no grita specs — nunca mencionar gramaje/serigrafía/calidad.

## Aprendizajes

- Umbral de envío gratis (200k) < producto más barato (220k) → el envío nunca
  se cobra. Verificar si es intencional antes de tocar precios.
- Imágenes ya comprimidas 94% (222MB → 12MB); no re-subir originales pesados.
- CORS y `SITE_URL` hardcodeados al subdominio de Netlify en `create-payment.js` —
  al migrar a dominio propio hay que actualizarlos.

## Rediseño "Effortless" (rama `rediseno-effortless`, sin desplegar)

Estado al 19 de agosto de 2026. **Nada de esto está en producción todavía.**

- **Identidad:** palabra ancla *effortless*; comunidad = **Effortless Boys**.
  "Only for the boss · only for you" queda solo para etiquetas físicas.
- **Fondo:** motion blur de larga exposición generado por CSS en `shell.css`
  (dos capas de gradiente desenfocadas + grano). Perilla global `--atmos-veil`
  (actual 0.38) sube o baja la oscuridad de todo el sitio.
- **Tipografía:** Inter en todo. Bebas Neue eliminada de las 6 páginas.
- **Header:** sin barra — hamburguesa, logo centrado, carrito. Menú lateral
  de vidrio con Best Seller / Gallery / Shop All / Lookbook.
- **Fotos de producto:** recortes con transparencia (`*-cut.webp`) hechos con
  Magnific `remove_background`. Los JPG originales quedan como respaldo.
  Los recortes van SIEMPRE con `object-fit: contain` y sin panel de fondo.
- **Sin pantalla de carga** y **sin cursor personalizado** (decisión del cliente).

## Aprendizajes

- Umbral de envío gratis (200k) < producto más barato (220k) → el envío nunca
  se cobra. Verificar si es intencional antes de tocar precios.
- Imágenes ya comprimidas 94% (222MB → 12MB); no re-subir originales pesados.
- CORS y `SITE_URL` hardcodeados al subdominio de Netlify en `create-payment.js` —
  al migrar a dominio propio hay que actualizarlos.
- El carrito es **`cart.js`**, no `localStorage` directo. Antes cada página
  escribía por su cuenta y ninguna leía de vuelta: el contador marcaba 0
  mientras el checkout tenía prendas. No volver a tocar `localStorage` a mano.
- `producto.html` lee stock real vía `inventario.js` → Supabase. No volver a
  escribir stock a mano en el catálogo del archivo: vendía tallas agotadas.
- Recorte con transparencia + `object-fit: cover` = prenda cortada. Siempre
  `contain`.
- Bloqueo de scroll: usar `window.ClozkyScroll.lock()/unlock()` (contador
  compartido). Tocar `body.style.overflow` directo rompe cuando hay dos
  capas abiertas.
- Magnific: `ultra-photo` es el único modo con creatividad cero (solo calidad).
  `creative` alucina detalle y no sirve para foto de producto real.

## Pendientes

- **RLS de Supabase — lo más urgente.** `pedidos` guarda correo, nombre,
  teléfono, cédula y dirección. La anon key es pública; solo RLS protege eso.
  Sin verificar (informe: `~/Desktop/cyber-neo-report-clozky-2026-08-19.md`).
- Corregir los 4 hallazgos altos del informe de seguridad (CN-001 a CN-004).
- Video del hero: `assets/hero.mp4`. El `<source>` está comentado en
  `index.html`; al añadir el archivo, descomentar.
- 101 MB de PNG sin referenciar en `assets/` que Netlify publica igual.
- Dominio propio (mejora confianza + verificación en Business Manager).
- Limpiar `screenshot-*.png` sin trackear (~5MB) y `.claude/worktrees/` residual.
