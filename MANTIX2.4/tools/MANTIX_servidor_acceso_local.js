'use strict';
// Etapa 5.6: servidor de autenticacion y consulta de catalogos, SOLO LOCAL.
// No reemplaza server.js; no crea ni modifica estructura de tablas.
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { pool } = require('./MANTIX_conexion_PostgreSQL');
const { verifyPassword, hashPassword } = require('./MANTIX_auth_criptografia');
const app = express();
app.disable('x-powered-by');
app.use(express.json({limit:'384kb'}));
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');next();});
const HOST='127.0.0.1', PORT=3102, sessions=new Map(), failed=new Map(), TIMEOUT=30*60*1000;
function cookies(req) {return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim().split('=')).filter(x=>x.length===2));}
function sessionFrom(req) {
  const token=cookies(req).mantix_session;
  if (!token) return null;
  const session=sessions.get(token);
  if (!session) return null;
  if (Date.now()>session.expires) {sessions.delete(token);return null;}
  session.expires=Date.now()+TIMEOUT;
  return {token,session};
}
function cookieSet(res,token) {res.setHeader('Set-Cookie',`mantix_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);}
function clearCookie(res) {res.setHeader('Set-Cookie','mantix_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');}
async function auth(req,res,next) {
  const s=sessionFrom(req);
  if (!s) { if(req.method==='GET'&&!req.path.startsWith('/api/')&&req.accepts('html'))return res.redirect('/'); return res.status(401).json({ok:false,error:'Inicia sesion.'}); }
  try {
    const u=await pool.query('SELECT activo FROM mantix.usuarios WHERE id=$1',[s.session.id]);
    if (!u.rows[0]?.activo) {sessions.delete(s.token);clearCookie(res);return res.status(401).json({ok:false,error:'Cuenta inactiva.'});}
    const r=await pool.query(`SELECT DISTINCT p.codigo FROM mantix.usuario_roles ur JOIN mantix.rol_permisos rp ON rp.rol_id=ur.rol_id JOIN mantix.permisos p ON p.id=rp.permiso_id WHERE ur.usuario_id=$1`,[s.session.id]);
    s.session.perms=r.rows.map(x=>x.codigo);
    const roles=await pool.query(`SELECT DISTINCT r.codigo FROM mantix.usuario_roles ur JOIN mantix.roles r ON r.id=ur.rol_id WHERE ur.usuario_id=$1`,[s.session.id]);
    s.session.roles=roles.rows.map(x=>x.codigo);
    req.actor=s.session;req.sessionToken=s.token;next();
  } catch(err) { console.error('Sesion:',err.message);res.status(503).json({ok:false,error:'No fue posible validar la sesion.'}); }
}
function permit(permission) {return (req,res,next)=>req.actor.perms.includes(permission)?next():res.status(403).json({ok:false,error:'No autorizado.'});}
function localWrite(req,res,next) {
  const origin=req.headers.origin;
  if (origin!==`http://${HOST}:${PORT}` || req.get('X-MANTIX-Local')!=='1') return res.status(403).json({ok:false,error:'Origen no autorizado.'});
  next();
}
app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_login_industrial.html')));
app.get('/logo-isysa.png',(_req,res)=>res.sendFile(path.join(__dirname,'../public/logo.png')));
app.get('/api/salud',async(_req,res)=>{try{const r=await pool.query("SELECT current_database() base,current_schema() esquema");res.json({ok:true,...r.rows[0]});}catch{res.status(503).json({ok:false,error:'Sin acceso a la BD.'});}});
app.post('/api/login',localWrite,async(req,res)=>{
  const username=String(req.body?.usuario||'').toLowerCase().trim(), password=req.body?.contrasena;
  if(!/^[a-z0-9._-]{3,40}$/.test(username)||typeof password!=='string'||Buffer.byteLength(password,'utf8')>256) return res.status(400).json({ok:false,error:'Datos invalidos.'});
  const key=req.ip+'|'+username; const record=failed.get(key);
  if(record&&record.until>Date.now())return res.status(429).json({ok:false,error:'Demasiados intentos. Intenta despues.'});
  try{
    const q=await pool.query('SELECT id,nombre_usuario,nombre_mostrar,password_hash,activo FROM mantix.usuarios WHERE nombre_usuario=$1',[username]);
    const u=q.rows[0];
    const matches=u?await verifyPassword(password,u.password_hash):false;
    if(!u||!u.activo||!matches){const n=(record?.count||0)+1;failed.set(key,{count:n,until:n>=5?Date.now()+15*60*1000:0});return res.status(401).json({ok:false,error:'Usuario o contrasena incorrectos.'});}
    failed.delete(key);
    const rp=await pool.query(`SELECT DISTINCT p.codigo FROM mantix.usuario_roles ur JOIN mantix.rol_permisos rr ON rr.rol_id=ur.rol_id JOIN mantix.permisos p ON p.id=rr.permiso_id WHERE ur.usuario_id=$1`,[u.id]);
    const perms=rp.rows.map(x=>x.codigo);
    const roleRows=await pool.query(`SELECT DISTINCT r.codigo FROM mantix.usuario_roles ur JOIN mantix.roles r ON r.id=ur.rol_id WHERE ur.usuario_id=$1`,[u.id]);
    const roles=roleRows.rows.map(x=>x.codigo);
    const token=crypto.randomBytes(32).toString('hex');
    sessions.set(token,{id:u.id,usuario:u.nombre_usuario,nombre:u.nombre_mostrar,perms,roles,expires:Date.now()+TIMEOUT});
    cookieSet(res,token);
    await pool.query('UPDATE mantix.usuarios SET ultimo_acceso_en=now() WHERE id=$1',[u.id]);
    return res.json({ok:true,usuario:u.nombre_usuario,nombre:u.nombre_mostrar,permisos:perms,roles});
  }catch(err){console.error('Login:',err.message);return res.status(503).json({ok:false,error:'No fue posible autenticar.'});}
});
app.get('/api/me',auth,(req,res)=>res.json({ok:true,usuario:req.actor.usuario,nombre:req.actor.nombre,permisos:req.actor.perms,roles:req.actor.roles||[]}));
app.post('/api/logout',localWrite,auth,(req,res)=>{sessions.delete(req.sessionToken);clearCookie(res);res.json({ok:true});});
app.get('/api/catalogos/equipos',auth,permit('catalogos.leer'),async(_req,res)=>{try{const r=await pool.query('SELECT id,codigo,nombre,centro_costo_id,activo FROM mantix.equipos ORDER BY nombre,id LIMIT 500');res.json({ok:true,total:r.rowCount,datos:r.rows});}catch{res.status(503).json({ok:false,error:'Consulta no disponible.'});}});
app.get('/api/catalogos/empleados',auth,permit('catalogos.leer'),async(_req,res)=>{try{const r=await pool.query('SELECT id,clave,nombre,departamento,puesto,activo FROM mantix.empleados ORDER BY nombre,id LIMIT 500');res.json({ok:true,total:r.rowCount,datos:r.rows});}catch{res.status(503).json({ok:false,error:'Consulta no disponible.'});}});
// Administracion protegida: solo localhost, sesion activa y permiso administrativo.
app.get('/administracion/usuarios',auth,permit('usuarios.administrar'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_admin_usuarios.html')));
app.get('/api/admin/roles',auth,permit('usuarios.administrar'),async(_req,res)=>{
  try {const r=await pool.query("SELECT codigo FROM mantix.roles WHERE codigo IN ('ADMINISTRADOR','JEFE','SUPERVISOR','COORDINADOR') ORDER BY codigo");res.json({ok:true,datos:r.rows.map(x=>x.codigo)});}catch{res.status(503).json({ok:false,error:'Consulta no disponible.'});}
});
app.get('/api/admin/empleados-disponibles',auth,permit('usuarios.administrar'),async(_req,res)=>{
  try {const r=await pool.query(`SELECT e.id,e.clave,e.nombre FROM mantix.empleados e WHERE e.activo=true AND NOT EXISTS(SELECT 1 FROM mantix.usuarios u WHERE u.empleado_id=e.id) ORDER BY e.nombre LIMIT 500`);res.json({ok:true,datos:r.rows});}catch{res.status(503).json({ok:false,error:'Consulta no disponible.'});}
});
app.get('/api/admin/usuarios',auth,permit('usuarios.administrar'),async(_req,res)=>{
  try {const r=await pool.query(`SELECT u.id,u.nombre_usuario,u.nombre_mostrar,u.activo,u.empleado_id,e.nombre AS empleado,COALESCE(array_agg(r.codigo) FILTER (WHERE r.codigo IS NOT NULL),'{}') AS roles FROM mantix.usuarios u LEFT JOIN mantix.empleados e ON e.id=u.empleado_id LEFT JOIN mantix.usuario_roles ur ON ur.usuario_id=u.id LEFT JOIN mantix.roles r ON r.id=ur.rol_id GROUP BY u.id,e.nombre ORDER BY u.nombre_usuario LIMIT 200`);res.json({ok:true,total:r.rowCount,datos:r.rows});}catch{res.status(503).json({ok:false,error:'Consulta no disponible.'});}
});
function validUsername(s){return typeof s==='string' && /^[a-z0-9._-]{3,40}$/.test(s);}
function validDisplay(s){return typeof s==='string' && s.trim().length>=3 && s.trim().length<=180;}
function validUuid(s){return typeof s==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);}
const ALLOWED_ROLES=new Set(['ADMINISTRADOR','JEFE','SUPERVISOR','COORDINADOR']);
async function transaction(work){const c=await pool.connect();try{await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
async function audit(c, actor, action, id, after, before=null){await c.query(`INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_antes,datos_despues) VALUES($1,$2,$3,'usuarios',$4,$5,$6)`,[crypto.randomUUID(),actor,action,id,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);}
app.post('/api/admin/usuarios',localWrite,auth,permit('usuarios.administrar'),async(req,res)=>{
  const b=req.body||{}, username=typeof b.usuario==='string'?b.usuario.trim().toLowerCase():'';
  const nombre=typeof b.nombre==='string'?b.nombre.trim():'';
  if(!validUsername(username)||!validDisplay(nombre)||!ALLOWED_ROLES.has(b.rol)||typeof b.contrasena!=='string'||b.contrasena.length<12||Buffer.byteLength(b.contrasena,'utf8')>256||(b.empleado_id!=null&&!validUuid(b.empleado_id))) return res.status(400).json({ok:false,error:'Revisa usuario, nombre, rol, empleado y contrasena (12 caracteres minimo).'});
  try{
    const hash=await hashPassword(b.contrasena);const id=crypto.randomUUID();
    await transaction(async c=>{
      const role=await c.query('SELECT id FROM mantix.roles WHERE codigo=$1',[b.rol]);
      if(!role.rowCount)throw new Error('El rol no esta configurado.');
      await c.query(`INSERT INTO mantix.usuarios(id,empleado_id,nombre_usuario,nombre_mostrar,password_hash) VALUES($1,$2,$3,$4,$5)`,[id,b.empleado_id||null,username,nombre,hash]);
      await c.query(`INSERT INTO mantix.usuario_roles(usuario_id,rol_id,asignado_por) VALUES($1,$2,$3)`,[id,role.rows[0].id,req.actor.id]);
      await audit(c,req.actor.id,'USUARIO_CREADO',id,{usuario:username,nombre,rol:b.rol,empleado_id:b.empleado_id||null});
    });
    res.status(201).json({ok:true,id,usuario:username});
  }catch(err){console.error('Crear usuario:',err.message);res.status(err.code==='23505'?409:400).json({ok:false,error:err.code==='23505'?'Usuario o empleado ya asociado a otra cuenta.':'No fue posible crear usuario; verifica los datos.'});}
});
app.patch('/api/admin/usuarios/:id/estado',localWrite,auth,permit('usuarios.administrar'),async(req,res)=>{
  const id=req.params.id,activo=req.body?.activo;
  if(!validUuid(id)||typeof activo!=='boolean')return res.status(400).json({ok:false,error:'Datos invalidos.'});
  if(id===req.actor.id && !activo)return res.status(409).json({ok:false,error:'No puedes desactivar tu propia cuenta.'});
  try{
    const affected=await transaction(async c=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('mantix.admin.user.state'))");
      const existing=await c.query('SELECT activo,nombre_usuario FROM mantix.usuarios WHERE id=$1 FOR UPDATE',[id]);
      if(!existing.rowCount)return false;
      if(!activo){
        const admins=await c.query(`SELECT count(*)::int AS n FROM mantix.usuarios u JOIN mantix.usuario_roles ur ON ur.usuario_id=u.id JOIN mantix.roles r ON r.id=ur.rol_id WHERE r.codigo='ADMINISTRADOR' AND u.activo=true`);
        const target=await c.query(`SELECT 1 FROM mantix.usuario_roles ur JOIN mantix.roles r ON ur.rol_id=r.id WHERE ur.usuario_id=$1 AND r.codigo='ADMINISTRADOR'`,[id]);
        if(target.rowCount&&admins.rows[0].n<=1)throw new Error('Debe quedar al menos un administrador activo.');
      }
      await c.query('UPDATE mantix.usuarios SET activo=$1,actualizado_en=now() WHERE id=$2',[activo,id]);
      await audit(c,req.actor.id,activo?'USUARIO_ACTIVADO':'USUARIO_DESACTIVADO',id,{activo},{activo:existing.rows[0].activo});
      return true;
    });
    if(!affected)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});
    res.json({ok:true});
  }catch(err){console.error('Estado usuario:',err.message);res.status(409).json({ok:false,error:err.message==='Debe quedar al menos un administrador activo.'?err.message:'No se pudo actualizar el estado.'});}
});
app.patch('/api/admin/usuarios/:id/rol',localWrite,auth,permit('usuarios.administrar'),async(req,res)=>{
  const id=req.params.id,rol=req.body?.rol;
  if(!validUuid(id)||!ALLOWED_ROLES.has(rol))return res.status(400).json({ok:false,error:'Rol o usuario invalido.'});
  if(id===req.actor.id)return res.status(409).json({ok:false,error:'No cambies tu propio rol en esta pantalla.'});
  try{
    const updated=await transaction(async c=>{
      await c.query("SELECT pg_advisory_xact_lock(hashtext('mantix.admin.user.state'))");
      const u=await c.query('SELECT id FROM mantix.usuarios WHERE id=$1 FOR UPDATE',[id]);if(!u.rowCount)return false;
      const before=await c.query(`SELECT r.codigo FROM mantix.usuario_roles ur JOIN mantix.roles r ON r.id=ur.rol_id WHERE ur.usuario_id=$1`,[id]);
      const oldRoles=before.rows.map(x=>x.codigo);
      if(oldRoles.includes('ADMINISTRADOR')&&!oldRoles.includes(rol)){
        const count=await c.query(`SELECT count(*)::int AS n FROM mantix.usuarios u JOIN mantix.usuario_roles ur ON ur.usuario_id=u.id JOIN mantix.roles r ON r.id=ur.rol_id WHERE u.activo=true AND r.codigo='ADMINISTRADOR'`);
        if(count.rows[0].n<=1)throw new Error('Debe quedar al menos un administrador activo.');
      }
      const role=await c.query('SELECT id FROM mantix.roles WHERE codigo=$1',[rol]);if(!role.rowCount)throw new Error('Rol no disponible.');
      await c.query('DELETE FROM mantix.usuario_roles WHERE usuario_id=$1',[id]);
      await c.query('INSERT INTO mantix.usuario_roles(usuario_id,rol_id,asignado_por) VALUES($1,$2,$3)',[id,role.rows[0].id,req.actor.id]);
      await audit(c,req.actor.id,'ROL_ASIGNADO',id,{rol},{roles:oldRoles});return true;
    });
    if(!updated)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});res.json({ok:true});
  }catch(err){console.error('Rol usuario:',err.message);res.status(409).json({ok:false,error:err.message==='Debe quedar al menos un administrador activo.'?err.message:'No se pudo modificar el rol.'});}
});
app.patch('/api/admin/usuarios/:id/contrasena',localWrite,auth,permit('usuarios.administrar'),async(req,res)=>{
  const id=req.params.id,p=req.body?.contrasena;
  if(!validUuid(id)||typeof p!=='string'||p.length<12||Buffer.byteLength(p,'utf8')>256)return res.status(400).json({ok:false,error:'Contrasena invalida (minimo 12 caracteres).'});
  try {const hash=await hashPassword(p);
    const updated=await transaction(async c=>{const u=await c.query('SELECT id FROM mantix.usuarios WHERE id=$1 FOR UPDATE',[id]);if(!u.rowCount)return false;
      await c.query('UPDATE mantix.usuarios SET password_hash=$1,actualizado_en=now() WHERE id=$2',[hash,id]);await audit(c,req.actor.id,'CONTRASENA_RESTABLECIDA',id,{restablecida:true});return true;});
    if(!updated)return res.status(404).json({ok:false,error:'Usuario no encontrado.'});
    for(const [token,s] of sessions)if(s.id===id)sessions.delete(token);
    res.json({ok:true});
  }catch(err){console.error('Contrasena usuario:',err.message);res.status(503).json({ok:false,error:'No se pudo restablecer la contrasena.'});}
});

