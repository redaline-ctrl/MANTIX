# Revisión funcional de MANTIX

Fecha de revisión: 10 de noviembre de 2026.

Resultado: las pruebas de los módulos descritos abajo pasaron en PostgreSQL y Chromium. Se detectaron y corrigieron dos fallos concretos de acceso; se conserva el diseño y las reglas de trabajo.

## Fallos corregidos

1. **Acciones propias en el historial.** `/api/me` no devolvía el identificador del usuario, aunque el detalle lo utilizaba para mostrar Enviar a revisión y Solicitar corrección únicamente al responsable. Ahora devuelve su propio identificador. Se verificó en navegador que el responsable ve el envío de un trabajo anterior terminado y sin enviar; el servidor sigue validando la pertenencia y el estado.
2. **Acceso a nombres provisionales desde el inicio del administrador.** La tarjeta apuntaba a `/propuestas`, pero faltaba registrar esa ruta directa. Se añadió con permiso `catalogos.administrar`; administrador puede abrirla y los otros roles reciben acceso denegado. No cambia cómo se crean o validan las propuestas.

## Cobertura y resultados

| Módulo | Comprobación |
|---|---|
| Acceso y permisos | Inicio/cierre de sesión, usuario desactivado, contraseña restablecida, actualización de permisos al cambiar rol y rechazo de escrituras desde otro origen. |
| Usuarios | Crear cuenta, vínculo opcional a empleado, rechazo de duplicados, cambio de rol, activar/desactivar y restablecer contraseña. No permite desactivar la propia cuenta ni cambiar su propio rol desde esta pantalla. Se ejercitó también desde navegador. |
| Equipos y empleados | Altas, cambio de estado por API, lectura de catálogos e importación con vista previa sin escritura, confirmación y omisión de claves ya existentes. Alta de equipo comprobada en navegador. |
| Propuestas provisionales | Crear registro oficial, vincular uno existente o descartar. Se comprobaron relaciones con orden e intervención, rechazo de resolución repetida y acceso desde la tarjeta del administrador. |
| Auditoría | Lectura con permiso exclusivo, eventos de cambios de usuarios, contraseñas, catálogos y propuestas. La consulta no expone contraseñas. Vista verificada en navegador y móvil. |
| Turnos | Rotación A/B/C, Q1–Q5, domingo EXTRA, jornada no identificada, resumen y cierre. Las pruebas con fechas históricas eligen Solo consultar cuando aparece la propuesta de jornada actual. |
| Registro y bitácora | Órdenes externas con número, trabajos internos sin número, selección múltiple de ejecutantes, guardado de relaciones, edición permitida y bloqueo tras enviar, entregar o cerrar. |
| Pendientes y programación | Publicación, aviso, toma exclusiva concurrente, liberación con motivo antes de iniciar, continuidad sin duplicar la orden, autoría por turno y navegación entre Pendientes y Mi bitácora. |
| Cierre | Entrega y envío en una transacción, datos faltantes, resumen cambiado, EXTRA inválida, confirmación repetida y simultánea, conservación de rechazados y bloqueo posterior de altas/ediciones. |
| Revisión y correcciones | Aprobar/rechazar, impedir autorrevisión, control de versión, resolución simultánea, historial, corrección autorizada, reenvío y nueva aprobación. |
| Solicitudes | Solicitar corrección de trabajo aprobado y autorización; solicitar cambio de fecha, aprobar/rechazar y conservar fecha original. El jefe resolvió una reprogramación desde Solicitudes en el navegador. |
| Dashboard y coordinador | Lectura de los mismos registros de bitácora, ejecutantes y supervisor; igualdad de resultados para jefe/coordinador; órdenes sin duplicación, continuidad, cumplimiento aprobado, backlog, horas Q, cobertura individual, filtros y porcentajes de aprobación/rechazo. |
| Exportación | Excel, PDF y detalle de trabajadores comprobados por las pruebas del Dashboard. |
| Navegación | Sintaxis y enlaces de las nueve páginas; regreso al centro y vistas móviles. |

## Pruebas ejecutadas

- `npm run comprobar`
- `npm run comprobar:navegacion`
- `npm run probar:turnos`
- `ADMIN_BROWSER=1 npm run test:administracion`: 79 peticiones verificadas.
- `PROGRAMACION_BROWSER=1 npm run test:programacion`: 54 peticiones verificadas.
- `SUPERVISOR_BROWSER=1 npm run test:supervisor`: 27 peticiones verificadas.
- `REVISION_BROWSER=1 npm run test:revision`: 48 peticiones verificadas.
- `DASHBOARD_BROWSER=1 npm run test:dashboard`: 21 peticiones verificadas.

En total, 229 peticiones verificadas por las pruebas de integración, además de las comprobaciones de navegador. Las respuestas de error esperadas forman parte de las pruebas de permisos y validaciones; no son fallos pendientes.

`test:administracion` utiliza exclusivamente `mantix_revision_test`. Las demás pruebas mantienen sus nombres de base desechable y sus restricciones. Se usaron cuentas y datos temporales. No se verificó ni modificó directamente la instalación de Windows del usuario ni su base de desarrollo.

## Alcance práctico

Las pruebas respaldan los flujos descritos; no garantizan ausencia de errores en cualquier situación ni sustituyen la prueba con usuarios reales y el servidor autorizado. No se hicieron pruebas de carga en producción.

Se mantienen los criterios del Dashboard: seleccionar un ejecutante registra su participación; las horas-hombre necesitan tiempos individuales completos. No se inventan horas para intervalos abiertos. El cumplimiento requiere validación y se limita a la agenda interna registrada. Los indicadores técnicos sin datos suficientes mantienen N/D.

No se añadió una migración ni se cambió la estructura de la base. Para recibir estas dos correcciones en Laragon es necesario actualizar los archivos y reiniciar el servidor desde la carpeta actualizada.

## Organización posterior del repositorio

El 11 de noviembre de 2026 se consolidó esta versión en la raíz. Se retiraron la versión MANTIX3.0, el ZIP antiguo, el servidor y pantallas heredadas, el acceso de prueba no utilizado, las capturas históricas y la comprobación Python duplicada. También se retiró el importador de la carga inicial v1 y su JSON, restringidos al esquema antiguo de 30 tablas; la importación administrativa actual se conserva. Los archivos anteriores permanecen recuperables en el historial de Git.

El comportamiento de los archivos actuales del servidor y las ocho pantallas se conservó al moverlos; las salidas de las pruebas ahora usan un directorio configurable. No se modificó la base del usuario. Las instrucciones vigentes están en README.md y docs/DESPLIEGUE.md.

### Validación de la limpieza, 11 de noviembre de 2026

- Pasaron las comprobaciones de sintaxis, navegación y turnos desde la raíz: ocho pantallas vigentes.
- Pasaron administración (79), programación (54), supervisor (27), revisión (48) y Dashboard (21): 229 peticiones verificadas, además de los flujos de Chromium.
- Se comprobó por SHA-256 que los 27 archivos conservados de ejecución, recursos y SQL tienen el mismo contenido que en el último commit funcional anterior a la limpieza.
- Se generó y revisó el paquete de traslado: 36 archivos, con `package-lock.json`, sin dependencias instaladas, pruebas, secretos ni respaldos. Su extracción permitió ejecutar `npm ci --omit=dev` correctamente.
- Las pruebas se ejecutaron en copias desechables creadas dentro del entorno, no sobre la base de la computadora del usuario.
