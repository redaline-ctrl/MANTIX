'use strict';
const {randomUUID:uuid}=require('node:crypto'),guardDay=require('./MANTIX_jornada_guard');
const id=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const TZ='America/Merida',today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(new Date());
function currentDuty(j){const day=guardDay.key(j.fecha_operativa),now=new Date();const previous=new Date(today()+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);
 return day===today()||(day===previous.toISOString().slice(0,10)&&j.codigo_turno==='A'&&Number(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',hourCycle:'h23'}).format(now))<7);
}
const projection=`SELECT oc.*,p.equipo_id,p.actividad,p.activo plan_activo,e.activo equipo_activo,e.nombre equipo,u.nombre_mostrar responsable,
 to_char(oc.fecha_vigente AT TIME ZONE 'America/Merida','YYYY-MM-DD') fecha,
 NOT EXISTS(SELECT 1 FROM mantix.intervenciones v WHERE v.orden_id=oc.orden_id AND v.estado='TERMINADA' AND v.estado_revision<>'APROBADA') validaciones_completas,
 i.id intervencion_id,i.estado estado_intervencion,i.estado_revision,i.entregada_en,iu.nombre_mostrar ultimo_supervisor
 FROM mantix.ocurrencias_preventivas oc JOIN mantix.planes_preventivos p ON p.id=oc.plan_id JOIN mantix.equipos e ON e.id=p.equipo_id
 LEFT JOIN mantix.usuarios u ON u.id=oc.tomada_por
 LEFT JOIN LATERAL (SELECT x.* FROM mantix.intervenciones x WHERE x.orden_id=oc.orden_id ORDER BY x.creada_en DESC,x.id DESC LIMIT 1) i ON true
 LEFT JOIN mantix.usuarios iu ON iu.id=i.supervisor_id`;
function state(r){if(['CANCELADA','OMITIDA'].includes(r.estado))return r.estado;
 if(r.intervencion_id){if(r.estado_intervencion==='TERMINADA')return r.estado_revision==='APROBADA'?(r.validaciones_completas?'VALIDADO':'VALIDACION_PENDIENTE'):r.estado_revision==='RECHAZADA'?'RECHAZADO':r.estado_revision==='EN_REVISION'?'EN_REVISION':'TERMINADO_SIN_ENVIAR';return r.entregada_en?'CONTINUIDAD':'EN_PROCESO';}
 if(r.estado==='COMPLETADA')return 'HISTORICO';if(r.tomada_por)return 'TOMADO';if(!r.plan_activo||!r.equipo_activo)return 'INACTIVO';return r.fecha>today()?'PROGRAMADO':'DISPONIBLE';}
module.exports=function(app,{pool,auth,permit,localWrite}){
 const wrap=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){console.error('[Programación]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'No se pudo completar la programación. Consulta la terminal.'});}};
 const read=(p,fn)=>[auth,permit(p),wrap(fn)],write=(p,fn)=>[localWrite,auth,permit(p),wrap(fn)];
 const tx=async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 const audit=(c,actor,action,key,data)=>c.query("INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_despues) VALUES($1,$2,$3,'ocurrencias_preventivas',$4,$5)",[uuid(),actor,action,key,JSON.stringify(data)]);
 app.get('/api/programacion/trabajos',...read('ordenes.registrar',async req=>{
  const rows=(await pool.query(projection+" WHERE oc.estado IN ('PROGRAMADA','EN_PROCESO') AND NOT EXISTS(SELECT 1 FROM mantix.intervenciones ix WHERE ix.orden_id=oc.orden_id) AND (oc.tomada_por IS NULL OR oc.tomada_por=$2) AND (oc.fecha_vigente AT TIME ZONE 'America/Merida')::date<=$1::date ORDER BY oc.fecha_vigente,oc.id",[today(),req.actor.id])).rows.map(r=>({...r,situacion:state(r)}));
  const available=rows.filter(r=>r.situacion==='DISPONIBLE'),mine=rows.filter(r=>r.tomada_por===req.actor.id&&!r.intervencion_id&&r.situacion==='TOMADO');
  return {disponibles:available.slice(0,100),tomados:mine,resumen:{disponibles:available.length,tomados:mine.length},fecha:today()};
 }));
 app.get('/api/programacion/seguimiento',...read('preventivos.autorizar',async req=>{
  const rows=(await pool.query(projection+" ORDER BY CASE WHEN oc.estado IN ('CANCELADA','OMITIDA') OR (oc.estado='COMPLETADA' AND i.estado_revision='APROBADA') THEN 2 WHEN oc.fecha_vigente<=now() THEN 0 ELSE 1 END,oc.fecha_vigente,oc.id")).rows.map(r=>({...r,situacion:state(r)}));
  const q=String(req.query.q||'').slice(0,150).toLocaleLowerCase(),status=String(req.query.estado||''),page=Number(req.query.pagina||1);if(!Number.isInteger(page)||page<1||page>100000)fail('Página inválida.');
  const filtered=rows.filter(r=>(!status||r.situacion===status)&&(!q||(r.actividad+' '+r.equipo+' '+(r.ultimo_supervisor||r.responsable||'')).toLocaleLowerCase().includes(q)));
  return {datos:filtered.slice((page-1)*100,page*100),pagina:page,filtradas:filtered.length,total:rows.length,resumen:rows.reduce((a,r)=>(a[r.situacion]=(a[r.situacion]||0)+1,a),{})};
 }));
 app.post('/api/programacion/:id/tomar',...write('ordenes.registrar',req=>tx(async c=>{
  const key=req.params.id,jid=req.body?.jornada_id;if(!id(key)||!id(jid))fail('Selecciona el trabajo y una jornada abierta.');
  const probe=(await c.query('SELECT * FROM mantix.asignaciones_turno WHERE id=$1',[jid])).rows[0];if(!probe||probe.supervisor_id!==req.actor.id)fail('La jornada no pertenece a tu usuario.',403);
  const duty=await guardDay(c,req.actor.id,probe.fecha_operativa);if(!duty||duty.id!==jid||!currentDuty(duty))fail('Confirma tu jornada actual antes de tomar trabajos.',409);
  const r=(await c.query(projection+' WHERE oc.id=$1 FOR UPDATE OF oc',[key])).rows[0];if(!r)fail('Trabajo no encontrado.',404);
  if(r.tomada_por===req.actor.id&&r.jornada_toma_id===jid&&!r.intervencion_id)return {orden_id:r.orden_id,repetido:true};
  if(r.tomada_por)fail('El trabajo ya está tomado por '+(r.responsable||'otro supervisor')+'. Actualiza la lista.',409);
  if(state(r)!=='DISPONIBLE')fail('El trabajo ya fue tomado, aún no corresponde o dejó de estar disponible. Actualiza la lista.',409);
  let oid=r.orden_id;
  if(oid){await c.query('SELECT id FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[oid]);if((await c.query('SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 LIMIT 1',[oid])).rowCount)fail('El trabajo ya tiene intervenciones. Consulta su continuidad.',409);}
  else{oid=uuid();await c.query("INSERT INTO mantix.ordenes_trabajo(id,modalidad_registro,tipo_mantenimiento_codigo,descripcion,estado_operativo,creada_por) VALUES($1,'OPERATIVO','PREVENTIVO',$2,'ABIERTA',$3)",[oid,r.actividad,req.actor.id]);await c.query('INSERT INTO mantix.orden_equipos(orden_id,equipo_id,principal) VALUES($1,$2,true)',[oid,r.equipo_id]);}
  await c.query("UPDATE mantix.ocurrencias_preventivas SET orden_id=$1,tomada_por=$2,jornada_toma_id=$3,tomada_en=now(),estado='EN_PROCESO' WHERE id=$4",[oid,req.actor.id,jid,key]);
  await audit(c,req.actor.id,'PROGRAMACION_TOMADA',key,{orden_id:oid,jornada_id:jid});return {orden_id:oid};
 })));
 app.post('/api/programacion/:id/liberar',...write('ordenes.registrar',req=>release(req,false)));
 app.post('/api/programacion/:id/liberar-jefe',...write('preventivos.autorizar',req=>release(req,true)));
 async function release(req,chief){const key=req.params.id,reason=req.body?.motivo;if(!id(key)||typeof reason!=='string'||reason.trim().length<8||reason.length>1500)fail('Explica por qué liberas la toma (8 a 1500 caracteres).');
  return tx(async c=>{const probe=(await c.query('SELECT * FROM mantix.ocurrencias_preventivas WHERE id=$1',[key])).rows[0];if(!probe?.tomada_por)fail('El trabajo ya no tiene una toma pendiente.',409);if(!chief&&probe.tomada_por!==req.actor.id)fail('Solo puedes liberar tus propios trabajos.',403);
   // Mismo orden de locks que cierre e inicio: jornada, ocurrencia, orden.
   const j=(await c.query('SELECT fecha_operativa FROM mantix.asignaciones_turno WHERE id=$1',[probe.jornada_toma_id])).rows[0];await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mantix.turno.'+probe.tomada_por+'.'+guardDay.key(j.fecha_operativa)]);
   const r=(await c.query('SELECT * FROM mantix.ocurrencias_preventivas WHERE id=$1 FOR UPDATE',[key])).rows[0];if(!r.tomada_por||r.tomada_por!==probe.tomada_por||r.jornada_toma_id!==probe.jornada_toma_id)fail('La toma cambió. Actualiza la lista.',409);
   await c.query('SELECT id FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[r.orden_id]);if((await c.query('SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 LIMIT 1',[r.orden_id])).rowCount)fail('Ya hay avances. Debe entregarse por continuidad; no se puede liberar la toma.',409);
   await c.query("UPDATE mantix.ocurrencias_preventivas SET tomada_por=NULL,jornada_toma_id=NULL,tomada_en=NULL,estado='PROGRAMADA' WHERE id=$1",[key]);
   await audit(c,req.actor.id,'PROGRAMACION_LIBERADA',key,{motivo:reason.trim(),responsable_anterior:r.tomada_por,jornada_id:r.jornada_toma_id,orden_id:r.orden_id});return {liberado:true};
  });
 }
 app.post('/api/programacion/:id/cancelar',...write('preventivos.autorizar',req=>tx(async c=>{
  const key=req.params.id,reason=req.body?.motivo;if(!id(key)||typeof reason!=='string'||reason.trim().length<8||reason.length>1500)fail('Explica el motivo de cancelación (8 a 1500 caracteres).');
  const r=(await c.query('SELECT * FROM mantix.ocurrencias_preventivas WHERE id=$1 FOR UPDATE',[key])).rows[0];if(!r||r.tomada_por||!['PROGRAMADA','EN_PROCESO'].includes(r.estado))fail('Solo se cancela programación sin tomar ni iniciar.',409);
  if(r.orden_id){await c.query('SELECT id FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[r.orden_id]);if((await c.query('SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 LIMIT 1',[r.orden_id])).rowCount)fail('El trabajo ya tiene avances.',409);await c.query("UPDATE mantix.ordenes_trabajo SET estado_operativo='CANCELADA',version=version+1 WHERE id=$1",[r.orden_id]);}
  await c.query("UPDATE mantix.ocurrencias_preventivas SET estado='CANCELADA' WHERE id=$1",[key]);await audit(c,req.actor.id,'PROGRAMACION_CANCELADA',key,{motivo:reason.trim()});return {cancelado:true};
 })));
};
module.exports.currentDuty=currentDuty;
