'use strict';
// Ejecutar solo contra una copia desechable: PGDATABASE=mantix_bitacora_test node tests/bitacora_integracion.js
const assert=require('node:assert/strict');
const {randomUUID:uuid}=require('node:crypto');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const express=require('express'),{Pool}=require('pg');
if(process.env.PGDATABASE!=='mantix_bitacora_test')throw Error('Esta prueba requiere la base desechable mantix_bitacora_test.');
const pool=new Pool({database:process.env.PGDATABASE});
(async()=>{
 await require('../tools/MANTIX_migrar_bitacora')(pool);await require('../tools/MANTIX_migrar_bitacora')(pool);
 for(const file of ['MANTIX_bitacora.html','MANTIX_centro.html']){const html=fs.readFileSync(path.join(__dirname,'../tools',file),'utf8');new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);}
 const people={};for(const name of ['sup','otro','jefe','coord']){const key=uuid();people[name]={id:key,nombre:name,roles:[name==='jefe'?'JEFE':name==='coord'?'COORDINADOR':'SUPERVISOR'],perms:name==='jefe'?['revision.gestionar']:name==='coord'?['dashboard.leer']:['ordenes.registrar']};await pool.query('INSERT INTO mantix.usuarios(id,nombre_usuario,nombre_mostrar,password_hash) VALUES($1,$2,$3,$4)',[key,'t'+key,name,'test-only-not-a-password-hash']);}
 const app=express();app.use(express.json());
 const auth=(req,res,next)=>{req.actor=people[req.get('Test-Actor')];if(!req.actor)return res.sendStatus(401);next();};
 const permit=p=>(req,res,next)=>req.actor.perms.includes(p)?next():res.sendStatus(403);
 const localWrite=(req,res,next)=>req.get('X-MANTIX-Local')==='1'?next():res.sendStatus(403);
 const ctx={pool,auth,permit,localWrite};require('../tools/MANTIX_bitacora')(app,ctx);require('../tools/MANTIX_modulos_completos')(app,ctx);
 app.get('/api/me',auth,(req,res)=>res.json({ok:true,nombre:req.actor.nombre,roles:req.actor.roles,permisos:req.actor.perms}));
 app.get('/api/ejecucion/opciones',auth,async(req,res)=>res.json({ok:true,tipos:(await pool.query('SELECT codigo,nombre FROM mantix.tipos_mantenimiento WHERE activo')).rows,equipos:(await pool.query('SELECT id,nombre FROM mantix.equipos WHERE activo')).rows,empleados:(await pool.query('SELECT id,nombre FROM mantix.empleados WHERE activo')).rows}));
 app.get('/logo-isysa.png',(req,res)=>res.sendFile(path.join(__dirname,'../public/logo.png')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;let count=0;
 async function call(url,body,actor='sup',method='POST',status=200){const r=await fetch(base+url,{method:body===undefined?'GET':method,headers:{'Test-Actor':actor,'Content-Type':'application/json','X-MANTIX-Local':'1'},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();assert.equal(r.status,status,url+' '+raw);count++;return raw.startsWith('{')?JSON.parse(raw):{};}
 try{
 const eq=(await pool.query('SELECT id FROM mantix.equipos WHERE activo LIMIT 1')).rows[0].id,staff=(await pool.query('SELECT id FROM mantix.empleados WHERE activo LIMIT 1')).rows[0].id,type=(await pool.query('SELECT codigo FROM mantix.tipos_mantenimiento WHERE activo LIMIT 1')).rows[0].codigo;
 const shift=(await call('/api/v2/turnos',{fecha_operativa:'2026-11-07',turno:'A'})).id;
 const b={jornada_id:shift,clave_envio:uuid(),modalidad:'CON_ORDEN',numero_orden:'PRUEBA-'+uuid(),tipo:type,descripcion:'Trabajo asignado de prueba',estado:'POR_INICIAR',equipos:[eq],ejecutantes:[],actividades:'',inicio:null,fin:null};
 const created=await call('/api/bitacora/filas',b);assert.equal((await call('/api/bitacora/filas',b)).id,created.id);
 await call('/api/bitacora/jornadas/'+shift,undefined,'otro','GET',403);
 await call('/api/bitacora/filas',b,'coord','POST',403);
 await call('/api/bitacora/jornadas/'+shift+'/cerrar',{},'sup','POST',409);
 let saved=(await call('/api/bitacora/jornadas/'+shift)).filas[0];assert.equal(saved.inicio_real,null);
 await call('/api/bitacora/filas/'+created.id,{...b,version:1,estado:'TERMINADA',ejecutantes:[staff],actividades:'Trabajo terminado',inicio:'2026-11-08T05:30:00Z',fin:'2026-11-08T08:00:00Z'},'sup','PATCH');
 await call('/api/bitacora/filas/'+created.id,{...b,version:1},'sup','PATCH',409);
 const unfinished=await call('/api/bitacora/filas',{...b,clave_envio:uuid(),numero_orden:'PRUEBA-'+uuid(),motivo_pendiente:'No se inició por falta de acceso al equipo.'});
 const close=await call('/api/bitacora/jornadas/'+shift+'/cerrar',{});assert.equal((await call('/api/bitacora/jornadas/'+shift+'/cerrar',{})).cierre_id,close.cierre_id);
 const after=await call('/api/bitacora/jornadas/'+shift);assert.equal(after.filas.find(i=>i.id===created.id).estado_revision,'EN_REVISION');assert(after.filas.find(i=>i.id===unfinished.id).entregada_en);
 await call('/api/bitacora/filas',{...b,clave_envio:uuid()},'sup','POST',409);
 await call('/api/bitacora/filas/'+created.id,{...b,version:2},'sup','PATCH',409);
 const report=await call('/api/bitacora/reportes/'+close.cierre_id,undefined,'jefe');assert.equal(report.reporte.filas.length,2);
 await call('/api/v2/revisiones/'+created.id+'/resolver',{resultado:'RECHAZADA',motivo:'Completar el detalle de las actividades.'},'jefe');
 const corrections=await call('/api/v2/correcciones/mias');const correction=corrections.datos.find(s=>s.intervencion_id===created.id);assert.equal(correction.estado,'AUTORIZADA');
 await call('/api/v2/correcciones/'+correction.id+'/aplicar',{actividades:'Detalle corregido del trabajo terminado.'});
 await call('/api/v2/correcciones/'+correction.id+'/enviar',{});
 await call('/api/v2/revisiones/'+created.id+'/resolver',{resultado:'APROBADA'},'jefe');
 assert.deepEqual((await call('/api/bitacora/reportes/'+close.cierre_id,undefined,'jefe')).reporte,report.reporte);
 const order=after.filas.find(i=>i.id===unfinished.id).orden_id;
 await call('/api/bitacora/ordenes/'+order+'/cancelacion',{motivo:'Ya no se requiere realizar la actividad.'});
 await call('/api/bitacora/cancelaciones/'+order,{decision:'APROBADA'},'sup','POST',403);
 await call('/api/bitacora/cancelaciones/'+order,{decision:'APROBADA'},'jefe');
 assert.equal((await pool.query('SELECT estado_operativo FROM mantix.ordenes_trabajo WHERE id=$1',[order])).rows[0].estado_operativo,'CANCELADA');
 assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.versiones_intervencion WHERE intervencion_id=$1',[created.id])).rows[0].n,1);
 // Sunday and divided shifts remain separate, and no login side effect creates them.
 await call('/api/v2/turnos',{fecha_operativa:'2026-11-08',turno:'B'},'sup','POST',400);
 const sunday=(await call('/api/v2/turnos',{fecha_operativa:'2026-11-08',turno:'EXTRA',inicio_real:'2026-11-08T14:00:00Z'})).id;
 await call('/api/bitacora/jornadas/'+sunday+'/cerrar',{},'sup','POST',409);
 await call('/api/v2/turnos/'+sunday+'/horario',{fin_real:'2026-11-08T20:00:00Z'},'sup','PATCH');
 await call('/api/bitacora/jornadas/'+sunday+'/cerrar',{});
 if(process.env.BITACORA_BROWSER==='1'){
  const uiShift=(await call('/api/v2/turnos',{fecha_operativa:'2026-11-09',turno:'Q1'})).id;
  const browser=await require('playwright').chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try{const page=await browser.newPage({viewport:{width:1600,height:1000},extraHTTPHeaders:{'Test-Actor':'sup'}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/bitacora?jornada='+uiShift);await page.getByRole('button',{name:'+ Agregar actividad'}).click();
   await page.locator('#mode').selectOption('OPERATIVO');await page.locator('#equipment').selectOption(eq);await page.locator('#description').fill('Inspección operativa de prueba en navegador');await page.locator('#save').click();
   await page.getByText('Fila guardada.',{exact:false}).waitFor();await page.getByRole('button',{name:'Actualizar',exact:true}).last().click();
   await page.locator('#reason').fill('No se inició por falta de acceso al equipo.');await page.locator('#save').click();await page.locator('#editor').waitFor({state:'detached'});
   await page.getByRole('button',{name:'Revisar y cerrar turno',exact:true}).click();await page.getByRole('button',{name:'Cerrar turno y enviar reporte',exact:true}).click();
   await page.getByText('Turno cerrado. Reporte enviado',{exact:false}).waitFor();assert(await page.locator('#add').isDisabled());
   fs.mkdirSync('/workspace/artifacts',{recursive:true});await page.screenshot({path:'/workspace/artifacts/bitacora-turno.png',fullPage:true});assert.deepEqual(errors,[]);
   await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true);
   console.log('OK: navegador, captura sin horas, actualización, cierre y vista móvil sin errores JavaScript.');
  }finally{await browser.close();}
 }
 // Exercise the real server middleware, session authentication and legacy continuity too.
 const passwords={};
 for(const [name,person] of Object.entries(people)){
  passwords[name]=uuid();const hash=await require('../tools/MANTIX_auth_criptografia').hashPassword(passwords[name]);
  await pool.query('UPDATE mantix.usuarios SET password_hash=$1 WHERE id=$2',[hash,person.id]);
  await pool.query('INSERT INTO mantix.usuario_roles(usuario_id,rol_id) SELECT $1,id FROM mantix.roles WHERE codigo=$2',[person.id,person.roles[0]]);
 }
 require.cache[require.resolve('../tools/MANTIX_conexion_PostgreSQL')].exports={pool};
 const realApp=require('../tools/MANTIX_servidor_acceso_local');const real=realApp.listen(0,'127.0.0.1');await new Promise(r=>real.once('listening',r));
 const origin='http://127.0.0.1:3102',realBase='http://127.0.0.1:'+real.address().port,cookies={};
 async function realCall(url,body,who='sup',status=200){const r=await fetch(realBase+url,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'X-MANTIX-Local':'1','Content-Type':'application/json',Cookie:cookies[who]||''},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();assert.equal(r.status,status,url+' '+raw);count++;return {r,data:raw.startsWith('{')?JSON.parse(raw):{}};}
 try{
  for(const name of Object.keys(people)){const login=await realCall('/api/login',{usuario:'t'+people[name].id,contrasena:passwords[name]},name);cookies[name]=login.r.headers.get('set-cookie').split(';')[0];}
  await realCall('/api/me',undefined,'sup');await realCall('/api/bitacora/jornadas/'+shift,undefined,'otro',403);await realCall('/api/bitacora/jornadas/'+shift,undefined,'coord',403);
  const actualShift=(await realCall('/api/v2/turnos',{fecha_operativa:'2026-11-10',turno:'B'})).data.id;
  const planned=(await realCall('/api/bitacora/filas',{...b,clave_envio:uuid(),jornada_id:actualShift,numero_orden:'PRUEBA-'+uuid(),motivo_pendiente:'Falta el permiso para intervenir el equipo.'})).data.id;
  await realCall('/api/bitacora/jornadas/'+actualShift+'/cerrar',{});
  const planRow=(await realCall('/api/bitacora/jornadas/'+actualShift)).data.filas.find(i=>i.id===planned);
  const racing=await Promise.all(['sup','otro'].map(async who=>{const r=await fetch(realBase+'/api/pendientes/'+planRow.orden_id+'/tomar',{method:'POST',headers:{Origin:origin,'X-MANTIX-Local':'1','Content-Type':'application/json',Cookie:cookies[who]},body:'{}'});return {who,status:r.status,data:await r.json()};}));
  assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);count+=2;const winner=racing.find(r=>r.status===200);
  await realCall('/api/v2/turnos',{fecha_operativa:'2026-11-11',turno:'B'},winner.who);
  await realCall('/api/pendientes/'+planRow.orden_id+'/continuar',{clave_envio:uuid(),token:winner.data.token,fecha_operativa:'2026-11-11',estado:'TERMINADA',inicio:'2026-11-11T13:00:00Z',fin:'2026-11-11T14:00:00Z',actividades:'Continuidad terminada por el siguiente supervisor.',equipos:[eq],ejecutantes:[staff]},winner.who,201);
  assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.intervenciones WHERE orden_id=$1',[planRow.orden_id])).rows[0].n,2);
  console.log('OK: servidor real, sesiones, permisos y toma simultánea con continuidad en una sola orden.');
 }finally{await new Promise(r=>real.close(r));}
 console.log('OK:',count,'solicitudes verificadas: planificación, validación, permisos, cierre atómico, reintentos, entrega sin inicio, corrección versionada, reporte inmutable, cancelación y domingo.');
 }finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>pool.end());
