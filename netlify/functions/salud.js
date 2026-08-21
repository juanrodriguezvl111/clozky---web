/* ============================================================
   SALUD — ¿puede la tienda vender ahora mismo?

   Devuelve 200 sólo si Supabase responde. Si la base está pausada o caída,
   devuelve 503. Existe para que un monitor externo (UptimeRobot) avise por
   correo, porque la portada sigue devolviendo 200 aunque la base esté muerta:
   el sitio se ve, pero al dar "Pagar" sale 503 y no se vende nada.

   De paso, al consultarse cada 5 minutos, es el keepalive más frecuente que
   hay: los otros dos (GitHub Actions y la función programada) van una vez al
   día cada uno.

   Comprueba con SUPABASE_SERVICE_KEY, que es la misma credencial que necesita
   create-payment. Así un 401 por clave caducada también se detecta, no sólo
   una base pausada.

   Es público a propósito. Para que nadie pueda martillear la base desde aquí,
   el resultado se cachea 60 segundos: por muchas peticiones que lleguen, a
   Supabase le llega como mucho una por minuto y contenedor.
   ============================================================ */
const SUPABASE_URL = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CACHE_MS = 60000;
let cache = null;   // { ok, motivo, cuando }

const responder = (estado) => ({
    statusCode: estado.ok ? 200 : 503,
    headers: {
        'Content-Type':  'application/json',
        // Sin esto un intermediario podría servir un 200 viejo y ocultar la caída.
        'Cache-Control': 'no-store, max-age=0',
    },
    body: JSON.stringify({
        ok:     estado.ok,
        base:   estado.ok ? 'viva' : 'sin respuesta',
        motivo: estado.motivo,
        hace:   Math.round((Date.now() - estado.cuando) / 1000) + 's',
    }),
});

exports.handler = async (event) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    if (cache && Date.now() - cache.cuando < CACHE_MS) {
        return responder(cache);
    }

    let estado;
    if (!SUPABASE_KEY) {
        estado = { ok: false, motivo: 'falta la clave de servicio', cuando: Date.now() };
    } else {
        try {
            const res = await fetch(
                `${SUPABASE_URL}/rest/v1/inventario?select=producto_id&limit=1`,
                { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } },
            );
            // fetch no lanza en 4xx/5xx: hay que mirar res.ok a mano.
            estado = res.ok
                ? { ok: true,  motivo: null,                       cuando: Date.now() }
                : { ok: false, motivo: 'supabase ' + res.status,   cuando: Date.now() };
        } catch (e) {
            estado = { ok: false, motivo: 'sin conexión', cuando: Date.now() };
        }
    }

    if (!estado.ok) console.error('SALUD: la tienda NO puede vender —', estado.motivo);
    cache = estado;
    return responder(estado);
};
