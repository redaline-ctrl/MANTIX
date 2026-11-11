# Operación de MANTIX

## Supervisor

1. Inicia sesión con su propia cuenta y confirma la jornada. El domingo se registra EXTRA con horarios reales; el turno A conserva la fecha operativa del inicio durante la madrugada.
2. Las órdenes de Easy Maint se registran con su código real. Los trabajos internos no tienen número; su tipo puede ser operativo o preventivo. No se vuelve a capturar un encargo que ya está publicado por el jefe.
3. En **Pendientes → Del jefe** consulta y toma programación interna disponible. Solo un supervisor puede tomar cada actividad. La toma persiste al cerrar el navegador y no registra trabajo realizado por sí sola.
4. Al tomar se abre el formulario de avance en **Mi bitácora**. Selecciona ejecutantes mediante casillas y buscador, indica horarios reales y registra actividades. Las selecciones se conservan al buscar otras personas.
5. **Pendientes → Tomados por mí** contiene tomas sin iniciar. Puede iniciarlas o liberarlas con motivo. Después de registrar avances debe usarse continuidad; no se borra la intervención.
6. **Pendientes → De otros turnos** permite continuar lo que dejó otro supervisor, con una nueva intervención sobre la misma orden. La reserva breve de esta captura es distinta de la toma inicial persistente.
7. **Mi bitácora** reúne avances, estados y detalles flotantes. Al pulsar **Finalizar turno y enviar a revisión** revisa terminados para el jefe y pendientes para entregar. Debe explicar qué falta y qué necesita saber el siguiente turno. Si faltan datos, no se confirma parcialmente.
8. **Correcciones** muestra devoluciones y correcciones autorizadas para aplicar y reenviar sin reabrir el turno. **Historial** conserva la secuencia de órdenes e intervenciones.

Cerrar el turno no termina las órdenes pendientes. Cada supervisor conserva su autoría; el último no recibe el trabajo de todos como si lo hubiera hecho solo.

## Jefe

- **Revisión de trabajos:** aprueba o rechaza reportes terminados, con motivo cuando devuelve uno. Consulta bitácoras por turno, historial y solicitudes.
- **Programación preventiva:** publica rutinas internas sin número, únicas o recurrentes. Cada fecha tiene una toma independiente. Puede consultar responsables y cancelar o liberar trabajos sin avances con motivo. Las recurrencias cubren hasta 12 meses y requieren revisar el siguiente periodo.
- **Consulta de órdenes:** seguimiento entre turnos.
- **Dashboard:** mantenimiento, supervisores, trabajadores y revisiones. Publicar, tomar o marcar terminado no equivale a validación del jefe.

## Coordinador

Consulta Dashboard e historial sin modificar trabajos ni resolver revisiones.

## Administrador

Gestiona usuarios y roles, equipos y empleados, importación validada desde la pantalla, nombres provisionales y auditoría. La validación puede crear un registro oficial, vincularlo con uno existente o descartar la propuesta, conservando lo reportado originalmente.

La herramienta `admin:inicial` es para una instalación nueva autorizada. No debe ejecutarse para actualizar una instalación que ya tiene administrador. Los catálogos actuales viven en PostgreSQL; no se distribuye ni se reimporta la carga inicial antigua.

## Documentos y firmas

La carga de PDF o imágenes y la firma de órdenes son ideas pendientes de una etapa posterior. No forman parte del flujo actual.
