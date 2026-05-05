// =============================================================
//  INVENTARIO CLOZKY STUDIOS
//  Los valores se sincronizan automáticamente desde Supabase.
//  Los números abajo son el fallback si no hay conexión.
// =============================================================

const SUPABASE_URL      = 'https://opcnglllvppfavjjpjkf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wY25nbGxsdnBwZmF2ampwamtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5OTk3NzEsImV4cCI6MjA5MzU3NTc3MX0.Wq0Hk_mrLefO0doMVh5G5yLIQK5rHQ9tlgMzdCbafHM';

const INVENTARIO = {
    1: { S: 0, M: 5, L: 2, XL: 0 }, // Worthless Sacrifice
    2: { S: 1, M: 5, L: 4, XL: 0 }, // No Grace
    3: { S: 1, M: 4, L: 7, XL: 1 }, // Devil's F*cking Evil
};

function stockDe(id, talla)  { return (INVENTARIO[id] || {})[talla] ?? 0; }
function hayStock(id, talla) { return stockDe(id, talla) > 0; }
function hayAlgunStock(id)   {
    const inv = INVENTARIO[id];
    return inv && Object.values(inv).some(v => v > 0);
}

// Sincroniza con Supabase al cargar la página
async function sincronizarInventario() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/inventario?select=*`, {
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            }
        });
        if (!res.ok) throw new Error(res.status);
        const rows = await res.json();
        rows.forEach(r => {
            if (!INVENTARIO[r.producto_id]) INVENTARIO[r.producto_id] = {};
            INVENTARIO[r.producto_id][r.talla] = r.stock;
        });
        console.log('Inventario sincronizado desde Supabase');
    } catch (e) {
        console.warn('Inventario: usando valores locales', e);
    }
}
