/* ============================================================
   PRUEBAS DE create-payment
   Sin dependencias:   node netlify/functions/__tests__/create-payment.test.js

   Cada llamada usa una IP distinta a propósito: el limitador de tasa cuenta
   por IP+correo y si no, las propias pruebas se auto-bloquearían.
   ============================================================ */
process.env.WOMPI_INTEGRITY_SECRET = 'test_integridad';
process.env.SUPABASE_SERVICE_KEY   = 'test_service';

const path = require('path');

// ── Supabase de mentira ──
let pedidoGuardado = null;
let respuestaInsert = { ok: true, status: 201, text: async () => '' };
let INVENTARIO = [
    { producto_id: 1, talla: 'S', stock: 0 }, { producto_id: 1, talla: 'M', stock: 5 },
    { producto_id: 1, talla: 'L', stock: 2 }, { producto_id: 1, talla: 'XL', stock: 0 },
    { producto_id: 2, talla: 'S', stock: 1 }, { producto_id: 2, talla: 'M', stock: 5 },
    { producto_id: 2, talla: 'L', stock: 4 }, { producto_id: 2, talla: 'XL', stock: 0 },
    { producto_id: 3, talla: 'S', stock: 1 }, { producto_id: 3, talla: 'M', stock: 4 },
    { producto_id: 3, talla: 'L', stock: 7 }, { producto_id: 3, talla: 'XL', stock: 1 },
];

global.fetch = async (u, o = {}) => {
    if ((o.method || 'GET') === 'GET') {
        return { ok: true, status: 200, json: async () => INVENTARIO, text: async () => '' };
    }
    pedidoGuardado = JSON.parse(o.body);
    return respuestaInsert;
};

const { handler } = require(path.join(__dirname, '..', 'create-payment.js'));

const cliOK = {
    nombre: 'Juan Pérez', email: 'j@x.com', telefono: '3001234567', cedula: '1020',
    direccion: 'Cra 7 # 12-34, apto 501', ciudad: 'Bogotá', depto: 'Cundinamarca',
};
let n = 0;
const call = (items, cliente = cliOK, ip = null) => handler({
    httpMethod: 'POST',
    headers: { 'x-nf-client-connection-ip': ip || `10.0.${++n}.1` },
    body: JSON.stringify({ items, cliente }),
});

let pasan = 0, fallan = 0;
const real = { log: console.log, error: console.error, warn: console.warn };
async function t(nombre, fn) {
    console.log = console.error = console.warn = () => {};
    let ok = false, err = null;
    try { ok = await fn(); } catch (e) { err = e; }
    Object.assign(console, real);
    if (ok) { pasan++; console.log('  PASA   ' + nombre); }
    else    { fallan++; console.log('  FALLA  ' + nombre + (err ? ' :: ' + err.message : '')); }
}

