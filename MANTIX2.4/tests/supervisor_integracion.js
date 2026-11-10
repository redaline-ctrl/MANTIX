'use strict';
const assert=require('node:assert/strict'),{randomUUID:uuid}=require('node:crypto'),fs=require('node:fs');
const {Pool}=require('pg');
if(process.env.PGDATABASE!=='mantix_revision_test')throw Error('Usa solamente la copia desechable mantix_revision_test.');
const pool=new Pool();let server,checks=0;
(async()=>{
 await require('../tools/MANTIX_migrar_programacion')(pool);
 await require('../tools/MANTIX_migrar_revision')(pool);
 const users={};for(const [name,role] of Object.entries({sup:'SUPERVISOR',next:'SUPERVISOR',chief:'JEFE',coord:'COORDINADOR'})){
  const id=uuid(),password=uuid(),username='s'+id;users[name]={id,password,username};
  await pool.query('INSERT INTO mantix.usuarios(id,nombre_usuario,nombre_mostrar,password_hash) VALUES($1,$2,$3,$4)',[id,username,'Prueba flujo '+name,await require('../tools/MANTIX_auth_criptografia').hashPassword(password)]);
  await pool.query('INSERT INTO mantix.usuario_roles(usuario_id,rol_id) SELECT $1,id FROM mantix.roles WHERE codigo=$2',[id,role]);
 }
 const eq=uuid(),staff=uuid();await pool.query('INSERT INTO mantix.equipos(id,nombre) VALUES($1,$2)',[eq,'Equipo prueba cierre']);await pool.query('INSERT INTO mantix.empleados(id,clave,nombre) VALUES($1,$2,$3)',[staff,'S'+staff,'Ejecutante prueba cierre']);
 async function shift(who,fecha='2026-11-08',extra=true){const id=uuid();await pool.query("INSERT INTO mantix.asignaciones_turno(id,supervisor_id,fecha_operativa,codigo_turno,extraordinario,inicio_real,creado_por) VALUES($1,$2,$3,$4,$5,$6,$2)",[id,users[who].id,fecha,extra?'EXTRA':'B',extra,fecha+'T13:00Z']);return id;}
 async function work(who,shiftId,state='TERMINADA',legacy=false){const id=uuid(),o=uuid();const fecha=(await pool.query('SELECT fecha_operativa::text fecha FROM mantix.asignaciones_turno WHERE id=$1',[shiftId])).rows[0].fecha;
  await pool.query("INSERT INTO mantix.ordenes_trabajo(id,numero_orden,modalidad_registro,tipo_mantenimiento_codigo,descripcion,estado_operativo,creada_por) VALUES($1,$2,'CON_ORDEN','PREVENTIVO','Trabajo de prueba del cierre',$3,$4)",[o,'CIERRE-'+o,state==='TERMINADA'?'TERMINADA':state==='EN_PROCESO'?'EN_PROCESO':'PENDIENTE',users[who].id]);
  await pool.query('INSERT INTO mantix.orden_equipos(orden_id,equipo_id) VALUES($1,$2)',[o,eq]);
  await pool.query("INSERT INTO mantix.intervenciones(id,orden_id,supervisor_id,asignacion_turno_id,fecha_operativa,inicio_real,fin_real,actividades,estado,creada_por) VALUES($1,$2,$3,$4,$5,$6,$7,'Avance realizado durante el turno',$8,$3)",[id,o,users[who].id,legacy?null:shiftId,fecha,fecha+'T13:00Z',state==='TERMINADA'?fecha+'T14:00Z':null,state]);
  await pool.query('INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id) VALUES($1,$2,$3)',[o,id,eq]);await pool.query('INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id) VALUES($1,$2)',[id,staff]);return {id,order:o};
 }
 const day=await shift('sup'),nextDay=await shift('next'),term=await work('sup',day),pending=await work('sup',day,'PENDIENTE_CONTINUIDAD'),inProgress=await work('sup',day,'EN_PROCESO'),legacy=await work('sup',day,'TERMINADA',true);
 const rejected=await work('sup',day);await pool.query("UPDATE mantix.intervenciones SET estado_revision='RECHAZADA' WHERE id=$1",[rejected.id]);
 const conn=require.resolve('../tools/MANTIX_conexion_PostgreSQL');require(conn);require.cache[conn].exports={pool};server=require('../tools/MANTIX_servidor_acceso_local').listen(3102,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:3102',cookies={};
 async function call(url,body,who='sup',status=200,method='POST'){
  const r=await fetch(base+url,{method:body===undefined?'GET':method,headers:{Origin:base,'X-MANTIX-Local':'1','Content-Type':'application/json',Cookie:cookies[who]||''},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();assert.equal(r.status,status,url+' '+raw);checks++;return {data:raw.startsWith('{')?JSON.parse(raw):raw,response:r};
 }
 for(const [name,u] of Object.entries(users)){const r=await call('/api/login',{usuario:u.username,contrasena:u.password},name);cookies[name]=r.response.headers.get('set-cookie').split(';')[0];}
 const preview=()=>call('/api/v2/turnos/'+day+'/preparar-cierre');
 const submit=(body,status=200)=>call('/api/v2/turnos/'+day+'/cerrar',body,'sup',status);
 await call('/api/v2/turnos/'+day+'/preparar-cierre',undefined,'next',403);await call('/api/v2/turnos/'+day+'/cerrar',{},'coord',403);
 let d=(await preview()).data;assert.equal(d.trabajos.filter(i=>i.para_enviar).length,2);assert.equal(d.trabajos.filter(i=>i.requiere_entrega).length,2);
 const delivery=id=>({id,estado:'PENDIENTE_CONTINUIDAD',detalle:'Falta alinear y probar el equipo en el siguiente turno.'});
 let body={revision:d.revision,entregas:[delivery(pending.id),delivery(inProgress.id)],fin_real:'2026-11-08T18:00Z'};
 await submit({...body,entregas:[{...delivery(pending.id),detalle:'No'}]},409);
 await submit({...body,entregas:[{...delivery(pending.id),detalle:'No'},delivery(inProgress.id)]},400);
 assert.equal((await pool.query('SELECT estado_revision FROM mantix.intervenciones WHERE id=$1',[term.id])).rows[0].estado_revision,'NO_ENVIADA');assert.equal((await pool.query('SELECT entregada_en FROM mantix.intervenciones WHERE id=$1',[pending.id])).rows[0].entregada_en,null);
 await submit({...body,fin_real:'2026-11-08T12:00Z'},409);
 // A stale preview must not partially deliver, send or close.
 await call('/api/v2/bitacora/'+term.id,{estado:'TERMINADA',actividades:'Avance actualizado antes de confirmar.',version:1},'sup',200,'PATCH');await submit(body,409);
 assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.cierres_turno WHERE asignacion_turno_id=$1',[day])).rows[0].n,0);
 d=(await preview()).data;body.revision=d.revision;
 const responses=await Promise.all([submit(body),submit(body)]);assert.equal(responses.filter(r=>r.data.repetido).length,1);assert.equal(responses[0].data.cierre_id,responses[1].data.cierre_id);
 assert.equal((await pool.query('SELECT estado_revision FROM mantix.intervenciones WHERE id=$1',[rejected.id])).rows[0].estado_revision,'RECHAZADA');
 assert.equal(responses[0].data.enviadas,2);assert.equal(responses[0].data.entregadas,2);
 assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.cierres_turno WHERE asignacion_turno_id=$1',[day])).rows[0].n,1);
 for(const i of [pending,inProgress]){const row=(await pool.query('SELECT * FROM mantix.intervenciones WHERE id=$1',[i.id])).rows[0];assert.equal(row.estado_revision,'NO_ENVIADA');assert.equal(row.estado,'PENDIENTE_CONTINUIDAD');assert(row.entregada_en);assert.equal((await pool.query("SELECT count(*)::int n FROM mantix.seguimientos WHERE intervencion_id=$1 AND tipo='ENTREGA'",[i.id])).rows[0].n,1);}
 await call('/api/v2/revisiones/enviar',{intervenciones:[pending.id]},'sup',409);
 const chief=(await call('/api/revision/bandeja?supervisor='+users.sup.id+'&estado=EN_REVISION',undefined,'chief')).data;assert.deepEqual(chief.datos.map(i=>i.id).sort(),[term.id,legacy.id].sort());
 await call('/api/v2/bitacora/'+term.id,{estado:'TERMINADA',version:2},'sup',409,'PATCH');
 const create={clave_envio:uuid(),modalidad:'OPERATIVO',numero_orden:'',tipo:'OPERATIVO',descripcion:'Trabajo nuevo de prueba',fecha_operativa:'2026-11-08',estado:'TERMINADA',inicio:'2026-11-08T14:00:00Z',fin:'2026-11-08T15:00:00Z',actividades:'Prueba posterior al cierre',equipos:[eq],ejecutantes:[staff]};
 await call('/api/ejecucion/ordenes',create,'sup',409);
 // The next supervisor continues the same order and keeps the first intervention intact.
 const take=(await call('/api/pendientes/'+pending.order+'/tomar',{},'next')).data;
 const continueBody={...create,token:take.token,clave_envio:uuid(),actividades:'Alineación y prueba final del equipo.'};
 const continued=(await call('/api/pendientes/'+pending.order+'/continuar',continueBody,'next',201)).data;
 assert.equal(continued.orden_id,pending.order);const next=(await pool.query('SELECT * FROM mantix.intervenciones WHERE id=$1',[continued.intervencion_id])).rows[0];assert.equal(next.supervisor_id,users.next.id);assert.equal(next.asignacion_turno_id,nextDay);assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.intervenciones WHERE orden_id=$1',[pending.order])).rows[0].n,2);
 let np=(await call('/api/v2/turnos/'+nextDay+'/preparar-cierre',undefined,'next')).data;assert.equal(np.trabajos.length,1);await call('/api/v2/turnos/'+nextDay+'/cerrar',{revision:np.revision,entregas:[],fin_real:'2026-11-08T19:00Z'},'next');
 const replay=(await call('/api/pendientes/'+pending.order+'/continuar',continueBody,'next')).data;assert(replay.repetido);assert.equal(replay.intervencion_id,continued.intervencion_id);
 // A previously delivered pending may already have a later continuation; closing must not overwrite it.
 const oldShift=await shift('sup','2026-11-09',false),old=await work('sup',oldShift,'PENDIENTE_REFACCION');await call('/api/pendientes/'+old.order+'/entregar',{detalle:'Se requiere refacción para continuar la reparación.'});
 await pool.query("INSERT INTO mantix.intervenciones(id,orden_id,supervisor_id,fecha_operativa,actividades,estado,creada_por) VALUES($1,$2,$3,'2026-11-10','Continuación por otro supervisor','EN_PROCESO',$3)",[uuid(),old.order,users.next.id]);await pool.query("UPDATE mantix.ordenes_trabajo SET estado_operativo='EN_PROCESO' WHERE id=$1",[old.order]);
 const op=(await call('/api/v2/turnos/'+oldShift+'/preparar-cierre')).data;assert(!op.trabajos.some(i=>i.requiere_entrega));await call('/api/v2/turnos/'+oldShift+'/cerrar',{revision:op.revision,entregas:[]});assert.equal((await pool.query('SELECT estado_operativo FROM mantix.ordenes_trabajo WHERE id=$1',[old.order])).rows[0].estado_operativo,'EN_PROCESO');
 if(process.env.SUPERVISOR_BROWSER==='1'){
  const uiShift=await shift('sup','2026-11-11',false),uTerm=await work('sup',uiShift),uPending=await work('sup',uiShift,'PENDIENTE_REFACCION');
  const browser=await require('playwright').chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try{const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'es-MX',timezoneId:'America/Merida'});await context.addCookies([{name:'mantix_session',value:cookies.sup.split('=')[1],url:base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addLocatorHandler(page.locator('#shiftOverlay:not(.hide)'),async()=>{await page.locator('#shiftDialogView').click();});
   await page.goto(base+'/bitacora');await page.locator('#previousDays summary').waitFor();await page.locator('#previousDays summary').click();await page.locator('#bdia').fill('2026-11-11');await page.locator('#bcargar').click();await page.locator('[data-intervention="'+uTerm.id+'"]').waitFor();assert(await page.locator('#nav').isHidden());
   const card=page.locator('[data-intervention="'+uPending.id+'"]');await card.getByRole('button',{name:'Ver detalle',exact:true}).click();await page.locator('#orderDialog').waitFor({state:'visible'});assert.equal(await page.locator('#orderDialog [data-send]').count(),0);assert(await page.locator('#orderDialog').getByText('Pendiente por refacción',{exact:false}).isVisible());
   fs.mkdirSync('/workspace/artifacts',{recursive:true});await page.screenshot({path:'/workspace/artifacts/supervisor-detalle-flotante.png'});await page.keyboard.press('Escape');assert(await page.locator('#orderDialog').isHidden());assert(await card.getByRole('button',{name:'Ver detalle',exact:true}).evaluate(e=>document.activeElement===e));
   await page.locator('#bitacoraClose').click();await page.locator('#closeOverlay').waitFor({state:'visible'});assert.equal(await page.locator('#closeOverlay [data-handoff]').count(),1);assert(await page.locator('#closeOverlay').getByText('Terminados para enviar al jefe · 1').isVisible());
   await page.locator('#closeDialogConfirm').click();await page.locator('#closeDialogError').filter({hasText:'Explica qué falta'}).waitFor();assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.cierres_turno WHERE asignacion_turno_id=$1',[uiShift])).rows[0].n,0);
   await page.locator('.handoff-detail').fill('Falta conseguir la refacción y hacer la prueba final.');await page.screenshot({path:'/workspace/artifacts/supervisor-resumen-cierre.png'});
   await page.setViewportSize({width:390,height:844});assert(await page.locator('#closeOverlay').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.screenshot({path:'/workspace/artifacts/supervisor-cierre-movil.png'});await page.setViewportSize({width:1440,height:1000});await page.locator('#closeDialogConfirm').click();await page.locator('#closeOverlay').waitFor({state:'hidden'});await page.locator('#message').filter({hasText:'1 terminado(s) enviado(s) al jefe y 1 pendiente(s) entregado(s)'}).waitFor();assert(await page.locator('#bitacoraClose').isDisabled());await page.screenshot({path:'/workspace/artifacts/supervisor-bitacora-cerrada.png',fullPage:true});
   await page.goto(base+'/historial');await page.locator('#hquery').fill('CIERRE-'+uTerm.order);await page.locator('#hsearch').click();await page.locator('#hrows .entry').first().getByRole('button',{name:'Ver detalle'}).click();await page.locator('#orderDialog').waitFor({state:'visible'});const scrollBefore=await page.evaluate(()=>scrollY);await page.locator('#orderDialogClose').click();assert(Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)<=1);assert.equal(await page.locator('#hquery').inputValue(),'CIERRE-'+uTerm.order);assert.equal(await page.locator('#hrows .entry').count(),1);assert.deepEqual(errors,[]);
   console.log('OK navegador: bitácora, detalle flotante/Esc/foco, pendientes sin envío, cierre único, filtros conservados, escritorio y móvil.');
  }finally{await browser.close();}
 }
 console.log('OK:',checks,'solicitudes: cierre atómico, permisos, datos faltantes, resumen obsoleto, confirmación concurrente, legado sin turno, continuidad con autoría y bloqueo posterior al cierre.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
