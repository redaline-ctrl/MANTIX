'use strict';
// Prueba exclusivamente SELECT. No crea, modifica ni elimina datos.
const { pool } = require('./MANTIX_conexion_PostgreSQL');
(async () => {
  try {
    const info = await pool.query(`SELECT current_database() AS base, current_schema() AS esquema, current_user AS usuario`);
    const conteo = await pool.query(`SELECT count(*)::integer AS tablas FROM information_schema.tables WHERE table_schema='mantix' AND table_type='BASE TABLE'`);
    const tablasClave = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='mantix' AND table_name IN ('usuarios','equipos','empleados','ordenes_trabajo','intervenciones','revisiones') ORDER BY table_name`);
    console.log('Conexion:', info.rows[0]);
    console.log('Tablas del esquema mantix:', conteo.rows[0].tablas);
    console.log('Tablas esenciales:', tablasClave.rows.map(r=>r.table_name).join(', '));
    if (info.rows[0].base !== 'mantix_desarrollo' || info.rows[0].esquema !== 'mantix' || conteo.rows[0].tablas !== 30 || tablasClave.rows.length !== 6) {
      process.exitCode = 1;
      console.error('VALIDACION INCOMPLETA: revise conexion/esquema/tablas.');
    } else {
      console.log('OK: conexion a MANTIX validada sin cambios en la base de datos.');
    }
  } catch (err) {
    process.exitCode = 1;
    console.error('ERROR:', err.message);
  } finally {
    await pool.end();
  }
})();
