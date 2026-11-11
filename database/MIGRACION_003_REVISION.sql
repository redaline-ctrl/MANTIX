-- Ejecutada transaccionalmente por MANTIX_migrar_revision.js; se puede repetir.
-- NULL en registros históricos significa fecha desconocida; no se rellena con la fecha actual.
ALTER TABLE mantix.intervenciones ADD COLUMN IF NOT EXISTS enviada_revision_en timestamptz;
ALTER TABLE mantix.intervenciones ADD COLUMN IF NOT EXISTS resuelta_revision_en timestamptz;
CREATE INDEX IF NOT EXISTS ix_revision_bandeja ON mantix.intervenciones(estado_revision,fecha_operativa,supervisor_id);
