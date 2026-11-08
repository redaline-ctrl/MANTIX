'use strict';
// Serializa altas, edición y cierre de una misma jornada sin agregar tablas.
const dayKey=f=>typeof f==='string'?f.slice(0,10):[f.getFullYear(),String(f.getMonth()+1).padStart(2,'0'),String(f.getDate()).padStart(2,'0')].join('-');
module.exports=async function(c,supervisor,fecha){
 await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mantix.turno.'+supervisor+'.'+dayKey(fecha)]);
 const r=await c.query(`SELECT a.*,ct.id cierre_id FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 AND a.fecha_operativa=$2 ORDER BY a.creado_en DESC LIMIT 1`,[supervisor,fecha]);
 if(r.rows[0]?.cierre_id)throw Object.assign(new Error('La jornada está cerrada. Consulta tu bitácora o solicita una corrección.'),{status:409});
 return r.rows[0]||null;
};

module.exports.key=dayKey;
