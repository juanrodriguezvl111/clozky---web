const crypto = require('crypto');

const WOMPI_PUBLIC_KEY = 'pub_prod_H2t4E7Bl53P5R2M9949Njdmtl6lIixkv';
const WOMPI_SECRET     = process.env.WOMPI_INTEGRITY_SECRET;
const SUPABASE_URL     = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
/* De dónde sale la URL del sitio, en orden:
     1. SITE_URL   — defínela en Netlify cuando tengas dominio propio.
     2. URL        — la inyecta Netlify sola, con la URL real del sitio.
   El valor quemado quedó como último recurso, pero apunta a un subdominio que
   ya no existe: si se llegara a usar, Wompi devolvería al cliente a un 404
   después de pagar. Por eso `URL` va antes. */
const SITE_URL         = process.env.SITE_URL
                      || process.env.URL
                      || 'https://tranquil-beignet-2ef138.netlify.app';

// Catálogo oficial — nombre y precio salen de aquí, NUNCA del cliente
const PRODUCTOS = {
    1: { nombre: 'Worthless Sacrifice',  precio: 260000 },
    2: { nombre: 'No Grace',             precio: 220000 },
    3: { nombre: "Devil's F*cking Evil", precio: 240000 },
};
const TALLAS       = ['S', 'M', 'L', 'XL'];
const MAX_LINEAS   = 20;
// El envío se cobra SIEMPRE. Antes había envío gratis desde $200.000, pero la
// prenda más barata cuesta $220.000: el umbral quedaba por debajo del carrito
// mínimo y el envío no se cobraba nunca en ninguna compra.
const ENVIO_COSTO  = 20000;

const CORS = {
    'Access-Control-Allow-Origin':  SITE_URL,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const resp = (statusCode, body, json) => ({
    statusCode,
    headers: json ? { ...CORS, 'Content-Type': 'application/json' } : CORS,
    body: json ? JSON.stringify(body) : body,
});

/* ── Límite de tasa ──
   Por contenedor y en memoria: Netlify puede tener varios vivos a la vez, así
   que esto frena scripts torpes, no un ataque distribuido. La contención real
   está en validar todo lo que entra y en no dejar campos libres en la base. */
const GOLPES      = new Map();
const VENTANA_MS  = 60000;
const MAX_VENTANA = 25;   // los operadores móviles colombianos usan CGNAT:
                          // varios clientes reales comparten IP de salida.

function pasaLimite(clave) {
    const ahora = Date.now();
    const previos = (GOLPES.get(clave) || []).filter(t => ahora - t < VENTANA_MS);
    if (previos.length >= MAX_VENTANA) {
        GOLPES.set(clave, previos);   // no se apunta el golpe bloqueado:
        return false;                 // si no, el bloqueo se auto-alimenta.
    }
    previos.push(ahora);
    GOLPES.set(clave, previos);
    if (GOLPES.size > 5000) {
        // Purga selectiva: se van las ventanas ya vencidas, no todo el mapa.
        for (const [k, v] of GOLPES) {
            if (!v.some(t => ahora - t < VENTANA_MS)) GOLPES.delete(k);
        }
    }
    return true;
}

/* Lectura contra Supabase con la service key. Lanza si la respuesta no es OK:
   `fetch` no lanza solo en 4xx/5xx y un fallo silencioso aquí daría "hay stock". */
async function sbGet(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
        },
    });
    if (!res.ok) throw new Error(`Supabase GET ${path} → ${res.status}`);
    return res.json();
}

/* Normaliza un nombre de producto para compararlo: mayúsculas/minúsculas,
   apóstrofos tipográficos y espacios de más dejan de importar. */
