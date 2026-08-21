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

Envío: 20.000, se cobra siempre (no hay envío gratis).

## Reglas de trabajo

- Precios y montos SIEMPRE se validan en servidor, nunca confiar en el cliente.
- Evento Purchase del Pixel solo se dispara con pago APROBADO.
- Usar Pixel web ADSM real, NUNCA el App ID.
- Copy de marca: luxury no grita specs — nunca mencionar gramaje/serigrafía/calidad.

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

- El envío cuesta 20.000 y se cobra SIEMPRE (decidido el 20 de agosto de 2026).
  Antes era 12.000 con envío gratis desde 200.000, pero la prenda más barata
  cuesta 220.000: el umbral quedaba por debajo del carrito mínimo y el envío
  no se cobraba nunca. Vive en tres sitios: `create-payment.js` (manda),
  `checkout.html` (solo muestra) y el texto de `cambios.html`.
- Imágenes ya comprimidas 94% (222MB → 12MB); no re-subir originales pesados.
- `SITE_URL` sale de variable de entorno en `create-payment.js` (con el
  subdominio de Netlify como respaldo). Migrar a dominio propio = definir
  `SITE_URL` en Netlify, sin tocar código. Rige también el CORS.
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
- **`fetch` no lanza excepción en 4xx/5xx.** Un `try/catch` alrededor de una
  escritura a Supabase no detecta un 403 de RLS: pasa como si hubiera ido bien.
  Hay que comprobar `res.ok` a mano. Este era el bug que dejaba cobrar sin pedido.
- El descuento de stock se hace por comparación-e-intercambio: se relee y el
  PATCH lleva `stock=eq.<valor leído>`. Si otro proceso ganó, PostgREST devuelve
  0 filas y se reintenta. Leer-restar-escribir sobrevende.
- Wompi reintenta los webhooks. El pedido se toma en exclusiva con un PATCH
  filtrado por `estado=eq.pendiente` y `return=representation`: el segundo
  webhook no encuentra filas y sale sin tocar el stock.
- Las fotos de la sala son verticales y el marco usa `object-fit: cover`.
  Un formato horizontal (`cuadro`, `paisaje`) les corta cabeza o pies:
  solo `alto` (4:5), `retrato` (3:4) y `panel` (2:3).
- Los PNG de origen (>100 MB) viven en `_fuentes/`, ignorada por git y fuera
  del deploy. `assets/` solo lleva lo que alguna página referencia de verdad.
- **Wompi, firma de eventos:** las rutas de `signature.properties` son
  relativas a `data`, NO a la raíz del payload — `"transaction.id"` significa
  `data.transaction.id`. Y el checksum llega en hexadecimal MAYÚSCULA, mientras
  `digest('hex')` de Node lo da en minúscula. Fallar cualquiera de las dos hace
  que el webhook devuelva 401 a todos los eventos legítimos, en silencio.
- **Wompi, redirección:** al volver del checkout solo manda `?id=<transaccion>`.
  No existe `payment-status` ni `status`. El estado hay que pedirlo a
  `https://production.wompi.co/v1/transactions/<id>` (lectura pública).
- **Una prueba que construye el payload como lo espera tu código no prueba
  nada.** Los 13 casos del webhook estaban en verde mientras rechazaba el 100%
  de los eventos reales, porque la prueba imitaba el bug. El formato de un
  tercero se copia de su documentación, o se captura de un evento real.
- **Supabase Free pausa el proyecto tras 7 días sin actividad**, y con la base
  pausada el checkout devuelve 503: no se vende, sin aviso. Pasó el 20 de
  agosto de 2026. Mitigación sin pagar: `.github/workflows/mantener-viva-la-base.yml`
  consulta la base a diario. GitHub desactiva los cron si el repo pasa 60 días
  sin commits — avisa por correo, y se reactiva desde la pestaña Actions.
- Netlify Free (2026) son 300 créditos/mes: ~15 GB de tráfico y ~20 despliegues
  de producción, con tope duro. Al agotarse **se apagan las funciones**, o sea
  el checkout. Vercel Hobby da más, pero prohíbe el uso comercial: una tienda
  que cobra viola sus términos. Por eso se queda en Netlify.
- El limitador de tasa no debe contar los intentos que bloquea: si los cuenta,
  el bloqueo se auto-alimenta y nunca expira. Y contar solo por IP deja fuera a
  clientes reales, porque el móvil colombiano va por CGNAT: la clave es
  IP+correo.
