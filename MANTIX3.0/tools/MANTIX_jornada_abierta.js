'use strict';
module.exports=async function(c,actor,date){
 const r=await c.query(`SELECT a.id,ct.id AS cierre_id FROM mantix.asignaciones_turno a LEFT JOIN mantix.cierres_turno ct ON ct.asignacion_turno_id=a.id WHERE a.supervisor_id=$1 AND a.fecha_operativa=$2 ORDER BY a.creado_en DESC LIMIT 1 FOR UPDATE OF a`,[actor,date]);
 if(!r.rows[0]||r.rows[0].cierre_id)throw Object.assign(new Error('Registra una jornada abierta. Las jornadas cerradas se corrigen desde Correcciones.'),{status:409});
 return r.rows[0].id;
};
