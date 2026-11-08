'use strict';
// MANTIX 2.0 - Extensiones integradas de desarrollo, PostgreSQL esquema mantix.
// No crea tablas ni inicia trabajos sin acciones explicitas del usuario.
const crypto=require('node:crypto');
const path=require('node:path');
const uuid=()=>crypto.randomUUID();
const isId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const text=(v,n=3000)=>typeof v==='string'?v.trim().slice(0,n):'';
const isDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v+'T12:00:00Z'));
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?/^\d/.test(v)?new Date(v):null:null;
const error=(message,status=400)=>Object.assign(new Error(message),{status});
module.exports=function(app,ctx){
const {pool,auth,permit,localWrite}=ctx;
const q=(sql,params=[])=>pool.query(sql,params);
async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}}
function wrap(fn){return async(req,res)=>{try{const result=await fn(req);res.json({ok:true,...(result||{})});}catch(e){console.error('[MANTIX]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'La operacion no pudo completarse. Revisa la terminal.'});}};}
async function audit(c,actor,action,entity,id,after,before){await c.query(`INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_antes,datos_despues) VALUES($1,$2,$3,$4,$5,$6,$7)`,[uuid(),actor,action,entity,id,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);}
const guard=role=>(req,res,next)=>auth(req,res,()=>permit(role)(req,res,next));
const write=(role,handler)=>[localWrite,auth,permit(role),wrap(handler)];
const read=(role,handler)=>[auth,permit(role),wrap(handler)];
const handoffStates=['PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD'];
// Portal central sin acceso publico a datos.
app.get('/centro',auth,(req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
app.get('/bitacora',auth,permit('ordenes.registrar'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
app.get('/historial',auth,permit('ordenes.leer'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
app.get('/preventivos',auth,permit('catalogos.leer'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
app.get('/turnos',auth,permit('ordenes.registrar'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
app.get('/catalogos',auth,permit('catalogos.administrar'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
app.get('/auditoria',auth,permit('auditoria.leer'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_centro.html')));
// HISTORIAL: filtros SQL, historial no editable y equipos/ejecutantes vinculados.
app.get('/api/v2/historial',...read('ordenes.leer',async(req)=>{
 const b=req.query;let conditions=[],params=[];
 if(req.actor.roles?.includes('SUPERVISOR')&&!req.actor.roles?.some(x=>['JEFE','COORDINADOR','ADMINISTRADOR'].includes(x))){params.push(req.actor.id);conditions.push(`(o.creada_por=$${params.length} OR EXISTS(SELECT 1 FROM mantix.intervenciones ix WHERE ix.orden_id=o.id AND ix.supervisor_id=$${params.length}))`);}
 if(b.estado){params.push(String(b.estado));conditions.push(`o.estado_operativo=$${params.length}`);}
 if(b.tipo){params.push(String(b.tipo));conditions.push(`o.tipo_mantenimiento_codigo=$${params.length}`);}
 if(b.desde&&isDate(b.desde)){params.push(b.desde);conditions.push(`o.creada_en >= $${params.length}::date`);}
 if(b.hasta&&isDate(b.hasta)){params.push(b.hasta);conditions.push(`o.creada_en < ($${params.length}::date + interval '1 day')`);}
 if(b.q){params.push('%'+String(b.q).slice(0,100).replace(/[%_]/g,'')+'%');conditions.push(`(o.descripcion ILIKE $${params.length} OR o.numero_orden ILIKE $${params.length})`);}
 const r=await q(`SELECT o.id,o.numero_orden,o.modalidad_registro,o.descripcion,o.tipo_mantenimiento_codigo,o.estado_operativo,o.creada_en,
 u.nombre_mostrar AS creador, (SELECT count(*)::int FROM mantix.intervenciones i WHERE i.orden_id=o.id) AS intervenciones,
 (SELECT string_agg(e.nombre,', ' ORDER BY e.nombre) FROM mantix.orden_equipos oe JOIN mantix.equipos e ON e.id=oe.equipo_id WHERE oe.orden_id=o.id) AS equipos
 FROM mantix.ordenes_trabajo o JOIN mantix.usuarios u ON u.id=o.creada_por
 ${conditions.length?'WHERE '+conditions.join(' AND '):''} ORDER BY o.creada_en DESC LIMIT 250`,params);
 return {datos:r.rows};
}));
app.get('/api/v2/historial/:id',...read('ordenes.leer',async(req)=>{
 if(!isId(req.params.id))throw error('Orden invalida');
 const o=await q(`SELECT o.*,u.nombre_mostrar AS creador FROM mantix.ordenes_trabajo o JOIN mantix.usuarios u ON u.id=o.creada_por WHERE o.id=$1`,[req.params.id]);
 if(!o.rowCount)throw error('Orden no encontrada',404);
 if(req.actor.roles?.includes('SUPERVISOR')&&!req.actor.roles?.some(x=>['JEFE','COORDINADOR','ADMINISTRADOR'].includes(x))){const v=await q('SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 AND supervisor_id=$2 UNION ALL SELECT 1 FROM mantix.ordenes_trabajo WHERE id=$1 AND creada_por=$2 LIMIT 1',[req.params.id,req.actor.id]);if(!v.rowCount)throw error('No autorizado para consultar esta orden.',403);}
 const [eq,iv,seg,rev]=await Promise.all([
 q(`SELECT e.id,e.nombre FROM mantix.orden_equipos oe JOIN mantix.equipos e ON e.id=oe.equipo_id WHERE oe.orden_id=$1 ORDER BY oe.principal DESC`,[req.params.id]),
 q(`SELECT i.*,u.nombre_mostrar supervisor, COALESCE((SELECT json_agg(json_build_object('clave',e.clave,'nombre',e.nombre)) FROM mantix.intervencion_ejecutantes x JOIN mantix.empleados e ON e.id=x.empleado_id WHERE x.intervencion_id=i.id),'[]'::json) ejecutantes FROM mantix.intervenciones i JOIN mantix.usuarios u ON u.id=i.supervisor_id WHERE i.orden_id=$1 ORDER BY i.creada_en,i.id`,[req.params.id]),
 q(`SELECT s.*,u.nombre_mostrar supervisor FROM mantix.seguimientos s JOIN mantix.usuarios u ON u.id=s.supervisor_id WHERE s.orden_id=$1 ORDER BY s.ocurrido_en`,[req.params.id]),
 q(`SELECT r.*,u.nombre_mostrar revisor FROM mantix.revisiones r JOIN mantix.intervenciones i ON i.id=r.intervencion_id JOIN mantix.usuarios u ON u.id=r.revisor_id WHERE i.orden_id=$1 ORDER BY r.revisado_en`,[req.params.id])]);
 return {orden:o.rows[0],equipos:eq.rows,intervenciones:iv.rows,seguimientos:seg.rows,revisiones:rev.rows};
}));
// REVISION por intervencion, no por orden global.
app.get('/api/v2/revisiones/pendientes',...read('revision.gestionar',async()=>{
 const r=await q(`SELECT i.id,i.version,i.actividades,i.estado,i.fecha_operativa,i.inicio_real,i.fin_real,o.numero_orden,o.descripcion,o.id AS orden_id,u.nombre_mostrar AS supervisor FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id JOIN mantix.usuarios u ON u.id=i.supervisor_id WHERE i.estado_revision='EN_REVISION' ORDER BY i.creada_en LIMIT 200`);return {datos:r.rows};
}));
// Envíos y decisiones centralizados en MANTIX_revision.js.
app.get('/api/v2/supervisores',...read('revision.gestionar',async()=>{const r=await q(`SELECT u.id,u.nombre_mostrar FROM mantix.usuarios u JOIN mantix.usuario_roles ur ON ur.usuario_id=u.id JOIN mantix.roles r ON r.id=ur.rol_id WHERE u.activo=true AND r.codigo='SUPERVISOR' ORDER BY u.nombre_mostrar`);return {datos:r.rows};}));
// Correcciones: solicitud -> autorizacion -> version -> reenvio -> revisión.
app.post('/api/v2/correcciones',...write('ordenes.registrar',async(req)=>{
 const id=req.body?.intervencion_id,motivo=text(req.body?.motivo);if(!isId(id)||motivo.length<8)throw error('Intervencion y motivo obligatorios.');
 return tx(async c=>{const r=await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1',[id]);if(!r.rowCount)throw error('No existe la intervencion',404);if(r.rows[0].supervisor_id!==req.actor.id)throw error('Solo el responsable puede solicitar corrección de su intervención.',403);if(!['RECHAZADA','APROBADA','NO_ENVIADA','EN_REVISION'].includes(r.rows[0].estado_revision))throw error('Estado no permitido.',409);
 const open=await c.query("SELECT id FROM mantix.solicitudes_correccion WHERE intervencion_id=$1 AND estado IN ('SOLICITADA','AUTORIZADA')",[id]);if(open.rowCount)throw error('Ya existe una solicitud abierta.',409);
 const sid=uuid();await c.query('INSERT INTO mantix.solicitudes_correccion(id,intervencion_id,solicitante_id,motivo) VALUES($1,$2,$3,$4)',[sid,id,req.actor.id,motivo]);await audit(c,req.actor.id,'CORRECCION_SOLICITADA','intervenciones',id,{solicitud:sid,motivo});return {id:sid};});
}));
app.get('/api/v2/correcciones',...read('revision.gestionar',async()=>{const r=await q(`SELECT s.*,u.nombre_mostrar solicitante,i.actividades FROM mantix.solicitudes_correccion s JOIN mantix.usuarios u ON u.id=s.solicitante_id JOIN mantix.intervenciones i ON i.id=s.intervencion_id WHERE s.estado IN ('SOLICITADA','AUTORIZADA') ORDER BY s.solicitada_en DESC LIMIT 150`);return {datos:r.rows};}));
app.post('/api/v2/correcciones/:id/autorizar',...write('revision.gestionar',async(req)=>{
 const id=req.params.id,b=req.body||{};if(!isId(id)||!['AUTORIZADA','RECHAZADA'].includes(b.decision)||(b.supervisor_id&&!isId(b.supervisor_id)))throw error('Decision o supervisor invalido.');
 return tx(async c=>{const r=await c.query('SELECT * FROM mantix.solicitudes_correccion WHERE id=$1 FOR UPDATE',[id]);const s=r.rows[0];if(!s||s.estado!=='SOLICITADA')throw error('Solicitud no disponible.',409);
 const assigned=b.decision==='AUTORIZADA'?(b.supervisor_id||s.solicitante_id):null;
 if(assigned){const ok=await c.query(`SELECT 1 FROM mantix.usuarios u JOIN mantix.usuario_roles ur ON ur.usuario_id=u.id JOIN mantix.roles r ON r.id=ur.rol_id WHERE u.id=$1 AND u.activo AND r.codigo='SUPERVISOR'`,[assigned]);if(!ok.rowCount)throw error('Supervisor asignado no autorizado.',400);}
 await c.query('UPDATE mantix.solicitudes_correccion SET estado=$1,autorizador_id=$2,supervisor_asignado_id=$3,resuelta_en=now() WHERE id=$4',[b.decision,req.actor.id,assigned,id]);await audit(c,req.actor.id,'CORRECCION_'+b.decision,'intervenciones',s.intervencion_id,{solicitud:id,asignado:assigned});return {decision:b.decision};});
}));
// Aplicación y reenvío de correcciones centralizados en MANTIX_revision.js.
// TURNOS: seleccion explícita de asignaciones, horario real, cierre formal.
app.get('/api/v2/bitacora',...read('ordenes.registrar',async(req)=>{
 const date=String(req.query.fecha||'');if(!isDate(date))throw error('Fecha operativa inválida.');
 const [rows,shift]=await Promise.all([
 q(`SELECT i.id,i.orden_id,i.fecha_operativa,i.inicio_real,i.fin_real,i.actividades,i.estado,i.estado_revision,i.version,i.entregada_en,
 o.numero_orden,o.modalidad_registro,o.descripcion AS orden_descripcion,
 COALESCE((SELECT string_agg(e.nombre,', ' ORDER BY e.nombre) FROM mantix.intervencion_equipos ie JOIN mantix.equipos e ON e.id=ie.equipo_id WHERE ie.intervencion_id=i.id),'') AS equipos,
 COALESCE((SELECT string_agg(p.nombre_original,', ') FROM mantix.propuestas_catalogo p WHERE p.intervencion_id=i.id AND p.tipo='EQUIPO' AND p.estado='PENDIENTE'),'') AS equipos_provisionales,
 COALESCE((SELECT string_agg(e.nombre,', ' ORDER BY e.nombre) FROM mantix.intervencion_ejecutantes x JOIN mantix.empleados e ON e.id=x.empleado_id WHERE x.intervencion_id=i.id),'') AS ejecutantes,
 COALESCE((SELECT string_agg(p.nombre_original,', ') FROM mantix.propuestas_catalogo p WHERE p.intervencion_id=i.id AND p.tipo='EJECUTANTE' AND p.estado='PENDIENTE'),'') AS ejecutantes_provisionales
 FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id
 WHERE i.supervisor_id=$1 AND i.fecha_operativa=$2 ORDER BY i.inicio_real NULLS LAST,i.creada_en`,[req.actor.id,date]),
 q(`SELECT a.*,c.id AS cierre_id FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno c ON c.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 AND a.fecha_operativa=$2 ORDER BY a.creado_en DESC LIMIT 2`,[req.actor.id,date])
 ]);
 return {datos:rows.rows,turnos:shift.rows};
}));
app.get('/api/v2/turnos/recomendacion',...read('ordenes.registrar',async(req)=>{
 const fecha=String(req.query.fecha||'');if(!isDate(fecha))throw error('Fecha inválida.');
 const dia=new Date(fecha+'T12:00:00Z').getUTCDay();
 const defaultTimes={A:'23:00–07:00 (día siguiente)',B:'07:00–15:00',C:'15:00–23:00',Q:'07:00–12:00 y 14:00–17:00'};
 if(dia===0)return {domingo:true,codigo_sugerido:'EXTRA',aviso:'Domingo: jornada extraordinaria voluntaria, sin asignación automática. Introduce las horas reales.',horarios:defaultTimes};
 // Referencia de calendario confirmada: semana 02-nov-2026. Se recomienda pero no se asigna automáticamente.
 const ref=Date.UTC(2026,10,2),t=Date.parse(fecha+'T12:00:00Z');const weeks=Math.floor((t-ref)/(7*86400000));
 const rotation={GERARDO:['B','A','C'],VICTOR:['C','B','A'],VENANCIO:['A','C','B']};
 // Identificación orientativa: el vínculo del empleado es prioritario frente al nombre de pantalla.
 // Las excepciones deberán confirmarse con un calendario autorizado; nunca se autoasignan.
 const userInfo=await q(`SELECT COALESCE(e.nombre,u.nombre_mostrar) AS nombre FROM mantix.usuarios u LEFT JOIN mantix.empleados e ON e.id=u.empleado_id WHERE u.id=$1`,[req.actor.id]);
 const nombre=String(userInfo.rows[0]?.nombre||req.actor.nombre||'').toUpperCase();
 const key=Object.keys(rotation).find(k=>new RegExp('(^|\\s)'+k+'(\\s|$)').test(nombre));
 const fixed=[['EDGAR','Q1'],['JOCSAN','Q2'],['LORENZO','Q3'],['JESUS','Q4'],['JESÚS','Q4'],['BRYAN','Q5']];
 const qCode=fixed.find(([n])=>nombre.split(/\s+/).includes(n))?.[1];
 const recomendado=key?rotation[key][((weeks%3)+3)%3]:qCode||null;
 return {domingo:false,codigo_sugerido:recomendado,horarios:defaultTimes,aviso:recomendado?`Jornada sugerida ${recomendado}. Confirma antes de iniciar; las excepciones se registran manualmente.`:'No fue posible identificar un horario; selecciona el turno autorizado para esta jornada.'};
}));
// Resumen para la tarjeta de jornada inteligente y el cierre guiado.
app.get('/api/v2/turnos/resumen',...read('ordenes.registrar',async(req)=>{
 const fecha=String(req.query.fecha||'');if(!isDate(fecha))throw error('Fecha operativa inválida.');
 const [j,counts,pendientes]=await Promise.all([
 q(`SELECT a.*,c.id AS cierre_id,c.cerrado_en FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno c ON c.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 AND a.fecha_operativa=$2 ORDER BY a.creado_en DESC LIMIT 1`,[req.actor.id,fecha]),
 q(`SELECT count(*)::int total,count(*) FILTER (WHERE estado='TERMINADA')::int terminadas,count(*) FILTER (WHERE estado IN ('EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD'))::int abiertas FROM mantix.intervenciones WHERE supervisor_id=$1 AND fecha_operativa=$2`,[req.actor.id,fecha]),
 q(`SELECT i.id,i.actividades,i.estado,o.numero_orden,o.descripcion FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id WHERE i.supervisor_id=$1 AND i.fecha_operativa=$2 AND i.estado IN ('EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD') AND i.entregada_en IS NULL AND NOT EXISTS(SELECT 1 FROM mantix.intervenciones n WHERE n.orden_id=i.orden_id AND n.creada_en>i.creada_en) ORDER BY i.creada_en LIMIT 100`,[req.actor.id,fecha])
 ]);
 return {jornada:j.rows[0]||null,conteos:counts.rows[0],pendientes_sin_entrega:pendientes.rows};
}));
app.get('/api/v2/turnos',...read('ordenes.registrar',async(req)=>{const r=await q(`SELECT a.*,c.id AS cierre_id,c.cerrado_en FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno c ON c.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 ORDER BY a.fecha_operativa DESC,a.creado_en DESC LIMIT 90`,[req.actor.id]);return {datos:r.rows};}));
app.post('/api/v2/turnos',...write('ordenes.registrar',async(req)=>{
 const b=req.body||{},codigo=b.turno,fecha=b.fecha_operativa;
 if(!isDate(fecha)||!['A','B','C','Q1','Q2','Q3','Q4','Q5','EXTRA'].includes(codigo))throw error('Turno o fecha invalidos.');
 const domingo=new Date(fecha+'T12:00:00Z').getUTCDay()===0;
 if(domingo&&codigo!=='EXTRA')throw error('En domingo solo se puede registrar jornada extraordinaria EXTRA; no hay turno automático.');
 if(!domingo&&codigo==='EXTRA'&&!b.justificacion_extra)throw error('La jornada EXTRA fuera del domingo requiere una justificación.');
 const inicio=b.inicio_real?iso(b.inicio_real):null,fin=b.fin_real?iso(b.fin_real):null;
 if((b.inicio_real&&!inicio)||(b.fin_real&&!fin)||(fin&&!inicio)||(inicio&&fin&&fin<=inicio))throw error('Revisa los horarios reales de la jornada.');
 if(domingo&&!inicio)throw error('Domingo extraordinario: registra al menos la hora real de inicio. La hora de salida puede completarse antes del cierre.');
 // Se registra la asignacion real. La rotacion semanal se controla con el calendario de jefatura.
 const r=await tx(async c=>{
 // Serializa la creación por supervisor+fecha; evita dos jornadas por doble clic.
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mantix.turno.'+req.actor.id+'.'+fecha]);
 const existing=await c.query(`SELECT a.id,a.codigo_turno,ct.id cierre_id FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 AND a.fecha_operativa=$2 ORDER BY a.creado_en DESC LIMIT 1`,[req.actor.id,fecha]);
 if(existing.rowCount){if(existing.rows[0].codigo_turno!==codigo)throw error('Ya hay una jornada registrada en esta fecha. Consulta Mi turno; no crees otra.',409);if(existing.rows[0].cierre_id)throw error('La jornada ya está cerrada.',409);return existing.rows[0].id;}
 const id=uuid();await c.query(`INSERT INTO mantix.asignaciones_turno(id,supervisor_id,fecha_operativa,codigo_turno,extraordinario,creado_por,inicio_real,fin_real,observaciones) VALUES($1,$2,$3,$4,$5,$2,$6,$7,$8)`,[id,req.actor.id,fecha,codigo,codigo==='EXTRA',inicio,fin,text(b.justificacion_extra,500)||null]);
 await audit(c,req.actor.id,'JORNADA_INICIADA','asignaciones_turno',id,{fecha_operativa:fecha,codigo_turno:codigo});return id;
 });return {id:r};
}));
app.patch('/api/v2/turnos/:id/horario',localWrite,auth,permit('ordenes.registrar'),wrap(async(req)=>{
 const id=req.params.id,fin=iso(req.body?.fin_real);
 if(!isId(id)||!fin)throw error('Introduce una hora final válida.');
 return tx(async c=>{
  const r=await c.query(`SELECT a.*,ct.id AS cierre_id FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.id=$1 FOR UPDATE OF a`,[id]);
  const a=r.rows[0];if(!a||a.supervisor_id!==req.actor.id)throw error('Turno no autorizado.',403);
  if(a.cierre_id)throw error('El turno ya está cerrado.',409);
  if(!a.inicio_real||new Date(fin)<=new Date(a.inicio_real))throw error('La hora final debe ser posterior al inicio real.');
  await c.query('UPDATE mantix.asignaciones_turno SET fin_real=$1 WHERE id=$2',[fin,id]);
  await audit(c,req.actor.id,'HORARIO_TURNO_ACTUALIZADO','asignaciones_turno',id,{fin_real:fin});return {id};
 });
}));
// Resumen y confirmación única: entregas, envío y cierre se confirman juntos.
const guardDay=require('./MANTIX_jornada_guard');
async function closureRows(c,actor,fecha){return (await c.query(`SELECT i.*,o.numero_orden,o.descripcion,
 (SELECT n.id FROM mantix.intervenciones n WHERE n.orden_id=i.orden_id ORDER BY n.creada_en DESC,n.id DESC LIMIT 1) ultima_id,
 (SELECT s.descripcion FROM mantix.seguimientos s WHERE s.intervencion_id=i.id AND s.tipo='ENTREGA' ORDER BY s.registrado_en DESC,s.id DESC LIMIT 1) detalle_entrega
 FROM mantix.intervenciones i JOIN mantix.ordenes_trabajo o ON o.id=i.orden_id WHERE i.supervisor_id=$1 AND i.fecha_operativa=$2 ORDER BY i.id`,[actor,fecha])).rows;}
function closureRevision(j,rows){return crypto.createHash('sha256').update(JSON.stringify([j.id,j.inicio_real,j.fin_real,rows.map(i=>[i.id,i.version,i.estado,i.estado_revision,i.inicio_real,i.fin_real,i.actividades,i.entregada_en,i.ultima_id,i.detalle_entrega])])).digest('hex');}
app.get('/api/v2/turnos/:id/preparar-cierre',...read('ordenes.registrar',async req=>{
 if(!isId(req.params.id))throw error('Jornada inválida.');
 const j=(await q('SELECT a.*,ct.id cierre_id FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.id=$1',[req.params.id])).rows[0];
 if(!j||j.supervisor_id!==req.actor.id)throw error('Jornada no autorizada.',403);
 const rows=await closureRows(pool,req.actor.id,j.fecha_operativa);
 return {jornada:j,revision:closureRevision(j,rows),trabajos:rows.map(i=>({...i,requiere_entrega:i.id===i.ultima_id&&!i.entregada_en&&['EN_PROCESO',...handoffStates].includes(i.estado),para_enviar:i.estado==='TERMINADA'&&i.estado_revision==='NO_ENVIADA'}))};
}));
app.post('/api/v2/turnos/:id/cerrar',...write('ordenes.registrar',async req=>{
 const id=req.params.id,b=req.body||{};if(!isId(id))throw error('Turno inválido.');
 return tx(async c=>{
  const probe=(await c.query('SELECT * FROM mantix.asignaciones_turno WHERE id=$1',[id])).rows[0];
  if(!probe||probe.supervisor_id!==req.actor.id)throw error('Turno no pertenece a tu usuario.',403);
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mantix.turno.'+req.actor.id+'.'+guardDay.key(probe.fecha_operativa)]);
  const a=(await c.query('SELECT * FROM mantix.asignaciones_turno WHERE id=$1 FOR UPDATE',[id])).rows[0];
  const existing=(await c.query('SELECT id FROM mantix.cierres_turno WHERE asignacion_turno_id=$1',[id])).rows[0];
  if(existing){const previous=(await c.query("SELECT datos_despues FROM mantix.auditoria WHERE entidad_id=$1 AND accion='TURNO_CERRADO' ORDER BY registrada_en DESC LIMIT 1",[existing.id])).rows[0]?.datos_despues||{};return {cierre_id:existing.id,repetido:true,enviadas:previous.enviadas||0,entregadas:previous.entregadas||0};}
  // Orden de locks compatible con toma/entrega: jornada, órdenes, intervenciones.
  const orders=await c.query('SELECT DISTINCT orden_id FROM mantix.intervenciones WHERE supervisor_id=$1 AND fecha_operativa=$2 ORDER BY orden_id',[req.actor.id,a.fecha_operativa]);
  for(const o of orders.rows)await c.query('SELECT id FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[o.orden_id]);
  await c.query('SELECT id FROM mantix.intervenciones WHERE supervisor_id=$1 AND fecha_operativa=$2 ORDER BY id FOR UPDATE',[req.actor.id,a.fecha_operativa]);
  const rows=await closureRows(c,req.actor.id,a.fecha_operativa);
  if(b.revision!==closureRevision(a,rows))throw error('La bitácora cambió. Cierra este resumen y vuelve a revisar el turno antes de confirmar.',409);
  const end=b.fin_real==null?a.fin_real:iso(b.fin_real);
  if(b.fin_real!=null&&!end)throw error('Hora real de salida inválida.');
  if(a.extraordinario&&(!a.inicio_real||!end||new Date(end)<=new Date(a.inicio_real)))throw error('La jornada extraordinaria requiere una salida posterior a la entrada.',409);
  const deliveries=b.entregas||[];if(!Array.isArray(deliveries)||deliveries.length>rows.length||deliveries.some(d=>!d||!isId(d.id))||new Set(deliveries.map(d=>d.id)).size!==deliveries.length)throw error('Entregas inválidas.');
  const pending=rows.filter(i=>i.id===i.ultima_id&&!i.entregada_en&&['EN_PROCESO',...handoffStates].includes(i.estado));
  if(deliveries.length!==pending.length||deliveries.some(d=>!pending.some(i=>i.id===d.id)))throw error('Completa la entrega de cada trabajo pendiente.',409);
  for(const i of rows.filter(i=>i.estado==='TERMINADA'&&i.estado_revision==='NO_ENVIADA'))if(!i.inicio_real||!i.fin_real||new Date(i.fin_real)<new Date(i.inicio_real)||!i.actividades?.trim())throw error('Completa los horarios y actividades de '+(i.numero_orden||i.descripcion)+' antes de enviar.',409);
  for(const i of pending){const d=deliveries.find(x=>x.id===i.id);if(typeof d.detalle!=='string'||d.detalle.trim().length<10||d.detalle.length>3000||!handoffStates.includes(d.estado))throw error('Explica qué falta (10 a 3000 caracteres) y elige continuidad o refacción para '+(i.numero_orden||i.descripcion)+'.');
   if(i.estado_revision!=='NO_ENVIADA')throw error('El pendiente ya cambió de revisión. Actualiza tu bitácora.',409);
   if((await c.query('SELECT 1 FROM mantix.tomas_activas WHERE orden_id=$1 AND expira_en>now()',[i.orden_id])).rowCount)throw error('Un pendiente está tomado. Actualiza el resumen antes de cerrar.',409);
  }
  const cid=uuid();let sent=0;
  if(a.extraordinario)await c.query('UPDATE mantix.asignaciones_turno SET fin_real=$1 WHERE id=$2',[end,id]);
  await c.query('INSERT INTO mantix.cierres_turno(id,asignacion_turno_id,cerrado_por,observaciones) VALUES($1,$2,$3,$4)',[cid,id,req.actor.id,text(b.observaciones,1500)]);
  for(const i of pending){const d=deliveries.find(x=>x.id===i.id),detail=d.detalle.trim();
   await c.query('UPDATE mantix.intervenciones SET estado=$1,entregada_en=now(),version=version+1 WHERE id=$2',[d.estado,i.id]);
   await c.query("UPDATE mantix.ordenes_trabajo SET estado_operativo='PENDIENTE',version=version+1 WHERE id=$1",[i.orden_id]);
   await c.query("INSERT INTO mantix.seguimientos(id,orden_id,intervencion_id,supervisor_id,tipo,descripcion,ocurrido_en) VALUES($1,$2,$3,$4,'ENTREGA',$5,now())",[uuid(),i.orden_id,i.id,req.actor.id,detail]);
   await audit(c,req.actor.id,'PENDIENTE_ENTREGADO','ordenes_trabajo',i.orden_id,{intervencion_id:i.id,detalle:detail,cierre_id:cid});
  }
  for(const i of rows.filter(i=>i.estado==='TERMINADA'&&i.estado_revision==='NO_ENVIADA')){
   await c.query("UPDATE mantix.intervenciones SET estado_revision='EN_REVISION',enviada_revision_en=now(),resuelta_revision_en=NULL WHERE id=$1",[i.id]);
   await audit(c,req.actor.id,'INTERVENCION_ENVIADA','intervenciones',i.id,{version:i.version,cierre_id:cid});sent++;
  }
  const delivered=await closureRows(c,req.actor.id,a.fecha_operativa);
  for(const i of delivered.filter(i=>handoffStates.includes(i.estado)&&i.entregada_en))await c.query('INSERT INTO mantix.entregas_pendientes(id,orden_id,intervencion_origen_id,cierre_turno_id,detalle_pendiente) SELECT $1,$2,$3,$4,$5 WHERE NOT EXISTS(SELECT 1 FROM mantix.entregas_pendientes WHERE intervencion_origen_id=$3)',[uuid(),i.orden_id,i.id,cid,i.detalle_entrega||'Pendiente entregado']);
  await audit(c,req.actor.id,'TURNO_CERRADO','cierres_turno',cid,{asignacion:id,enviadas:sent,entregadas:pending.length});return {cierre_id:cid,enviadas:sent,entregadas:pending.length};
 });
}));
// PREVENTIVOS (plan unico o recurrente). Generacion explícita de ocurrencias para 12 meses.
function occurrenceDates(b){const start=new Date(b.inicio+'T12:00:00Z');if(!Number.isFinite(start.getTime()))throw error('Fecha de inicio invalida.');
 const limit=new Date(start);limit.setUTCFullYear(limit.getUTCFullYear()+1);const results=[];
 if(b.modalidad==='UNICA')return [start];
 const freq=b.frecuencia; if(!['DIARIA','SEMANAL','MENSUAL'].includes(freq))throw error('Frecuencia no soportada.');
 const interval=Number(b.intervalo||1);if(!Number.isInteger(interval)||interval<1||interval>24)throw error('Intervalo invalido.');
 let d=new Date(start);for(let n=0;n<370 && d<limit;n++){
  results.push(new Date(d));if(freq==='DIARIA')d.setUTCDate(d.getUTCDate()+interval);
  else if(freq==='SEMANAL')d.setUTCDate(d.getUTCDate()+7*interval);
  else {const target=new Date(d);target.setUTCDate(1);target.setUTCMonth(target.getUTCMonth()+interval);const day=Math.min(start.getUTCDate(),new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate());target.setUTCDate(day);d=target;}
 }return results;
}
app.get('/api/v2/preventivos',...read('catalogos.leer',async()=>{
 const [p,o]=await Promise.all([q(`SELECT p.*,e.nombre equipo FROM mantix.planes_preventivos p JOIN mantix.equipos e ON e.id=p.equipo_id ORDER BY p.creado_en DESC LIMIT 150`),q(`SELECT o.*,p.actividad,e.nombre equipo FROM mantix.ocurrencias_preventivas o JOIN mantix.planes_preventivos p ON p.id=o.plan_id JOIN mantix.equipos e ON e.id=p.equipo_id WHERE o.fecha_vigente BETWEEN now()-interval '30 days' AND now()+interval '90 days' ORDER BY o.fecha_vigente LIMIT 200`)]);return {planes:p.rows,ocurrencias:o.rows};
}));
app.post('/api/v2/preventivos',...write('preventivos.autorizar',async(req)=>{
 const b=req.body||{},actividad=text(b.actividad,2500);if(!isId(b.equipo_id)||!isDate(b.inicio)||actividad.length<6||!['UNICA','RECURRENTE'].includes(b.modalidad))throw error('Datos de plan incompletos.');const dates=occurrenceDates(b);const id=uuid();
 return tx(async c=>{const valid=await c.query('SELECT 1 FROM mantix.equipos WHERE id=$1 AND activo',[b.equipo_id]);if(!valid.rowCount)throw error('Equipo no activo.',400);
 const rule=b.modalidad==='RECURRENTE'?{frecuencia:b.frecuencia,intervalo:Number(b.intervalo||1)}:null;
 await c.query(`INSERT INTO mantix.planes_preventivos(id,equipo_id,actividad,modalidad,regla_recurrencia,fecha_inicio,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,b.equipo_id,actividad,b.modalidad,rule?JSON.stringify(rule):null,b.inicio,req.actor.id]);
 for(const date of dates)await c.query(`INSERT INTO mantix.ocurrencias_preventivas(id,plan_id,fecha_original,fecha_vigente) VALUES($1,$2,$3,$3)`,[uuid(),id,date.toISOString()]);await audit(c,req.actor.id,'PLAN_PREVENTIVO_CREADO','planes_preventivos',id,{ocurrencias:dates.length});return {id,ocurrencias:dates.length};});
}));
app.post('/api/v2/preventivos/:id/solicitar',...write('preventivos.solicitar',async(req)=>{
 const id=req.params.id,fecha=iso(req.body?.fecha),motivo=text(req.body?.motivo);if(!isId(id)||!fecha||motivo.length<8)throw error('Fecha y motivo obligatorios.');
 return tx(async c=>{const r=await c.query('SELECT * FROM mantix.ocurrencias_preventivas WHERE id=$1 FOR UPDATE',[id]);if(!r.rowCount||['COMPLETADA','CANCELADA'].includes(r.rows[0].estado))throw error('Actividad no reprogramable.',409);
 const sid=uuid();await c.query('INSERT INTO mantix.solicitudes_reprogramacion(id,ocurrencia_id,solicitante_id,fecha_solicitada,motivo) VALUES($1,$2,$3,$4,$5)',[sid,id,req.actor.id,fecha,motivo]);await audit(c,req.actor.id,'REPROGRAMACION_SOLICITADA','ocurrencias_preventivas',id,{fecha_solicitada:fecha,motivo});return {id:sid};});
}));
app.get('/api/v2/preventivos/solicitudes',...read('preventivos.autorizar',async()=>{const r=await q(`SELECT s.*,p.actividad,e.nombre equipo FROM mantix.solicitudes_reprogramacion s JOIN mantix.ocurrencias_preventivas o ON o.id=s.ocurrencia_id JOIN mantix.planes_preventivos p ON p.id=o.plan_id JOIN mantix.equipos e ON e.id=p.equipo_id WHERE s.estado='SOLICITADA' ORDER BY s.solicitada_en DESC`);return {datos:r.rows};}));
app.post('/api/v2/preventivos/solicitudes/:id/resolver',...write('preventivos.autorizar',async(req)=>{
 const id=req.params.id,b=req.body||{};if(!isId(id)||!['APROBADA','RECHAZADA'].includes(b.decision))throw error('Decision invalida.');
 return tx(async c=>{const r=await c.query('SELECT * FROM mantix.solicitudes_reprogramacion WHERE id=$1 FOR UPDATE',[id]);const s=r.rows[0];if(!s||s.estado!=='SOLICITADA')throw error('Solicitud ya resuelta.',409);
 await c.query('UPDATE mantix.solicitudes_reprogramacion SET estado=$1,autorizador_id=$2,resuelta_en=now() WHERE id=$3',[b.decision,req.actor.id,id]);if(b.decision==='APROBADA'){const moved=await c.query(`UPDATE mantix.ocurrencias_preventivas SET fecha_vigente=$1 WHERE id=$2 AND estado='PROGRAMADA'`,[s.fecha_solicitada,s.ocurrencia_id]);if(!moved.rowCount)throw error('La actividad ya no puede reprogramarse.',409);}
 await audit(c,req.actor.id,'REPROGRAMACION_'+b.decision,'ocurrencias_preventivas',s.ocurrencia_id,{fecha:s.fecha_solicitada});return {decision:b.decision};});
}));
app.post('/api/v2/preventivos/:id/crear-orden',...write('ordenes.registrar',async(req)=>{
 const id=req.params.id;if(!isId(id))throw error('Actividad invalida.');return tx(async c=>{const r=await c.query(`SELECT o.*,p.equipo_id,p.actividad FROM mantix.ocurrencias_preventivas o JOIN mantix.planes_preventivos p ON p.id=o.plan_id WHERE o.id=$1 FOR UPDATE`,[id]);const oc=r.rows[0];if(!oc||oc.estado!=='PROGRAMADA'||oc.orden_id)throw error('Actividad no disponible para generar orden.',409);
 const oid=uuid();await c.query(`INSERT INTO mantix.ordenes_trabajo(id,modalidad_registro,tipo_mantenimiento_codigo,descripcion,estado_operativo,creada_por) VALUES($1,'OPERATIVO','PREVENTIVO',$2,'ABIERTA',$3)`,[oid,oc.actividad,req.actor.id]);await c.query('INSERT INTO mantix.orden_equipos(orden_id,equipo_id,principal) VALUES($1,$2,true)',[oid,oc.equipo_id]);await c.query("UPDATE mantix.ocurrencias_preventivas SET orden_id=$1,estado='EN_PROCESO' WHERE id=$2",[oid,id]);await audit(c,req.actor.id,'PREVENTIVO_ORDEN_CREADA','ordenes_trabajo',oid,{ocurrencia:id});return {orden_id:oid};});
}));
// HISTORIAL preparado permite intervención directa en una orden preventiva programada.
app.post('/api/v2/ordenes/:id/intervenir',...write('ordenes.registrar',async(req)=>{
 const oid=req.params.id,b=req.body||{},acts=text(b.actividades,5000),start=iso(b.inicio),end=b.fin?iso(b.fin):null;
 if(!isId(oid)||!['EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD','TERMINADA'].includes(b.estado)||acts.length<5||!start||(b.fin&&!end)||(end&&end<start)||(b.estado==='TERMINADA'&&!end)||!isDate(b.fecha_operativa)||!Array.isArray(b.ejecutantes)||!b.ejecutantes.length||!b.ejecutantes.every(isId))throw error('Completa actividades, fechas y ejecutantes.');
 return tx(async c=>{const duty=await guardDay(c,req.actor.id,b.fecha_operativa);const o=(await c.query('SELECT * FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[oid])).rows[0];if(!o||!['ABIERTA','EN_PROCESO'].includes(o.estado_operativo))throw error('Solo se admiten intervenciones iniciales de ordenes abiertas o en proceso.',409);
 const prior=await c.query('SELECT 1 FROM mantix.intervenciones WHERE orden_id=$1 LIMIT 1',[oid]);if(prior.rowCount)throw error('La orden ya tiene intervenciones. Utiliza continuidad y pendientes.',409); const eq=(await c.query('SELECT equipo_id FROM mantix.orden_equipos WHERE orden_id=$1',[oid])).rows;if(!eq.length)throw error('Orden sin equipo.');const iv=uuid();await c.query(`INSERT INTO mantix.intervenciones(id,orden_id,supervisor_id,fecha_operativa,inicio_real,fin_real,actividades,estado,creada_por,asignacion_turno_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$3,$9)`,[iv,oid,req.actor.id,b.fecha_operativa,start,end,acts,b.estado,duty?.id||null]);
 for(const e of eq)await c.query('INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id) VALUES($1,$2,$3)',[oid,iv,e.equipo_id]);for(const staff of [...new Set(b.ejecutantes)])await c.query('INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id) VALUES($1,$2)',[iv,staff]);
 const state=b.estado==='TERMINADA'?'TERMINADA':handoffStates.includes(b.estado)?'PENDIENTE':'EN_PROCESO';await c.query('UPDATE mantix.ordenes_trabajo SET estado_operativo=$1,version=version+1 WHERE id=$2',[state,oid]);if(state==='TERMINADA')await c.query("UPDATE mantix.ocurrencias_preventivas SET estado='COMPLETADA',completada_en=$1 WHERE orden_id=$2 AND estado='EN_PROCESO'",[end,oid]);await audit(c,req.actor.id,'INTERVENCION_ORDEN_CREADA','intervenciones',iv,{orden_id:oid});return {intervencion_id:iv};});
}));
// ADMIN - Catálogos manuales: no borra históricos.
app.post('/api/v2/admin/equipos',...write('catalogos.administrar',async(req)=>{
 const b=req.body||{},name=text(b.nombre,200),code=text(b.codigo,80),cc=isId(b.centro_costo_id)?b.centro_costo_id:null;
 if(name.length<3)throw error('Nombre de equipo obligatorio.');return tx(async c=>{const id=uuid();await c.query('INSERT INTO mantix.equipos(id,codigo,nombre,centro_costo_id) VALUES($1,$2,$3,$4)',[id,code||null,name,cc]);await audit(c,req.actor.id,'EQUIPO_CREADO','equipos',id,{nombre:name,codigo:code});return {id};});
}));
app.post('/api/v2/admin/empleados',...write('catalogos.administrar',async(req)=>{
 const b=req.body||{},clave=text(b.clave,50),nombre=text(b.nombre,180);if(!clave||nombre.length<3)throw error('Clave y nombre obligatorios.');return tx(async c=>{const id=uuid();await c.query('INSERT INTO mantix.empleados(id,clave,nombre,departamento,puesto) VALUES($1,$2,$3,$4,$5)',[id,clave,nombre,text(b.departamento,120),text(b.puesto,120)]);await audit(c,req.actor.id,'EMPLEADO_CREADO','empleados',id,{clave,nombre});return {id};});
}));
app.patch('/api/v2/admin/:tabla/:id/activo',...write('catalogos.administrar',async(req)=>{
 const table=req.params.tabla;if(!['equipos','empleados'].includes(table)||!isId(req.params.id)||typeof req.body?.activo!=='boolean')throw error('Datos invalidos.');return tx(async c=>{const a=await c.query(`UPDATE mantix.${table} SET activo=$1,actualizado_en=now() WHERE id=$2 RETURNING id`,[req.body.activo,req.params.id]);if(!a.rowCount)throw error('Registro no encontrado.',404);await audit(c,req.actor.id,'CATALOGO_ESTADO',''+table,req.params.id,{activo:req.body.activo});return {};});
}));
// Previsualizar e importar datos copiados desde Excel/CSV (nunca borrado masivo).
app.post('/api/v2/admin/importar',...write('catalogos.administrar',async(req)=>{
 const b=req.body||{};if(!['EQUIPOS','EMPLEADOS'].includes(b.catalogo)||!Array.isArray(b.filas)||b.filas.length<1||b.filas.length>400)throw error('Selecciona 1-400 filas.');
 const keys=b.catalogo==='EMPLEADOS'?['clave','nombre']:['nombre'];let rows=[];for(let i=0;i<b.filas.length;i++){const f=b.filas[i];if(!f||keys.some(k=>!text(f[k],200)))throw error('Fila '+(i+1)+' incompleta.');rows.push(f);}
 if(!b.confirmar)return {vista_previa:rows.slice(0,10),filas:rows.length,requiere_confirmacion:true};
 return tx(async c=>{let added=0,skipped=0;for(const row of rows){if(b.catalogo==='EMPLEADOS'){
 const exists=await c.query('SELECT id FROM mantix.empleados WHERE clave=$1',[text(row.clave,50)]);if(exists.rowCount){skipped++;continue;}
 await c.query('INSERT INTO mantix.empleados(id,clave,nombre,departamento,puesto) VALUES($1,$2,$3,$4,$5)',[uuid(),text(row.clave,50),text(row.nombre,180),text(row.departamento,120),text(row.puesto,120)]);
 }else{const name=text(row.nombre,200),code=text(row.codigo,80);if(code){const exists=await c.query('SELECT id FROM mantix.equipos WHERE lower(codigo)=lower($1)',[code]);if(exists.rowCount){skipped++;continue;}}
 await c.query('INSERT INTO mantix.equipos(id,codigo,nombre) VALUES($1,$2,$3)',[uuid(),code||null,name]);}
 added++;}await audit(c,req.actor.id,'IMPORTACION_CATALOGO','importaciones_catalogo',null,{catalogo:b.catalogo,agregados:added,omitidos:skipped});return {agregados:added,omitidos:skipped};});
}));
// Dashboard de solo lectura centralizado en MANTIX_dashboard.js.
app.get('/api/v2/auditoria',...read('auditoria.leer',async()=>{const r=await q(`SELECT a.accion,a.entidad,a.registrada_en,u.nombre_mostrar actor FROM mantix.auditoria a LEFT JOIN mantix.usuarios u ON u.id=a.actor_usuario_id ORDER BY a.registrada_en DESC LIMIT 100`);return {datos:r.rows};}));

// MANTIX 2.3: edición de bitácora únicamente mientras la intervención NO fue entregada ni enviada.
app.patch('/api/v2/bitacora/:id',localWrite,auth,permit('ordenes.registrar'),wrap(async(req)=>{
 const id=req.params.id,b=req.body||{};
 if(!isId(id)||!['EN_PROCESO','PENDIENTE_CONTINUIDAD','PENDIENTE_REFACCION','TERMINADA'].includes(b.estado)||!Number.isInteger(b.version))throw error('Estado o versión inválidos.');
 const actividades=b.actividades==null?null:text(b.actividades,5000);
 if(actividades!==null&&actividades.length<5)throw error('Describe la actividad con al menos 5 caracteres.');
 const fin=b.fin_real==null?null:iso(b.fin_real);if(b.fin_real!=null&&!fin)throw error('Hora final inválida.');
 return tx(async c=>{
  const probe=(await c.query('SELECT supervisor_id,fecha_operativa,orden_id FROM mantix.intervenciones WHERE id=$1',[id])).rows[0];
  if(!probe||probe.supervisor_id!==req.actor.id)throw error('No puedes editar esta intervención.',403);
  await guardDay(c,req.actor.id,probe.fecha_operativa);
  await c.query('SELECT id FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[probe.orden_id]);
  const r=await c.query('SELECT * FROM mantix.intervenciones WHERE id=$1 FOR UPDATE',[id]);const i=r.rows[0];
  if(!i||i.supervisor_id!==req.actor.id)throw error('No puedes editar esta intervención.',403);
  if(i.version!==b.version)throw error('Otro cambio actualizó el registro. Recarga tu bitácora.',409);
  if(i.entregada_en||i.estado_revision!=='NO_ENVIADA')throw error('Ya fue entregada o enviada. Solicita una corrección autorizada.',409);
  const closed=await c.query('SELECT 1 FROM mantix.asignaciones_turno a JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 AND a.fecha_operativa=$2 LIMIT 1',[req.actor.id,i.fecha_operativa]);
  if(closed.rowCount)throw error('La jornada está cerrada. Solicita una corrección.',409);
  const nextState=b.estado,finalActivities=actividades===null?i.actividades:actividades,finalEnd=fin||i.fin_real;
  if(nextState==='TERMINADA'&&!finalEnd)throw error('Para terminar un trabajo debes indicar su hora de finalización.');
  if(finalEnd&&i.inicio_real&&new Date(finalEnd)<new Date(i.inicio_real))throw error('La hora final debe ser posterior al inicio.');
  await c.query('UPDATE mantix.intervenciones SET estado=$1,actividades=$2,fin_real=$3,version=version+1 WHERE id=$4',[nextState,finalActivities,finalEnd,id]);
  const last=await c.query('SELECT estado FROM mantix.intervenciones WHERE orden_id=$1 ORDER BY creada_en DESC,id DESC LIMIT 1',[i.orden_id]);
  const st=last.rows[0]?.estado;await c.query('UPDATE mantix.ordenes_trabajo SET estado_operativo=$1,version=version+1 WHERE id=$2', [st==='TERMINADA'?'TERMINADA':st==='EN_PROCESO'?'EN_PROCESO':'PENDIENTE',i.orden_id]);
  await audit(c,req.actor.id,'INTERVENCION_ACTUALIZADA','intervenciones',id,{estado:nextState,actividades:finalActivities,fin_real:finalEnd,version:i.version+1},{estado:i.estado,actividades:i.actividades,fin_real:i.fin_real,version:i.version});
  return {id,version:i.version+1,estado:nextState};
 });
}));
// La bandeja es exclusivamente administrativa. La asociación original queda trazable.
app.get('/api/v2/admin/propuestas',...read('catalogos.administrar',async()=>{
 const r=await q(`SELECT p.*,u.nombre_mostrar propuesto_por_nombre FROM mantix.propuestas_catalogo p JOIN mantix.usuarios u ON u.id=p.propuesto_por ORDER BY (p.estado='PENDIENTE') DESC,p.creado_en DESC LIMIT 300`);
 return {datos:r.rows};
}));
app.post('/api/v2/admin/propuestas/:id/resolver',...write('catalogos.administrar',async(req)=>{
 const id=req.params.id,b=req.body||{};if(!isId(id)||!['VINCULAR','CREAR','DESCARTAR'].includes(b.accion))throw error('Solicitud o acción inválida.');
 return tx(async c=>{
  const r=await c.query('SELECT * FROM mantix.propuestas_catalogo WHERE id=$1 FOR UPDATE',[id]);const p=r.rows[0];
  if(!p||p.estado!=='PENDIENTE')throw error('La propuesta ya fue resuelta o no existe.',409);
  const name=text(b.nombre||p.nombre_original,180);
  let target=null;
  if(b.accion==='VINCULAR'){
   if(!isId(b.catalogo_id))throw error('Selecciona el registro oficial existente.');
   const table=p.tipo==='EQUIPO'?'equipos':'empleados';
   const existing=await c.query(`SELECT id FROM mantix.${table} WHERE id=$1 AND activo=true`,[b.catalogo_id]);
   if(!existing.rowCount)throw error('El registro oficial no existe o está inactivo.');target=b.catalogo_id;
  }
  if(b.accion==='CREAR'){
   if(name.length<3)throw error('Nombre oficial demasiado corto.');target=uuid();
   if(p.tipo==='EQUIPO')await c.query('INSERT INTO mantix.equipos(id,nombre,codigo,activo) VALUES($1,$2,$3,true)',[target,name,text(b.clave,50)||null]);
   else{const key=text(b.clave||p.clave_original,50);if(!key)throw error('Para registrar oficialmente un ejecutante, proporciona su clave única.');await c.query('INSERT INTO mantix.empleados(id,clave,nombre,departamento,puesto,activo) VALUES($1,$2,$3,$4,$5,true)',[target,key,name,text(b.area,150)||null,text(b.puesto,150)||null]);}
  }
  if(target){
   if(p.tipo==='EQUIPO'){
    const existingCount=await c.query('SELECT 1 FROM mantix.orden_equipos WHERE orden_id=$1 LIMIT 1',[p.orden_id]);await c.query('INSERT INTO mantix.orden_equipos(orden_id,equipo_id,principal) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.orden_id,target,!existingCount.rowCount]);
    await c.query('INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[p.orden_id,p.intervencion_id,target]);
   }else await c.query('INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.intervencion_id,target]);
  }
  await c.query('UPDATE mantix.propuestas_catalogo SET estado=$1,validado_por=$2,validado_en=now(),catalogo_id=$3,nombre_validado=$4 WHERE id=$5',[b.accion==='DESCARTAR'?'DESCARTADA':'VALIDADA',req.actor.id,target,b.accion==='DESCARTAR'?null:name,id]);
  await audit(c,req.actor.id,'PROPUESTA_'+b.accion,'propuestas_catalogo',id,{catalogo_id:target,nombre:name,accion:b.accion},{nombre_original:p.nombre_original});
  return {id,catalogo_id:target};
 });
}));
};
