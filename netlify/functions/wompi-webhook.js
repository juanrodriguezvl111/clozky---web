const crypto = require('crypto');

const SUPABASE_URL = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Wompi usa el "Secreto de Eventos" para firmar webhooks (≠ Secreto de Integridad)
const WOMPI_SECRET = process.env.WOMPI_EVENTOS_SECRET;

// La firma debe cubrir al menos estos campos. Si el payload declarara otra lista,
// el checksum podría ser válido sin proteger el monto ni el estado.
const FIRMADAS_MIN = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];

/* Ventana de frescura.
   Wompi firma el payload UNA vez: sus reintentos reenvían el mismo `timestamp`.
   Una ventana corta (5 min) haría que un reintento tras una caída de Supabase
   se rechazara para siempre, dejando el pedido cobrado y sin procesar. Quien
   aporta la protección contra replay no es esta ventana sino la toma exclusiva
   del pedido más abajo: un evento repetido no encuentra el pedido pendiente y
   sale sin tocar nada. Aquí solo se descartan payloads absurdamente viejos. */
const VENTANA_SEG = 86400;   // 24 h

// Navega objetos anidados: "transaction.id" → valor real
function deepGet(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
}

/* Las rutas de `signature.properties` son relativas a `data`, NO a la raíz.
   Wompi manda ["transaction.id", ...] y eso significa data.transaction.id.
   Resolverlas contra la raíz devuelve undefined en todas y el checksum jamás
   coincide: el webhook rechazaba el 100% de los eventos legítimos. */
const sinPrefijo = (p) => String(p).replace(/^data\./, '');
const valorFirmado = (payload, p) => deepGet(payload.data, sinPrefijo(p));

/* Compara sin filtrar información por tiempo de ejecución.
   Wompi entrega el checksum en hexadecimal MAYÚSCULA y Node lo genera en
   minúscula, así que se normalizan los dos lados antes de comparar. */
function mismoChecksum(a, b) {
    const A = Buffer.from(String(a).trim().toLowerCase(), 'utf8');
    const B = Buffer.from(String(b).trim().toLowerCase(), 'utf8');
    return A.length === B.length && crypto.timingSafeEqual(A, B);
}

async function api(path, method = 'GET', body, prefer = 'return=minimal') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: {
            'apikey':        SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type':  'application/json',
            'Prefer':        prefer,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        throw new Error(`Supabase ${method} ${path} → ${res.status} ${await res.text()}`);
    }
    if (prefer === 'return=minimal' && method !== 'GET') return true;
    return res.json();
}

/* Filtro PostgREST con el valor codificado.
   Sin esto, un `size` con "&" o "=" reescribe la consulta entera. */
const eq = (col, val) => `${col}=eq.${encodeURIComponent(String(val))}`;

/* ── Descuento atómico por comparación-e-intercambio ──
   Leer, restar en JS y escribir permite que dos webhooks simultáneos vendan
   la misma última unidad. Aquí el PATCH sólo aplica si el stock sigue siendo
   el que se leyó; si otro lo cambió, Supabase devuelve 0 filas y se reintenta. */
async function descontar(productoId, talla, qty) {
    for (let intento = 0; intento < 4; intento++) {
        const filas = await api(`inventario?${eq('producto_id', productoId)}&${eq('talla', talla)}`);
        if (!filas?.length) return { ok: false, motivo: 'talla inexistente' };

        const actual = Number(filas[0].stock) || 0;
        if (actual < qty) return { ok: false, motivo: `stock insuficiente (${actual} < ${qty})` };

        const aplicado = await api(
            `inventario?${eq('producto_id', productoId)}&${eq('talla', talla)}&${eq('stock', actual)}`,
            'PATCH',
            { stock: actual - qty },
            'return=representation',
        );
        if (aplicado?.length) return { ok: true, antes: actual, ahora: actual - qty };
        // Otro proceso ganó la carrera: releer y volver a intentar.
    }
    return { ok: false, motivo: 'demasiada contención' };
}

/* Cambia el estado sólo si el pedido está en el estado esperado.
   Devuelve la fila si el cambio se aplicó, o null si otro proceso se adelantó. */
