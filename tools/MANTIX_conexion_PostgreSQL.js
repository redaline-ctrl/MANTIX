'use strict';
// Conexion LOCAL DE DESARROLLO. No inicializa tablas ni ejecuta migraciones.
// Configurar variables PGHOST, PGPORT, PGUSER y PGPASSWORD solo si hace falta.
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 5432),
  database: 'mantix_desarrollo',
  user: process.env.PGUSER || 'postgres',
  ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
  options: '-c search_path=mantix,public',
  connectionTimeoutMillis: 5000,
  max: 5
});
module.exports = { pool };