const clave = (v) => String(v ?? '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/* Recorta a longitud fija y quita caracteres de control. */
const txt = (v, max) => String(v ?? '').replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, max);

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return resp(204, '');
    if (event.httpMethod !== 'POST')    return resp(405, 'Method Not Allowed');

    if (!WOMPI_SECRET || !SUPABASE_KEY) {
        console.error('Faltan variables de entorno: WOMPI_INTEGRITY_SECRET o SUPABASE_SERVICE_KEY');
        return resp(500, 'Configuración incompleta');
    }

    const ip = event.headers['x-nf-client-connection-ip']
            || (event.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || 'desconocida';

    let body;
    try { body = JSON.parse(event.body || ''); }
    catch { return resp(400, 'JSON inválido'); }

    const { items, cliente } = body || {};
    if (!Array.isArray(items) || !items.length) return resp(400, 'Carrito vacío');
    if (items.length > MAX_LINEAS)              return resp(400, 'Demasiados artículos');
    if (!cliente || typeof cliente !== 'object') return resp(400, 'Datos de envío incompletos');

    /* ── Cliente: esquema cerrado ──
       Sólo estos campos, con tope de longitud. Lo que llegue de más se descarta:
       la tabla `pedidos` no es un buzón abierto a lo que mande el navegador. */
    const clienteLimpio = {
        nombre:    txt(cliente.nombre, 120),
        email:     txt(cliente.email, 160).toLowerCase(),
        telefono:  txt(cliente.telefono, 20),
        cedula:    txt(cliente.cedula, 20),
        direccion: txt(cliente.direccion, 200),
        ciudad:    txt(cliente.ciudad, 80),
        depto:     txt(cliente.depto, 80),
    };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(clienteLimpio.email)) {
        return resp(400, 'Correo inválido');
    }
    if (!clienteLimpio.nombre || !clienteLimpio.direccion || !clienteLimpio.ciudad) {
        return resp(400, 'Datos de envío incompletos');
    }

    // Se cuenta por IP + correo: una IP compartida por CGNAT no puede dejar
    // fuera a otro cliente distinto que compra desde la misma red.
    if (!pasaLimite(ip + '|' + clienteLimpio.email)) {
        console.warn(`Límite de tasa alcanzado por ${ip}`);
        return resp(429, 'Demasiadas solicitudes. Espera un momento.');
    }

    /* ── Artículos: precio, nombre y talla los pone el servidor ── */
    let subtotal = 0;
    const itemsValidados = [];
    for (const item of items) {
        if (!item || typeof item !== 'object') return resp(400, 'Artículo inválido');

        // Carritos viejos guardaban productId nulo: se resuelve por nombre.
        // Hay que normalizar: la portada guarda el nombre en MAYÚSCULAS y
        // producto.html usa apóstrofo tipográfico (’) donde el catálogo usa '.
        let pid = Number(item.productId);
        if (!Number.isInteger(pid) || !PRODUCTOS[pid]) {
            const buscado = clave(item.name);
            const porNombre = Object.keys(PRODUCTOS)
                .find(k => clave(PRODUCTOS[k].nombre) === buscado);
            pid = porNombre ? Number(porNombre) : NaN;
        }
        const producto = PRODUCTOS[pid];
        if (!producto) return resp(400, 'Producto inválido');

        const size = txt(item.size, 4).toUpperCase();
        if (!TALLAS.includes(size)) return resp(400, 'Talla inválida');

        const qty = Math.max(1, Math.min(10, parseInt(item.qty, 10) || 1));
        subtotal += producto.precio * qty;

        itemsValidados.push({
            productId: pid,
            name:      producto.nombre,   // nombre del catálogo, no el del cliente
            size,                         // ya validado contra la lista blanca
            qty,
            price:     producto.precio,   // precio del servidor
        });
    }

    /* ── Stock real antes de cobrar ──
       inventario.js comprueba el stock en el navegador, pero eso es una pista
       de interfaz: una pestaña vieja o una compra simultánea la dejan obsoleta.
       Sin esto, el servidor firma y cobra una talla agotada, y el problema
       aparece en el webhook — con el dinero ya movido. */
    try {
        const pedido = new Map();   // "id|talla" → unidades pedidas
        for (const it of itemsValidados) {
            const k = `${it.productId}|${it.size}`;
            pedido.set(k, (pedido.get(k) || 0) + it.qty);
        }
        const ids  = [...new Set(itemsValidados.map(i => i.productId))].join(',');
        const filas = await sbGet(`inventario?select=producto_id,talla,stock&producto_id=in.(${ids})`);
        const hay = new Map((filas || []).map(f => [`${f.producto_id}|${f.talla}`, Number(f.stock) || 0]));

        for (const [k, piden] of pedido) {
            if ((hay.get(k) ?? 0) < piden) {
                const [, talla] = k.split('|');
                console.warn(`Sin stock para ${k}: piden ${piden}, hay ${hay.get(k) ?? 0}`);
                return resp(409, `Nos quedamos sin la talla ${talla}. Actualiza tu bolsa.`);
            }
        }
    } catch (e) {
        // Si el inventario no responde no se bloquea la venta: el guardado del
        // pedido, más abajo, sí falla en cerrado si Supabase está caído.
        console.error('No se pudo verificar stock, se continúa:', e.message);
    }

    const envio = ENVIO_COSTO;
    const total = subtotal + envio;
    const cents = total * 100;

    // Referencia impredecible: no debe poderse adivinar la de otro pedido.
    // Hexadecimal a propósito: base64url mete "_" y "-", y no está comprobado
    // que Wompi acepte "_". 9 bytes = 72 bits, de sobra.
    const ref = 'CLZKY-' + crypto.randomBytes(9).toString('hex').toUpperCase();

    // Firma de integridad — se computa en el servidor, nunca llega al cliente
    const integridad = crypto
        .createHash('sha256')
        .update(ref + cents + 'COP' + WOMPI_SECRET)
        .digest('hex');

    /* ── Guardar el pedido ANTES de mandar a pagar ──
       Si esto falla, no se devuelve URL de pago. Es preferible que el cliente
       reintente a que pague y no quede constancia de su pedido. */
    let guardado;
    try {
        guardado = await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
            method: 'POST',
            headers: {
                'apikey':        SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type':  'application/json',
                'Prefer':        'return=minimal',
            },
            body: JSON.stringify({
                referencia: ref,
                items:      itemsValidados,
                cliente:    clienteLimpio,
                total,
                estado:     'pendiente',
            }),
        });
    } catch (e) {
        console.error('Error de red guardando pedido:', e);
        return resp(503, 'No pudimos crear tu pedido. Intenta de nuevo.');
    }
    // fetch NO lanza en 4xx/5xx: un 403 de RLS pasaría silencioso sin este chequeo.
    if (!guardado.ok) {
        console.error('Supabase rechazó el pedido:', guardado.status, await guardado.text());
        return resp(503, 'No pudimos crear tu pedido. Intenta de nuevo.');
    }

    // URL de Wompi
    const url = new URL('https://checkout.wompi.co/p/');
    url.searchParams.set('public-key',          WOMPI_PUBLIC_KEY);
    url.searchParams.set('currency',            'COP');
    url.searchParams.set('amount-in-cents',     cents);
    url.searchParams.set('reference',           ref);
    url.searchParams.set('signature:integrity', integridad);
    url.searchParams.set('redirect-url',        `${SITE_URL}/gracias.html`);
    url.searchParams.set('customer-data:email',             clienteLimpio.email);
    url.searchParams.set('customer-data:full-name',         clienteLimpio.nombre);
    url.searchParams.set('customer-data:phone-number',      clienteLimpio.telefono);
    url.searchParams.set('customer-data:legal-id',          clienteLimpio.cedula);
    url.searchParams.set('customer-data:legal-id-type',     'CC');
    url.searchParams.set('shipping-address:address-line-1', clienteLimpio.direccion);
    url.searchParams.set('shipping-address:city',           clienteLimpio.ciudad);
    url.searchParams.set('shipping-address:region',         clienteLimpio.depto);
    url.searchParams.set('shipping-address:country',        'CO');
    url.searchParams.set('shipping-address:phone-number',   clienteLimpio.telefono);

    return resp(200, { wompiUrl: url.toString(), reference: ref, total }, true);
};
