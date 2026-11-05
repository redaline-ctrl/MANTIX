'use strict';
const assert=require('node:assert/strict'),{randomUUID:uuid}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {Pool}=require('pg');
if(process.env.PGDATABASE!=='mantix_revision_test')throw Error('Usa solamente la base desechable mantix_revision_test.');
const pool=new Pool({database:process.env.PGDATABASE});let server,checks=0;
(async()=>{
 const migration=fs.readFileSync(path.join(__dirname,'../database/MIGRACION_002_PROPUESTAS_CATALOGO.sql'),'utf8');
 await pool.query(migration.slice(migration.indexOf('CREATE TABLE'),migration.lastIndexOf('COMMIT;')));
 const migrate=require('../tools/MANTIX_migrar_revision');await migrate(pool);await migrate(pool);
 await pool.query("INSERT INTO mantix.tipos_mantenimiento(codigo,nombre) VALUES('OPERATIVO','Trabajo operativo') ON CONFLICT DO NOTHING");
 const users={};for(const [name,roles] of Object.entries({sup:['SUPERVISOR'],other:['SUPERVISOR'],chief:['JEFE'],chief2:['JEFE'],admin:['ADMINISTRADOR'],coord:['COORDINADOR']})){
  const key=uuid(),password=uuid(),username='t'+key;users[name]={id:key,password,username};
  const hash=await require('../tools/MANTIX_auth_criptografia').hashPassword(password);
  await pool.query('INSERT INTO mantix.usuarios(id,nombre_usuario,nombre_mostrar,password_hash) VALUES($1,$2,$3,$4)',[key,username,'Prueba '+name,hash]);
  for(const role of roles)await pool.query('INSERT INTO mantix.usuario_roles(usuario_id,rol_id) SELECT $1,id FROM mantix.roles WHERE codigo=$2',[key,role]);
 }
 const eq=uuid(),eq2=uuid(),staff=uuid(),staff2=uuid();
 for(const [id,name] of [[eq,'Equipo de prueba revisión A'],[eq2,'Equipo de prueba revisión B']])await pool.query('INSERT INTO mantix.equipos(id,nombre) VALUES($1,$2)',[id,name]);
 for(const [id,name] of [[staff,'Ejecutante de prueba Ana'],[staff2,'Ejecutante de prueba Luis']])await pool.query('INSERT INTO mantix.empleados(id,clave,nombre) VALUES($1,$2,$3)',[id,'T'+id,name]);
 const shifts={};for(const [who,code] of [['sup','B'],['other','C']]){const key=uuid();shifts[who]=key;await pool.query('INSERT INTO mantix.asignaciones_turno(id,supervisor_id,fecha_operativa,codigo_turno,creado_por) VALUES($1,$2,$3,$4,$2)',[key,users[who].id,'2026-11-05',code]);}
 async function order(){const key=uuid();await pool.query("INSERT INTO mantix.ordenes_trabajo(id,numero_orden,modalidad_registro,tipo_mantenimiento_codigo,descripcion,creada_por) VALUES($1,$2,'CON_ORDEN','PREVENTIVO','Inspección preventiva de prueba',$3)",[key,'REV-'+key,users.sup.id]);for(const e of [eq,eq2])await pool.query('INSERT INTO mantix.orden_equipos(orden_id,equipo_id) VALUES($1,$2)',[key,e]);return key;}
 async function intervention(o,who='sup',state='TERMINADA',shift=shifts[who]){const key=uuid();await pool.query(`INSERT INTO mantix.intervenciones(id,orden_id,supervisor_id,asignacion_turno_id,fecha_operativa,inicio_real,fin_real,actividades,estado,creada_por) VALUES($1,$2,$3,$4,'2026-11-05','2026-11-05T13:00Z','2026-11-05T15:00Z','Inspección y ajuste de prueba',$5,$3)`,[key,o,users[who].id,shift,state]);for(const e of [eq,eq2])await pool.query('INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id) VALUES($1,$2,$3)',[o,key,e]);for(const e of [staff,staff2])await pool.query("INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id,inicio_participacion,fin_participacion) VALUES($1,$2,'2026-11-05T13:00Z','2026-11-05T14:00Z')",[key,e]);return key;}
 const original=await order(),first=await intervention(original,'sup','EN_PROCESO'),continued=await intervention(original,'other'),legacy=await intervention(await order(),'sup','TERMINADA',null);
 const conn=require.resolve('../tools/MANTIX_conexion_PostgreSQL');require(conn);require.cache[conn].exports={pool};const app=require('../tools/MANTIX_servidor_acceso_local');server=app.listen(3102,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port,origin='http://127.0.0.1:3102',cookies={};
 async function call(url,body,who='chief',status=200,method='POST'){
  const r=await fetch(base+url,{method:body===undefined?'GET':method,headers:{Origin:origin,'X-MANTIX-Local':'1','Content-Type':'application/json',Cookie:cookies[who]||''},body:body===undefined?undefined:JSON.stringify(body)});const raw=await r.text();assert.equal(r.status,status,url+' '+raw);checks++;return {data:raw.startsWith('{')?JSON.parse(raw):raw,response:r};
 }
 for(const [name,u] of Object.entries(users)){const r=await call('/api/login',{usuario:u.username,contrasena:u.password},name);cookies[name]=r.response.headers.get('set-cookie').split(';')[0];}
 await call('/api/revision/bandeja',undefined,'anonymous',401);await call('/api/revision/intervenciones/'+first,undefined,'sup',403);await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'APROBADA',version:1},'sup',403);for(const who of ['sup','admin','coord'])await call('/api/revision/bandeja',undefined,who,403);
 await call('/api/v2/revisiones/enviar',{intervenciones:[first]},'sup',409);await call('/api/v2/revisiones/enviar',{intervenciones:[continued]},'sup',403);
 await pool.query("UPDATE mantix.intervenciones SET estado='TERMINADA' WHERE id=$1",[first]);
 await call('/api/v2/revisiones/enviar',{intervenciones:[first]},'sup');const sent=(await pool.query('SELECT enviada_revision_en FROM mantix.intervenciones WHERE id=$1',[first])).rows[0].enviada_revision_en;
 await call('/api/v2/revisiones/enviar',{intervenciones:[first]},'sup');assert.equal(+(await pool.query('SELECT enviada_revision_en FROM mantix.intervenciones WHERE id=$1',[first])).rows[0].enviada_revision_en,+sent);
 const list=(await call('/api/revision/bandeja?supervisor='+users.sup.id+'&estado=EN_REVISION')).data;assert.equal(list.total,1);assert.equal(list.datos[0].equipos.length,2);assert.equal(list.datos[0].ejecutantes.length,2);assert.equal(list.resumen.pendientes,1);
 assert.equal((await call('/api/revision/bandeja?supervisor='+users.sup.id+'&q=%25')).data.total,0);
 await call('/api/revision/bandeja?desde=2026-02-30',undefined,'chief',400);await call('/api/revision/bandeja?desde=2026-11-06&hasta=2026-11-05',undefined,'chief',400);
 assert.equal((await call('/api/revision/bandeja?supervisor='+users.sup.id+'&turno=C')).data.total,0);
 const detail=(await call('/api/revision/intervenciones/'+first)).data;assert.equal(detail.continuidad.length,2);assert.equal(detail.intervencion.supervisor,'Prueba sup');
 const self=await intervention(await order(),'chief','TERMINADA',null);await pool.query("UPDATE mantix.intervenciones SET estado_revision='EN_REVISION' WHERE id=$1",[self]);await call('/api/v2/revisiones/'+self+'/resolver',{resultado:'APROBADA',version:1},'chief',403);
 const beforeClosed=uuid();await pool.query('INSERT INTO mantix.cierres_turno(id,asignacion_turno_id,cerrado_por) VALUES($1,$2,$3)',[beforeClosed,shifts.sup,users.sup.id]);
 await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'RECHAZADA',motivo:'corto',version:1},'chief',400);
 await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'APROBADA',version:9},'chief',409);
 await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'RECHAZADA',motivo:'Completar el detalle de la intervención.',version:1});
 await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'APROBADA',version:1},'chief2',409);
 const mine=(await call('/api/v2/correcciones/mias',undefined,'sup')).data.datos.find(s=>s.intervencion_id===first);assert.equal(mine.estado,'AUTORIZADA');assert.equal((await call('/api/v2/correcciones/mias',undefined,'other')).data.datos.length,0);
 await call('/api/v2/correcciones/'+mine.id+'/aplicar',{version:1,actividades:'Corrección no autorizada de prueba'},'other',403);
 await pool.query('UPDATE mantix.empleados SET activo=false WHERE id=$1',[staff]);
 await call('/api/v2/correcciones/'+mine.id+'/aplicar',{version:1,actividades:'Actividades completas, revisadas y corregidas.',ejecutantes:[staff,staff2]},'sup');
 await pool.query('UPDATE mantix.empleados SET activo=true WHERE id=$1',[staff]);
 const history=(await pool.query('SELECT datos_anteriores,datos_nuevos FROM mantix.versiones_intervencion WHERE intervencion_id=$1',[first])).rows[0];assert.equal(history.datos_anteriores.version,1);assert.equal(history.datos_nuevos.version,2);
 const corrected=(await pool.query('SELECT enviada_revision_en,resuelta_revision_en FROM mantix.intervenciones WHERE id=$1',[first])).rows[0];assert.equal(corrected.enviada_revision_en,null);assert.equal(corrected.resuelta_revision_en,null);
 const participation=(await pool.query('SELECT inicio_participacion FROM mantix.intervencion_ejecutantes WHERE intervencion_id=$1',[first])).rows;assert(participation.every(e=>e.inicio_participacion));
 await call('/api/v2/correcciones/'+mine.id+'/enviar',{},'sup');await call('/api/v2/correcciones/'+mine.id+'/enviar',{},'sup');assert.equal((await call('/api/v2/correcciones/mias',undefined,'sup')).data.datos.length,0);
 await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'APROBADA',version:1},'chief',409);
 await call('/api/v2/revisiones/'+first+'/resolver',{resultado:'APROBADA',version:2});
 const final=(await call('/api/revision/intervenciones/'+first)).data;assert.equal(final.revisiones.filter(r=>r.intervencion_id===first).length,2);assert.equal(final.versiones.length,1);assert(final.intervencion.resuelta_revision_en);assert.equal((await pool.query('SELECT id FROM mantix.cierres_turno WHERE asignacion_turno_id=$1',[shifts.sup])).rows[0].id,beforeClosed);
 await call('/api/v2/revisiones/enviar',{intervenciones:[continued]},'other');
 const race=await Promise.all(['chief','chief2'].map(async who=>{const r=await fetch(base+'/api/v2/revisiones/'+continued+'/resolver',{method:'POST',headers:{Origin:origin,'X-MANTIX-Local':'1','Content-Type':'application/json',Cookie:cookies[who]},body:JSON.stringify({resultado:'APROBADA',version:1})});return r.status;}));assert.deepEqual(race.sort(),[200,409]);checks+=2;
 assert.equal((await pool.query('SELECT count(*)::int n FROM mantix.revisiones WHERE intervencion_id=$1',[continued])).rows[0].n,1);
 const term=await intervention(await order()),pending=await intervention(await order(),'sup','PENDIENTE_CONTINUIDAD');await call('/api/v2/revisiones/enviar',{intervenciones:[term,pending]},'sup',409);assert.equal((await pool.query('SELECT estado_revision FROM mantix.intervenciones WHERE id=$1',[term])).rows[0].estado_revision,'NO_ENVIADA');
 const past=(await call('/api/revision/intervenciones/'+legacy)).data;assert.equal(past.intervencion.enviada_revision_en,null);
 const groups=(await call('/api/revision/jornadas?supervisor='+users.sup.id)).data;assert(groups.datos.some(g=>g.codigo_turno===null));assert(groups.datos.some(g=>g.codigo_turno==='B'));
 // A provisional name is visible, never silently counted as an official employee.
 await pool.query("INSERT INTO mantix.propuestas_catalogo(id,tipo,nombre_original,propuesto_por,orden_id,intervencion_id) VALUES($1,'EJECUTANTE','Persona provisional de prueba',$2,$3,$4)",[uuid(),users.sup.id,original,first]);
 assert.equal((await call('/api/revision/intervenciones/'+first)).data.intervencion.provisionales.length,1);
 if(process.env.REVISION_BROWSER==='1'){
  const ui=await intervention(await order());await call('/api/v2/revisiones/enviar',{intervenciones:[ui]},'sup');
  const browser=await require('playwright').chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  try{
   const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'es-MX',timezoneId:'America/Mexico_City'});await context.addCookies([{name:'mantix_session',value:cookies.chief.split('=')[1],url:base}]);
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.status()>=400)console.log('Browser HTTP',r.status(),r.url(),await r.text().catch(()=>''));});page.on('dialog',d=>d.accept());
   await page.goto(base+'/revision');await page.locator('#supervisor').selectOption(users.sup.id);await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();await page.locator('[data-detail="'+ui+'"]').click();
   await page.locator('#detail').waitFor({state:'visible'});await page.locator('#reject').click();await page.getByText('Explica qué debe corregirse',{exact:false}).waitFor();await page.locator('#reason').fill('Completar las actividades realizadas en este trabajo.');
   fs.mkdirSync('/workspace/artifacts',{recursive:true});await page.screenshot({path:'/workspace/artifacts/revision-jefe-detalle.png',fullPage:true});await page.locator('#reject').click();await page.locator('#detail').waitFor({state:'hidden',timeout:10000}).catch(async err=>{console.log('Decision:',await page.locator('#decisionMessage').textContent());console.log('Errors:',errors);throw err;});
   await page.getByRole('tab',{name:'Historial de revisión',exact:true}).click();await page.locator('[data-detail="'+ui+'"]').waitFor();await page.getByRole('tab',{name:'Bitácoras por turno',exact:true}).click();await page.getByRole('button',{name:'Ver bitácora',exact:true}).first().click();await page.locator('[data-detail]').first().waitFor();
   await page.screenshot({path:'/workspace/artifacts/revision-jefe-bandeja.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);
   await page.screenshot({path:'/workspace/artifacts/revision-jefe-movil.png',fullPage:true});
   await context.addCookies([{name:'mantix_session',value:cookies.sup.split('=')[1],url:base}]);await page.goto(base+'/correcciones');await page.locator('.acts').fill('Actividades detalladas corregidas desde el navegador.');await page.getByRole('button',{name:'Guardar y reenviar al jefe'}).click();await page.getByText('Corrección guardada y enviada al jefe.',{exact:false}).waitFor();
   await context.addCookies([{name:'mantix_session',value:cookies.chief.split('=')[1],url:base}]);await page.goto(base+'/revision');await page.locator('#supervisor').selectOption(users.sup.id);await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();await page.locator('[data-detail="'+ui+'"]').click();await page.locator('#approve').click();await page.locator('#detail').waitFor({state:'hidden'});
   for(const who of ['chief','coord','admin','sup']){
    await context.addCookies([{name:'mantix_session',value:cookies[who].split('=')[1],url:base}]);await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/centro');await page.locator('#who').filter({hasText:'Prueba '+who}).waitFor();await page.locator('#content .panel').first().waitFor();
    if(who==='admin'){assert(await page.locator('#nav').isVisible());continue;}
    assert(await page.locator('#nav').isHidden());
    if(who==='sup')continue;
    assert(await page.locator('#contextNav').isVisible());const navText=await page.locator('#contextNav').textContent();assert(navText.includes('Dashboard'));assert(navText.includes('Historial'));assert(!navText.includes('Registrar trabajo'));
    if(who==='chief'){assert(navText.includes('Revisar trabajos'));assert(navText.includes('Preventivos'));}else{assert(!navText.includes('Revisar trabajos'));assert(!navText.includes('Preventivos'));}
    await page.locator('#contextNav').getByRole('button',{name:'Historial',exact:false}).click();await page.waitForURL('**/historial');assert(await page.locator('#nav').isHidden());await page.locator('#contextNav').getByRole('button',{name:'Mi centro',exact:false}).click();await page.waitForURL('**/centro');
    await page.screenshot({path:'/workspace/artifacts/centro-'+who+'-sin-lateral.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth),true);assert(await page.locator('#nav').isHidden());
   }
   assert.deepEqual(errors,[]);console.log('OK: navegador, revisión/corrección y navegación superior de jefe/coordinador en escritorio y móvil; supervisor sin lateral y administrador conservado.');
  }finally{await browser.close();}
 }
 // Pagination must not truncate or duplicate records.
 const big=await order();for(let n=0;n<27;n++)await intervention(big,'other');
 const p1=(await call('/api/revision/bandeja?supervisor='+users.other.id+'&estado=TODOS&pagina=1')).data,p2=(await call('/api/revision/bandeja?supervisor='+users.other.id+'&estado=TODOS&pagina=2')).data;assert.equal(p1.datos.length,25);assert(p2.datos.length>0);assert.equal(new Set([...p1.datos,...p2.datos].map(i=>i.id)).size,p1.total);
 console.log('OK:',checks,'solicitudes verificadas con autenticación real: permisos, filtros, datos sin duplicación, envío solo terminado, transacciones, decisiones concurrentes, versiones, corrección, historial y paginación.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await pool.end();});
