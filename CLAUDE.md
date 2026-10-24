# Proyecto: Página web Clozky — tienda en producción

Tienda e-commerce **real y en producción** de Clozky Studios (streetwear high-end, Colombia). Nació del kit "web-scrolling", pero **no** se actúa como asistente de creación de webs: es una tienda que cobra dinero de verdad.

## Fuente única de verdad
Este `CLAUDE.md` + la carpeta `reglas/`. No hay wiki, no hay Obsidian y no uso memoria interna para este proyecto.
- `_archivo/` = material viejo (wiki, CLAUDE.md anterior). **No se lee ni se usa** salvo que Juan lo pida.
- Cuando Juan apruebe, corrija o decida algo: se escribe en el momento en el archivo de `reglas/` que corresponde, **reemplazando** la regla vieja. Fechas absolutas.
- Si una regla nueva choca con una existente: gana la más reciente, se borra la vieja y se le avisa a Juan.
- **Netlify publica la raíz del repo**: todo archivo versionado queda público en la web. Por eso `reglas/` y `_archivo/` están en `.gitignore` y este `CLAUDE.md` no lleva detalles de seguridad. Nada sensible va a un archivo versionado.

## Lo activo
- **Live**: https://clozkygallery.netlify.app (Netlify, publish en la raíz, deploy automático desde GitHub `main`). El subdominio viejo `tranquil-beignet-2ef138.netlify.app` ya no existe (404).
- **Pagos**: Wompi PRODUCCIÓN. Firma server-side en `netlify/functions/create-payment.js`; confirmación en `netlify/functions/wompi-webhook.js` con auth obligatoria.
- **Datos**: Supabase (tablas `inventario` y `pedidos`).
- **Productos** (precios = fuente de verdad en `create-payment.js`): Worthless Sacrifice $260.000 · No Grace $220.000 · Devil's F*cking Evil $240.000. Envío $20.000, se cobra siempre.
- **Rama `rediseno-effortless`** (estado al 2026-08-19): sin desplegar. Ver `reglas/rediseno-effortless.md`.
- Pendientes abiertos (seguridad, pedido de prueba, dominio propio, peso): `reglas/seguridad-y-pendientes.md`.

## Reglas de trabajo
1. **Precios y montos SIEMPRE se validan en servidor.** Nunca confiar en el cliente.
2. **El evento Purchase del Pixel solo se dispara con pago APROBADO.**
3. **Pixel web ADSM real** (`2256599795114564`), NUNCA el App ID.
4. **Copy de marca**: el lujo no grita specs. Nunca mencionar gramaje, serigrafía ni "calidad".
5. El carrito es `cart.js` (fuente única) y el stock lo lee `inventario.js` desde Supabase: nunca `localStorage` a mano ni stock quemado en el HTML.
6. **No hacer push sin visto bueno de Juan**: push a `main` = despliegue a producción de una tienda que cobra.

## Qué leer antes de qué
| Antes de… | Leer |
|---|---|
| Tocar pagos, webhook, stock o funciones | `reglas/pagos-y-arquitectura.md` |
| Tocar HTML, CSS o JS del front | `reglas/front-y-operacion.md` |
| Tocar Supabase, RLS o vigilancia | `reglas/seguridad-y-pendientes.md` |
| Tocar diseño, header o tipografía | `reglas/rediseno-effortless.md` |

## Comandos
- Pruebas (sin dependencias, solo Node): `sh netlify/functions/__tests__/correr.sh`
- Capturas: Edge headless (`msedge.exe --headless=new --screenshot=...`) con alturas normales (~1000 px). El `browse.exe` de gstack está bloqueado por App Control de Windows en esta máquina.
- Deploy: push a GitHub `main` → Netlify. Solo con visto bueno de Juan.

## Cómo entrego
- Cambios con pruebas corridas y su salida. Un cambio en pagos no se da por bueno sin un pago real de prueba.
- Antes de entregar al cliente, pasar por el subagente `revisor`.
