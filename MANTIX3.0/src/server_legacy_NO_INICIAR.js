const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reportes (
        id SERIAL PRIMARY KEY,
        fecha DATE,
        letra VARCHAR(10),
        turno TEXT,
        supervisor TEXT,
        filas JSONB,
        preventivos INT,
        correctivos INT,
        operativos INT,
        dia_juliano INT,
        creado TIMESTAMP DEFAULT NOW(),
        revisado BOOLEAN DEFAULT FALSE,
        fecha_revision TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS pendientes_abiertos (
        orden TEXT PRIMARY KEY,
        h_ini TEXT,
        equipo TEXT,
        tipo TEXT,
        descripcion TEXT,
        ejecutantes TEXT,
        estatus TEXT,
        supervisor_origen TEXT,
        letra_origen TEXT,
        turno_origen TEXT,
        fecha_origen DATE,
        timestamp BIGINT,
        horas_acumuladas INT DEFAULT 0,
        tomado_por TEXT,
        tomado_fecha TEXT
      );
    `);
    // Migracion por si la tabla ya existia V5.3
    await pool.query(`ALTER TABLE pendientes_abiertos ADD COLUMN IF NOT EXISTS turno_origen TEXT;`);
    await pool.query(`ALTER TABLE pendientes_abiertos ADD COLUMN IF NOT EXISTS tomado_por TEXT;`);
    await pool.query(`ALTER TABLE pendientes_abiertos ADD COLUMN IF NOT EXISTS tomado_fecha TEXT;`);
    await pool.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS revisado BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE reportes ADD COLUMN IF NOT EXISTS fecha_revision TIMESTAMP;`);
    console.log('✅ MANTIX V5.7 DB lista - Bloque Diurno + Candado');
  } catch (err) {
    console.error('⚠️ Error DB:', err.message);
  }
}
initDB();

app.post('/api/reportes', async (req, res) => {
  try {
    const { fecha, letra, turno, supervisor, filas, preventivos, correctivos, operativos, dia_juliano } = req.body;
    await pool.query(
      `INSERT INTO reportes (fecha, letra, turno, supervisor, filas, preventivos, correctivos, operativos, dia_juliano)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [fecha, letra, turno, supervisor, JSON.stringify(filas), preventivos, correctivos, operativos, dia_juliano]
    );
    for (let f of filas) {
      let orden = f[0]; let h_ini = f[1]; let equipo = f[2]; let tipo = f[3]; let desc = f[4]; let ejec = f[5]; let estatus = f[7];
      if (!orden) continue;
      if (orden === 'TRABAJO OPERATIVO') {
        orden = 'OP-' + Date.now().toString().slice(-6) + '-' + Math.floor(Math.random() * 100);
      }
      if (estatus === 'EN PROCESO' || estatus === 'PENDIENTE POR REFACCION') {
        await pool.query(`
          INSERT INTO pendientes_abiertos (orden, h_ini, equipo, tipo, descripcion, ejecutantes, estatus, supervisor_origen, letra_origen, turno_origen, fecha_origen, timestamp, tomado_por, tomado_fecha)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL)
          ON CONFLICT (orden) DO UPDATE SET
            equipo=$3, tipo=$4, descripcion=$5, ejecutantes=$6, estatus=$7,
            supervisor_origen=$8, letra_origen=$9, turno_origen=$10, fecha_origen=$11, timestamp=$12
            WHERE pendientes_abiertos.tomado_por IS NULL
        `, [orden, h_ini, equipo, tipo, desc, ejec, estatus, supervisor, letra, turno, fecha, Date.now()]);
      } else if (estatus === 'TERMINADO') {
        await pool.query(`DELETE FROM pendientes_abiertos WHERE orden = $1`, [orden]);
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/pendientes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *, EXTRACT(EPOCH FROM (NOW() - TO_TIMESTAMP(timestamp / 1000))) / 3600 as horas_calc
      FROM pendientes_abiertos WHERE estatus!= 'TERMINADO' ORDER BY timestamp DESC
    `);
    res.json(rows.map(r => ({ ...r, horas_acumuladas: Math.floor(r.horas_calc || 0) })));
  } catch (e) { res.json([]); }
});

// NUEVO V5.7 - CANDADO PARA 8 USUARIOS
app.post('/api/pendientes/tomar', async (req, res) => {
  try {
    const { orden, tomado_por } = req.body;
    const { rows } = await pool.query(`SELECT tomado_por FROM pendientes_abiertos WHERE orden=$1`, [orden]);
    if (rows.length > 0 && rows[0].tomado_por) { return res.status(409).json({ error: 'Ya tomado por ' + rows[0].tomado_por }); }
    await pool.query(`UPDATE pendientes_abiertos SET tomado_por=$2, tomado_fecha=$3 WHERE orden=$1 AND tomado_por IS NULL`, [orden, tomado_por, new Date().toLocaleTimeString()]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/pendientes/cerrar', async (req, res) => {
  try { await pool.query(`DELETE FROM pendientes_abiertos WHERE orden=$1`, [req.body.orden]); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reportes', async (req, res) => {
  try { const { rows } = await pool.query(`SELECT * FROM reportes ORDER BY creado DESC LIMIT 200`); res.json(rows); } catch (e) { res.json([]); }
});

app.put('/api/reportes/:id', async (req, res) => {
  try {
    const { filas, revisado } = req.body;
    if (revisado) {
      await pool.query(`UPDATE reportes SET filas=$1, revisado=true, fecha_revision=NOW() WHERE id=$2`, [JSON.stringify(filas), req.params.id]);
    } else {
      await pool.query(`UPDATE reportes SET filas=$1 WHERE id=$2`, [JSON.stringify(filas), req.params.id]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 MANTIX V5.7 BLOQUE DIURNO corriendo en puerto ${PORT}`));