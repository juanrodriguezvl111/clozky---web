const crypto = require('crypto');

const SUPABASE_URL     = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_KEY;
const WOMPI_SECRET     = process.env.WOMPI_INTEGRITY_SECRET;

// Navega objetos anidados: "data.transaction.id" → valor real
function deepGet(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
}

async function db(path, method = 'GET', body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (method === 'GET') return res.json();
    return res.ok;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let payload;
    try { payload = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: 'Bad Request' }; }

    // ── Verificar firma de Wompi — OBLIGATORIA ──
    const { signature, timestamp } = payload;
    if (!signature?.checksum) {
        console.error('Webhook rechazado: sin firma');
        return { statusCode: 401, body: 'Unauthorized' };
    }
    if (!WOMPI_SECRET) {
        console.error('WOMPI_INTEGRITY_SECRET no configurado');
        return { statusCode: 500, body: 'Server Error' };
    }
    const chain = [
        ...(signature.properties || []).map(p => deepGet(payload, p)),
        timestamp,
        WOMPI_SECRET,
    ].join('');
    const expected = crypto.createHash('sha256').update(chain).digest('hex');
    if (expected !== signature.checksum) {
        console.error('Firma inválida');
        return { statusCode: 401, body: 'Unauthorized' };
    }

    const tx = payload.data?.transaction;
    if (!tx || tx.status !== 'APPROVED') {
        return { statusCode: 200, body: 'OK' };
    }

    const ref = tx.reference;
    console.log(`Procesando pedido aprobado: ${ref}`);

    try {
        // Buscar pedido
        const pedidos = await db(`pedidos?referencia=eq.${ref}&estado=eq.pendiente`);
        if (!pedidos?.length) {
            console.log(`Pedido ${ref} no encontrado o ya procesado`);
            return { statusCode: 200, body: 'OK' };
        }

        const items = pedidos[0].items || [];

        // Descontar stock por cada ítem
        for (const item of items) {
            if (!item.productId || !item.size || !item.qty) continue;

            const stocks = await db(
                `inventario?producto_id=eq.${item.productId}&talla=eq.${item.size}`
            );
            if (stocks?.length) {
                const nuevoStock = Math.max(0, stocks[0].stock - item.qty);
                await db(
                    `inventario?producto_id=eq.${item.productId}&talla=eq.${item.size}`,
                    'PATCH',
                    { stock: nuevoStock }
                );
                console.log(`Stock ${item.productId}/${item.size}: ${stocks[0].stock} → ${nuevoStock}`);
            }
        }

        // Marcar pedido como pagado
        await db(`pedidos?referencia=eq.${ref}`, 'PATCH', {
            estado: 'pagado',
            wompi_id: tx.id,
        });

        console.log(`Pedido ${ref} completado`);
    } catch (err) {
        console.error('Error procesando webhook:', err);
        return { statusCode: 500, body: 'Error interno' };
    }

    return { statusCode: 200, body: 'OK' };
};
