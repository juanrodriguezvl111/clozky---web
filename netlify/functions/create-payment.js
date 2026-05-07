const crypto = require('crypto');

const WOMPI_PUBLIC_KEY      = 'pub_prod_H2t4E7Bl53P5R2M9949Njdmtl6lIixkv';
const WOMPI_SECRET          = process.env.WOMPI_INTEGRITY_SECRET;
const SUPABASE_URL          = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY          = process.env.SUPABASE_SERVICE_KEY;
const SITE_URL              = 'https://tranquil-beignet-2ef138.netlify.app';

// Precios oficiales — fuente de verdad en el servidor
const PRECIOS = {
    1: 260000, // Worthless Sacrifice
    2: 220000, // No Grace
    3: 240000, // Devil's F*cking Evil
};
const ENVIO_COSTO  = 12000;
const ENVIO_GRATIS = 200000;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }
    if (!WOMPI_SECRET || !SUPABASE_KEY) {
        console.error('Variables de entorno faltantes');
        return { statusCode: 500, body: 'Configuración incompleta' };
    }

    let body;
    try { body = JSON.parse(event.body); }
    catch { return { statusCode: 400, body: 'JSON inválido' }; }

    const { items, cliente } = body;
    if (!Array.isArray(items) || !items.length || !cliente?.email) {
        return { statusCode: 400, body: 'Datos incompletos' };
    }

    // Validar precios server-side — ignorar precio del cliente
    let subtotal = 0;
    const itemsValidados = [];
    for (const item of items) {
        const precioReal = PRECIOS[item.productId];
        if (!precioReal) {
            return { statusCode: 400, body: `Producto inválido: ${item.productId}` };
        }
        const qty = Math.max(1, Math.min(10, parseInt(item.qty) || 1));
        subtotal += precioReal * qty;
        itemsValidados.push({
            productId: item.productId,
            name:      item.name,
            size:      item.size,
            qty,
            price:     precioReal, // precio del servidor, no del cliente
        });
    }

    const envio  = subtotal >= ENVIO_GRATIS ? 0 : ENVIO_COSTO;
    const total  = subtotal + envio;
    const cents  = total * 100;

    // Referencia única
    const ref = 'CLZKY-' + Date.now().toString(36).toUpperCase() + '-' +
                Math.random().toString(36).substr(2, 4).toUpperCase();

    // Firma de integridad — se computa en el servidor, nunca llega al cliente
    const integridad = crypto
        .createHash('sha256')
        .update(ref + cents + 'COP' + WOMPI_SECRET)
        .digest('hex');

    // Guardar pedido en Supabase
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/pedidos`, {
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
                cliente,
                total,
                estado:     'pendiente',
            }),
        });
    } catch(e) {
        console.error('Error guardando pedido:', e);
        // No bloquear el pago por un error de DB
    }

    // Construir URL de Wompi con todos los datos
    const url = new URL('https://checkout.wompi.co/p/');
    url.searchParams.set('public-key',           WOMPI_PUBLIC_KEY);
    url.searchParams.set('currency',             'COP');
    url.searchParams.set('amount-in-cents',      cents);
    url.searchParams.set('reference',            ref);
    url.searchParams.set('signature:integrity',  integridad);
    url.searchParams.set('redirect-url',         `${SITE_URL}/gracias.html`);
    url.searchParams.set('customer-data:email',          cliente.email || '');
    url.searchParams.set('customer-data:full-name',      cliente.nombre || '');
    url.searchParams.set('customer-data:phone-number',   cliente.telefono || '');
    url.searchParams.set('customer-data:legal-id',       cliente.cedula || '');
    url.searchParams.set('customer-data:legal-id-type',  'CC');
    url.searchParams.set('shipping-address:address-line-1', cliente.direccion || '');
    url.searchParams.set('shipping-address:city',           cliente.ciudad || '');
    url.searchParams.set('shipping-address:region',         cliente.depto || '');
    url.searchParams.set('shipping-address:country',        'CO');
    url.searchParams.set('shipping-address:phone-number',   cliente.telefono || '');

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': SITE_URL },
        body: JSON.stringify({ wompiUrl: url.toString(), reference: ref, total }),
    };
};
