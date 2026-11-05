'use strict';
// Solo lectura. Los totales se obtienen de entidades únicas antes de sumar relaciones.
const TZ='America/Merida';
const validId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00Z'))&&new Date(v+'T12:00Z').toISOString().slice(0,10)===v;
const fail=s=>{throw Object.assign(Error(s),{status:400});};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const date=v=>v?String(v).slice(0,10):null;
const ratio=(a,b)=>b?Math.round(a/b*10000)/100:null;
const sum=a=>a.reduce((s,x)=>s+x,0);
const unique=a=>[...new Set(a)];
function filters(b={}){const now=today(),f={desde:b.desde||now.slice(0,7)+'-01',hasta:b.hasta||now,supervisor:b.supervisor||'',trabajador:b.trabajador||'',equipo:b.equipo||'',tipo:b.tipo||'',turno:b.turno||'',estado:b.estado||''};
 if(!validDate(f.desde)||!validDate(f.hasta)||f.desde>f.hasta)fail('Revisa el periodo de consulta.');
 if((Date.parse(f.hasta)-Date.parse(f.desde))/86400000>365)fail('Consulta hasta un año por reporte.');
 for(const key of ['supervisor','trabajador','equipo'])if(f[key]&&!validId(f[key]))fail('Filtro inválido: '+key);
 if(f.tipo&&!/^[A-Z0-9_]{2,30}$/.test(f.tipo))fail('Tipo inválido.');
 if(f.turno&&!['A','B','C','Q1','Q2','Q3','Q4','Q5','EXTRA','SIN_TURNO'].includes(f.turno))fail('Turno inválido.');
 if(f.estado&&!['ABIERTA','EN_PROCESO','PENDIENTE','TERMINADA','CANCELADA'].includes(f.estado))fail('Estado inválido.');return f;
}
function hours(start,end,shift){if(!start||!end)return null;const a=+new Date(start),b=+new Date(end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)return null;
 let ms=b-a;
 // Descuenta únicamente la pausa programada de jornadas Q. No inventa horas sin fechas reales.
 if(shift&&shift.startsWith('Q')){let d=new Date(a-6*3600000).toISOString().slice(0,10),last=new Date(b-6*3600000).toISOString().slice(0,10);for(let n=0;d<=last&&n<1000;n++){
  const x=Date.parse(d+'T12:00:00-06:00'),y=Date.parse(d+'T14:00:00-06:00');ms-=Math.max(0,Math.min(b,y)-Math.max(a,x));d=new Date(Date.parse(d+'T12:00Z')+86400000).toISOString().slice(0,10);
 }}return Math.max(0,ms/3600000);
}
module.exports={filters,hours,ratio,TZ};
module.exports.report=async function(pool,input){const f=filters(input),c=await pool.connect();try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const queries=[
  ()=>c.query(`SELECT i.id,i.orden_id,i.supervisor_id,i.fecha_operativa::text,i.inicio_real,i.fin_real,i.actividades,i.estado,i.estado_revision,i.version,i.creada_en,i.enviada_revision_en,i.resuelta_revision_en,u.nombre_mostrar supervisor,a.codigo_turno,
   COALESCE((SELECT json_agg(json_build_object('id',e.id,'nombre',e.nombre)) FROM mantix.intervencion_equipos x JOIN mantix.equipos e ON e.id=x.equipo_id WHERE x.intervencion_id=i.id),'[]') equipos,
   COALESCE((SELECT json_agg(json_build_object('id',e.id,'nombre',e.nombre,'inicio',x.inicio_participacion,'fin',x.fin_participacion)) FROM mantix.intervencion_ejecutantes x JOIN mantix.empleados e ON e.id=x.empleado_id WHERE x.intervencion_id=i.id),'[]') ejecutantes,
   (SELECT count(*)::int FROM mantix.propuestas_catalogo p WHERE p.intervencion_id=i.id AND p.estado='PENDIENTE') provisionales
   FROM mantix.intervenciones i JOIN mantix.usuarios u ON u.id=i.supervisor_id LEFT JOIN mantix.asignaciones_turno a ON a.id=i.asignacion_turno_id ORDER BY i.creada_en,i.id`),
  ()=>c.query(`SELECT o.*,o.creada_en AT TIME ZONE $2 AS creada_local,COALESCE((SELECT json_agg(json_build_object('id',e.id,'nombre',e.nombre)) FROM mantix.orden_equipos x JOIN mantix.equipos e ON e.id=x.equipo_id WHERE x.orden_id=o.id),'[]') equipos FROM mantix.ordenes_trabajo o WHERE (o.creada_en AT TIME ZONE $2)::date<=$1::date OR EXISTS(SELECT 1 FROM mantix.intervenciones i WHERE i.orden_id=o.id AND i.fecha_operativa<=$1::date)`,[f.hasta,TZ]),
  ()=>c.query(`SELECT oc.*,to_char(oc.fecha_original AT TIME ZONE $2,'YYYY-MM-DD') fecha_programada,p.equipo_id,e.nombre equipo,p.actividad,p.creado_por FROM mantix.ocurrencias_preventivas oc JOIN mantix.planes_preventivos p ON p.id=oc.plan_id JOIN mantix.equipos e ON e.id=p.equipo_id WHERE (oc.fecha_original AT TIME ZONE $2)::date<=$1::date`,[f.hasta,TZ]),
  ()=>c.query(`SELECT r.*,u.nombre_mostrar revisor FROM mantix.revisiones r JOIN mantix.usuarios u ON u.id=r.revisor_id ORDER BY r.revisado_en,r.id`),
  ()=>c.query(`SELECT json_build_object('supervisores',(SELECT COALESCE(json_agg(x),'[]') FROM (SELECT DISTINCT u.id,u.nombre_mostrar nombre FROM mantix.usuarios u WHERE EXISTS(SELECT 1 FROM mantix.intervenciones i WHERE i.supervisor_id=u.id) OR EXISTS(SELECT 1 FROM mantix.usuario_roles ur JOIN mantix.roles r ON r.id=ur.rol_id WHERE ur.usuario_id=u.id AND r.codigo='SUPERVISOR') ORDER BY nombre) x),'trabajadores',(SELECT COALESCE(json_agg(x),'[]') FROM (SELECT id,nombre FROM mantix.empleados ORDER BY nombre) x),'equipos',(SELECT COALESCE(json_agg(x),'[]') FROM (SELECT id,nombre FROM mantix.equipos ORDER BY nombre) x),'tipos',(SELECT COALESCE(json_agg(x),'[]') FROM (SELECT codigo,nombre FROM mantix.tipos_mantenimiento ORDER BY nombre) x)) catalogos`)
 ];
 const results=[];for(const query of queries)results.push(await query());
 const [source,orders,plans,reviewRows,catalogs]=results;
 await c.query('COMMIT');
 const orderMap=new Map(orders.rows.map(o=>[o.id,o])),allByOrder=new Map();for(const i of source.rows){if(!allByOrder.has(i.orden_id))allByOrder.set(i.orden_id,[]);allByOrder.get(i.orden_id).push(i);}
 const matchOrder=o=>(!f.tipo||o.tipo_mantenimiento_codigo===f.tipo)&&(!f.estado||o.estado_operativo===f.estado)&&(!f.equipo||o.equipos.some(e=>e.id===f.equipo));
 const matchInter=i=>(!f.supervisor||i.supervisor_id===f.supervisor)&&(!f.turno||(f.turno==='SIN_TURNO'?!i.codigo_turno:i.codigo_turno===f.turno))&&(!f.equipo||i.equipos.some(e=>e.id===f.equipo));
 const current=source.rows.filter(i=>i.fecha_operativa>=f.desde&&i.fecha_operativa<=f.hasta&&matchInter(i)&&orderMap.has(i.orden_id)&&matchOrder(orderMap.get(i.orden_id))).map(i=>({...i,numero_orden:orderMap.get(i.orden_id).numero_orden,descripcion:orderMap.get(i.orden_id).descripcion,tipo:orderMap.get(i.orden_id).tipo_mantenimiento_codigo,estado_orden:orderMap.get(i.orden_id).estado_operativo,horas:hours(i.inicio_real,i.fin_real,i.codigo_turno)}));
 const validation=o=>{const list=allByOrder.get(o.id)||[],last=list.at(-1);return o.estado_operativo!=='CANCELADA'&&last?.estado==='TERMINADA'&&last.estado_revision==='APROBADA'&&!list.some(i=>i.estado==='TERMINADA'&&i.estado_revision!=='APROBADA');};
 const reviewTime=i=>{const last=reviewRows.rows.filter(r=>r.intervencion_id===i.id&&r.version_revisada===i.version).at(-1);return i.resuelta_revision_en||last?.revisado_en||null;};
 const represented=unique(current.map(i=>i.orden_id)).map(key=>orderMap.get(key));
 // La agenda interna es la única fuente que contiene actividades programadas aún no ejecutadas.
 const planFiltered=plans.rows.filter(p=>p.fecha_programada>=f.desde&&p.estado!=='CANCELADA'&&(!f.equipo||p.equipo_id===f.equipo)&&(!f.tipo||f.tipo==='PREVENTIVO')&&(!f.estado||(p.orden_id&&orderMap.get(p.orden_id)?.estado_operativo===f.estado))&&(!(f.supervisor||f.turno)||(p.orden_id&&(allByOrder.get(p.orden_id)||[]).some(i=>i.fecha_operativa<=f.hasta&&matchInter(i)))));
 const cutoff=Date.parse(f.hasta+'T23:59:59.999-06:00');
 const planValid=p=>{const o=orderMap.get(p.orden_id);if(!o||!validation(o))return false;const last=(allByOrder.get(o.id)||[]).at(-1),resolved=reviewTime(last);return resolved&&+new Date(resolved)<=cutoff&&+new Date(last.fin_real)<=cutoff;};
 const planRows=planFiltered.map(p=>({...p,cumplida:!!planValid(p)}));
 const backlog=orders.rows.filter(o=>o.estado_operativo!=='CANCELADA'&&!validation(o)&&matchOrder(o)&&(!(f.supervisor||f.turno)||(allByOrder.get(o.id)||[]).some(i=>i.fecha_operativa<=f.hasta&&matchInter(i)))).map(o=>{
  const list=allByOrder.get(o.id)||[],last=list.at(-1),due=plans.rows.filter(p=>p.orden_id===o.id&&p.estado!=='CANCELADA').map(p=>p.fecha_programada).sort()[0]||null;
  const first=list[0]?.fecha_operativa||new Intl.DateTimeFormat('en-CA',{timeZone:TZ}).format(new Date(o.creada_en));
  const stage=last?.estado_revision==='EN_REVISION'?'EN_REVISION':last?.estado_revision==='RECHAZADA'?'RECHAZADA':last?.estado_revision==='CORRECCION_EN_PROCESO'?'CORRECCION_EN_PROCESO':last?.estado==='TERMINADA'?'TERMINADA_SIN_VALIDAR':o.estado_operativo;
  return {id:o.id,numero_orden:o.numero_orden,descripcion:o.descripcion,estado:stage,fecha_programada:due,vencida:!!due&&due<(f.hasta<today()?f.hasta:today()),dias:Math.max(0,Math.floor((Date.parse(f.hasta<today()?f.hasta:today())-Date.parse(first))/86400000))};
 }).sort((a,b)=>b.dias-a.dias||a.id.localeCompare(b.id));
 const supervisors=new Map(),types=new Map(),equipment=new Map(),monthly=new Map();
 for(let month=f.desde.slice(0,7);month<=f.hasta.slice(0,7);){monthly.set(month,{mes:month,ordenes:new Set(),intervenciones:0,aprobadas:0,programadas:0,cumplidas:0});const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);}
 for(const o of represented){types.set(o.tipo_mantenimiento_codigo,(types.get(o.tipo_mantenimiento_codigo)||0)+1);}
 for(const i of current){if(!supervisors.has(i.supervisor_id))supervisors.set(i.supervisor_id,{id:i.supervisor_id,nombre:i.supervisor,ordenes:new Set(),intervenciones:0,terminadas:0,aprobadas:0,rechazadas:0,por_revisar:0,horas:0,horas_conocidas:0});
  const s=supervisors.get(i.supervisor_id);s.ordenes.add(i.orden_id);s.intervenciones++;if(i.estado==='TERMINADA')s.terminadas++;if(i.estado_revision==='APROBADA')s.aprobadas++;if(i.estado_revision==='RECHAZADA')s.rechazadas++;if(i.estado_revision==='EN_REVISION')s.por_revisar++;if(i.horas!==null){s.horas+=i.horas;s.horas_conocidas++;}
  const m=i.fecha_operativa.slice(0,7);if(!monthly.has(m))monthly.set(m,{mes:m,ordenes:new Set(),intervenciones:0,aprobadas:0,programadas:0,cumplidas:0});monthly.get(m).ordenes.add(i.orden_id);monthly.get(m).intervenciones++;if(i.estado_revision==='APROBADA')monthly.get(m).aprobadas++;
  for(const e of i.equipos){if(!equipment.has(e.id))equipment.set(e.id,{id:e.id,nombre:e.nombre,ordenes:new Set(),intervenciones:0,horas:0,horas_conocidas:0});const x=equipment.get(e.id);x.ordenes.add(i.orden_id);x.intervenciones++;if(i.horas!==null){x.horas+=i.horas;x.horas_conocidas++;}}
 }
 for(const p of planRows){const m=p.fecha_programada.slice(0,7);if(!monthly.has(m))monthly.set(m,{mes:m,ordenes:new Set(),intervenciones:0,aprobadas:0,programadas:0,cumplidas:0});monthly.get(m).programadas++;if(p.cumplida)monthly.get(m).cumplidas++;}
 const participants=new Map(),pairs=new Set();let participationRecords=0,measured=0,hh=0;
 for(const i of current)for(const e of i.ejecutantes){if(f.trabajador&&e.id!==f.trabajador)continue;
  if(!participants.has(e.id))participants.set(e.id,{id:e.id,nombre:e.nombre,ordenes:new Set(),intervenciones:0,registros_horas:0,horas:0,aprobadas:new Set(),rechazadas:new Set(),por_revisar:new Set(),preventivas:new Set(),operativas:new Set()});
  const w=participants.get(e.id),key=e.id+'|'+i.orden_id;w.ordenes.add(i.orden_id);w.intervenciones++;pairs.add(key);participationRecords++;
  if(i.tipo==='PREVENTIVO')w.preventivas.add(i.orden_id);if(i.tipo==='OPERATIVO')w.operativas.add(i.orden_id);
  if(i.estado_revision==='APROBADA')w.aprobadas.add(i.orden_id);if(i.estado_revision==='RECHAZADA')w.rechazadas.add(i.orden_id);if(i.estado_revision==='EN_REVISION')w.por_revisar.add(i.orden_id);
  const h=hours(e.inicio,e.fin,i.codigo_turno);if(h!==null){w.horas+=h;w.registros_horas++;measured++;hh+=h;}
 }
 const rcounts={por_revisar:0,aprobadas:0,rechazadas:0,correcciones:0,sin_enviar:0,tiempos_medidos:0,horas_revision:null};const waits=[];
 const details=current.map(i=>{const resolved=reviewTime(i),wait=i.enviada_revision_en&&resolved?(+new Date(resolved)-+new Date(i.enviada_revision_en))/3600000:null;if(wait!==null&&wait>=0&&['APROBADA','RECHAZADA'].includes(i.estado_revision))waits.push(wait);
  const key={EN_REVISION:'por_revisar',APROBADA:'aprobadas',RECHAZADA:'rechazadas',CORRECCION_EN_PROCESO:'correcciones',NO_ENVIADA:'sin_enviar'}[i.estado_revision];if(key)rcounts[key]++;
  return {...i,resuelta:resolved,horas_revision:wait!==null&&wait>=0?wait:null};});
 rcounts.tiempos_medidos=waits.length;rcounts.horas_revision=waits.length?sum(waits)/waits.length:null;rcounts.aprobacion=ratio(rcounts.aprobadas,rcounts.aprobadas+rcounts.rechazadas);
 return {generado_en:new Date().toISOString(),zona_horaria:TZ,filtros:f,catalogos:catalogs.rows[0].catalogos,
  mantenimiento:{ordenes:represented.length,intervenciones:current.length,terminadas:represented.filter(o=>(allByOrder.get(o.id)||[]).at(-1)?.estado==='TERMINADA').length,validadas:represented.filter(validation).length,programadas:planRows.length,cumplidas:planRows.filter(p=>p.cumplida).length,cumplimiento:ratio(planRows.filter(p=>p.cumplida).length,planRows.length),programacion_pendiente:planRows.filter(p=>!p.cumplida).length,programadas_sin_orden:planRows.filter(p=>!p.orden_id).length,backlog:backlog.length,vencidas:backlog.filter(o=>o.vencida).length,horas_registradas:current.some(i=>i.horas!==null)?sum(current.map(i=>i.horas||0)):null,horas_conocidas:current.filter(i=>i.horas!==null).length,mttr:null,mtbf:null,disponibilidad:null},
  por_tipo:[...types].map(([tipo,cantidad])=>{const validadas=represented.filter(o=>o.tipo_mantenimiento_codigo===tipo&&validation(o)).length;return {tipo,cantidad,porcentaje:ratio(cantidad,represented.length),validadas,porcentaje_validadas:ratio(validadas,represented.filter(validation).length)};}),
  por_mes:[...monthly.values()].sort((a,b)=>a.mes.localeCompare(b.mes)).map(m=>({...m,ordenes:m.ordenes.size,cumplimiento:ratio(m.cumplidas,m.programadas)})),
  supervisores:[...supervisors.values()].map(s=>({...s,ordenes:s.ordenes.size,horas:s.horas_conocidas?s.horas:null,aprobacion:ratio(s.aprobadas,s.aprobadas+s.rechazadas)})).sort((a,b)=>b.intervenciones-a.intervenciones||a.nombre.localeCompare(b.nombre)),
  equipos:[...equipment.values()].map(e=>({...e,ordenes:e.ordenes.size,horas:e.horas_conocidas?e.horas:null})).sort((a,b)=>b.intervenciones-a.intervenciones||a.nombre.localeCompare(b.nombre)),
  personal:{trabajadores:participants.size,participaciones:pairs.size,registros:participationRecords,con_horas:measured,cobertura:ratio(measured,participationRecords),horas_hombre:measured?hh:null,preventivas:sum([...participants.values()].map(w=>w.preventivas.size)),operativas:sum([...participants.values()].map(w=>w.operativas.size)),porcentaje_preventivas:ratio(sum([...participants.values()].map(w=>w.preventivas.size)),pairs.size),porcentaje_operativas:ratio(sum([...participants.values()].map(w=>w.operativas.size)),pairs.size),provisionales:sum(current.map(i=>i.provisionales))},
  trabajadores:[...participants.values()].map(w=>({...w,ordenes:w.ordenes.size,horas:w.registros_horas?w.horas:null,aprobadas:w.aprobadas.size,rechazadas:w.rechazadas.size,por_revisar:w.por_revisar.size,preventivas:w.preventivas.size,operativas:w.operativas.size})).sort((a,b)=>b.ordenes-a.ordenes||a.nombre.localeCompare(b.nombre)),
  revisiones:rcounts,detalle:details,backlog,programacion:planRows.map(p=>({id:p.id,orden_id:p.orden_id,fecha:p.fecha_programada,equipo:p.equipo,actividad:p.actividad,cumplida:p.cumplida})),
  criterios:[
   'Actividad: fecha operativa del periodo; estados de revisión actuales. Una orden puede tener varias intervenciones y varios supervisores.',
   'Programación: ocurrencias no canceladas de la agenda preventiva interna, según fecha original. No equivale a todas las hojas externas de Easy Maint. El cumplimiento exige la orden validada y su aprobación registrada hasta la fecha final.',
   'Backlog: órdenes actualmente sin validación final, con origen hasta la fecha final; incluye heredadas. No reconstruye una fotografía histórica. Las programaciones sin orden se muestran aparte.',
   'Trabajador: filtra solamente la sección de personal y su detalle. Las demás secciones conservan los filtros generales.',
   'Horas: se usan intervalos reales completos. En jornadas Q se descuenta 12:00–14:00; las horas por equipo/supervisor no son aditivas para medir ocupación si hubo trabajos simultáneos.',
   'Horas-hombre: solo tiempos individuales registrados, sin multiplicar la duración de la intervención por el número de personas. La cobertura indica los registros completos.',
   'MTTR: N/D; falta identificar reparaciones asociadas a fallas. MTBF y disponibilidad: N/D; faltan registros confiables de operación y paros por falla.',
   'Las revisiones representan el estado actual de cada intervención, no el número de decisiones históricas. El tiempo medio usa únicamente envíos y resoluciones con fechas conocidas de la versión actual.'
  ]};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}};
