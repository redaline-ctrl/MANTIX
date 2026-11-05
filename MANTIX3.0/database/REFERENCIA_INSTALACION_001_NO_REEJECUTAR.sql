-- MANTIX / ISYSA - INSTALACION INICIAL DEL ESQUEMA v1.2
-- SOLO EJECUTAR EN LA BASE VACIA mantix_desarrollo, desde pgAdmin Query Tool.
-- NO modifica las bases postgres ni monitoreocol.
-- IMPORTANTE: NO ejecuta server.js ni migra informacion del proyecto anterior.
-- Debe ejecutarse ENTERO, una sola vez; transaccion con proteccion por nombre de BD.
-- NO es apto para PRODUCCION sin pruebas de integracion y aprobacion de TI.

BEGIN;
DO $preflight$
BEGIN
  IF current_database() <> 'mantix_desarrollo' THEN
    RAISE EXCEPTION 'MANTIX: base incorrecta: %. Se exige mantix_desarrollo', current_database();
  END IF;
  IF current_setting('server_version_num')::integer < 140000 THEN
    RAISE EXCEPTION 'MANTIX: se requiere PostgreSQL 14 o posterior';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'mantix') THEN
    RAISE EXCEPTION 'MANTIX: esquema mantix ya existe. No ejecutar instalacion inicial dos veces.';
  END IF;
END
$preflight$;
CREATE SCHEMA mantix;

-- A. IDENTIDAD Y AUTORIZACION ------------------------------------------------
CREATE TABLE mantix.empleados (
  id uuid PRIMARY KEY,
  clave varchar(50) NOT NULL UNIQUE,
  nombre varchar(180) NOT NULL,
  departamento varchar(120),
  puesto varchar(120),
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_empleado_clave CHECK (length(btrim(clave)) > 0),
  CONSTRAINT ck_empleado_nombre CHECK (length(btrim(nombre)) > 0)
);
CREATE TABLE mantix.usuarios (
  id uuid PRIMARY KEY,
  empleado_id uuid UNIQUE REFERENCES mantix.empleados(id) ON DELETE RESTRICT,
  nombre_usuario varchar(80) NOT NULL UNIQUE,
  nombre_mostrar varchar(180) NOT NULL,
  password_hash text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  ultimo_acceso_en timestamptz,
  CONSTRAINT ck_usuario_nombre CHECK (length(btrim(nombre_usuario)) > 0),
  CONSTRAINT ck_usuario_hash CHECK (length(btrim(password_hash)) > 0)
);
CREATE TABLE mantix.roles (
  id smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo varchar(40) NOT NULL UNIQUE,
  descripcion text
);
CREATE TABLE mantix.permisos (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  codigo varchar(120) NOT NULL UNIQUE,
  descripcion text
);
CREATE TABLE mantix.usuario_roles (
  usuario_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  rol_id smallint NOT NULL REFERENCES mantix.roles(id) ON DELETE RESTRICT,
  asignado_por uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  asignado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, rol_id)
);
CREATE TABLE mantix.rol_permisos (
  rol_id smallint NOT NULL REFERENCES mantix.roles(id) ON DELETE RESTRICT,
  permiso_id integer NOT NULL REFERENCES mantix.permisos(id) ON DELETE RESTRICT,
  PRIMARY KEY (rol_id, permiso_id)
);

-- B. CATALOGOS ---------------------------------------------------------------
CREATE TABLE mantix.centros_costos (
  id uuid PRIMARY KEY,
  codigo varchar(60) NOT NULL UNIQUE,
  nombre varchar(180),
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT ck_cc_codigo CHECK (length(btrim(codigo)) > 0)
);
CREATE TABLE mantix.equipos (
  id uuid PRIMARY KEY,
  codigo varchar(80),
  nombre varchar(200) NOT NULL,
  centro_costo_id uuid REFERENCES mantix.centros_costos(id) ON DELETE RESTRICT,
  activo boolean NOT NULL DEFAULT true,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_equipo_nombre CHECK (length(btrim(nombre)) > 0),
  CONSTRAINT ck_equipo_codigo CHECK (codigo IS NULL OR length(btrim(codigo)) > 0)
);
CREATE UNIQUE INDEX uq_equipos_codigo_presente ON mantix.equipos(lower(btrim(codigo))) WHERE codigo IS NOT NULL;
CREATE INDEX ix_equipos_centro ON mantix.equipos(centro_costo_id);
CREATE TABLE mantix.tipos_mantenimiento (
  codigo varchar(30) PRIMARY KEY,
  nombre varchar(100) NOT NULL,
  activo boolean NOT NULL DEFAULT true
);
CREATE TABLE mantix.motivos_pendiente (
  codigo varchar(50) PRIMARY KEY,
  nombre varchar(150) NOT NULL,
  activo boolean NOT NULL DEFAULT true
);