async function cambiarEstado(ref, desde, cambios) {
    const filas = await api(
        `pedidos?${eq('referencia', ref)}&${eq('estado', desde)}`,
        'PATCH',
        cambios,
        'return=representation',
    );
    return filas?.length ? filas[0] : null;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    if (!WOMPI_SECRET || !SUPABASE_KEY) {
        console.error('Faltan variables de entorno: WOMPI_EVENTOS_SECRET o SUPABASE_SERVICE_KEY');
        return { statusCode: 500, body: 'Server Error' };
    }

    let payload;
    try { payload = JSON.parse(event.body || ''); }
    catch { return { statusCode: 400, body: 'Bad Request' }; }

    // ── Verificar firma de Wompi — OBLIGATORIA ──
    const { signature, timestamp } = payload || {};
    if (!signature?.checksum) {
        console.error('Webhook rechazado: sin firma');
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const recibidas = Array.isArray(signature.properties) ? signature.properties : [];
    const normalizadas = recibidas.map(sinPrefijo);
    if (FIRMADAS_MIN.some(p => !normalizadas.includes(p))) {
        console.error('Webhook rechazado: la firma no cubre los campos requeridos',
                      JSON.stringify(recibidas));
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const edad = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(edad) || edad > VENTANA_SEG) {
        console.error(`Webhook rechazado: fuera de ventana temporal (${Math.round(edad)}s)`);
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const cadena = [
        ...recibidas.map(p => valorFirmado(payload, p)),
        timestamp,
        WOMPI_SECRET,
    ].join('');
    const esperado = crypto.createHash('sha256').update(cadena).digest('hex');
    if (!mismoChecksum(esperado, signature.checksum)) {
        console.error('Webhook rechazado: firma inválida');
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const tx = payload.data?.transaction;
    if (!tx || tx.status !== 'APPROVED') {
        return { statusCode: 200, body: 'OK' };
    }

    const ref = String(tx.reference || '');
    if (!ref) return { statusCode: 200, body: 'OK' };
    console.log(`Procesando pedido aprobado: ${ref}`);

    try {
        const pedidos = await api(`pedidos?${eq('referencia', ref)}&${eq('estado', 'pendiente')}`);
        if (!pedidos?.length) {
            // Decir POR QUÉ no está pendiente. Un pedido atascado en 'procesando'
            // es uno que murió a mitad del descuento y hay que terminar a mano.
            const otros = await api(`pedidos?${eq('referencia', ref)}&select=estado`);
            const estado = otros?.[0]?.estado;
            if (estado === 'procesando') {
                console.error(`Pedido ${ref} atascado en 'procesando': COBRADO y sin terminar de descontar stock. Revisar a mano.`);
            } else {
                console.log(`Pedido ${ref} no procesado: estado actual = ${estado ?? 'no existe'}`);
            }
            return { statusCode: 200, body: 'OK' };
        }
        const pedido = pedidos[0];

        // El monto cobrado debe ser exactamente el del pedido (evita pagos parciales).
        // `reference` no va firmado por Wompi: esta comprobación es la que impide
        // que alguien reutilice un evento válido apuntando a otro pedido.
        if (Number(tx.amount_in_cents) !== Number(pedido.total) * 100) {
            console.error(`Monto incorrecto en ${ref}: cobrado ${tx.amount_in_cents}, esperado ${pedido.total * 100}`);
            await cambiarEstado(ref, 'pendiente', { estado: 'revisar', wompi_id: tx.id });
            return { statusCode: 200, body: 'OK' };
        }

        /* ── Tomar el pedido en exclusiva, en dos pasos ──
           Primero 'procesando', y sólo al final 'pagado'. Si la función muere a
           mitad del descuento de stock, el pedido queda visible en 'procesando'
           en vez de aparentar estar completo: un pedido a medias se puede buscar
           y terminar a mano. Marcarlo 'pagado' de entrada escondía ese fallo. */
        const tomado = await cambiarEstado(ref, 'pendiente', { estado: 'procesando', wompi_id: tx.id });
        if (!tomado) {
            console.log(`Pedido ${ref} ya lo tomó otra ejecución`);
            return { statusCode: 200, body: 'OK' };
        }

        // Descontar stock. Nada de fallar en silencio: lo que no cuadre se marca.
        const problemas = [];
        for (const item of (pedido.items || [])) {
            if (!item?.productId || !item?.size || !item?.qty) {
                problemas.push('artículo incompleto');
                continue;
            }
            const r = await descontar(item.productId, item.size, item.qty);
            if (r.ok) {
                console.log(`Stock ${item.productId}/${item.size}: ${r.antes} → ${r.ahora}`);
            } else {
                problemas.push(`${item.productId}/${item.size}: ${r.motivo}`);
            }
        }

        const final = problemas.length ? 'revisar' : 'pagado';
        await cambiarEstado(ref, 'procesando', { estado: final });
        if (problemas.length) {
            console.error(`Pedido ${ref} COBRADO pero requiere revisión: ${problemas.join(' | ')}`);
        } else {
            console.log(`Pedido ${ref} completado`);
        }
    } catch (err) {
        console.error('Error procesando webhook:', err);
        /* 500 para que Wompi reintente. El pedido quedará en 'procesando' o
           'pendiente'; en ninguno de los dos casos se descuenta stock dos veces,
           porque cada paso exige el estado previo exacto. */
        return { statusCode: 500, body: 'Error interno' };
    }

    return { statusCode: 200, body: 'OK' };
};
