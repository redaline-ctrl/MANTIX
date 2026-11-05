'use strict';
const {randomUUID:uuid}=require('node:crypto');
const path=require('node:path');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v);
const txt=(v,max=5000)=>typeof v==='string'&&v.length<=max?v.trim():'';
const ids=(v,max)=>Array.isArray(v)&&v.length<=max&&v.every(id)&&new Set(v).size===v.length;
const states=['POR_INICIAR','EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD','TERMINADA'];
const pending=s=>s==='POR_INICIAR'||s.startsWith('PENDIENTE');
module.exports=function(app,{pool,auth,permit,localWrite}){
 const read=(perm,fn)=>[auth,permit(perm),wrap(fn)];
 const write=(perm,fn)=>[localWrite,auth,permit(perm),wrap(fn)];
 function wrap(fn){return async(req,res)=>{try{res.json({ok:true,...await fn(req)})}catch(e){console.error('[Bitácora]',e.message);res.status(e.status||(e.code==='23505'?409:503)).json({ok:false,error:e.status?e.message:e.code==='23505'?'La orden o envío ya existe. Actualiza antes de reintentar.':'No se pudo completar la operación.'});}};}
 async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function audit(c,actor,action,entity,key,data){await c.query('INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_despues) VALUES($1,$2,$3,$4,$5,$6)',[uuid(),actor,action,entity,key,JSON.stringify(data)]);}
 async function duty(c,key,actor,allowClosed=false){
  if(!id(key))fail('Selecciona una jornada válida.');
  const r=await c.query(`SELECT a.*,ct.id AS cierre_id,ct.reporte FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.id=$1 FOR UPDATE OF a`,[key]);
  const a=r.rows[0];if(!a||a.supervisor_id!==actor)fail('La jornada no pertenece a tu usuario.',403);
  if(a.cierre_id&&!allowClosed)fail('La jornada está cerrada. Utiliza Correcciones.',409);return a;
 }
 async function rows(c,a,lock=false){return (await c.query(`SELECT i.*,o.numero_orden,o.modalidad_registro,o.descripcion,o.tipo_mantenimiento_codigo,o.estado_operativo,o.cancelacion_solicitada_por,
  (SELECT json_agg(e.equipo_id) FROM mantix.intervencion_equipos e WHERE e.intervencion_id=i.id) equipos,
  (SELECT json_agg(e.empleado_id) FROM mantix.intervencion_ejecutantes e WHERE e.intervencion_id=i.id) ejecutantes
  FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id
  WHERE i.supervisor_id=$1 AND (i.asignacion_turno_id=$2 OR (i.asignacion_turno_id IS NULL AND i.fecha_operativa=$3))
  ORDER BY i.creada_en,i.id ${lock?'FOR UPDATE OF i':''}`,[a.supervisor_id,a.id,a.fecha_operativa])).rows;}
 function data(b){
  if(!states.includes(b.estado))fail('Estado inválido.');
  const start=b.inicio?new Date(b.inicio):null,end=b.fin?new Date(b.fin):null;
  if((start&&!Number.isFinite(+start))||(end&&!Number.isFinite(+end))||(end&&!start)||(end&&end<start)||(start&&end&&end-start>72*3600000))fail('Revisa las fechas reales de inicio y cierre.');
  if(b.estado==='POR_INICIAR'&&(start||end))fail('Una actividad por iniciar no tiene horas de ejecución.');
  const acts=txt(b.actividades),notes=txt(b.observaciones,3000),reason=txt(b.motivo_pendiente,3000);
  if(b.estado!=='POR_INICIAR'&&(!start||acts.length<5||!b.ejecutantes?.length))fail('Registra inicio, actividades y al menos un ejecutante.');
  if(b.estado==='TERMINADA'&&!end)fail('Registra la hora de cierre.');
  if(!ids(b.equipos,30)||!b.equipos.length||!ids(b.ejecutantes,50))fail('Selecciona equipos y ejecutantes válidos.');
  return {start,end,acts,notes,reason};
 }
 async function catalogs(c,b){
  const eq=await c.query('SELECT id FROM mantix.equipos WHERE id=ANY($1::uuid[]) AND activo',[b.equipos]);
  const staff=await c.query('SELECT id FROM mantix.empleados WHERE id=ANY($1::uuid[]) AND activo',[b.ejecutantes]);
  if(eq.rowCount!==b.equipos.length||staff.rowCount!==b.ejecutantes.length)fail('Hay equipos o ejecutantes inactivos.');
 }
 async function links(c,i,o,b){
  await c.query('DELETE FROM mantix.intervencion_equipos WHERE intervencion_id=$1',[i]);
  await c.query('DELETE FROM mantix.intervencion_ejecutantes WHERE intervencion_id=$1',[i]);
  for(const e of b.equipos){await c.query('INSERT INTO mantix.orden_equipos(orden_id,equipo_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[o,e]);await c.query('INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id) VALUES($1,$2,$3)',[o,i,e]);}
  for(const e of b.ejecutantes)await c.query('INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id) VALUES($1,$2)',[i,e]);
 }
 app.get('/bitacora',auth,permit('ordenes.registrar'),(req,res)=>res.sendFile(path.join(__dirname,'MANTIX_bitacora.html')));
 app.get('/api/bitacora/jornadas/:id',...read('ordenes.registrar',req=>tx(async c=>{
  const a=await duty(c,req.params.id,req.actor.id,true);return {jornada:a,filas:await rows(c,a)};
 })));
 app.post('/api/bitacora/filas',...write('ordenes.registrar',req=>tx(async c=>{
  const b=req.body||{},v=data(b),a=await duty(c,b.jornada_id,req.actor.id);
  if(!id(b.clave_envio))fail('Falta la clave de guardado.');
  const claim=await c.query(`INSERT INTO mantix.solicitudes_idempotentes(id,usuario_id,clave_cliente,operacion) VALUES($1,$2,$3,'BITACORA_FILA') ON CONFLICT DO NOTHING RETURNING id`,[uuid(),req.actor.id,b.clave_envio]);
  if(!claim.rowCount){const old=await c.query("SELECT recurso_id FROM mantix.solicitudes_idempotentes WHERE usuario_id=$1 AND clave_cliente=$2 AND operacion='BITACORA_FILA'",[req.actor.id,b.clave_envio]);return {id:old.rows[0].recurso_id,repetido:true};}
  const num=txt(b.numero_orden,80),desc=txt(b.descripcion,3000);
  if(!['OPERATIVO','CON_ORDEN'].includes(b.modalidad)||desc.length<5||(b.modalidad==='CON_ORDEN'?!num:!!num))fail('Indica modalidad, número si corresponde y descripción de la actividad.');
  if(!(await c.query('SELECT 1 FROM mantix.tipos_mantenimiento WHERE codigo=$1 AND activo',[b.tipo])).rowCount)fail('Selecciona el tipo de mantenimiento.');
  await catalogs(c,b);
  const o=uuid(),i=uuid();
  await c.query(`INSERT INTO mantix.ordenes_trabajo(id,numero_orden,modalidad_registro,tipo_mantenimiento_codigo,descripcion,creada_por) VALUES($1,$2,$3,$4,$5,$6)`,[o,num||null,b.modalidad,b.tipo,desc,req.actor.id]);
  await c.query(`INSERT INTO mantix.intervenciones(id,orden_id,supervisor_id,asignacion_turno_id,fecha_operativa,inicio_real,fin_real,actividades,estado,creada_por,observaciones,motivo_pendiente) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$3,$10,$11)`,[i,o,req.actor.id,a.id,a.fecha_operativa,v.start,v.end,v.acts,b.estado,v.notes,v.reason]);
  await links(c,i,o,b);await updateOrder(c,o,b.estado);
  await c.query("UPDATE mantix.solicitudes_idempotentes SET estado='CONFIRMADA',recurso_id=$1,recurso_tipo='intervenciones',finalizada_en=now() WHERE usuario_id=$2 AND clave_cliente=$3 AND operacion='BITACORA_FILA'",[i,req.actor.id,b.clave_envio]);
  await audit(c,req.actor.id,'BITACORA_FILA_CREADA','intervenciones',i,{orden_id:o,estado:b.estado});return {id:i};
 })));
 async function updateOrder(c,o,state){await c.query('UPDATE mantix.ordenes_trabajo SET estado_operativo=$1,version=version+1 WHERE id=$2',[state==='POR_INICIAR'?'ABIERTA':state==='TERMINADA'?'TERMINADA':state==='EN_PROCESO'?'EN_PROCESO':'PENDIENTE',o]);}
 app.patch('/api/bitacora/filas/:id',...write('ordenes.registrar',req=>tx(async c=>{
  const b=req.body||{},v=data(b);if(!id(req.params.id))fail('Registro inválido.');
  const probe=(await c.query('SELECT asignacion_turno_id FROM mantix.intervenciones WHERE id=$1',[req.params.id])).rows[0];
  if(!probe?.asignacion_turno_id)fail('Este registro histórico se modifica mediante Correcciones.',409);
  await duty(c,probe.asignacion_turno_id,req.actor.id);
  const i=(await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(i.supervisor_id!==req.actor.id)fail('Registro de otro supervisor.',403);
  if(i.version!==b.version||i.estado_revision!=='NO_ENVIADA'||i.entregada_en)fail('El registro cambió o ya fue enviado/entregado. Actualiza la bitácora.',409);
  const o=(await c.query('SELECT * FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[i.orden_id])).rows[0];
  if(o.estado_operativo==='CANCELADA'||o.cancelacion_solicitada_por)fail('La orden tiene una cancelación pendiente o autorizada.',409);
  await catalogs(c,b);
  await c.query(`UPDATE mantix.intervenciones SET inicio_real=$1,fin_real=$2,actividades=$3,estado=$4,observaciones=$5,motivo_pendiente=$6,version=version+1 WHERE id=$7`,[v.start,v.end,v.acts,b.estado,v.notes,v.reason,i.id]);
  await links(c,i.id,i.orden_id,b);await updateOrder(c,i.orden_id,b.estado);
  await audit(c,req.actor.id,'BITACORA_FILA_ACTUALIZADA','intervenciones',i.id,{version:i.version+1,anterior:i});return {id:i.id};
 })));
 app.post('/api/bitacora/filas/:id/enviar',...write('ordenes.registrar',req=>tx(async c=>{
  const i=(await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1',[req.params.id])).rows[0];if(!i)fail('Registro inexistente.',404);
  await duty(c,i.asignacion_turno_id,req.actor.id);
  const r=await c.query("UPDATE mantix.intervenciones SET estado_revision='EN_REVISION' WHERE id=$1 AND supervisor_id=$2 AND estado='TERMINADA' AND estado_revision='NO_ENVIADA' RETURNING id",[i.id,req.actor.id]);
  if(!r.rowCount)fail('Solo se envían trabajos terminados sin enviar.',409);
  await audit(c,req.actor.id,'INTERVENCION_ENVIADA','intervenciones',i.id,{version:i.version});return {id:i.id};
 })));
 async function close(req){return tx(async c=>{
  const a=await duty(c,req.params.id,req.actor.id,true);
  if(a.cierre_id)return {cierre_id:a.cierre_id,repetido:true};
  if(a.extraordinario&&(!a.inicio_real||!a.fin_real))fail('Completa el inicio y fin real de la jornada extraordinaria.',409);
  const list=await rows(c,a,true);
  for(const i of list){
   if(i.estado==='EN_PROCESO'&&!i.entregada_en)fail('Actualiza las actividades en proceso a terminadas o pendientes.',409);
   if(pending(i.estado)&&!i.entregada_en&&txt(i.motivo_pendiente).length<10)fail('Explica por qué no se inició o qué falta en cada pendiente (mínimo 10 caracteres).',409);
  }
  const cid=uuid(),report={jornada:{id:a.id,fecha_operativa:a.fecha_operativa,turno:a.codigo_turno,supervisor_id:a.supervisor_id},filas:list.map(i=>({...i,estado_revision:i.estado==='TERMINADA'&&i.estado_revision==='NO_ENVIADA'?'EN_REVISION':i.estado_revision}))};
  await c.query('INSERT INTO mantix.cierres_turno(id,asignacion_turno_id,cerrado_por,observaciones,reporte) VALUES($1,$2,$3,$4,$5)',[cid,a.id,req.actor.id,txt(req.body?.observaciones,1500),JSON.stringify(report)]);
  for(const i of list){
   if(i.estado==='TERMINADA'&&i.estado_revision==='NO_ENVIADA'){
    await c.query("UPDATE mantix.intervenciones SET estado_revision='EN_REVISION' WHERE id=$1",[i.id]);
    await audit(c,req.actor.id,'INTERVENCION_ENVIADA','intervenciones',i.id,{version:i.version,cierre_id:cid});
   }
   if(pending(i.estado)&&!i.entregada_en){
    const o=(await c.query('SELECT * FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[i.orden_id])).rows[0];
    if(o.estado_operativo!=='CANCELADA'){
     await c.query("UPDATE mantix.ordenes_trabajo SET estado_operativo='PENDIENTE' WHERE id=$1",[i.orden_id]);
     await c.query('UPDATE mantix.intervenciones SET entregada_en=now(),asignacion_turno_id=$2 WHERE id=$1',[i.id,a.id]);
     await c.query("INSERT INTO mantix.seguimientos(id,orden_id,intervencion_id,supervisor_id,tipo,descripcion,ocurrido_en) VALUES($1,$2,$3,$4,'ENTREGA',$5,now())",[uuid(),i.orden_id,i.id,req.actor.id,i.motivo_pendiente]);
     await c.query('DELETE FROM mantix.tomas_activas WHERE orden_id=$1 AND supervisor_id=$2',[i.orden_id,req.actor.id]);
    }
   }
   if(pending(i.estado))await c.query('INSERT INTO mantix.entregas_pendientes(id,orden_id,intervencion_origen_id,cierre_turno_id,detalle_pendiente) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM mantix.entregas_pendientes WHERE intervencion_origen_id=$3)',[uuid(),i.orden_id,i.id,cid,i.motivo_pendiente||'Entrega documentada previamente']);
  }
  await audit(c,req.actor.id,'TURNO_CERRADO_Y_ENVIADO','cierres_turno',cid,{filas:list.length});return {cierre_id:cid};
 });}
 app.post('/api/bitacora/jornadas/:id/cerrar',...write('ordenes.registrar',close));
 // También protege la acción de cierre del centro anterior.
 app.post('/api/v2/turnos/:id/cerrar',...write('ordenes.registrar',close));
 app.get('/api/bitacora/reportes',...read('revision.gestionar',async()=>({datos:(await pool.query(`SELECT c.id,c.cerrado_en,a.fecha_operativa,a.codigo_turno,u.nombre_mostrar supervisor FROM mantix.cierres_turno c JOIN mantix.asignaciones_turno a ON a.id=c.asignacion_turno_id JOIN mantix.usuarios u ON u.id=a.supervisor_id ORDER BY c.cerrado_en DESC LIMIT 150`)).rows})));
 app.get('/api/bitacora/reportes/:id',...read('revision.gestionar',async req=>{
  const r=await pool.query('SELECT reporte FROM mantix.cierres_turno WHERE id=$1',[req.params.id]);if(!r.rowCount)fail('Reporte no encontrado.',404);return {reporte:r.rows[0].reporte};
 }));
 app.post('/api/bitacora/ordenes/:id/cancelacion',...write('ordenes.registrar',req=>tx(async c=>{
  const reason=txt(req.body?.motivo,3000);if(reason.length<10)fail('Explica el motivo de cancelación (mínimo 10 caracteres).');
  const o=(await c.query('SELECT * FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(!o||o.creada_por!==req.actor.id)fail('Solo el creador puede solicitar la cancelación.',403);
  if(!['ABIERTA','PENDIENTE'].includes(o.estado_operativo)||o.cancelacion_solicitada_por)fail('La orden no admite otra solicitud.',409);
  if((await c.query("SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 AND estado<>'POR_INICIAR'",[o.id])).rowCount)fail('Solo se cancelan por este flujo actividades no iniciadas.',409);
  await c.query('UPDATE mantix.ordenes_trabajo SET cancelacion_solicitada_por=$1,motivo_cancelacion=$2 WHERE id=$3',[req.actor.id,reason,o.id]);
  await audit(c,req.actor.id,'CANCELACION_SOLICITADA','ordenes_trabajo',o.id,{motivo:reason});return {};
 })));
 app.get('/api/bitacora/cancelaciones',...read('revision.gestionar',async()=>({datos:(await pool.query('SELECT id,numero_orden,descripcion,motivo_cancelacion FROM mantix.ordenes_trabajo WHERE cancelacion_solicitada_por IS NOT NULL')).rows})));
 app.post('/api/bitacora/cancelaciones/:id',...write('revision.gestionar',req=>tx(async c=>{
  if(!['APROBADA','RECHAZADA'].includes(req.body?.decision))fail('Decisión inválida.');
  const o=(await c.query('SELECT * FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(!o?.cancelacion_solicitada_por)fail('Solicitud no disponible.',409);
  if(o.cancelacion_solicitada_por===req.actor.id)fail('No puedes autorizar tu propia solicitud.',403);
  if((await c.query('SELECT 1 FROM mantix.tomas_activas WHERE orden_id=$1 AND expira_en>now()',[o.id])).rowCount)fail('La orden está tomada. Libera primero la toma.',409);
  if(req.body.decision==='APROBADA'){
   if((await c.query("SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 AND estado<>'POR_INICIAR'",[o.id])).rowCount)fail('El trabajo ya comenzó; no puede cancelarse como no iniciado.',409);
   await c.query("UPDATE mantix.ordenes_trabajo SET estado_operativo='CANCELADA',cerrada_en=now() WHERE id=$1",[o.id]);
  }
  await c.query('UPDATE mantix.ordenes_trabajo SET cancelacion_solicitada_por=NULL WHERE id=$1',[o.id]);
  await audit(c,req.actor.id,'CANCELACION_'+req.body.decision,'ordenes_trabajo',o.id,{motivo:o.motivo_cancelacion});return {};
 })));
};