// ETAPA 5.9 / MANTIX - primera ejecución transaccional en desarrollo.
// Los demás módulos originales permanecen intactos.
app.get('/marca/logo.png',auth,(_req,res)=>res.sendFile(path.join(__dirname,'../public/logo.png')));
app.get('/ejecucion',auth,permit('ordenes.registrar'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_ejecucion.html')));
app.get('/api/ejecucion/opciones',auth,permit('ordenes.registrar'),async(req,res)=>{
  try {
    const [t,e,p]=await Promise.all([
      pool.query("SELECT codigo,nombre FROM mantix.tipos_mantenimiento WHERE activo=true AND codigo IN ('PREVENTIVO','OPERATIVO') ORDER BY nombre"),
      pool.query('SELECT id,nombre,codigo FROM mantix.equipos WHERE activo=true ORDER BY nombre,id LIMIT 1000'),
      pool.query('SELECT id,clave,nombre FROM mantix.empleados WHERE activo=true ORDER BY nombre,id LIMIT 1000')
    ]);
    res.json({ok:true,tipos:t.rows,equipos:e.rows,empleados:p.rows,supervisor:req.actor.nombre});
  } catch(err){console.error('Opciones ejecución:',err.message);res.status(503).json({ok:false,error:'No se pudo consultar el catálogo.'});}
});
const STATES=new Set(['EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD','TERMINADA']);
function validIso(s){return typeof s==='string' && s.length>=20 && s.length<=35 && !Number.isNaN(Date.parse(s)) && /(?:Z|[+-]\d\d:\d\d)$/.test(s);}
function uniqueIds(a,max){return Array.isArray(a)&&a.length>0&&a.length<=max&&a.every(validUuid)&&new Set(a).size===a.length;}
app.post('/api/ejecucion/ordenes',localWrite,auth,permit('ordenes.registrar'),async(req,res)=>{
  const b=req.body||{}; const modality=b.modalidad;
  const numero=typeof b.numero_orden==='string'?b.numero_orden.trim():'';
  const desc=typeof b.descripcion==='string'?b.descripcion.trim():'';
  const acts=typeof b.actividades==='string'?b.actividades.trim():'';
  const start=validIso(b.inicio)?new Date(b.inicio):null;
  const end=b.fin==null||b.fin===''?null:(validIso(b.fin)?new Date(b.fin):null);
  const fecha=b.fecha_operativa;
  if(!['OPERATIVO','CON_ORDEN'].includes(modality)||
     (modality==='CON_ORDEN'?(numero.length<1||numero.length>80):!!numero)||
     !((modality==='CON_ORDEN'&&b.tipo==='PREVENTIVO')||(modality==='OPERATIVO'&&b.tipo==='OPERATIVO'))||!STATES.has(b.estado)||
     desc.length<5||desc.length>3000||acts.length<5||acts.length>5000||
     !/^\d{4}-\d{2}-\d{2}$/.test(fecha||'') ||
     !start || (b.fin && !end) || (end && end<start) ||
     (b.estado==='TERMINADA' && !end) ||
     (end && end-start>72*3600*1000) ||
     !(uniqueIds(b.equipos,30)||(Array.isArray(b.equipos)&&b.equipos.length===0))||!(uniqueIds(b.ejecutantes,50)||(Array.isArray(b.ejecutantes)&&b.ejecutantes.length===0))||!validUuid(b.clave_envio)){
    return res.status(400).json({ok:false,error:'Revisa modalidad, número de orden, tipo, fechas, actividades, equipos y ejecutantes.'});
  }
  const proposals=b.provisionales||{};
  const cleanNames=(items,max)=>Array.isArray(items)&&items.length<=max&&items.every(v=>v&&typeof v.nombre==='string'&&v.nombre.trim().length>=3&&v.nombre.trim().length<=180&&(!v.clave||String(v.clave).length<=50)&&(!v.area||String(v.area).length<=150));
  const tempEq=proposals.equipos||[],tempStaff=proposals.ejecutantes||[];
  if(!cleanNames(tempEq,20)||!cleanNames(tempStaff,25)||b.equipos.length+tempEq.length<1||b.ejecutantes.length+tempStaff.length<1)return res.status(400).json({ok:false,error:'Elige al menos un equipo y un ejecutante, del catálogo o provisional.'});
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    // Única clave por usuario y operación: un reenvío no genera órdenes duplicadas.
    const claim=await c.query(`INSERT INTO mantix.solicitudes_idempotentes(id,usuario_id,clave_cliente,operacion)
      VALUES($1,$2,$3,'CREAR_ORDEN') ON CONFLICT(usuario_id,clave_cliente,operacion) DO NOTHING RETURNING id`,
      [crypto.randomUUID(),req.actor.id,b.clave_envio]);
    if(!claim.rowCount){
      const prev=await c.query(`SELECT recurso_id,estado FROM mantix.solicitudes_idempotentes
        WHERE usuario_id=$1 AND clave_cliente=$2 AND operacion='CREAR_ORDEN'`,[req.actor.id,b.clave_envio]);
      await c.query('COMMIT');
      if(prev.rows[0]?.estado==='CONFIRMADA')return res.json({ok:true,repetido:true,orden_id:prev.rows[0].recurso_id});
      return res.status(409).json({ok:false,error:'El envío anterior aún no está confirmado.'});
    }
    const type=await c.query('SELECT 1 FROM mantix.tipos_mantenimiento WHERE codigo=$1 AND activo=true',[b.tipo]);
    const eq=await c.query('SELECT id FROM mantix.equipos WHERE id=ANY($1::uuid[]) AND activo=true',[b.equipos]);
    const staff=await c.query('SELECT id FROM mantix.empleados WHERE id=ANY($1::uuid[]) AND activo=true',[b.ejecutantes]);
    if(!type.rowCount||eq.rowCount!==b.equipos.length||staff.rowCount!==b.ejecutantes.length){
      await c.query('ROLLBACK');return res.status(400).json({ok:false,error:'Tipo, equipos o ejecutantes no válidos o inactivos.'});
    }
    const duty=await c.query(`SELECT id,codigo_turno FROM mantix.asignaciones_turno WHERE supervisor_id=$1 AND fecha_operativa=$2 ORDER BY creado_en DESC LIMIT 1`,[req.actor.id,fecha]);
    const sunday=new Date(fecha+'T12:00:00Z').getUTCDay()===0;
    if(sunday&&(!duty.rowCount||duty.rows[0].codigo_turno!=='EXTRA')){await c.query('ROLLBACK');return res.status(409).json({ok:false,error:'En domingo registra primero tu jornada EXTRA con horario real desde Mi turno.'});}
    const asignacion=duty.rows[0]?.id||null;
    const orderId=crypto.randomUUID(),interventionId=crypto.randomUUID();
    await c.query(`INSERT INTO mantix.ordenes_trabajo
      (id,numero_orden,modalidad_registro,tipo_mantenimiento_codigo,descripcion,estado_operativo,creada_por)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[orderId,modality==='CON_ORDEN'?numero:null,modality,b.tipo,desc,
       b.estado==='TERMINADA'?'TERMINADA':b.estado==='EN_PROCESO'?'EN_PROCESO':'PENDIENTE',req.actor.id]);
    for (let i=0;i<b.equipos.length;i++)await c.query(`INSERT INTO mantix.orden_equipos(orden_id,equipo_id,principal) VALUES($1,$2,$3)`,[orderId,b.equipos[i],i===0]);
    await c.query(`INSERT INTO mantix.intervenciones
      (id,orden_id,supervisor_id,fecha_operativa,inicio_real,fin_real,actividades,estado,creada_por,asignacion_turno_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$3,$9)`,[interventionId,orderId,req.actor.id,fecha,start,end,acts,b.estado,asignacion]);
    for(const equipmentId of b.equipos)await c.query(`INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id)
      VALUES($1,$2,$3)`,[orderId,interventionId,equipmentId]);
    for(const employeeId of b.ejecutantes)await c.query(`INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id)
      VALUES($1,$2)`,[interventionId,employeeId]);
    // Propuestas: nunca se convierten en entradas oficiales sin decisión administrativa.
    for(const item of tempEq)await c.query(`INSERT INTO mantix.propuestas_catalogo(id,tipo,nombre_original,clave_original,area_original,propuesto_por,orden_id,intervencion_id) VALUES($1,'EQUIPO',$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),item.nombre.trim(),String(item.clave||'').trim()||null,String(item.area||'').trim()||null,req.actor.id,orderId,interventionId]);
    for(const item of tempStaff)await c.query(`INSERT INTO mantix.propuestas_catalogo(id,tipo,nombre_original,clave_original,area_original,propuesto_por,orden_id,intervencion_id) VALUES($1,'EJECUTANTE',$2,$3,$4,$5,$6,$7)`,[crypto.randomUUID(),item.nombre.trim(),String(item.clave||'').trim()||null,String(item.area||'').trim()||null,req.actor.id,orderId,interventionId]);
    await c.query(`INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_despues,correlacion_id)
      VALUES($1,$2,'ORDEN_CON_INTERVENCION_CREADA','ordenes_trabajo',$3,$4,$5)`,
      [crypto.randomUUID(),req.actor.id,orderId,JSON.stringify({intervencion_id:interventionId,estado:b.estado,equipos:b.equipos.length,ejecutantes:b.ejecutantes.length}),b.clave_envio]);
    await c.query(`UPDATE mantix.solicitudes_idempotentes SET estado='CONFIRMADA',recurso_tipo='ordenes_trabajo',recurso_id=$1,finalizada_en=now()
      WHERE usuario_id=$2 AND clave_cliente=$3 AND operacion='CREAR_ORDEN'`,[orderId,req.actor.id,b.clave_envio]);
    await c.query('COMMIT');return res.status(201).json({ok:true,orden_id:orderId,intervencion_id:interventionId});
  } catch(err){await c.query('ROLLBACK').catch(()=>{});console.error('Guardar ejecución:',err.message);
    if(err.code==='42P01')return res.status(503).json({ok:false,error:'Falta aplicar la migración 002 de MANTIX 2.3 para equipos y ejecutantes provisionales.'});
    if(err.code==='23505')return res.status(409).json({ok:false,error:'El número de orden ya está registrado.'});
    return res.status(503).json({ok:false,error:'No se pudo guardar el trabajo. Revisa y reintenta con el mismo envío.'});
  } finally {c.release();}
});
app.get('/api/ejecucion/mis-ordenes',auth,permit('ordenes.registrar'),async(req,res)=>{
  try {
    const q=await pool.query(`SELECT o.id,o.numero_orden,o.modalidad_registro,o.tipo_mantenimiento_codigo,o.descripcion,o.estado_operativo,o.creada_en,
       (SELECT count(*)::int FROM mantix.orden_equipos oe WHERE oe.orden_id=o.id) AS equipos,
       (SELECT count(*)::int FROM mantix.intervenciones i WHERE i.orden_id=o.id) AS intervenciones
       FROM mantix.ordenes_trabajo o WHERE o.creada_por=$1 ORDER BY o.creada_en DESC LIMIT 30`,[req.actor.id]);
    res.json({ok:true,datos:q.rows});
  }catch(err){console.error('Mis órdenes:',err.message);res.status(503).json({ok:false,error:'No se pudo consultar el historial.'});}
});


