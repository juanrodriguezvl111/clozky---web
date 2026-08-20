/* ============================================================
   PRUEBAS DEL WEBHOOK DE WOMPI
   Se corren sin dependencias:   node netlify/functions/__tests__/wompi-webhook.test.js

   IMPORTANTE — leer antes de tocar `evento()`:
   El evento se construye EXACTAMENTE como lo manda Wompi, y eso es el valor
   de este archivo. Una versión anterior de estas pruebas construía la firma
   como la esperaba el código (rutas contra la raíz, checksum en minúscula) y
   por eso los 13 casos pasaban mientras el webhook rechazaba el 100% de los
   eventos reales. Si algún día hay que "ajustar" `evento()` para que un test
   pase, el que está mal es el código.

   Formato real (https://docs.wompi.co/docs/colombia/eventos/):
     - `signature.properties` son rutas relativas a `data`, no a la raíz:
       "transaction.id" significa data.transaction.id
     - la cadena es: valores en orden + timestamp + secreto de eventos
     - `signature.checksum` viene en hexadecimal MAYÚSCULA
   ============================================================ */
process.env.SUPABASE_SERVICE_KEY = 'test_service';
process.env.WOMPI_EVENTOS_SECRET = 'prod_events_SECRETO_DE_PRUEBA';

const crypto = require('crypto');
const path   = require('path');

// ── Supabase de mentira: dos tablas en memoria con filtros PostgREST reales ──
let DB, escriturasStock;
function reset() {
    DB = {
        pedidos: [{
            referencia: 'CLZKY-ABC', estado: 'pendiente', total: 2320,
            items: [{ productId: 2, name: 'No Grace', size: 'M', qty: 1 }],
        }],
        inventario: [{ producto_id: 2, talla: 'M', stock: 1 }],
    };
    escriturasStock = 0;
}

global.fetch = async (u, o) => {
    const url   = new URL(u);
    const tabla = url.pathname.split('/').pop();
    const filtros = [...url.searchParams.entries()]
        .filter(([c]) => c !== 'select')
        .map(([c, v]) => [c, decodeURIComponent(v.replace(/^eq\./, ''))]);
    const filas = DB[tabla].filter(f => filtros.every(([c, v]) => String(f[c]) === v));

    if (o.method === 'PATCH') {
        if (tabla === 'inventario') escriturasStock++;
        const cambio = JSON.parse(o.body);
        filas.forEach(f => Object.assign(f, cambio));
    }
    return { ok: true, status: 200, json: async () => filas, text: async () => '' };
};

const { handler } = require(path.join(__dirname, '..', 'wompi-webhook.js'));

/* Construye un evento con el formato REAL de Wompi. */
function evento({
    ref = 'CLZKY-ABC', status = 'APPROVED', cents = 232000,
    ts = Math.floor(Date.now() / 1000),
    props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'],
    secreto = 'prod_events_SECRETO_DE_PRUEBA',
    romperFirma = false, minuscula = false,
} = {}) {
    const data = {
        transaction: { id: 'tx1', status, reference: ref, amount_in_cents: cents },
    };
    // Las rutas se resuelven DENTRO de `data`
    const valores = props.map(p => p.split('.').reduce((o, k) => o?.[k], data));
    const cadena  = [...valores, ts, secreto].join('');
    let checksum  = crypto.createHash('sha256').update(cadena).digest('hex').toUpperCase();
    if (minuscula)   checksum = checksum.toLowerCase();
    if (romperFirma) checksum = '0'.repeat(64);

    return {
        httpMethod: 'POST',
        body: JSON.stringify({
            event: 'transaction.updated', data, environment: 'prod',
            signature: { properties: props, checksum }, timestamp: ts,
            sent_at: new Date(ts * 1000).toISOString(),
        }),
    };
}

// ── Corredor ──
let pasan = 0, fallan = 0;
const silencio = { log: console.log, error: console.error, warn: console.warn };
async function t(nombre, fn) {
    reset();
    console.log = console.error = console.warn = () => {};
    let ok = false, err = null;
    try { ok = await fn(); } catch (e) { err = e; }
    Object.assign(console, silencio);
    if (ok) { pasan++; console.log('  PASA   ' + nombre); }
    else    { fallan++; console.log('  FALLA  ' + nombre + (err ? ' :: ' + err.message : '')); }
}

