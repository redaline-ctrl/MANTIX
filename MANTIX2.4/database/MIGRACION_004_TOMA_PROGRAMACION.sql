-- Toma persistente de trabajos internos. No modifica ni restaura órdenes históricas.
ALTER TABLE mantix.ocurrencias_preventivas ADD COLUMN IF NOT EXISTS tomada_por uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT;
ALTER TABLE mantix.ocurrencias_preventivas ADD COLUMN IF NOT EXISTS jornada_toma_id uuid REFERENCES mantix.asignaciones_turno(id) ON DELETE RESTRICT;
ALTER TABLE mantix.ocurrencias_preventivas ADD COLUMN IF NOT EXISTS tomada_en timestamptz;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='mantix.ocurrencias_preventivas'::regclass AND conname='ck_ocurrencia_toma') THEN
  ALTER TABLE mantix.ocurrencias_preventivas ADD CONSTRAINT ck_ocurrencia_toma CHECK
   ((tomada_por IS NULL AND jornada_toma_id IS NULL AND tomada_en IS NULL) OR
    (tomada_por IS NOT NULL AND jornada_toma_id IS NOT NULL AND tomada_en IS NOT NULL AND orden_id IS NOT NULL));
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_ocurrencia_responsable ON mantix.ocurrencias_preventivas(tomada_por,jornada_toma_id) WHERE tomada_por IS NOT NULL;