// ETAPA 5.10 — Pendientes / entrega / toma atomica / continuacion.
// Desarrollo local. La entrega de esta etapa NO sustituye el cierre formal del turno.
const LEASE_MINUTES = 20;
app.get('/pendientes',auth,permit('pendientes.gestionar'),(_req,res)=>res.sendFile(path.join(__dirname,'MANTIX_pendientes.html')));
const pendingStates = ['PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD'];
app.get('/api/pendientes',auth,permit('pendientes.gestionar'),async(req,res)=>{
  try {
    const result=await pool.query(`
      SELECT o.id,o.numero_orden,o.descripcion,o.estado_operativo,o.creada_en,
        i.id AS ultima_intervencion_id,i.supervisor_id AS ultimo_supervisor_id,
        u.nombre_mostrar AS ultimo_supervisor,i.estado AS ultimo_estado,
        i.actividades AS ultimo_avance,i.entregada_en AS fecha_entrega,
        i.creada_en AS ultima_intervencion_en,
        t.supervisor_id AS tomada_por,t.expira_en AS toma_expira,
        (t.orden_id IS NOT NULL AND t.expira_en>now()) AS toma_vigente,
        COALESCE((SELECT string_agg(e.nombre,', ' ORDER BY e.nombre)
          FROM mantix.orden_equipos oe JOIN mantix.equipos e ON e.id=oe.equipo_id
          WHERE oe.orden_id=o.id),'') AS equipos
      FROM mantix.ordenes_trabajo o
      JOIN LATERAL (
        SELECT i.* FROM mantix.intervenciones i
        WHERE i.orden_id=o.id ORDER BY i.creada_en DESC,i.id DESC LIMIT 1
      ) i ON true
      JOIN mantix.usuarios u ON u.id=i.supervisor_id
      LEFT JOIN mantix.tomas_activas t ON t.orden_id=o.id
      WHERE o.estado_operativo='PENDIENTE' AND i.estado=ANY($1::varchar[])
      ORDER BY i.creada_en DESC LIMIT 120`,[pendingStates]);
    res.json({ok:true,usuario_id:req.actor.id,datos:result.rows});
  }catch(e){console.error('Pendientes lista:',e.message);res.status(503).json({ok:false,error:'No se pudieron consultar los pendientes.'});}
});
app.post('/api/pendientes/:ordenId/entregar',localWrite,auth,permit('pendientes.gestionar'),async(req,res)=>{
  if(!validUuid(req.params.ordenId))return res.status(400).json({ok:false,error:'Orden inválida.'});
  const detalle=String(req.body?.detalle||'').trim();
  if(detalle.length<10||detalle.length>3000)return res.status(400).json({ok:false,error:'Explica qué falta y cómo debe retomarse el trabajo (10 a 3000 caracteres).'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const o=await c.query('SELECT id,estado_operativo FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[req.params.ordenId]);
    if(!o.rowCount||o.rows[0].estado_operativo!=='PENDIENTE')throw Object.assign(new Error('La orden ya no está pendiente.'),{status:409});
    const r=await c.query('SELECT id,supervisor_id,estado,entregada_en FROM mantix.intervenciones WHERE orden_id=$1 ORDER BY creada_en DESC,id DESC LIMIT 1 FOR UPDATE',[req.params.ordenId]);
    const i=r.rows[0];
    if(!i||!pendingStates.includes(i.estado))throw Object.assign(new Error('La intervención actual no está pendiente.'),{status:409});
    if(i.supervisor_id!==req.actor.id)throw Object.assign(new Error('Solo el supervisor de la última intervención puede entregarla.'),{status:403});
    if(i.entregada_en)throw Object.assign(new Error('Este pendiente ya fue entregado.'),{status:409});
    const lock=await c.query('SELECT 1 FROM mantix.tomas_activas WHERE orden_id=$1 AND expira_en>now()',[req.params.ordenId]);
    if(lock.rowCount)throw Object.assign(new Error('La orden está tomada por un supervisor.'),{status:409});
    await c.query('UPDATE mantix.intervenciones SET entregada_en=now() WHERE id=$1',[i.id]);
    await c.query(`INSERT INTO mantix.seguimientos(id,orden_id,intervencion_id,supervisor_id,tipo,descripcion,ocurrido_en)
      VALUES($1,$2,$3,$4,'ENTREGA',$5,now())`,[crypto.randomUUID(),req.params.ordenId,i.id,req.actor.id,detalle]);
    await c.query(`INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_despues)
      VALUES($1,$2,'PENDIENTE_ENTREGADO','ordenes_trabajo',$3,$4)`,[crypto.randomUUID(),req.actor.id,req.params.ordenId,JSON.stringify({intervencion_id:i.id,detalle})]);
    await c.query('COMMIT');res.json({ok:true});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('Entrega:',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'No se pudo entregar el pendiente.'});}
  finally{c.release();}
});
app.post('/api/pendientes/:ordenId/tomar',localWrite,auth,permit('pendientes.gestionar'),async(req,res)=>{
  if(!validUuid(req.params.ordenId))return res.status(400).json({ok:false,error:'Orden inválida.'});
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const order=await c.query('SELECT estado_operativo FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[req.params.ordenId]);
    if(!order.rowCount||order.rows[0].estado_operativo!=='PENDIENTE')throw Object.assign(new Error('La orden no está pendiente.'),{status:409});
    const last=await c.query('SELECT id,estado,entregada_en FROM mantix.intervenciones WHERE orden_id=$1 ORDER BY creada_en DESC,id DESC LIMIT 1',[req.params.ordenId]);
    if(!last.rowCount||!pendingStates.includes(last.rows[0].estado)||!last.rows[0].entregada_en)throw Object.assign(new Error('Falta la entrega del supervisor anterior.'),{status:409});
    const token=crypto.randomUUID();
    const claim=await c.query(`INSERT INTO mantix.tomas_activas(orden_id,supervisor_id,token,expira_en)
      VALUES($1,$2,$3,now()+interval '20 minutes')
      ON CONFLICT(orden_id) DO UPDATE SET
        supervisor_id=EXCLUDED.supervisor_id,token=EXCLUDED.token,
        adquirido_en=now(),expira_en=EXCLUDED.expira_en,version=mantix.tomas_activas.version+1
      WHERE mantix.tomas_activas.expira_en<=now()
      RETURNING token,expira_en`,[req.params.ordenId,req.actor.id,token]);
    if(!claim.rowCount)throw Object.assign(new Error('Otro supervisor ya tiene tomada esta orden.'),{status:409});
    await c.query(`INSERT INTO mantix.seguimientos(id,orden_id,intervencion_id,supervisor_id,tipo,descripcion,ocurrido_en)
      VALUES($1,$2,$3,$4,'RETOMA','Pendiente tomado para continuidad',now())`,[crypto.randomUUID(),req.params.ordenId,last.rows[0].id,req.actor.id]);
    await c.query('COMMIT');res.json({ok:true,token:claim.rows[0].token,expira_en:claim.rows[0].expira_en});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('Tomar pendiente:',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'No se pudo tomar el pendiente.'});}
  finally{c.release();}
});
app.post('/api/pendientes/:ordenId/renovar',localWrite,auth,permit('pendientes.gestionar'),async(req,res)=>{
  if(!validUuid(req.params.ordenId)||!validUuid(req.body?.token))return res.status(400).json({ok:false,error:'Datos inválidos.'});
  const q=await pool.query(`UPDATE mantix.tomas_activas SET expira_en=now()+interval '20 minutes'
    WHERE orden_id=$1 AND supervisor_id=$2 AND token=$3 AND expira_en>now()
    RETURNING expira_en`,[req.params.ordenId,req.actor.id,req.body.token]).catch(e=>{console.error('Renovar:',e.message);return null;});
  if(!q)return res.status(503).json({ok:false,error:'No se pudo renovar.'});
  if(!q.rowCount)return res.status(409).json({ok:false,error:'La toma venció o ya no te pertenece. Actualiza pendientes.'});
  res.json({ok:true,expira_en:q.rows[0].expira_en});
});
app.post('/api/pendientes/:ordenId/continuar',localWrite,auth,permit('pendientes.gestionar'),async(req,res)=>{
  const b=req.body||{}; const start=validIso(b.inicio)?new Date(b.inicio):null;
  const end=b.fin?validIso(b.fin)?new Date(b.fin):null:null;
  if(!validUuid(req.params.ordenId)||!validUuid(b.token)||!validUuid(b.clave_envio)||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.fecha_operativa||'')||
    !STATES.has(b.estado)||!start||(b.fin&&!end)||(end&&end<start)||(end&&end-start>72*3600000)||
    (b.estado==='TERMINADA'&&!end)||!uniqueIds(b.equipos,30)||!uniqueIds(b.ejecutantes,50)||
    typeof b.actividades!=='string'||b.actividades.trim().length<5||b.actividades.length>5000)
    return res.status(400).json({ok:false,error:'Revisa fechas, actividades, estado, equipos y ejecutantes.'});
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    // Lock de orden: serializa toma/entrega/continuidad. Misma idempotencia que la creación de órdenes.
    const order=await c.query('SELECT id,estado_operativo FROM mantix.ordenes_trabajo WHERE id=$1 FOR UPDATE',[req.params.ordenId]);
    if(!order.rowCount)throw Object.assign(new Error('Orden no encontrada.'),{status:404});
    const prev=await c.query(`SELECT recurso_id FROM mantix.solicitudes_idempotentes
      WHERE usuario_id=$1 AND clave_cliente=$2 AND operacion='CONTINUAR_ORDEN' AND estado='CONFIRMADA'`,[req.actor.id,b.clave_envio]);
    if(prev.rowCount){await c.query('COMMIT');return res.json({ok:true,repetido:true,intervencion_id:prev.rows[0].recurso_id});}
    if(order.rows[0].estado_operativo!=='PENDIENTE')throw Object.assign(new Error('La orden ya no está pendiente.'),{status:409});
    const lock=await c.query('SELECT token FROM mantix.tomas_activas WHERE orden_id=$1 AND supervisor_id=$2 AND token=$3 AND expira_en>now() FOR UPDATE',[req.params.ordenId,req.actor.id,b.token]);
    if(!lock.rowCount)throw Object.assign(new Error('Tu toma ya venció. Actualiza pendientes y vuelve a tomar la orden.'),{status:409});
    const latest=await c.query('SELECT estado,entregada_en FROM mantix.intervenciones WHERE orden_id=$1 ORDER BY creada_en DESC,id DESC LIMIT 1',[req.params.ordenId]);
    if(!latest.rowCount||!latest.rows[0].entregada_en||!pendingStates.includes(latest.rows[0].estado))throw Object.assign(new Error('El último trabajo no fue entregado.'),{status:409});
    const eq=await c.query(`SELECT equipo_id FROM mantix.orden_equipos WHERE orden_id=$1 AND equipo_id=ANY($2::uuid[])`,[req.params.ordenId,b.equipos]);
    const staff=await c.query(`SELECT id FROM mantix.empleados WHERE id=ANY($1::uuid[]) AND activo=true`,[b.ejecutantes]);
    // Orden_equipos tiene clave equipo_id, no id
    if(eq.rowCount!==b.equipos.length||staff.rowCount!==b.ejecutantes.length)throw Object.assign(new Error('Equipos de la orden o ejecutantes inválidos.'),{status:400});
    const claim=await c.query(`INSERT INTO mantix.solicitudes_idempotentes(id,usuario_id,clave_cliente,operacion)
       VALUES($1,$2,$3,'CONTINUAR_ORDEN') ON CONFLICT DO NOTHING RETURNING id`,[crypto.randomUUID(),req.actor.id,b.clave_envio]);
    if(!claim.rowCount)throw Object.assign(new Error('Envío duplicado o pendiente.'),{status:409});
    const id=crypto.randomUUID();
    await c.query(`INSERT INTO mantix.intervenciones
      (id,orden_id,supervisor_id,fecha_operativa,inicio_real,fin_real,actividades,estado,creada_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$3)`,[id,req.params.ordenId,req.actor.id,b.fecha_operativa,start,end,b.actividades.trim(),b.estado]);
    for(const equipoId of b.equipos)await c.query(`INSERT INTO mantix.intervencion_equipos(orden_id,intervencion_id,equipo_id) VALUES($1,$2,$3)`,[req.params.ordenId,id,equipoId]);
    for(const empleadoId of b.ejecutantes)await c.query(`INSERT INTO mantix.intervencion_ejecutantes(intervencion_id,empleado_id) VALUES($1,$2)`,[id,empleadoId]);
    const state=b.estado==='TERMINADA'?'TERMINADA':b.estado==='EN_PROCESO'?'EN_PROCESO':'PENDIENTE';
    await c.query('UPDATE mantix.ordenes_trabajo SET estado_operativo=$1, version=version+1 WHERE id=$2',[state,req.params.ordenId]);
    if(state==='TERMINADA'&&end)await c.query("UPDATE mantix.ocurrencias_preventivas SET estado='COMPLETADA',completada_en=$1 WHERE orden_id=$2 AND estado='EN_PROCESO'",[end,req.params.ordenId]);
    await c.query(`INSERT INTO mantix.seguimientos(id,orden_id,intervencion_id,supervisor_id,tipo,descripcion,ocurrido_en)
      VALUES($1,$2,$3,$4,'AVANCE',$5,now())`,[crypto.randomUUID(),req.params.ordenId,id,req.actor.id,b.actividades.trim()]);
    await c.query(`UPDATE mantix.solicitudes_idempotentes SET estado='CONFIRMADA',recurso_tipo='intervenciones',recurso_id=$1,finalizada_en=now()
      WHERE usuario_id=$2 AND clave_cliente=$3 AND operacion='CONTINUAR_ORDEN'`,[id,req.actor.id,b.clave_envio]);
    await c.query('DELETE FROM mantix.tomas_activas WHERE orden_id=$1 AND token=$2',[req.params.ordenId,b.token]);
    await c.query(`INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id,datos_despues,correlacion_id)
      VALUES($1,$2,'CONTINUACION_REGISTRADA','intervenciones',$3,$4,$5)`,[crypto.randomUUID(),req.actor.id,id,JSON.stringify({orden_id:req.params.ordenId,estado:b.estado}),b.clave_envio]);
    await c.query('COMMIT');res.status(201).json({ok:true,intervencion_id:id,orden_id:req.params.ordenId});
  }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('Continuar:',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'Error al registrar continuación.'});}
  finally{c.release();}
});
app.get('/api/pendientes/:ordenId/equipos',auth,permit('pendientes.gestionar'),async(req,res)=>{
  if(!validUuid(req.params.ordenId))return res.status(400).json({ok:false,error:'Orden inválida.'});
  try {
    const q=await pool.query(`SELECT e.id,e.nombre,e.codigo FROM mantix.orden_equipos oe
      JOIN mantix.equipos e ON e.id=oe.equipo_id WHERE oe.orden_id=$1 ORDER BY oe.principal DESC,e.nombre`,[req.params.ordenId]);
    res.json({ok:true,datos:q.rows});
  }catch(e){console.error('Equipos pendiente:',e.message);res.status(503).json({ok:false,error:'No fue posible consultar equipos.'});}
});
app.get('/api/pendientes/:ordenId/historial',auth,permit('pendientes.gestionar'),async(req,res)=>{
  if(!validUuid(req.params.ordenId))return res.status(400).json({ok:false,error:'Orden inválida.'});
  try{
    const q=await pool.query(`SELECT i.id,i.fecha_operativa,i.inicio_real,i.fin_real,i.actividades,i.estado,i.estado_revision,i.entregada_en,u.nombre_mostrar AS supervisor
      FROM mantix.intervenciones i JOIN mantix.usuarios u ON u.id=i.supervisor_id
      WHERE i.orden_id=$1 ORDER BY i.creada_en,i.id LIMIT 100`,[req.params.ordenId]);
    res.json({ok:true,datos:q.rows});
  }catch(e){console.error('Historial pendiente:',e.message);res.status(503).json({ok:false,error:'No se pudo consultar historial.'});}
});

require('./MANTIX_revision')(app,{pool,auth,permit,localWrite});
require('./MANTIX_modulos_completos')(app,{pool,auth,permit,localWrite});
app.use((_req,res)=>res.status(404).json({ok:false,error:'Ruta no encontrada.'}));
module.exports=app;
if(require.main===module){
 let server;
 require('./MANTIX_migrar_revision')(pool).then(()=>{
  server=app.listen(PORT,HOST,()=>console.log('MANTIX 2.4 · Revisión · http://127.0.0.1:3102/ · Solo desarrollo.'));
  server.on('error',e=>{console.error(e.message);process.exitCode=1;pool.end();});
 }).catch(e=>{console.error('No se pudo preparar revisión:',e.message);process.exitCode=1;pool.end();});
 process.on('SIGINT',()=>{server?.close();pool.end().then(()=>process.exit(0));});
}
