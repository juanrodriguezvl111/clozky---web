/* ============================================================
   MANTENER VIVA LA BASE — segundo vigilante
   Se programa desde netlify.toml:  [functions."mantener-viva"]

   Supabase Free pausa el proyecto tras 7 días sin actividad, y con la base
   pausada create-payment no puede guardar el pedido: el checkout devuelve 503
   y la tienda deja de vender sin avisar. Ya pasó el 20 de agosto de 2026.

   Existe ya un keepalive en .github/workflows/mantener-viva-la-base.yml.
   Éste es aposta un SEGUNDO sistema, independiente, porque el de GitHub tiene
   un punto débil: GitHub desactiva los cron si el repositorio pasa 60 días
   sin commits. Si eso ocurre, este de aquí sigue corriendo.

   Los dos van desfasados 12 horas: GitHub a las 12:00 UTC, éste a las 00:00.

   Usa la service key, que es la misma que necesita el checkout: así el ping
   no solo mantiene viva la base, también comprueba a diario que esa variable
   de entorno sigue siendo válida.
   ============================================================ */
const SUPABASE_URL = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async () => {
    if (!SUPABASE_KEY) {
        console.error('KEEPALIVE FALLÓ: falta SUPABASE_SERVICE_KEY. El checkout no puede guardar pedidos.');
        return { statusCode: 500 };
    }

    let res;
    try {
        res = await fetch(`${SUPABASE_URL}/rest/v1/inventario?select=producto_id&limit=1`, {
            headers: {
                'apikey':        SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
        });
    } catch (e) {
        console.error('KEEPALIVE FALLÓ: no se pudo alcanzar Supabase.', e.message);
        return { statusCode: 500 };
    }

    // fetch no lanza en 4xx/5xx: hay que mirar res.ok a mano.
    if (!res.ok) {
        console.error(`KEEPALIVE FALLÓ: Supabase respondió ${res.status}. `
                    + 'Si es 401/403, la service key ya no sirve y el checkout está roto.');
        return { statusCode: 500 };
    }

    console.log('Base viva. Respuesta:', (await res.text()).slice(0, 120));
    return { statusCode: 200 };
};
