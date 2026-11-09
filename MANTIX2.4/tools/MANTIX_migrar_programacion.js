'use strict';
const fs=require('node:fs'),path=require('node:path');
module.exports=async function(pool){const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('mantix.programacion.004'))");await c.query(fs.readFileSync(path.join(__dirname,'../database/MIGRACION_004_TOMA_PROGRAMACION.sql'),'utf8'));await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
if(require.main===module){const {pool}=require('./MANTIX_conexion_PostgreSQL');module.exports(pool).then(()=>console.log('OK: programación conectada; históricos conservados.')).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>pool.end());}
