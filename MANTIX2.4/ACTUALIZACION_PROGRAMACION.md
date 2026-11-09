# MANTIX 2.4 · Programación interna conectada a la bitácora

El jefe publica trabajos preventivos internos sin número de Easy Maint. Los supervisores con jornada abierta pueden tomarlos desde Pendientes; una actividad solo admite un responsable inicial. La programación, la toma y la ejecución no se confunden entre sí.

## Origen y tipo de mantenimiento

| Origen | Número | Tipo registrado |
|---|---|---|
| Orden recibida de Easy Maint | El código real de la hoja | PREVENTIVO |
| Preventivo interno publicado por el jefe en MANTIX | Sin número | PREVENTIVO |
| Trabajo interno capturado manualmente por el supervisor | Sin número | OPERATIVO o PREVENTIVO, según corresponda |

La modalidad técnica OPERATIVO significa registro sin número; no obliga a clasificar el mantenimiento como operativo. No se inventan códigos externos. No hay importación ni sincronización automática con Easy Maint.

## Procedimiento

1. **Jefe → Programación preventiva.** Selecciona equipo, fecha e indicaciones. Puede publicar una actividad única o una rutina diaria, semanal o mensual, con intervalo. La recurrencia genera fechas independientes hasta por 12 meses.
2. **Supervisor → Mi centro.** Ve el aviso con la cantidad de trabajos disponibles y tomados sin iniciar, con acceso directo a Pendientes. Se actualiza dentro de la aplicación cada 45 segundos cuando la pantalla está visible; no son mensajes por correo, WhatsApp ni notificaciones del teléfono.
3. **Supervisor → Pendientes → Del jefe.** Consulta disponibles y puede buscar. Las otras pestañas son De otros turnos y Tomados por mí; solo se muestra una a la vez. Se ofrecen tareas de hoy y atrasadas; no las futuras. Se muestran hasta las 100 disponibles más antiguas, con su total. Confirma la jornada actual antes de tomar; la jornada nocturna A puede corresponder al día anterior antes de las 07:00 de Mérida.
4. **Tomar trabajo.** El servidor reserva la actividad a su nombre y reutiliza o crea una única orden interna sin número. Otro supervisor no puede tomarla simultáneamente. La toma inicial persiste al cerrar el navegador y no caduca a los 20 minutos. La reserva breve de la pantalla de continuidad sirve únicamente para que el siguiente supervisor capture su nueva intervención; es un paso distinto.
5. **Registrar avance.** Tras tomar el trabajo, se abre automáticamente el detalle flotante en Mi bitácora, con equipo y actividad ya registrados. Si sale sin guardar, encuentra la toma en Pendientes → Tomados por mí, donde puede iniciarla o liberarla con motivo. El supervisor indica ejecutantes, horarios reales, lo realizado y el estado. No vuelve a capturar la programación como otra orden. Aparece en su bitácora al guardar. El inicio se propone con la hora actual para que lo revise; la hora de fin queda vacía.
6. **Finalizar turno y enviar a revisión.** Los terminados van al jefe; los pendientes se entregan para continuidad. Si tiene una toma sin iniciar, debe registrar el avance o liberarla con motivo antes de cerrar.
7. **Siguiente turno.** Toma el pendiente entregado y añade su intervención a la misma orden. Se conserva cada supervisor y sus actividades.
8. **Jefe.** Consulta responsables, avances, continuidad y resultados en la agenda. Los terminados solo quedan validados al aprobar su última intervención y no quedar otras intervenciones terminadas sin aprobar; publicarlos o tomarlos no acredita cumplimiento.

Pendientes reúne los trabajos del jefe, la continuidad de otros turnos y las tomas propias sin iniciar. Sus pestañas y búsquedas permiten ver una lista a la vez. Mi bitácora contiene los avances registrados y el cierre; no repite la lista de disponibles. Al guardar una continuación desde Pendientes se abre Mi bitácora para consultar el avance. La actualización conserva la búsqueda y no recarga una captura de continuidad activa.

## Liberar, cancelar y reprogramar

- El supervisor puede liberar un trabajo propio solo antes de que existan intervenciones, indicando motivo. Otro supervisor puede tomarlo reutilizando la misma orden.
- El jefe también puede liberar una toma sin avances, con motivo; la auditoría conserva la persona anterior y la decisión.
- Después de registrar avances no se libera ni se borra la toma inicial: se utiliza la entrega por continuidad. El responsable visible sigue la última intervención.
- El jefe puede cancelar una actividad sin tomar ni iniciar, con motivo. La cancelación conserva su historial y excluye esa programación del cumplimiento.
- Las solicitudes de cambio de fecha solo se admiten antes de tomar la actividad. Resolver una solicitud no puede mover una tarea ya tomada. No se permite utilizar el endpoint antiguo para crear una orden sin toma.
- Si una rutina ya llegó en una hoja de Easy Maint, evitar publicar el mismo encargo otra vez como trabajo interno. MANTIX impide duplicar una toma de una ocurrencia; no puede identificar automáticamente que dos descripciones independientes representan el mismo trabajo físico.

