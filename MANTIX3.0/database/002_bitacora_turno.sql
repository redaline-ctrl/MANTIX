-- Ejecutar una vez con tools/MANTIX_migrar_bitacora.js (transacción y control de versión).
ALTER TABLE mantix.intervenciones ADD COLUMN IF NOT EXISTS observaciones text NOT NULL DEFAULT '';
ALTER TABLE mantix.intervenciones ADD COLUMN IF NOT EXISTS motivo_pendiente text NOT NULL DEFAULT '';
ALTER TABLE mantix.intervenciones DROP CONSTRAINT ck_interv_estado;
ALTER TABLE mantix.intervenciones ADD CONSTRAINT ck_interv_estado CHECK (estado IN ('POR_INICIAR','EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD','TERMINADA'));
ALTER TABLE mantix.intervenciones DROP CONSTRAINT ck_interv_actividades;
ALTER TABLE mantix.intervenciones ADD CONSTRAINT ck_interv_actividades CHECK (estado='POR_INICIAR' OR length(btrim(actividades))>0);
ALTER TABLE mantix.intervenciones ADD CONSTRAINT ck_bitacora_sin_horas CHECK (estado<>'POR_INICIAR' OR (inicio_real IS NULL AND fin_real IS NULL));
ALTER TABLE mantix.cierres_turno ADD COLUMN IF NOT EXISTS reporte jsonb;
ALTER TABLE mantix.ordenes_trabajo ADD COLUMN IF NOT EXISTS cancelacion_solicitada_por uuid REFERENCES mantix.usuarios(id);
ALTER TABLE mantix.ordenes_trabajo ADD COLUMN IF NOT EXISTS motivo_cancelacion text;
