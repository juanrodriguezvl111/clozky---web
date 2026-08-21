/* Pruebas del endpoint de salud.
   node netlify/functions/__tests__/salud.test.js */
const ruta = require('path').join(__dirname, '..', 'salud.js');

let pasan = 0, fallan = 0;
const real = { log: console.log, error: console.error };
async function t(n, fn) {
    console.log = console.error = () => {};
    let ok = false, e = null;
    try { ok = await fn(); } catch (x) { e = x; }
    Object.assign(console, real);
    if (ok) { pasan++; console.log('  PASA   ' + n); }
    else    { fallan++; console.log('  FALLA  ' + n + (e ? ' :: ' + e.message : '')); }
}

/* Recarga el módulo para vaciar su caché entre pruebas. */
function cargar(clave) {
    if (clave === undefined) delete process.env.SUPABASE_SERVICE_KEY;
    else process.env.SUPABASE_SERVICE_KEY = clave;
    delete require.cache[require.resolve(ruta)];
    return require(ruta).handler;
}
const GET = { httpMethod: 'GET' };

(async () => {
    console.log('\n── SALUD ──');

    await t('base viva → 200 y ok:true', async () => {
        global.fetch = async () => ({ ok: true, status: 200 });
        const r = await cargar('k')(GET);
        return r.statusCode === 200 && JSON.parse(r.body).ok === true;
    });

    await t('base pausada (sin conexión) → 503', async () => {
        global.fetch = async () => { throw new Error('ECONNREFUSED'); };
        const r = await cargar('k')(GET);
        return r.statusCode === 503 && JSON.parse(r.body).ok === false;
    });

    await t('supabase responde 503 → 503, no lo traga', async () => {
        global.fetch = async () => ({ ok: false, status: 503 });
        const r = await cargar('k')(GET);
        return r.statusCode === 503 && JSON.parse(r.body).motivo === 'supabase 503';
    });

    await t('clave caducada (401) → 503', async () => {
        global.fetch = async () => ({ ok: false, status: 401 });
        const r = await cargar('k')(GET);
        return r.statusCode === 503;
    });

    await t('sin variable de entorno → 503, sin llamar a Supabase', async () => {
        let llamadas = 0;
        global.fetch = async () => { llamadas++; return { ok: true, status: 200 }; };
        const r = await cargar(undefined)(GET);
        return r.statusCode === 503 && llamadas === 0;
    });

    await t('la caché evita martillear la base: 50 peticiones → 1 sola consulta', async () => {
        let llamadas = 0;
        global.fetch = async () => { llamadas++; return { ok: true, status: 200 }; };
        const h = cargar('k');
        for (let i = 0; i < 50; i++) await h(GET);
        return llamadas === 1;
    });

    await t('nunca filtra la clave ni detalles internos', async () => {
        global.fetch = async () => ({ ok: false, status: 401 });
        const r = await cargar('CLAVE_SECRETA_123')(GET);
        return !r.body.includes('CLAVE_SECRETA_123') && !r.body.includes(SUPABASE_ANON_LEAK());
    });
    function SUPABASE_ANON_LEAK() { return 'eyJhbGciOi'; }

    await t('responde con no-store (un 200 viejo ocultaría la caída)', async () => {
        global.fetch = async () => ({ ok: true, status: 200 });
        const r = await cargar('k')(GET);
        return /no-store/.test(r.headers['Cache-Control']);
    });

    await t('POST no permitido → 405', async () => {
        global.fetch = async () => ({ ok: true, status: 200 });
        const r = await cargar('k')({ httpMethod: 'POST' });
        return r.statusCode === 405;
    });

    console.log(`\n  salud: ${pasan} pasan, ${fallan} fallan`);
    process.exit(fallan ? 1 : 0);
})();