-- C. TURNOS Y ASIGNACIONES ---------------------------------------------------
CREATE TABLE mantix.asignaciones_turno (
  id uuid PRIMARY KEY,
  supervisor_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  fecha_operativa date NOT NULL,
  codigo_turno varchar(12) NOT NULL,
  inicio_programado timestamptz,
  fin_programado timestamptz,
  inicio_real timestamptz,
  fin_real timestamptz,
  extraordinario boolean NOT NULL DEFAULT false,
  observaciones text,
  creado_por uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_asig_turno_codigo CHECK (codigo_turno IN ('A','B','C','Q1','Q2','Q3','Q4','Q5','EXTRA')),
  CONSTRAINT ck_asig_prog_hora CHECK (inicio_programado IS NULL OR fin_programado IS NULL OR fin_programado > inicio_programado),
  CONSTRAINT ck_asig_real_hora CHECK (inicio_real IS NULL OR fin_real IS NULL OR fin_real > inicio_real),
  CONSTRAINT ck_asig_programacion_par CHECK ((inicio_programado IS NULL) = (fin_programado IS NULL)),
  CONSTRAINT ck_asig_real_fin_requiere_inicio CHECK (fin_real IS NULL OR inicio_real IS NOT NULL)
);
CREATE INDEX ix_asig_supervisor_fecha ON mantix.asignaciones_turno(supervisor_id, fecha_operativa);
CREATE TABLE mantix.cierres_turno (
  id uuid PRIMARY KEY,
  asignacion_turno_id uuid NOT NULL UNIQUE REFERENCES mantix.asignaciones_turno(id) ON DELETE RESTRICT,
  cerrado_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  cerrado_en timestamptz NOT NULL DEFAULT now(),
  observaciones text
);

-- D. ORDENES E INTERVENCIONES ------------------------------------------------
CREATE TABLE mantix.ordenes_trabajo (
  id uuid PRIMARY KEY,
  numero_orden varchar(80),
  modalidad_registro varchar(20) NOT NULL,
  tipo_mantenimiento_codigo varchar(30) NOT NULL REFERENCES mantix.tipos_mantenimiento(codigo) ON DELETE RESTRICT,
  descripcion text NOT NULL,
  estado_operativo varchar(25) NOT NULL DEFAULT 'ABIERTA',
  creada_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  creada_en timestamptz NOT NULL DEFAULT now(),
  cerrada_en timestamptz,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_orden_modalidad CHECK (modalidad_registro IN ('OPERATIVO','CON_ORDEN')),
  CONSTRAINT ck_orden_numero CHECK (
    (modalidad_registro='OPERATIVO' AND numero_orden IS NULL)
    OR (modalidad_registro='CON_ORDEN' AND numero_orden IS NOT NULL AND length(btrim(numero_orden)) > 0)
  ),
  CONSTRAINT ck_orden_descripcion CHECK (length(btrim(descripcion)) > 0),
  CONSTRAINT ck_orden_estado CHECK (estado_operativo IN ('ABIERTA','EN_PROCESO','PENDIENTE','TERMINADA','CANCELADA')),
  CONSTRAINT ck_orden_version CHECK (version > 0),
  CONSTRAINT ck_orden_cierre CHECK (cerrada_en IS NULL OR cerrada_en >= creada_en),
  CONSTRAINT ck_orden_cierre_estado CHECK (cerrada_en IS NULL OR estado_operativo IN ('TERMINADA','CANCELADA'))
);
-- Codigo externo unico al normalizar espacios extremos y mayusculas.
-- La aplicacion tambien debe normalizar otros espacios/variantes segun politica aprobada.
CREATE UNIQUE INDEX uq_orden_numero_externo ON mantix.ordenes_trabajo(upper(btrim(numero_orden)))
  WHERE numero_orden IS NOT NULL;

