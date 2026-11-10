# Ajustes de interfaz y verificación del Dashboard

Esta entrega se limita a la selección de ejecutantes del detalle de trabajo, el nombre visible MANTIX y el aspecto del botón de regreso en las pantallas de revisión y Dashboard.

- El formulario de primera intervención utiliza casillas y búsqueda por nombre o clave. Conserva las personas seleccionadas al filtrar y muestra sus nombres y cantidad. No requiere Ctrl. No guarda si no se eligió ningún ejecutante.
- Encabezados, títulos de pestaña y pies de las pantallas muestran MANTIX sin número de versión.
- Volver al centro tiene el aspecto de botón utilizado en los accesos del supervisor. Se comprobó en revisión del jefe y en Dashboard para jefe y coordinador. No se añadieron accesos repetidos ni se cambiaron permisos.

## Verificación del flujo hacia el Dashboard

La bitácora guarda en la misma base PostgreSQL que consulta `/api/dashboard`; no necesita un segundo envío para aparecer en los indicadores de actividad. El envío a revisión y la aprobación determinan los estados de revisión y validación, no una transferencia a otra base.

Se probó en una copia desechable: tomar un preventivo interno desde Pendientes, seleccionar dos ejecutantes usando búsquedas sucesivas, guardar el avance, consultar las relaciones almacenadas y solicitar el Dashboard con el equipo y fecha correspondientes. Los dos identificadores guardados coinciden con los del detalle del Dashboard. También aparecen el supervisor, el tipo PREVENTIVO y la participación del segundo ejecutante.

Pasaron las pruebas existentes de órdenes únicas, continuidad entre turnos, programación y cumplimiento sujeto a aprobación, backlog, horas reales, pausa Q, horas individuales, cobertura, filtros, aprobación/rechazo, permisos y exportaciones. No se modificó el cálculo del Dashboard ni sus consultas.

**Horas-hombre:** el formulario inicial guarda quién participó; no inventa tiempos individuales. Estas horas se calculan solo cuando `intervencion_ejecutantes` tiene inicio y fin de participación. Si faltan, se conserva N/D y la cobertura disponible. No se multiplica automáticamente la duración del trabajo por el número de personas.

## Validación

`npm run comprobar`, `npm run comprobar:navegacion`, `PROGRAMACION_BROWSER=1 npm run test:programacion`, `REVISION_BROWSER=1 npm run test:revision` y `DASHBOARD_BROWSER=1 npm run test:dashboard`, con las bases desechables y Chromium. La prueba de selección comprueba el guardado y la lectura real del Dashboard; la de navegación comprueba el botón de regreso del jefe y coordinador.

Para instalar, conservar la carpeta anterior y descargar la carpeta MANTIX2.4 de la rama `codex/bitacora-turno`. Usar las mismas variables de conexión PG, ejecutar `npm ci` y las comprobaciones habituales, detener la instancia anterior y arrancar `npm run acceso:local` en la nueva carpeta. Actualizar el navegador con Ctrl+F5.

No requiere una migración nueva respecto de la instalación con programación conectada. No se modificaron la base de desarrollo ni la instalación de Laragon durante estas pruebas.
