-- MANTIX 2.3 | Ejecutar SOLO tras respaldo en mantix_desarrollo, una única vez.
-- No altera la estructura de las 30 tablas preexistentes; agrega una tabla de propuestas.
BEGIN;
DO $safe$
BEGIN
 IF current_database()<>'mantix_desarrollo' THEN RAISE EXCEPTION 'Solo permitido en mantix_desarrollo'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='mantix') THEN RAISE EXCEPTION 'No se encontró el esquema mantix'; END IF;
END $safe$;
CREATE TABLE IF NOT EXISTS mantix.propuestas_catalogo (
 id uuid PRIMARY KEY,
 tipo varchar(16) NOT NULL CHECK(tipo IN ('EQUIPO','EJECUTANTE')),
 nombre_original varchar(180) NOT NULL CHECK(length(btrim(nombre_original))>=3),
 clave_original varchar(50),
 area_original varchar(150),
 propuesto_por uuid NOT NULL REFERENCES mantix.usuarios(id),
 orden_id uuid NOT NULL REFERENCES mantix.ordenes_trabajo(id),
 intervencion_id uuid NOT NULL,
 estado varchar(12) NOT NULL DEFAULT 'PENDIENTE' CHECK(estado IN ('PENDIENTE','VALIDADA','DESCARTADA')),
 creado_en timestamptz NOT NULL DEFAULT now(),
 validado_por uuid REFERENCES mantix.usuarios(id),
 validado_en timestamptz,
 catalogo_id uuid,
 nombre_validado varchar(180),
 CONSTRAINT propuesta_intervencion_orden FOREIGN KEY (orden_id,intervencion_id)
   REFERENCES mantix.intervenciones(orden_id,id)
);
CREATE INDEX IF NOT EXISTS ix_propuestas_estado ON mantix.propuestas_catalogo(estado,creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_propuestas_intervencion ON mantix.propuestas_catalogo(intervencion_id);
COMMIT;