-- Una orden puede abarcar varios equipos. El campo 'principal' solo identifica
-- el equipo de referencia; no duplica el conteo global de ordenes.
CREATE TABLE mantix.orden_equipos (
  orden_id uuid NOT NULL REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  equipo_id uuid NOT NULL REFERENCES mantix.equipos(id) ON DELETE RESTRICT,
  principal boolean NOT NULL DEFAULT false,
  agregado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (orden_id, equipo_id)
);
CREATE UNIQUE INDEX uq_orden_un_equipo_principal ON mantix.orden_equipos(orden_id) WHERE principal;
CREATE INDEX ix_orden_equipos_equipo ON mantix.orden_equipos(equipo_id, orden_id);
CREATE INDEX ix_orden_estado_fecha ON mantix.ordenes_trabajo(estado_operativo, creada_en DESC);
-- El indice uq_orden_numero_externo tambien sirve para busquedas normalizadas.

CREATE TABLE mantix.intervenciones (
  id uuid PRIMARY KEY,
  orden_id uuid NOT NULL REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  supervisor_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  asignacion_turno_id uuid REFERENCES mantix.asignaciones_turno(id) ON DELETE RESTRICT,
  fecha_operativa date NOT NULL,
  inicio_real timestamptz,
  fin_real timestamptz,
  actividades text NOT NULL,
  estado varchar(25) NOT NULL DEFAULT 'EN_PROCESO',
  estado_revision varchar(25) NOT NULL DEFAULT 'NO_ENVIADA',
  entregada_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now(),
  creada_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_interv_intervalo CHECK (inicio_real IS NULL OR fin_real IS NULL OR fin_real >= inicio_real),
  CONSTRAINT ck_interv_estado CHECK (estado IN ('EN_PROCESO','PENDIENTE_REFACCION','PENDIENTE_CONTINUIDAD','TERMINADA')),
  CONSTRAINT ck_interv_revision CHECK (estado_revision IN ('NO_ENVIADA','EN_REVISION','APROBADA','RECHAZADA','CORRECCION_EN_PROCESO')),
  CONSTRAINT ck_interv_version CHECK (version > 0),
  CONSTRAINT ck_interv_actividades CHECK (length(btrim(actividades)) > 0),
  CONSTRAINT ck_interv_terminada_fechas CHECK (estado <> 'TERMINADA' OR (inicio_real IS NOT NULL AND fin_real IS NOT NULL))
);
CREATE INDEX ix_interv_orden ON mantix.intervenciones(orden_id, creada_en);
CREATE INDEX ix_interv_supervisor_fecha ON mantix.intervenciones(supervisor_id, fecha_operativa);
CREATE INDEX ix_interv_revision ON mantix.intervenciones(estado_revision, creada_en);

