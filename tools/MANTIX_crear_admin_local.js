'use strict';
// Ejecutar una sola vez en DESARROLLO. Inserta roles/permisos y primer administrador.
// NO crea ni modifica tablas. NO ejecuta server.js.
const crypto = require('node:crypto');
const { pool } = require('./MANTIX_conexion_PostgreSQL');
const { hashPassword } = require('./MANTIX_auth_criptografia');
const readline = require('node:readline');
const roleRules = {
  ADMINISTRADOR: ['usuarios.administrar','catalogos.leer','catalogos.administrar','auditoria.leer'],
  JEFE: ['catalogos.leer','ordenes.leer','revision.gestionar','preventivos.autorizar','dashboard.leer'],
  SUPERVISOR: ['catalogos.leer','ordenes.leer','ordenes.registrar','pendientes.gestionar','preventivos.solicitar'],
  COORDINADOR: ['catalogos.leer','ordenes.leer','dashboard.leer']
};
const descriptions = {
  'usuarios.administrar':'Administrar cuentas y roles', 'catalogos.leer':'Consultar equipos y personal',
  'catalogos.administrar':'Gestionar catalogos', 'auditoria.leer':'Consultar auditoria',
  'ordenes.leer':'Consultar ordenes', 'revision.gestionar':'Revisar trabajos',
  'preventivos.autorizar':'Autorizar reprogramaciones', 'dashboard.leer':'Consultar dashboard',
  'ordenes.registrar':'Registrar ordenes e intervenciones',
  'pendientes.gestionar':'Tomar y entregar pendientes', 'preventivos.solicitar':'Solicitar reprogramaciones'
};
function promptLine(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}
function hiddenPassword(question) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error('Usa una terminal interactiva (PowerShell de VS Code).');
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write(question);
    const stdin = process.stdin;
    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    function done(err) {
      stdin.off('keypress', keypress);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (err) reject(err); else resolve(value);
    }
    function keypress(str, key) {
      if (key && key.ctrl && key.name === 'c') return done(new Error('Cancelado.'));
      if (key && key.name === 'return') return done();
      if (key && key.name === 'backspace') { value = value.slice(0, -1); return; }
      if (key && (key.ctrl || key.meta)) return;
      if (str && !/\r|\n/.test(str)) value += str;
    }
    stdin.on('keypress', keypress);
  });
}
async function run() {
  const client = await pool.connect();
  try {
    const guard = await client.query("SELECT current_database() AS db, current_schema() AS schema");
    if (guard.rows[0].db !== 'mantix_desarrollo' || guard.rows[0].schema !== 'mantix') throw new Error('Entorno incorrecto; operacion cancelada.');
    const admins = await client.query(`SELECT COUNT(*)::int AS n FROM mantix.usuario_roles ur JOIN mantix.roles r ON ur.rol_id=r.id WHERE r.codigo='ADMINISTRADOR'`);
    if (admins.rows[0].n > 0) throw new Error('Ya existe un administrador. No se creara otro mediante bootstrap.');
    const username = (await promptLine('Nombre de usuario administrador (3-40 letras/numeros/._-): ')).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('Nombre de usuario no valido.');
    const display = (await promptLine('Nombre para mostrar: ')).trim();
    if (display.length < 3 || display.length > 180) throw new Error('Nombre para mostrar no valido.');
    const p1 = await hiddenPassword('Contrasena (minimo 12 caracteres; no se muestra): ');
    const p2 = await hiddenPassword('Repetir contrasena: ');
    if (p1 !== p2) throw new Error('Las contrasenas no coinciden.');
    const passwordHash = await hashPassword(p1);
    await client.query('BEGIN');
    // Bloqueo de bootstrap: evita dos primeros administradores simultaneos.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('mantix.bootstrap.admin.v1'))");
    const recheck = await client.query(`SELECT COUNT(*)::int AS n FROM mantix.usuario_roles ur JOIN mantix.roles r ON ur.rol_id=r.id WHERE r.codigo='ADMINISTRADOR'`);
    if (recheck.rows[0].n > 0) throw new Error('Otro administrador fue creado primero; operacion cancelada.');
    for (const [role, perms] of Object.entries(roleRules)) {
      const rr = await client.query(`INSERT INTO mantix.roles(codigo,descripcion) VALUES($1,$2) ON CONFLICT(codigo) DO UPDATE SET descripcion=EXCLUDED.descripcion RETURNING id`,[role,role]);
      for (const permission of perms) {
        const pr = await client.query(`INSERT INTO mantix.permisos(codigo,descripcion) VALUES($1,$2) ON CONFLICT(codigo) DO NOTHING RETURNING id`,[permission,descriptions[permission]]);
        const permId = pr.rows[0]?.id ?? (await client.query('SELECT id FROM mantix.permisos WHERE codigo=$1',[permission])).rows[0].id;
        await client.query(`INSERT INTO mantix.rol_permisos(rol_id,permiso_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[rr.rows[0].id,permId]);
      }
    }
    const userId = crypto.randomUUID();
    await client.query(`INSERT INTO mantix.usuarios(id,nombre_usuario,nombre_mostrar,password_hash) VALUES($1,$2,$3,$4)`,[userId,username,display,passwordHash]);
    await client.query(`INSERT INTO mantix.usuario_roles(usuario_id,rol_id) SELECT $1,id FROM mantix.roles WHERE codigo='ADMINISTRADOR'`,[userId]);
    await client.query(`INSERT INTO mantix.auditoria(id,actor_usuario_id,accion,entidad,entidad_id) VALUES($1,$2,'USUARIO_ADMIN_INICIAL_CREADO','usuarios',$3)`,[crypto.randomUUID(),userId,userId]);
    await client.query('COMMIT');
    console.log('OK: administrador inicial y permisos creados en mantix_desarrollo.');
    console.log('Usuario:',username);
    console.log('No se muestra ni almacena la contrasena en texto plano.');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally { client.release(); await pool.end(); }
}
run().catch(err=>{ console.error('ERROR:',err.message); process.exitCode=1; });