(async () => {
    console.log('\n── CREATE-PAYMENT ──');

    await t('el precio que manda el cliente se ignora', async () => {
        const r = await call([{ productId: 2, name: 'No Grace', size: 'M', qty: 1, price: 1 }]);
        return JSON.parse(r.body).total === 240000;   // 220.000 + 20.000 de envío
    });

    await t('el nombre que manda el cliente se ignora (usa catálogo)', async () => {
        await call([{ productId: 2, name: '<script>x</script>', size: 'M', qty: 1 }]);
        return pedidoGuardado.items[0].name === 'No Grace';
    });

    await t('CN-001: talla inyectada se rechaza', async () =>
        (await call([{ productId: 2, size: 'M&stock=gt.0', qty: 1 }])).statusCode === 400);

    await t('CN-001: talla válida se normaliza a mayúscula', async () => {
        await call([{ productId: 2, size: 'm', qty: 1 }]);
        return pedidoGuardado.items[0].size === 'M';
    });

    await t('CN-003: campos extra del cliente se descartan', async () => {
        await call([{ productId: 1, size: 'L', qty: 1 }], { ...cliOK, rol: 'admin', basura: 'x'.repeat(9999) });
        const c = pedidoGuardado.cliente;
        return !('rol' in c) && !('basura' in c) && Object.keys(c).length === 7;
    });

    await t('CN-003: la dirección conserva espacios, # y comas', async () => {
        await call([{ productId: 1, size: 'L', qty: 1 }]);
        return pedidoGuardado.cliente.direccion === 'Cra 7 # 12-34, apto 501';
    });

    await t('CN-003: nombre con ñ y tilde sobrevive', async () => {
        await call([{ productId: 1, size: 'L', qty: 1 }], { ...cliOK, nombre: 'Muñoz Peña' });
        return pedidoGuardado.cliente.nombre === 'Muñoz Peña';
    });

    await t('CN-003: correo inválido → 400', async () =>
        (await call([{ productId: 1, size: 'L', qty: 1 }], { ...cliOK, email: 'no-es-correo' })).statusCode === 400);

    await t('CN-003: más de 20 líneas → 400', async () =>
        (await call(Array(21).fill({ productId: 1, size: 'L', qty: 1 }))).statusCode === 400);

    await t('CN-002: un 403 de Supabase corta el pago (no devuelve URL)', async () => {
        respuestaInsert = { ok: false, status: 403, text: async () => 'RLS' };
        const r = await call([{ productId: 1, size: 'L', qty: 1 }]);
        respuestaInsert = { ok: true, status: 201, text: async () => '' };
        return r.statusCode === 503 && !r.body.includes('wompiUrl');
    });

    await t('CN-008: referencia impredecible, única y alfanumérica', async () => {
        const a = JSON.parse((await call([{ productId: 1, size: 'L', qty: 1 }])).body).reference;
        const b = JSON.parse((await call([{ productId: 1, size: 'L', qty: 1 }])).body).reference;
        // hex a propósito: base64url metería "_" y "-", no comprobados en Wompi
        return a !== b && /^CLZKY-[0-9A-F]{18}$/.test(a);
    });

    await t('CN-010: el error no refleja la entrada del cliente', async () => {
        const r = await call([{ productId: '<script>', size: 'L', qty: 1 }]);
        return r.statusCode === 400 && !r.body.includes('script');
    });

    await t('la firma de integridad nunca llega al cliente', async () => {
        const r = await call([{ productId: 1, size: 'L', qty: 1 }]);
        const url = JSON.parse(r.body).wompiUrl;
        return !r.body.includes('test_integridad') && url.includes('signature%3Aintegrity')
            || !r.body.includes('test_integridad') && url.includes('signature:integrity');
    });

    await t('I7: talla agotada → 409, sin URL de pago', async () => {
        const r = await call([{ productId: 1, size: 'S', qty: 1 }]);   // stock 0
        return r.statusCode === 409 && !r.body.includes('wompiUrl');
    });

    await t('I7: pedir más unidades de las que hay → 409', async () =>
        (await call([{ productId: 1, size: 'L', qty: 5 }])).statusCode === 409);   // hay 2

    await t('I7: dos líneas de la misma talla suman contra el stock', async () => {
        const r = await call([
            { productId: 1, size: 'L', qty: 1 },
            { productId: 1, size: 'L', qty: 2 },
        ]);
        return r.statusCode === 409;   // 1+2 = 3 > 2
    });

    await t('M1: carrito viejo sin productId y nombre en MAYÚSCULAS se resuelve', async () => {
        const r = await call([{ productId: null, name: 'NO GRACE', size: 'M', qty: 1 }]);
        return JSON.parse(r.body).total === 240000;
    });

    await t('M1: nombre con apóstrofo tipográfico se resuelve', async () => {
        const r = await call([{ productId: null, name: 'Devil’s F*cking Evil', size: 'M', qty: 1 }]);
        return JSON.parse(r.body).total === 260000;
    });

    await t('qty topado a 10', async () => {
        INVENTARIO.find(f => f.producto_id === 2 && f.talla === 'M').stock = 999;
        await call([{ productId: 2, size: 'M', qty: 999 }]);
        const ok = pedidoGuardado.items[0].qty === 10;
        INVENTARIO.find(f => f.producto_id === 2 && f.talla === 'M').stock = 5;
        return ok;
    });

    await t('I6: el limitador deja pasar 25/min y bloquea el 26', async () => {
        let ultimo;
        for (let i = 0; i < 25; i++) ultimo = await call([{ productId: 2, size: 'M', qty: 1 }], cliOK, '9.9.9.9');
        if (ultimo.statusCode !== 200) return false;
        ultimo = await call([{ productId: 2, size: 'M', qty: 1 }], cliOK, '9.9.9.9');
        return ultimo.statusCode === 429;
    });

    await t('I6: otro cliente en la misma IP (CGNAT) no queda bloqueado', async () => {
        const otro = { ...cliOK, email: 'otra@persona.com' };
        const r = await call([{ productId: 2, size: 'M', qty: 1 }], otro, '9.9.9.9');
        return r.statusCode === 200;
    });

    await t('el envío de 20.000 se cobra siempre, compre lo que compre', async () => {
        const uno = JSON.parse((await call([{ productId: 2, size: 'M', qty: 1 }])).body);
        const dos = JSON.parse((await call([{ productId: 2, size: 'M', qty: 2 }])).body);
        const tres = JSON.parse((await call([
            { productId: 1, size: 'M', qty: 1 },
            { productId: 2, size: 'M', qty: 1 },
            { productId: 3, size: 'M', qty: 1 },
        ])).body);
        return uno.total  === 220000 + 20000
            && dos.total  === 440000 + 20000
            && tres.total === 720000 + 20000;
    });

    await t('OPTIONS responde al preflight', async () =>
        (await handler({ httpMethod: 'OPTIONS', headers: {} })).statusCode === 204);

    await t('GET no permitido → 405', async () =>
        (await handler({ httpMethod: 'GET', headers: {} })).statusCode === 405);

    console.log(`\n  create-payment: ${pasan} pasan, ${fallan} fallan`);
    process.exit(fallan ? 1 : 0);
})();