## Indicadores

Un preventivo interno se cuenta como PREVENTIVO aunque no lleve número. La programación usa las ocurrencias internas, no presume que todas las hojas externas estén cargadas. Una orden atendida por varios turnos cuenta una sola vez; las intervenciones permanecen separadas. El cumplimiento requiere la validación final y las fechas de término y aprobación dentro del corte, conforme a ACTUALIZACION_DASHBOARD.md. Tomar no registra horas ni trabajo ejecutado.

La agenda del jefe tiene búsqueda y filtro de situación sobre todas las actividades y páginas de 100 registros. Atiende primero la programación vencida o en curso; los próximos trabajos y el historial permanecen consultables. Las recurrencias no son un proceso que genere fechas eternamente: al acercarse el fin de los 12 meses se debe revisar y publicar el siguiente periodo.

## Instalar en Laragon

1. Conservar la instalación anterior y un respaldo de la base.
2. Descargar la rama `codex/bitacora-turno` de GitHub y extraer **MANTIX2.4** a una carpeta nueva, por ejemplo `C:\laragon\www\MANTIX2.4_PROGRAMACION`.
3. Reutilizar las variables PG que ya funcionan. El programa no carga `.env` automáticamente. No guardar contraseñas en el repositorio.
4. Ejecutar `npm ci`, `npm run comprobar`, `npm run probar:turnos`, `npm run comprobar:navegacion` y `npm run diagnostico`.
5. Detener la instancia anterior con Ctrl+C. Ejecutar `npm run acceso:local` en la carpeta nueva. Antes de escuchar, el servidor prepara las migraciones 003 y **004**, ambas repetibles. La 004 añade tres columnas y un índice a `ocurrencias_preventivas`; no agrega tablas, no importa datos y no reemplaza históricos. Permanecen 31 tablas.
6. Abrir http://127.0.0.1:3102/ y actualizar con Ctrl+F5.

También existe `npm run migrar:programacion` para aplicar explícitamente la 004 con el servidor detenido y la conexión configurada. No ejecutar el SQL de referencia, reinstalar la 001, repetir la 002 ni restaurar una base para aplicar esta conexión.

Las órdenes internas anteriores sin intervenciones se pueden tomar reutilizando su orden. Los trabajos históricos con intervenciones conservan su seguimiento: no se les asigna retroactivamente una toma ni se liberan por esta migración.

## Validación y recomendaciones operativas

Se validaron con PostgreSQL y autenticación real: dos supervisores compitiendo por una actividad, idempotencia de la toma del mismo responsable, permisos, jornada abierta y fecha elegible, liberación y retoma sin otra orden, bloqueo de liberación con avances, cancelación con auditoría, toma sin caducidad, cierre con tomas sin iniciar, continuidad hasta aprobación y cumplimiento. Se comprobó que el preventivo interno mantiene número nulo y tipo PREVENTIVO, y que el endpoint antiguo no omite la toma. Se verificó recurrencia y paginación sin repetir registros. Chromium probó publicación por el jefe, aviso, aviso que abre Pendientes, toma y liberación en sus pestañas, apertura automática del avance en bitácora, continuidad desde otros turnos, búsqueda que conserva su estado, formularios sin fin inventado y vista móvil. También pasaron los flujos existentes de supervisor, revisión, Dashboard, navegación y rotación.

Para repetir la prueba usar exclusivamente una copia desechable llamada `mantix_revision_test`, las variables PG y `npm run test:programacion`. `PROGRAMACION_BROWSER=1` activa Chromium cuando Playwright está disponible; `CHROMIUM_PATH` permite indicar la ruta. El puerto 3102 debe estar libre. La prueba crea registros en esa copia y se niega a usar otro nombre de base.

Recomiendo probar primero una actividad con dos supervisores: uno la toma y la entrega; el segundo la termina; el jefe la aprueba. Usar indicaciones concretas (equipo, alcance y qué verificar al finalizar), registrar horas reales y revisar al inicio de cada jornada los trabajos atrasados o sin tomar. Mantener el historial y corregir con trazabilidad, sin borrar trabajos para cuadrar indicadores.

Para el uso simultáneo real, los supervisores deben entrar a una misma instancia y base compartida. Esta entrega conserva el acceso local 127.0.0.1 para pruebas; la publicación en un servidor compartido es una etapa separada.

No se actualizó automáticamente Laragon, no se publicaron cambios de entorno y no se modificó la base de desarrollo en las pruebas.

El ajuste de ubicación a Pendientes no requiere otra migración: conserva la 004 y las reglas de exclusividad.
