'use strict';
const fs=require('node:fs'),path=require('node:path');
async function migrate(pool){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('mantix.revision.003'))");await c.query(fs.readFileSync(path.join(__dirname,'../database/MIGRACION_003_REVISION.sql'),'utf8'));await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
module.exports=migrate;
if(require.main===module){const {pool}=require('./MANTIX_conexion_PostgreSQL');migrate(pool).then(()=>console.log('OK: revisión actualizada sin modificar registros históricos.')).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());}
