'use strict';
// Pruebas de rutas con BD simulada: no abre conexiones ni modifica PostgreSQL.
const assert = require('node:assert/strict');
const routes = new Map();
const app = {
  get(path, ...handlers){routes.set('GET '+path,handlers.at(-1));},
  post(path, ...handlers){routes.set('POST '+path,handlers.at(-1));},
  patch(path, ...handlers){routes.set('PATCH '+path,handlers.at(-1));}
};
let simulatedName='Victor Canto';
const pool = {query:async(query)=>{
  if(query.includes('COALESCE(e.nombre'))return {rows:[{nombre:simulatedName}]};
  if(query.includes('FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno'))return {rows:[]};
  if(query.includes('count(*)::int total'))return {rows:[{total:0,terminadas:0,abiertas:0}]};
  if(query.includes('FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo'))return {rows:[]};
  throw Error('Consulta inesperada en prueba: '+query.slice(0,80));
}};
require('../tools/MANTIX_modulos_completos.js')(app,{pool,auth:()=>{},permit:()=>()=>{},localWrite:()=>{}});
async function call(route,fecha){
  const handler=routes.get('GET '+route); assert(handler,route);
  const req={query:{fecha},actor:{id:'00000000-0000-4000-8000-000000000001',nombre:simulatedName,roles:['SUPERVISOR']}};
  return new Promise((resolve,reject)=>{
    const res={json:(body)=>resolve(body),status:(n)=>({json:body=>reject(Error(`${n}: ${body.error}`))})};
    handler(req,res);
  });
}
(async()=>{
  const cases=[['Victor Canto','2026-11-02','C'],['Victor Canto','2026-11-09','B'],['Santos Gerardo Puc','2026-11-02','B'],['Venancio Puc','2026-11-09','C'],['Edgar','2026-11-05','Q1'],['Jocsan','2026-11-05','Q2'],['Lorenzo','2026-11-05','Q3'],['Jesús','2026-11-05','Q4'],['Bryan','2026-11-05','Q5']];
  for(const [name,date,expected] of cases){simulatedName=name;const r=await call('/api/v2/turnos/recomendacion',date);assert.equal(r.codigo_sugerido,expected,`${name} ${date}`);assert.equal(r.domingo,false);}
  simulatedName='Victor Canto';const sunday=await call('/api/v2/turnos/recomendacion','2026-11-08');assert.equal(sunday.domingo,true);assert.equal(sunday.codigo_sugerido,'EXTRA');
  simulatedName='supervisor_prueba';const unknown=await call('/api/v2/turnos/recomendacion','2026-11-05');assert.equal(unknown.codigo_sugerido,null);
  const summary=await call('/api/v2/turnos/resumen','2026-11-05');assert.equal(summary.jornada,null);assert.deepEqual(summary.pendientes_sin_entrega,[]);
  console.log('OK: rotación A/B/C, Q1–Q5, domingo EXTRA, usuario sin turno identificado y resumen sin escritura.');
})().catch(e=>{console.error(e);process.exitCode=1;});