- **Orden de scripts: los `<script src>` compartidos van ANTES del `<script>`
  en línea que los usa.** Pasó dos veces con el mismo síntoma: fallo silencioso.
  · `cart.js` después del `init()` del checkout → la bolsa salía vacía.
  · `inventario.js` en la línea 511 de `producto.html` mientras el código lo
    llamaba en la 391 → `typeof sincronizarInventario === 'function'` daba
    false, la guarda lo saltaba sin avisar y la página vendía tallas agotadas
    con la tabla quemada del archivo.
  · `cart.js` con `defer` en `index.html` mientras la línea 1333 hacía
    `let cart = ClozkyCart.read()` → el carrito local arrancaba vacío, pero el
    `paint()` de cart.js sí pintaba el contador leyendo localStorage: el badge
    decía 1 y la bolsa se abría vacía.
  Una guarda `typeof x === 'function'` o un `window.X ? ... : []` convierten un
  error de orden en un bug invisible. Si el script es obligatorio, cárgalo antes.
- **Cuidado con `aspect-ratio` en capas que cambian de `position` en móvil.**
  `.product-hover-layer` lleva `aspect-ratio:4/5` porque en escritorio va
  superpuesta sobre la foto. En móvil pasa a `position:static` y ese ratio la
  inflaba a ~490px de alto para un botón de 50px: 250px de hueco negro por
  prenda. La regla vivía más abajo en la hoja que el bloque `@media`, así que
  ganaba por orden — hubo que acotarla con `@media (min-width:901px)`, no
  sobrescribirla desde el bloque móvil.
- El hero usa una foto cuadrada con `object-fit:cover`. En pantallas verticales
  el recorte es HORIZONTAL, no vertical: ahí manda la X de `object-position`,
  no la Y. Con `center` la cabeza del modelo quedaba pegada al borde; al 30%
  entra con aire. En escritorio no hay recorte horizontal y no le afecta.
- Las pruebas viven en `netlify/functions/__tests__/`, sin dependencias:
  `sh netlify/functions/__tests__/correr.sh`.
- El navegador headless de gstack (`browse.exe`) está bloqueado por App Control
  de Windows en esta máquina. Para capturas: Edge headless
  (`msedge.exe --headless=new --screenshot=...`). Con ventanas muy altas
  (3600px) el IntersectionObserver no alcanza a marcar las piezas y la captura
  sale en blanco: usar alturas normales (~1000px).

## Pendientes

- **RLS de Supabase — COMPROBADO el 20 de agosto de 2026, hay agujero.**
  Con la clave pública anónima:
  · `pedidos` acepta INSERT. Confirmado: el error es 23502 (NOT NULL de
    `items`), no 42501 ni "permission denied" — o sea que la autorización
    pasó y solo lo frenó una restricción de esquema. Cualquiera puede llenar
    la tabla de pedidos falsos.
  · `pedidos` en SELECT devuelve 0 filas, pero la tabla está vacía: eso NO
    distingue entre "RLS te filtra" y "no hay nada". Dado que el INSERT sí
    está concedido, lo más probable es que el SELECT también.
  · `inventario` en escritura: BLOQUEADO. Confirmado con un PATCH sobre una
    fila existente y `Prefer: return=representation` → devuelve `[]`, la
    escritura no se aplicó. El stock está a salvo.
  · `inventario` en lectura: abierto, y es intencional.
  Ejecutar `supabase-seguridad.sql` cierra los dos casos de `pedidos`.
- `estado` en `pedidos` NO es un enum: acepta cualquier texto en los filtros.
  Descartado el bloqueo más probable para los valores `procesando` y
  `revisar`. Podría quedar un CHECK; la consulta está en el SQL, sección 5.
- Confirmar en Netlify que existen `WOMPI_INTEGRITY_SECRET`,
  `WOMPI_EVENTOS_SECRET` y `SUPABASE_SERVICE_KEY`.
- Comprobar que la columna `estado` de `pedidos` acepta los cuatro valores:
  `pendiente`, `procesando`, `pagado`, `revisar`. Si hay CHECK o enum que no
  los incluya, el webhook devolverá 500 y Wompi reintentará en bucle. Las
  consultas para verificarlo están en `supabase-seguridad.sql`, sección 5.
- **Hacer un pedido real de prueba** en cuanto el RLS esté puesto. Los tres
  bugs de Wompi eran invisibles desde el código: solo un pago de verdad
  confirma que el pedido pasa a `pagado`, el stock baja y el Pixel registra
  Purchase.
- Video del hero: `assets/hero.mp4`. El `<source>` está comentado en
  `index.html`; al añadir el archivo, descomentar.
- Dominio propio (mejora confianza + verificación en Business Manager).
  Al hacerlo, definir `SITE_URL` en Netlify.
- Peso: la portada bajó de 11,6 MB a 7,3 MB por visita nueva. Sigue alta para
  15 GB/mes. `producto.html` está en 9,7 MB. Bajarlas multiplica lo que
  aguanta el plan gratis.
- Desplegar: la rama `rediseno-effortless` sigue sin subir a producción.
