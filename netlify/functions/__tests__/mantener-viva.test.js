/* Pruebas del keepalive programado de Netlify.
   node netlify/functions/__tests__/mantener-viva.test.js */
const path = require('path').join(__dirname, '..', 'mantener-viva.js');
let pasan=0, fallan=0;
const real={log:console.log,error:console.error};
async function t(n,fn){console.log=console.error=()=>{};let ok=false,e=null;
  try{ok=await fn()}catch(x){e=x}Object.assign(console,real);
  if(ok){pasan++;console.log('  PASA   '+n)}else{fallan++;console.log('  FALLA  '+n+(e?' :: '+e.message:''))}}

(async()=>{
  console.log('\n-- KEEPALIVE --');

  await t('sin SUPABASE_SERVICE_KEY -> 500', async()=>{
    delete process.env.SUPABASE_SERVICE_KEY;
    delete require.cache[require.resolve(path)];
    const {handler}=require(path);
    return (await handler()).statusCode===500;
  });

  await t('Supabase responde 200 -> 200', async()=>{
    process.env.SUPABASE_SERVICE_KEY='k';
    delete require.cache[require.resolve(path)];
    global.fetch=async()=>({ok:true,status:200,text:async()=>'[{"producto_id":1}]'});
    const {handler}=require(path);
    return (await handler()).statusCode===200;
  });

  await t('Supabase 401 (clave mala) -> 500, no lo traga', async()=>{
    process.env.SUPABASE_SERVICE_KEY='k';
    delete require.cache[require.resolve(path)];
    global.fetch=async()=>({ok:false,status:401,text:async()=>''});
    const {handler}=require(path);
    return (await handler()).statusCode===500;
  });

  await t('base pausada / red caida -> 500', async()=>{
    process.env.SUPABASE_SERVICE_KEY='k';
    delete require.cache[require.resolve(path)];
    global.fetch=async()=>{throw new Error('ECONNREFUSED')};
    const {handler}=require(path);
    return (await handler()).statusCode===500;
  });

  console.log(`\n  keepalive: ${pasan} pasan, ${fallan} fallan`);
})();
