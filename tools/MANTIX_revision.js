'use strict';
const {randomUUID:uuid}=require('node:crypto'),path=require('node:path');
const validId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text=(v,max=3000)=>typeof v==='string'&&v.length<=max?v.trim():'';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00Z'))&&new Date(v+'T12:00Z').toISOString().slice(0,10)===v;
const states=['NO_ENVIADA','EN_REVISION','APROBADA','RECHAZADA','CORRECCION_EN_PROCESO'];
module.exports=function(app,{pool,auth,permit,localWrite}){
 const wrap=fn=>async(req,res)=>{try{res.json({ok:true,...await fn(req)});}catch(e){console.error('[Revisión]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'No se pudo completar la revisión. Consulta la terminal.'});}};
 const read=(p,fn)=>[auth,permit(p),wrap(fn)],write=(p,fn)=>[localWrite,auth,permit(p),wrap(fn)];
 async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function audit(c,actor,action,entity,key,after,before=null){await c.query('INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_antes,datos_despues) VALUES($1,$2,$3,$4,$5,$6,$7)',[uuid(),actor,action,entity,key,before?JSON.stringify(before):null,JSON.stringify(after)]);}
 const from=`FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id JOIN mantix.usuarios u ON u.id=i.supervisor_id LEFT JOIN mantix.asignaciones_turno a ON a.id=i.asignacion_turno_id`;
 const select=`SELECT i.*,o.numero_orden,o.descripcion,o.tipo_mantenimiento_codigo,o.estado_operativo,u.nombre_mostrar supervisor,a.codigo_turno,
 COALESCE((SELECT json_agg(json_build_object('id',e.id,'nombre',e.nombre)) FROM mantix.intervencion_equipos ie JOIN mantix.equipos e ON e.id=ie.equipo_id WHERE ie.intervencion_id=i.id),'[]'::json) equipos,
 COALESCE((SELECT json_agg(json_build_object('id',e.id,'nombre',e.nombre,'inicio',x.inicio_participacion,'fin',x.fin_participacion)) FROM mantix.intervencion_ejecutantes x JOIN mantix.empleados e ON e.id=x.empleado_id WHERE x.intervencion_id=i.id),'[]'::json) ejecutantes,
 COALESCE((SELECT json_agg(json_build_object('tipo',p.tipo,'nombre',p.nombre_original,'estado',p.estado)) FROM mantix.propuestas_catalogo p WHERE p.intervencion_id=i.id AND p.estado='PENDIENTE'),'[]'::json) provisionales`;
 function filters(b,withState=true){const parts=[],args=[];const add=(sql,value)=>{args.push(value);parts.push(sql.replace('?',`$${args.length}`));};
  if(b.desde){if(!date(b.desde))fail('Fecha inicial inválida.');add('i.fecha_operativa>=?::date',b.desde);}
  if(b.hasta){if(!date(b.hasta))fail('Fecha final inválida.');add('i.fecha_operativa<=?::date',b.hasta);}
  if(b.desde&&b.hasta&&b.desde>b.hasta)fail('La fecha inicial debe ser anterior a la final.');
  if(b.supervisor){if(!validId(b.supervisor))fail('Supervisor inválido.');add('i.supervisor_id=?',b.supervisor);}
  if(b.turno){if(b.turno==='SIN_TURNO')parts.push('a.codigo_turno IS NULL');else{if(!['A','B','C','Q1','Q2','Q3','Q4','Q5','EXTRA'].includes(b.turno))fail('Turno inválido.');add('a.codigo_turno=?',b.turno);}}
  if(b.q){const q=text(b.q,100);if(!q)fail('Búsqueda demasiado larga.');args.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');const p='$'+args.length;parts.push(`(o.numero_orden ILIKE ${p} OR o.descripcion ILIKE ${p} OR i.actividades ILIKE ${p} OR u.nombre_mostrar ILIKE ${p})`);}
  if(withState&&b.estado&&b.estado!=='TODOS'){if(!states.includes(b.estado))fail('Estado de revisión inválido.');add('i.estado_revision=?',b.estado);}
  return {args,where:parts.length?' WHERE '+parts.join(' AND '):''};
 }
 app.get('/revision',auth,permit('revision.gestionar'),(req,res)=>res.sendFile(path.join(__dirname,'MANTIX_revision.html')));
 app.get('/correcciones',auth,permit('ordenes.registrar'),(req,res)=>res.sendFile(path.join(__dirname,'MANTIX_correcciones.html')));
 app.get('/api/revision/bandeja',...read('revision.gestionar',async req=>{
  const b=req.query,f=filters(b),all=filters(b,false),page=Number(b.pagina||1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail('Página inválida.');
  const [rows,count,summary]=await Promise.all([
   pool.query(select+' '+from+f.where+` ORDER BY i.enviada_revision_en ASC NULLS LAST,i.creada_en,i.id LIMIT 25 OFFSET $${f.args.length+1}`,[...f.args,(page-1)*25]),
   pool.query('SELECT count(*)::int total '+from+f.where,f.args),
   pool.query(`SELECT count(*) FILTER(WHERE i.estado_revision='EN_REVISION')::int pendientes,count(*) FILTER(WHERE i.estado_revision='APROBADA')::int aprobadas,count(*) FILTER(WHERE i.estado_revision='RECHAZADA')::int rechazadas,count(*) FILTER(WHERE i.estado_revision='CORRECCION_EN_PROCESO')::int correcciones `+from+all.where,all.args)
  ]);return {datos:rows.rows,total:count.rows[0].total,pagina:page,resumen:summary.rows[0]};
 }));
 app.get('/api/revision/jornadas',...read('revision.gestionar',async req=>{
  const f=filters(req.query,false),page=Number(req.query.pagina||1);if(!Number.isSafeInteger(page)||page<1||page>100000)fail('Página inválida.');
  const sql=`SELECT i.supervisor_id,u.nombre_mostrar supervisor,i.fecha_operativa,a.codigo_turno,count(*)::int intervenciones,count(DISTINCT i.orden_id)::int ordenes,count(*) FILTER(WHERE i.estado='TERMINADA')::int terminadas,count(*) FILTER(WHERE i.estado<>'TERMINADA')::int pendientes,count(*) FILTER(WHERE i.estado_revision='EN_REVISION')::int por_revisar `+from+f.where+` GROUP BY i.supervisor_id,u.nombre_mostrar,i.fecha_operativa,a.codigo_turno`;
  const [r,n]=await Promise.all([pool.query(sql+` ORDER BY i.fecha_operativa DESC,u.nombre_mostrar,a.codigo_turno LIMIT 25 OFFSET $${f.args.length+1}`,[...f.args,(page-1)*25]),pool.query('SELECT count(*)::int total FROM ('+sql+') grupos',f.args)]);return {datos:r.rows,total:n.rows[0].total,pagina:page};
 }));
 app.get('/api/revision/intervenciones/:id',...read('revision.gestionar',async req=>{
  if(!validId(req.params.id))fail('Intervención inválida.');
  const selected=(await pool.query(select+' '+from+' WHERE i.id=$1',[req.params.id])).rows[0];if(!selected)fail('Intervención no encontrada.',404);
  const [history,reviews,versions,events]=await Promise.all([
   pool.query(select+' '+from+' WHERE i.orden_id=$1 ORDER BY i.creada_en,i.id',[selected.orden_id]),
   pool.query(`SELECT r.*,u.nombre_mostrar revisor FROM mantix.revisiones r JOIN mantix.usuarios u ON u.id=r.revisor_id JOIN mantix.intervenciones i ON i.id=r.intervencion_id WHERE i.orden_id=$1 ORDER BY r.revisado_en,r.id`,[selected.orden_id]),
   pool.query('SELECT numero_version,datos_anteriores,datos_nuevos,modificado_en FROM mantix.versiones_intervencion WHERE intervencion_id=$1 ORDER BY numero_version',[selected.id]),
   pool.query(`SELECT s.*,u.nombre_mostrar supervisor FROM mantix.seguimientos s JOIN mantix.usuarios u ON u.id=s.supervisor_id WHERE s.orden_id=$1 ORDER BY s.ocurrido_en,s.id`,[selected.orden_id])
  ]);return {intervencion:selected,continuidad:history.rows,revisiones:reviews.rows,versiones:versions.rows,seguimientos:events.rows};
 }));
 // Conserva los endpoints usados por la bitácora 2.4, con validación en servidor.
 app.post('/api/v2/revisiones/enviar',...write('ordenes.registrar',req=>tx(async c=>{
  const ids=req.body?.intervenciones;if(!Array.isArray(ids)||!ids.length||ids.length>60||!ids.every(validId)||new Set(ids).size!==ids.length)fail('Selecciona intervenciones válidas.');let sent=0;
  for(const key of [...ids].sort()){
   const i=(await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1 FOR UPDATE',[key])).rows[0];if(!i||i.supervisor_id!==req.actor.id)fail('La intervención no pertenece a tu usuario.',403);
   if(i.estado!=='TERMINADA'||!i.inicio_real||!i.fin_real)fail('Solo se envían a revisión intervenciones terminadas con horarios completos.',409);
   if(i.estado_revision==='EN_REVISION')continue;
   if(!['NO_ENVIADA','CORRECCION_EN_PROCESO'].includes(i.estado_revision))fail('La intervención ya fue resuelta o requiere una corrección autorizada.',409);
   await c.query("UPDATE mantix.intervenciones SET estado_revision='EN_REVISION',enviada_revision_en=now(),resuelta_revision_en=NULL WHERE id=$1",[key]);
   await audit(c,req.actor.id,'INTERVENCION_ENVIADA','intervenciones',key,{version:i.version});sent++;
  }return {enviadas:sent,repetidas:ids.length-sent};
 })));
 app.post('/api/v2/revisiones/:id/resolver',...write('revision.gestionar',req=>tx(async c=>{
  const b=req.body||{},key=req.params.id;if(!validId(key)||!Number.isInteger(b.version)||!['APROBADA','RECHAZADA'].includes(b.resultado))fail('Indica resultado y versión de la intervención.');
  const reason=text(b.motivo);if(b.resultado==='RECHAZADA'&&reason.length<8)fail('Explica el motivo del rechazo (mínimo 8 caracteres).');
  const i=(await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1 FOR UPDATE',[key])).rows[0];
  if(!i)fail('Intervención no encontrada.',404);if(i.supervisor_id===req.actor.id)fail('No puedes revisar tu propio trabajo.',403);
  if(i.version!==b.version||i.estado_revision!=='EN_REVISION')fail('Este registro cambió o ya fue revisado. Actualiza la bandeja.',409);
  if(i.estado!=='TERMINADA')fail('No se puede aprobar una intervención pendiente o en proceso.',409);
  await c.query('INSERT INTO mantix.revisiones(id,intervencion_id,version_revisada,revisor_id,resultado,motivo) VALUES($1,$2,$3,$4,$5,$6)',[uuid(),key,i.version,req.actor.id,b.resultado,reason||null]);
  await c.query('UPDATE mantix.intervenciones SET estado_revision=$1,resuelta_revision_en=now() WHERE id=$2',[b.resultado,key]);
  if(b.resultado==='RECHAZADA'){
   const open=(await c.query("SELECT id FROM mantix.solicitudes_correccion WHERE intervencion_id=$1 AND estado IN ('SOLICITADA','AUTORIZADA') FOR UPDATE",[key])).rows[0];
   if(open)await c.query("UPDATE mantix.solicitudes_correccion SET estado='AUTORIZADA',supervisor_asignado_id=$1,autorizador_id=$2,resuelta_en=now(),motivo=$3 WHERE id=$4",[i.supervisor_id,req.actor.id,reason,open.id]);
   else await c.query("INSERT INTO mantix.solicitudes_correccion(id,intervencion_id,solicitante_id,supervisor_asignado_id,autorizador_id,motivo,estado,resuelta_en) VALUES($1,$2,$3,$3,$4,$5,'AUTORIZADA',now())",[uuid(),key,i.supervisor_id,req.actor.id,reason]);
  }
  await audit(c,req.actor.id,'REVISION_'+b.resultado,'intervenciones',key,{version:i.version,resultado:b.resultado,motivo:reason});return {resultado:b.resultado};
 })));
 app.get('/api/v2/correcciones/mias',...read('ordenes.registrar',async req=>({datos:(await pool.query(`SELECT s.*,i.actividades,i.estado estado_intervencion,i.version,i.inicio_real,i.fin_real,o.numero_orden,o.descripcion,(SELECT json_agg(x.empleado_id) FROM mantix.intervencion_ejecutantes x WHERE x.intervencion_id=i.id) ejecutantes FROM mantix.solicitudes_correccion s JOIN mantix.intervenciones i ON i.id=s.intervencion_id JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id WHERE s.supervisor_asignado_id=$1 AND (s.estado='AUTORIZADA' OR (s.estado='APLICADA' AND i.estado_revision='CORRECCION_EN_PROCESO')) ORDER BY s.solicitada_en`,[req.actor.id])).rows})));
 app.post('/api/v2/correcciones/:id/aplicar',...write('ordenes.registrar',req=>tx(async c=>{
  const key=req.params.id,b=req.body||{},acts=text(b.actividades,5000);if(!validId(key)||acts.length<5)fail('Completa las actividades corregidas.');
  // Mismo orden de locks que resolver: intervención, después solicitud.
  const probe=(await c.query('SELECT intervencion_id FROM mantix.solicitudes_correccion WHERE id=$1',[key])).rows[0];if(!probe)fail('Solicitud no encontrada.',404);
  const i=(await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1 FOR UPDATE',[probe.intervencion_id])).rows[0];
  const s=(await c.query('SELECT * FROM mantix.solicitudes_correccion WHERE id=$1 FOR UPDATE',[key])).rows[0];
  if(s.estado!=='AUTORIZADA'||s.supervisor_asignado_id!==req.actor.id)fail('No tienes autorización para esta corrección.',403);
  if(b.version!==undefined&&b.version!==i.version)fail('La intervención cambió. Recarga Correcciones.',409);
  if(i.estado_revision==='EN_REVISION')fail('Espera la resolución del jefe antes de corregir.',409);
  const begin=b.inicio===undefined?i.inicio_real:(b.inicio?new Date(b.inicio):null),end=b.fin===undefined?i.fin_real:(b.fin?new Date(b.fin):null);
  if((begin&&!Number.isFinite(+new Date(begin)))||(end&&!Number.isFinite(+new Date(end)))||(end&&!begin)||(begin&&end&&new Date(end)<new Date(begin))||(i.estado==='TERMINADA'&&(!begin||!end)))fail('Revisa las fechas y horas corregidas.');
  const before=(await c.query('SELECT empleado_id FROM mantix.intervencion_ejecutantes WHERE intervencion_id=$1',[i.id])).rows.map(e=>e.empleado_id),staff=b.ejecutantes===undefined?before:b.ejecutantes;
  if(!Array.isArray(staff)||staff.length>50||!staff.every(validId)||new Set(staff).size!==staff.length)fail('Ejecutantes inválidos.');
  if(b.ejecutantes!==undefined&&(await c.query('SELECT id FROM mantix.empleados WHERE id=ANY($1::uuid[]) AND (activo OR id=ANY($2::uuid[]))',[staff,before])).rowCount!==staff.length)fail('Hay ejecutantes inactivos.');
  const provisional=await c.query("SELECT 1 FROM mantix.propuestas_catalogo WHERE intervencion_id=$1 AND tipo='EJECUTANTE' AND estado='PENDIENTE' LIMIT 1",[i.id]);if(!staff.length&&!provisional.rowCount)fail('La intervención necesita al menos un ejecutante.');
  const next=i.version+1,after={actividades:acts,inicio_real:begin,fin_real:end,ejecutantes:staff,version:next};
  await c.query('INSERT INTO mantix.versiones_intervencion(id,intervencion_id,numero_version,solicitud_correccion_id,datos_anteriores,datos_nuevos,modificado_por) VALUES($1,$2,$3,$4,$5,$6,$7)',[uuid(),i.id,next,key,JSON.stringify({...i,ejecutantes:before}),JSON.stringify(after),req.actor.id]);
  await c.query("UPDATE mantix.intervenciones SET actividades=$1,inicio_real=$2,fin_real=$3,version=$4,estado_revision='CORRECCION_EN_PROCESO',enviada_revision_en=NULL,resuelta_revision_en=NULL WHERE id=$5",[acts,begin,end,next,i.id]);
  // No reemplaza participaciones históricas ni sus horas individuales si no se modificó la selección.
  for(const employee of before.filter(x=>!staff.includes(x)))await c.query('DELETE FROM mantix.intervencion_ejecutantes WHERE intervencion_id=$1 AND empleado_id=$2',[i.id,employee]);
  for(const employee of staff.filter(x=>!before.includes(x)))await c.query('INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id) VALUES($1,$2)',[i.id,employee]);
  await c.query("UPDATE mantix.solicitudes_correccion SET estado='APLICADA' WHERE id=$1",[key]);await audit(c,req.actor.id,'CORRECCION_APLICADA','intervenciones',i.id,after);return {intervencion_id:i.id,version:next};
 })));
 app.post('/api/v2/correcciones/:id/enviar',...write('ordenes.registrar',req=>tx(async c=>{
  if(!validId(req.params.id))fail('Solicitud inválida.');
  const probe=(await c.query('SELECT intervencion_id FROM mantix.solicitudes_correccion WHERE id=$1',[req.params.id])).rows[0];if(!probe)fail('Solicitud inexistente.',404);
  const i=(await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1 FOR UPDATE',[probe.intervencion_id])).rows[0];
  const s=(await c.query('SELECT * FROM mantix.solicitudes_correccion WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
  if(s.estado!=='APLICADA'||s.supervisor_asignado_id!==req.actor.id)fail('Solicitud no aplicada para tu usuario.',403);
  if(i.estado_revision==='EN_REVISION')return {repetido:true};
  if(i.estado_revision!=='CORRECCION_EN_PROCESO'||i.estado!=='TERMINADA')fail('La corrección no está lista para revisión.',409);
  await c.query("UPDATE mantix.intervenciones SET estado_revision='EN_REVISION',enviada_revision_en=now(),resuelta_revision_en=NULL WHERE id=$1",[i.id]);await audit(c,req.actor.id,'CORRECCION_ENVIADA','intervenciones',i.id,{version:i.version});return {intervencion_id:i.id};
 })));
};
