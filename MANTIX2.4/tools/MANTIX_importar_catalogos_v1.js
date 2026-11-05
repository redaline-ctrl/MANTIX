'use strict';
// Importacion unica y controlada de los catalogos oficiales de ISYSA.
// Por defecto SOLO VISTA PREVIA. No reemplaza server.js ni modifica archivos HTML.
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { pool } = require('./MANTIX_conexion_PostgreSQL');
const filename = path.join(__dirname, 'MANTIX_catalogos_datos_v1.json');
const AUTH = '--aplicar=CONFIRMO_IMPORTACION_MANTIX';
const apply = process.argv.includes(AUTH);
const noop = process.argv.slice(2).filter(x=>x!==AUTH);
const norm = s => String(s == null ? '' : s).trim();
const upper = s => norm(s).toLocaleUpperCase('es-MX');

async function main() {
  if (noop.length) throw new Error('Argumento desconocido. Use sin argumentos para vista previa, o '+AUTH+' para importar.');
  const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!Array.isArray(data.equipos) || !Array.isArray(data.empleados)) throw new Error('JSON de catalogos invalido.');
  const errors = [];
  const eNames = new Map();
  const keys = new Set();
  for (const e of data.equipos) {
    if (!norm(e.nombre) || norm(e.nombre).length > 200) errors.push(`Equipo fila ${e.fila}: nombre vacio o demasiado largo.`);
    if (norm(e.centro_costo).length > 60) errors.push(`Equipo fila ${e.fila}: centro de costo demasiado largo.`);
    const k=upper(e.nombre);
    eNames.set(k, [...(eNames.get(k)||[]),e.fila]);
  }
  for (const p of data.empleados) {
    const k=norm(p.clave);
    if (!k || k.length>50 || !norm(p.nombre) || norm(p.nombre).length>180) errors.push(`Empleado fila ${p.fila}: clave o nombre invalido.`);
    if (keys.has(k)) errors.push(`Empleado fila ${p.fila}: clave duplicada ${k}.`);
    keys.add(k);
    if (norm(p.departamento).length>120 || norm(p.puesto).length>120) errors.push(`Empleado fila ${p.fila}: departamento o puesto demasiado largo.`);
  }
  const duplicados=[...eNames].filter(([,filas])=>filas.length>1);
  const centros=[...new Set(data.equipos.map(e=>norm(e.centro_costo)).filter(Boolean))];
  console.log('\nMANTIX / Vista previa de catalogos oficiales');
  console.log('Equipos: '+data.equipos.length+' | Empleados: '+data.empleados.length+' | Centros de costo distintos: '+centros.length);
  console.log('Equipos sin centro de costo: '+data.equipos.filter(e=>!norm(e.centro_costo)).length);
  for(const [nombre, filas] of duplicados) console.log('ATENCION: nombre de equipo repetido: '+nombre+' (filas '+filas.join(', ')+'). Se conservaran ambos.');
  if(errors.length) { for(const e of errors) console.error('ERROR: '+e); throw new Error('Corrija el archivo antes de importar.'); }
  if(!apply) { console.log('\nSOLO VISTA PREVIA. No se escribio en PostgreSQL.'); console.log('Para aplicar en una base de desarrollo vacia: node MANTIX_importar_catalogos_v1.js '+AUTH); return; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const meta=(await client.query(`SELECT current_database() AS base, current_schema() AS esquema, (SELECT count(*)::int FROM information_schema.tables WHERE table_schema='mantix' AND table_type='BASE TABLE') AS tablas`)).rows[0];
    if(meta.base!=='mantix_desarrollo'||meta.esquema!=='mantix'||meta.tablas!==30) throw new Error('Proteccion: base/esquema/cantidad de tablas no coinciden.');
    const counts=(await client.query(`SELECT (SELECT count(*)::int FROM mantix.equipos) AS e, (SELECT count(*)::int FROM mantix.empleados) AS p, (SELECT count(*)::int FROM mantix.centros_costos) AS c`)).rows[0];
    if(counts.e || counts.p || counts.c) throw new Error('Importacion cancelada: los catalogos ya tienen datos. No se sobrescribe ni se duplica informacion.');
    // Se crean centros de costo solo cuando el codigo existe en el archivo; sin inventar informacion.
    const cc = new Map();
    for (const codigo of centros) {
      const id=randomUUID();
      await client.query('INSERT INTO mantix.centros_costos(id,codigo) VALUES ($1,$2)',[id,codigo]);
      cc.set(codigo,id);
    }
    for(const e of data.equipos) {
      await client.query('INSERT INTO mantix.equipos(id,codigo,nombre,centro_costo_id) VALUES ($1,NULL,$2,$3)', [randomUUID(),norm(e.nombre),cc.get(norm(e.centro_costo))||null]);
    }
    for(const p of data.empleados) {
      await client.query('INSERT INTO mantix.empleados(id,clave,nombre,departamento,puesto) VALUES ($1,$2,$3,$4,$5)',[randomUUID(),norm(p.clave),norm(p.nombre),norm(p.departamento)||null,norm(p.puesto)||null]);
    }
    await client.query('COMMIT');
    console.log('\nIMPORTACION CONFIRMADA: '+centros.length+' centros, '+data.equipos.length+' equipos, '+data.empleados.length+' empleados.');
  } catch(err){ await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}
main().catch(e=>{ console.error('MANTIX: '+e.message);process.exitCode=1; }).finally(async()=>{ await pool.end(); });
