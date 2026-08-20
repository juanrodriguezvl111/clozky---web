const crypto = require('crypto');

const SUPABASE_URL = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Wompi usa el "Secreto de Eventos" para firmar webhooks (≠ Secreto de Integridad)
const WOMPI_SECRET = process.env.WOMPI_EVENTOS_SECRET;

// La firma debe cubrir al menos estos campos. Si el payload declara otra lista,
// el checksum podría ser válido sin proteger el monto ni el estado.
const FIRMADAS_MIN = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'];
const VENTANA_SEG  = 300;   // eventos de más de 5 minutos se rechazan

// Navega objetos anidados: "data.transaction.id" → valor real
function deepGet(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
}

/* Compara sin filtrar información por tiempo de ejecución. */
function mismoChecksum(a, b) {
    const A = Buffer.from(String(a), 'utf8');
    const B = Buffer.from(String(b), 'utf8');
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
    if (FIRMADAS_MIN.some(p => !recibidas.includes(p))) {
        console.error('Webhook rechazado: la firma no cubre los campos requeridos');
        return { statusCode: 401, body: 'Unauthorized' };
    }

    // Sin ventana temporal, un evento legítimo capturado se reenvía para siempre.
    const edad = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(edad) || edad > VENTANA_SEG) {
        console.error(`Webhook rechazado: fuera de ventana temporal (${edad}s)`);
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const cadena = [...recibidas.map(p => deepGet(payload, p)), timestamp, WOMPI_SECRET].join('');
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
            console.log(`Pedido ${ref} no encontrado o ya procesado`);
            return { statusCode: 200, body: 'OK' };
        }
        const pedido = pedidos[0];

        // El monto cobrado debe ser exactamente el del pedido (evita pagos parciales)
        if (Number(tx.amount_in_cents) !== Number(pedido.total) * 100) {
            console.error(`Monto incorrecto en ${ref}: cobrado ${tx.amount_in_cents}, esperado ${pedido.total * 100}`);
            await api(`pedidos?${eq('referencia', ref)}`, 'PATCH', { estado: 'revisar', wompi_id: tx.id });
            return { statusCode: 200, body: 'OK' };
        }

        /* ── Tomar el pedido de forma exclusiva ──
           El PATCH sólo aplica si sigue en 'pendiente'. Si Wompi reintenta el
           webhook (lo hace), el segundo no encuentra filas y sale sin tocar stock. */
        const tomado = await api(
            `pedidos?${eq('referencia', ref)}&${eq('estado', 'pendiente')}`,
            'PATCH',
            { estado: 'pagado', wompi_id: tx.id },
            'return=representation',
        );
        if (!tomado?.length) {
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

        if (problemas.length) {
            console.error(`Pedido ${ref} pagado pero con problemas de stock: ${problemas.join(' | ')}`);
            await api(`pedidos?${eq('referencia', ref)}`, 'PATCH', { estado: 'revisar' });
        } else {
            console.log(`Pedido ${ref} completado`);
        }
    } catch (err) {
        console.error('Error procesando webhook:', err);
        // 500 hace que Wompi reintente; el pedido ya tomado no se procesa dos veces.
        return { statusCode: 500, body: 'Error interno' };
    }

    return { statusCode: 200, body: 'OK' };
};