(async () => {
    console.log('\n── WEBHOOK DE WOMPI ──');

    await t('REGRESIÓN: un evento con el formato REAL de Wompi se acepta', async () => {
        const r = await handler(evento());
        return r.statusCode === 200 && DB.pedidos[0].estado === 'pagado';
    });

    await t('REGRESIÓN: checksum en minúscula también se acepta', async () =>
        (await handler(evento({ minuscula: true }))).statusCode === 200 &&
        DB.pedidos[0].estado === 'pagado');

    await t('REGRESIÓN: rutas con prefijo "data." también se resuelven', async () => {
        const p = ['data.transaction.id', 'data.transaction.status', 'data.transaction.amount_in_cents'];
        // se firma con las rutas ya recortadas, que es lo que Wompi haría
        const ts = Math.floor(Date.now() / 1000);
        const data = { transaction: { id: 'tx1', status: 'APPROVED', reference: 'CLZKY-ABC', amount_in_cents: 232000 } };
        const valores = p.map(x => x.replace(/^data\./, '').split('.').reduce((o, k) => o?.[k], data));
        const checksum = crypto.createHash('sha256')
            .update([...valores, ts, 'prod_events_SECRETO_DE_PRUEBA'].join('')).digest('hex').toUpperCase();
        const r = await handler({ httpMethod: 'POST', body: JSON.stringify({
            data, timestamp: ts, signature: { properties: p, checksum } }) });
        return r.statusCode === 200 && DB.pedidos[0].estado === 'pagado';
    });

    await t('firma inválida → 401', async () =>
        (await handler(evento({ romperFirma: true }))).statusCode === 401);

    await t('secreto equivocado → 401', async () =>
        (await handler(evento({ secreto: 'otro' }))).statusCode === 401);

    await t('sin firma → 401', async () =>
        (await handler({ httpMethod: 'POST', body: '{}' })).statusCode === 401);

    await t('CN-005: firma que no cubre el monto → 401', async () =>
        (await handler(evento({ props: ['transaction.id'] }))).statusCode === 401);

    await t('CN-005: evento de hace 2 días → 401', async () =>
        (await handler(evento({ ts: Math.floor(Date.now() / 1000) - 172800 }))).statusCode === 401);

    await t('un reintento de 10 minutos SÍ se acepta (Wompi refirma con el ts original)', async () =>
        (await handler(evento({ ts: Math.floor(Date.now() / 1000) - 600 }))).statusCode === 200);

    await t('pago aprobado descuenta stock y marca pagado', async () => {
        await handler(evento());
        return DB.inventario[0].stock === 0 && DB.pedidos[0].estado === 'pagado';
    });

    await t('monto que no cuadra → no descuenta, marca revisar', async () => {
        await handler(evento({ cents: 100 }));
        return DB.inventario[0].stock === 1 && DB.pedidos[0].estado === 'revisar';
    });

    await t('pago DECLINED no toca nada', async () => {
        await handler(evento({ status: 'DECLINED' }));
        return DB.inventario[0].stock === 1 && DB.pedidos[0].estado === 'pendiente';
    });

    await t('reintento de Wompi no descuenta dos veces', async () => {
        await handler(evento());
        const tras1 = DB.inventario[0].stock;
        await handler(evento());
        await handler(evento());
        return tras1 === 0 && DB.inventario[0].stock === 0 && escriturasStock <= 2;
    });

    await t('CN-007: tres webhooks a la vez no sobrevenden', async () => {
        DB.inventario[0].stock = 1;
        await Promise.all([handler(evento()), handler(evento()), handler(evento())]);
        return DB.inventario[0].stock === 0 && DB.pedidos[0].estado === 'pagado';
    });

    await t('CN-007: stock insuficiente marca revisar y no baja a negativo', async () => {
        DB.pedidos[0].items[0].qty = 5; DB.inventario[0].stock = 2;
        await handler(evento());
        return DB.inventario[0].stock === 2 && DB.pedidos[0].estado === 'revisar';
    });

    await t('CN-001: talla envenenada no reescribe la consulta', async () => {
        DB.pedidos[0].items[0].size = 'M&stock=gt.0';
        await handler(evento());
        return DB.inventario[0].stock === 1 && DB.pedidos[0].estado === 'revisar';
    });

    await t('GET no permitido → 405', async () =>
        (await handler({ httpMethod: 'GET' })).statusCode === 405);

    console.log(`\n  webhook: ${pasan} pasan, ${fallan} fallan`);
    process.exit(fallan ? 1 : 0);
})();