-- Relaciona la intervencion con los equipos realmente atendidos.
-- La FK compuesta impide seleccionar equipos ajenos a la orden.
-- UNIQUE(orden_id,id) sirve como destino de la FK compuesta siguiente.
ALTER TABLE mantix.intervenciones ADD CONSTRAINT uq_intervencion_orden_id UNIQUE(orden_id, id);
CREATE TABLE mantix.intervencion_equipos (
  orden_id uuid NOT NULL,
  intervencion_id uuid NOT NULL,
  equipo_id uuid NOT NULL,
  observaciones text,
  PRIMARY KEY (intervencion_id, equipo_id),
  CONSTRAINT fk_ie_intervencion_misma_orden FOREIGN KEY (orden_id, intervencion_id)
    REFERENCES mantix.intervenciones(orden_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ie_equipo_orden FOREIGN KEY (orden_id, equipo_id)
    REFERENCES mantix.orden_equipos(orden_id, equipo_id) ON DELETE RESTRICT
);
CREATE INDEX ix_interv_equipos_equipo ON mantix.intervencion_equipos(equipo_id);

CREATE TABLE mantix.intervencion_ejecutantes (
  intervencion_id uuid NOT NULL REFERENCES mantix.intervenciones(id) ON DELETE RESTRICT,
  empleado_id uuid NOT NULL REFERENCES mantix.empleados(id) ON DELETE RESTRICT,
  inicio_participacion timestamptz,
  fin_participacion timestamptz,
  observaciones text,
  PRIMARY KEY (intervencion_id, empleado_id),
  CONSTRAINT ck_participacion_hora CHECK (inicio_participacion IS NULL OR fin_participacion IS NULL OR fin_participacion >= inicio_participacion)
);
CREATE INDEX ix_ejecutante_empleado ON mantix.intervencion_ejecutantes(empleado_id);

CREATE TABLE mantix.seguimientos (
  id uuid PRIMARY KEY,
  orden_id uuid NOT NULL REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  intervencion_id uuid REFERENCES mantix.intervenciones(id) ON DELETE RESTRICT,
  supervisor_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  tipo varchar(30) NOT NULL,
  motivo_pendiente_codigo varchar(50) REFERENCES mantix.motivos_pendiente(codigo) ON DELETE RESTRICT,
  descripcion text NOT NULL,
  ocurrido_en timestamptz NOT NULL,
  registrado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_seguimiento_tipo CHECK (tipo IN ('AVANCE','ENTREGA','RETOMA','CAMBIO_ESTADO','OBSERVACION')),
  CONSTRAINT ck_seguimiento_descripcion CHECK (length(btrim(descripcion)) > 0),
  CONSTRAINT fk_seguimiento_intervencion_misma_orden FOREIGN KEY (orden_id, intervencion_id)
    REFERENCES mantix.intervenciones(orden_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_seg_orden_fecha ON mantix.seguimientos(orden_id, ocurrido_en DESC);

CREATE TABLE mantix.entregas_pendientes (
  id uuid PRIMARY KEY,
  orden_id uuid NOT NULL REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  intervencion_origen_id uuid NOT NULL REFERENCES mantix.intervenciones(id) ON DELETE RESTRICT,
  cierre_turno_id uuid NOT NULL REFERENCES mantix.cierres_turno(id) ON DELETE RESTRICT,
  detalle_pendiente text NOT NULL,
  entregado_en timestamptz NOT NULL DEFAULT now(),
  retomado_por uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  retomado_en timestamptz,
  CONSTRAINT ck_entrega_detalle CHECK (length(btrim(detalle_pendiente)) > 0),
  CONSTRAINT ck_entrega_retoma CHECK (retomado_en IS NULL OR retomado_por IS NOT NULL),
  CONSTRAINT fk_entrega_intervencion_misma_orden FOREIGN KEY (orden_id, intervencion_origen_id)
    REFERENCES mantix.intervenciones(orden_id, id) ON DELETE RESTRICT
);
CREATE INDEX ix_entregas_orden ON mantix.entregas_pendientes(orden_id, entregado_en DESC);

-- Un arrendamiento (lease) por orden, NO una aprobacion de estado offline.
-- La verificacion de vencimiento y toma debe ser atomica en una transaccion.
CREATE TABLE mantix.tomas_activas (
  orden_id uuid PRIMARY KEY REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  supervisor_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  token uuid NOT NULL UNIQUE,
  adquirido_en timestamptz NOT NULL DEFAULT now(),
  expira_en timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT ck_toma_expira CHECK (expira_en > adquirido_en)
);

-- E. REVISIONES, CORRECCIONES Y SEGUIMIENTO DE VERSIONES ---------------------
CREATE TABLE mantix.revisiones (
  id uuid PRIMARY KEY,
  intervencion_id uuid NOT NULL REFERENCES mantix.intervenciones(id) ON DELETE RESTRICT,
  version_revisada integer NOT NULL,
  revisor_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  resultado varchar(12) NOT NULL,
  motivo text,
  revisado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_revision_resultado CHECK (resultado IN ('APROBADA','RECHAZADA')),
  CONSTRAINT ck_revision_motivo CHECK (resultado <> 'RECHAZADA' OR (motivo IS NOT NULL AND length(btrim(motivo)) > 0)),
  CONSTRAINT ck_revision_version CHECK (version_revisada > 0),
  CONSTRAINT uq_revision_version UNIQUE (intervencion_id, version_revisada)
);
CREATE INDEX ix_revision_intervencion ON mantix.revisiones(intervencion_id, revisado_en DESC);
CREATE TABLE mantix.solicitudes_correccion (
  id uuid PRIMARY KEY,
  intervencion_id uuid NOT NULL REFERENCES mantix.intervenciones(id) ON DELETE RESTRICT,
  solicitante_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  supervisor_asignado_id uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  autorizador_id uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  motivo text NOT NULL,
  estado varchar(15) NOT NULL DEFAULT 'SOLICITADA',
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  resuelta_en timestamptz,
  CONSTRAINT ck_corr_estado CHECK (estado IN ('SOLICITADA','AUTORIZADA','RECHAZADA','APLICADA')),
  CONSTRAINT ck_corr_motivo CHECK (length(btrim(motivo)) > 0),
  CONSTRAINT ck_corr_resolucion CHECK (
    (estado='SOLICITADA' AND resuelta_en IS NULL AND autorizador_id IS NULL)
    OR (estado <> 'SOLICITADA' AND resuelta_en IS NOT NULL AND autorizador_id IS NOT NULL)
  )
);
CREATE TABLE mantix.versiones_intervencion (
  id uuid PRIMARY KEY,
  intervencion_id uuid NOT NULL REFERENCES mantix.intervenciones(id) ON DELETE RESTRICT,
  numero_version integer NOT NULL,
  solicitud_correccion_id uuid REFERENCES mantix.solicitudes_correccion(id) ON DELETE RESTRICT,
  datos_anteriores jsonb,
  datos_nuevos jsonb NOT NULL,
  modificado_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  modificado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intervencion_id, numero_version),
  CONSTRAINT ck_version_positiva CHECK (numero_version > 0)
);

-- F. PROGRAMACION PREVENTIVA -------------------------------------------------
CREATE TABLE mantix.planes_preventivos (
  id uuid PRIMARY KEY,
  equipo_id uuid NOT NULL REFERENCES mantix.equipos(id) ON DELETE RESTRICT,
  actividad text NOT NULL,
  modalidad varchar(15) NOT NULL,
  regla_recurrencia jsonb,
  zona_horaria varchar(80) NOT NULL DEFAULT 'America/Merida',
  fecha_inicio date NOT NULL,
  fecha_fin date,
  activo boolean NOT NULL DEFAULT true,
  creado_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  creado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_plan_modalidad CHECK (modalidad IN ('UNICA','RECURRENTE')),
  CONSTRAINT ck_plan_rec CHECK ((modalidad='UNICA' AND regla_recurrencia IS NULL) OR (modalidad='RECURRENTE' AND regla_recurrencia IS NOT NULL)),
  CONSTRAINT ck_plan_fechas CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE TABLE mantix.ocurrencias_preventivas (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES mantix.planes_preventivos(id) ON DELETE RESTRICT,
  orden_id uuid UNIQUE REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  fecha_original timestamptz NOT NULL,
  fecha_vigente timestamptz NOT NULL,
  fecha_limite_original timestamptz,
  fecha_limite_vigente timestamptz,
  estado varchar(20) NOT NULL DEFAULT 'PROGRAMADA',
  completada_en timestamptz,
  UNIQUE (plan_id, fecha_original),
  CONSTRAINT ck_ocurrencia_estado CHECK (estado IN ('PROGRAMADA','EN_PROCESO','COMPLETADA','OMITIDA','CANCELADA')),
  CONSTRAINT ck_ocurrencia_limite_original CHECK (fecha_limite_original IS NULL OR fecha_limite_original >= fecha_original),
  CONSTRAINT ck_ocurrencia_limite_vigente CHECK (fecha_limite_vigente IS NULL OR fecha_limite_vigente >= fecha_vigente),
  CONSTRAINT ck_ocurrencia_completada CHECK (
    (estado='COMPLETADA' AND completada_en IS NOT NULL)
    OR (estado <> 'COMPLETADA' AND completada_en IS NULL)
  )
);
CREATE INDEX ix_ocurrencia_fecha ON mantix.ocurrencias_preventivas(fecha_vigente, estado);
CREATE TABLE mantix.solicitudes_reprogramacion (
  id uuid PRIMARY KEY,
  ocurrencia_id uuid NOT NULL REFERENCES mantix.ocurrencias_preventivas(id) ON DELETE RESTRICT,
  solicitante_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  fecha_solicitada timestamptz NOT NULL,
  motivo text NOT NULL,
  estado varchar(15) NOT NULL DEFAULT 'SOLICITADA',
  autorizador_id uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  resuelta_en timestamptz,
  CONSTRAINT ck_reprog_estado CHECK (estado IN ('SOLICITADA','APROBADA','RECHAZADA')),
  CONSTRAINT ck_reprog_motivo CHECK (length(btrim(motivo)) > 0),
  CONSTRAINT ck_reprog_resolucion CHECK (
    (estado='SOLICITADA' AND resuelta_en IS NULL AND autorizador_id IS NULL)
    OR (estado <> 'SOLICITADA' AND resuelta_en IS NOT NULL AND autorizador_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_reprog_solicitud_pendiente ON mantix.solicitudes_reprogramacion(ocurrencia_id) WHERE estado='SOLICITADA';

-- G. CONFIABILIDAD, IMPORTACIONES, BORRADORES Y AUDITORIA --------------------
CREATE TABLE mantix.paros_equipo (
  id uuid PRIMARY KEY,
  equipo_id uuid NOT NULL REFERENCES mantix.equipos(id) ON DELETE RESTRICT,
  orden_id uuid REFERENCES mantix.ordenes_trabajo(id) ON DELETE RESTRICT,
  inicio_paro timestamptz NOT NULL,
  fin_paro timestamptz,
  motivo text,
  registrado_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT ck_paro_horas CHECK (fin_paro IS NULL OR fin_paro >= inicio_paro)
);
CREATE INDEX ix_paro_equipo_inicio ON mantix.paros_equipo(equipo_id, inicio_paro DESC);
CREATE TABLE mantix.importaciones_catalogo (
  id uuid PRIMARY KEY,
  tipo_catalogo varchar(15) NOT NULL,
  nombre_archivo varchar(250) NOT NULL,
  checksum_sha256 char(64),
  solicitada_por uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  estado varchar(20) NOT NULL DEFAULT 'PREVISUALIZACION',
  resumen jsonb,
  creada_en timestamptz NOT NULL DEFAULT now(),
  aplicada_en timestamptz,
  CONSTRAINT ck_import_tipo CHECK (tipo_catalogo IN ('EQUIPOS','EMPLEADOS')),
  CONSTRAINT ck_import_estado CHECK (estado IN ('PREVISUALIZACION','VALIDADA','APLICADA','RECHAZADA'))
);
CREATE TABLE mantix.solicitudes_idempotentes (
  id uuid PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  clave_cliente uuid NOT NULL,
  operacion varchar(80) NOT NULL,
  estado varchar(12) NOT NULL DEFAULT 'INICIADA',
  recurso_tipo varchar(70),
  recurso_id uuid,
  creada_en timestamptz NOT NULL DEFAULT now(),
  finalizada_en timestamptz,
  UNIQUE (usuario_id, clave_cliente, operacion),
  CONSTRAINT ck_idem_estado CHECK (estado IN ('INICIADA','CONFIRMADA','FALLIDA')),
  CONSTRAINT ck_idem_finalizada CHECK (
    (estado='INICIADA' AND finalizada_en IS NULL)
    OR (estado <> 'INICIADA' AND finalizada_en IS NOT NULL)
  )
);
CREATE TABLE mantix.auditoria (
  id uuid PRIMARY KEY,
  actor_usuario_id uuid REFERENCES mantix.usuarios(id) ON DELETE RESTRICT,
  accion varchar(120) NOT NULL,
  entidad varchar(80) NOT NULL,
  entidad_id uuid,
  datos_antes jsonb,
  datos_despues jsonb,
  registrada_en timestamptz NOT NULL DEFAULT now(),
  correlacion_id uuid
);
CREATE INDEX ix_auditoria_entidad ON mantix.auditoria(entidad, entidad_id, registrada_en DESC);
CREATE INDEX ix_auditoria_actor ON mantix.auditoria(actor_usuario_id, registrada_en DESC);

-- Verificacion dentro de la misma transaccion; aborta si no se crearon 30 tablas.
DO $postcheck$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'mantix' AND c.relkind = 'r';
  IF n <> 30 THEN
    RAISE EXCEPTION 'MANTIX: se esperaban 30 tablas, encontradas %', n;
  END IF;
END
$postcheck$;
COMMIT;
