'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {pool}=require('./MANTIX_conexion_PostgreSQL');
async function migrate(db=pool){
 const c=await db.connect();
 try {
  await c.query('BEGIN');
  await c.query("SELECT pg_advisory_xact_lock(hashtext('mantix.migration.002'))");
  const done=await c.query("SELECT 1 FROM information_schema.columns WHERE table_schema='mantix' AND table_name='cierres_turno' AND column_name='reporte'");
  if(!done.rowCount)await c.query(fs.readFileSync(path.join(__dirname,'../database/002_bitacora_turno.sql'),'utf8'));
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
module.exports=migrate;
if(require.main===module)migrate().then(()=>console.log('OK: migración de bitácora aplicada; registros históricos conservados.')).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());
