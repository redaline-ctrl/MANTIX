# MANTIX 2.4 · Bitácora y cierre del supervisor

El trabajo diario se concentra en **Mi bitácora**. El supervisor registra y actualiza sus actividades, consulta los detalles en una ventana flotante y finaliza su jornada mediante un único resumen. No necesita ir al historial para enviar cada trabajo.

## Procedimiento diario

1. Confirmar el inicio de la jornada desde Mi centro.
2. Abrir Mi bitácora. Registrar trabajos con código o actividades operativas sin código y actualizar lo realizado, ejecutantes, horarios y estado.
3. Pulsar Ver detalle para consultar una orden y sus intervenciones sin perder la lista. Cerrar con el botón Cerrar o Escape. El historial también usa este detalle flotante y conserva sus filtros.
4. Pulsar **Finalizar turno y enviar a revisión**. Se abre el resumen de la fecha consultada:
   - **Terminados para enviar al jefe:** solo intervenciones terminadas, con horarios completos y aún sin enviar.
   - **Pendientes para entregar:** explicar qué falta y elegir continuidad o espera de refacción. Un trabajo que seguía en proceso también debe quedar clasificado para la entrega. Estos trabajos no se envían como terminados.
   - Las entregas anteriores y los reportes enviados o resueltos conservan su seguimiento. Las correcciones se atienden en Correcciones y no se reenvían al cerrar.
5. En jornadas EXTRA, indicar la hora real de salida si falta. Pulsar **Confirmar cierre y envío**.
6. Consultar la confirmación: número de reportes enviados y nuevas entregas registradas. La bitácora permanece disponible para consulta.

El botón de cierre de Mi centro y el de Mi turno utilizan el mismo resumen. No existe un cierre alternativo que omita el envío. En el historial se conserva el envío individual de terminados propios que hayan quedado sin enviar en instalaciones anteriores; nunca aparece para una intervención pendiente ni para trabajos de otro supervisor.

## Continuidad

La entrega conserva la intervención del supervisor original. El siguiente supervisor entra en Pendientes recibidos, toma la orden y registra su propia intervención sobre la misma orden. Si existe una jornada para esa fecha, la nueva intervención queda vinculada a ella. Al terminar podrá enviarla al cerrar su propio turno. Si continúa pendiente, la entregará nuevamente.

El jefe revisa los terminados enviados. Puede consultar la secuencia completa sin atribuir al último supervisor el trabajo realizado por los anteriores.

## Confirmación y datos

Entregas nuevas, cambio de estado operativo de esos pendientes, envío de terminados, horario final EXTRA, auditoría y cierre se guardan en una sola transacción. Si falta información o el resumen cambió, no se confirma parcialmente. Hay que revisar nuevamente el resumen si otro cambio modificó la bitácora. Repetir una confirmación ya registrada devuelve el mismo cierre sin duplicar entregas ni envíos.

Las altas, ediciones y continuaciones se coordinan con el cierre para impedir agregar o editar trabajos en una jornada ya cerrada. Las correcciones autorizadas conservan su flujo separado.

El cierre no agrega tablas. La conexión posterior de programación usa la migración aditiva 004, documentada en ACTUALIZACION_PROGRAMACION.md. Se mantiene la migración 003 de revisión que prepara el servidor al iniciar. No ejecutar el SQL de referencia ni restaurar la base para aplicar esta actualización.

## Actualizar en Laragon

1. Conservar la carpeta de la instalación actual y un respaldo de la base.
2. Descargar la rama `codex/bitacora-turno` de GitHub y extraer **MANTIX2.4** a una carpeta nueva, por ejemplo `C:\laragon\www\MANTIX2.4_SUPERVISORES`.
3. Reutilizar la configuración PG de la instalación anterior sin guardarla en Git. El programa no carga `.env` automáticamente.
4. En la carpeta nueva ejecutar `npm ci`, `npm run comprobar`, `npm run probar:turnos`, `npm run comprobar:navegacion` y `npm run diagnostico`.
5. Detener el servidor anterior con Ctrl+C. Ejecutar `npm run acceso:local` desde la nueva carpeta y abrir http://127.0.0.1:3102/ con Ctrl+F5.

## Validación

Se probó con cuentas temporales, PostgreSQL y Chromium: resumen sin escritura, permisos, entrega incompleta, salida EXTRA inválida, resumen obsoleto, cierre y reintento concurrentes, envío exclusivo de terminados, conservación de rechazados, registros anteriores sin asignación, bloqueo de altas/edición tras cerrar, continuidad con otro supervisor y vínculo a su jornada. En navegador: detalle flotante, Escape y devolución de foco, conservación de filtros y desplazamiento, cierre desde bitácora, validación de entregas, escritorio y móvil. También pasaron las pruebas existentes de revisión, Dashboard, navegación y turnos.

Para repetir la prueba del supervisor, usar únicamente una copia desechable con nombre `mantix_revision_test`, configurar PGDATABASE y las variables PG de esa copia y ejecutar `npm run test:supervisor`. Con Playwright y Chromium ya disponibles, `SUPERVISOR_BROWSER=1` activa las pruebas del navegador; `CHROMIUM_PATH` permite indicar el ejecutable. El puerto 3102 debe estar libre. La prueba crea datos temporales en esa copia; no usar la base de desarrollo.

No se actualizó automáticamente Laragon ni se publicó el sistema.
