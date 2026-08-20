-- =============================================================
--  CLOZKY STUDIOS — Seguridad de Supabase
--  Pegar en Supabase → SQL Editor → Run.
--  Es idempotente: se puede ejecutar varias veces sin romper nada.
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. PEDIDOS — cerrado a la clave anónima  (hallazgo CN-004)
--
--    La tabla guarda correo, nombre, teléfono, cédula y dirección.
--    La clave anon está publicada en el JavaScript del sitio: es pública
--    por diseño. Lo único que separa esos datos de internet es RLS.
--    Sin esto, cualquiera que abra el código fuente puede descargarse
--    la base de clientes completa (Ley 1581 de 2012).
--
--    Las funciones de Netlify usan la SERVICE key, que salta RLS.
--    Por eso cerrar la puerta a `anon` no rompe la tienda.
-- ─────────────────────────────────────────────────────────────
alter table public.pedidos enable row level security;
alter table public.pedidos force row level security;

revoke all on public.pedidos from anon, authenticated;

-- Sin políticas para anon = nadie entra con la clave pública.
drop policy if exists "pedidos lectura publica"   on public.pedidos;
drop policy if exists "pedidos escritura publica" on public.pedidos;


-- ─────────────────────────────────────────────────────────────
-- 2. INVENTARIO — lectura pública, escritura solo del servidor
--
--    producto.html necesita leer el stock con la clave anon para no
--    vender tallas agotadas. Eso es intencional. Lo que NO puede ser
--    es que un visitante escriba stock.
-- ─────────────────────────────────────────────────────────────
alter table public.inventario enable row level security;
alter table public.inventario force row level security;

revoke all on public.inventario from anon, authenticated;
grant select on public.inventario to anon;

drop policy if exists "inventario lectura publica" on public.inventario;
create policy "inventario lectura publica"
  on public.inventario for select to anon using (true);


-- ─────────────────────────────────────────────────────────────
-- 3. REFERENCIA ÚNICA
--
--    El webhook busca el pedido por `referencia`. Si dos pedidos
--    compartieran referencia, el pago de uno cerraría el otro.
-- ─────────────────────────────────────────────────────────────
create unique index if not exists pedidos_referencia_uniq
  on public.pedidos (referencia);


-- ─────────────────────────────────────────────────────────────
-- 4. EL STOCK NUNCA PUEDE QUEDAR NEGATIVO
--
--    Última red de seguridad por si algún día alguien reintroduce
--    un descuento no atómico.
-- ─────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventario_stock_no_negativo'
  ) then
    alter table public.inventario
      add constraint inventario_stock_no_negativo check (stock >= 0);
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────
-- 5. LA COLUMNA `estado` DEBE ACEPTAR CUATRO VALORES
--
--    El webhook escribe:
--      pendiente  → recién creado, aún sin pagar
--      procesando → cobrado, descontando stock ahora mismo
--      pagado     → cobrado y stock descontado, listo para despachar
--      revisar    → cobrado pero algo no cuadró (monto o stock). Mirar a mano.
--
--    Si `estado` es un enum o tiene un CHECK que no incluya 'procesando' y
--    'revisar', esas escrituras devuelven 400, el webhook responde 500 y
--    Wompi reintenta en bucle. Esta consulta dice qué hay hoy:
-- ─────────────────────────────────────────────────────────────
select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'pedidos' and column_name = 'estado';

select conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.pedidos'::regclass and contype = 'c';

--  Si es un enum llamado, por ejemplo, `estado_pedido`, añade los que falten:
--     alter type public.estado_pedido add value if not exists 'procesando';
--     alter type public.estado_pedido add value if not exists 'revisar';
--
--  Si es `text` con un CHECK que los excluye, reemplázalo:
--     alter table public.pedidos drop constraint <nombre_del_check>;
--     alter table public.pedidos add constraint pedidos_estado_valido
--       check (estado in ('pendiente','procesando','pagado','revisar'));
--
--  Si es `text` sin CHECK, no hay nada que hacer: ya funciona.


-- ─────────────────────────────────────────────────────────────
-- 6. COMPROBACIÓN — qué debe salir
--
--    Ejecuta esto después de lo anterior. Las dos tablas deben
--    aparecer con rls_activo = true.
-- ─────────────────────────────────────────────────────────────
select relname as tabla, relrowsecurity as rls_activo, relforcerowsecurity as rls_forzado
from pg_class
where relname in ('pedidos', 'inventario') and relnamespace = 'public'::regnamespace;
