# Bitácora del turno · actualización de MANTIX

Esta versión sustituye la captura individual de `/ejecucion` por una bitácora por filas. Mantiene la base `mantix_desarrollo`, las cuentas existentes y los permisos del servidor. El Dashboard no se modificó.

## Instalar en tu computadora (Windows / Laragon)

1. Desde pgAdmin, guarda un respaldo actualizado de `mantix_desarrollo` en formato Custom.
2. Detén el servidor anterior con Ctrl+C. Conserva su carpeta y el respaldo.
3. Extrae el paquete en una carpeta nueva, por ejemplo `C:\laragon\www\MANTIX_BITACORA`. No sobrescribas tu versión anterior.
4. Abre la carpeta que contiene `package.json` en VS Code y abre una terminal.
5. Utiliza las mismas variables PGHOST, PGPORT, PGUSER y PGPASSWORD de tu conexión local. La base continúa siendo `mantix_desarrollo`. El programa no carga `.env` automáticamente. Nunca guardes la contraseña en código ni la envíes por chat.
6. Ejecuta `npm ci` y después `npm run comprobar`.
7. Ejecuta `npm run acceso:local`. En este primer arranque se aplica automáticamente `database/002_bitacora_turno.sql`, dentro de una transacción. Tu usuario PostgreSQL debe poder modificar el esquema. Si falla, el servidor no arranca; consulta el error sin ejecutar el SQL de referencia anterior.
8. Abre http://127.0.0.1:3102/ e inicia sesión con tu cuenta existente.
9. En **Mis jornadas**, registra la jornada real; luego abre **Mi bitácora**. Iniciar sesión no inicia un turno.

No ejecutes `REFERENCIA_INSTALACION_001_NO_REEJECUTAR.sql`, la inicialización de administrador ni la importación de catálogos para actualizar esta versión. No ejecutes el servidor antiguo junto al nuevo. Si necesitas regresar al código anterior después de registrar actividades POR_INICIAR, conserva el respaldo y consulta primero la compatibilidad: la versión anterior no conoce ese estado.

## Uso de la bitácora

- Agrega cada actividad recibida con su código de Easy Maint o como operativo sin código. Selecciona el tipo real de mantenimiento; tener código y ser preventivo son datos diferentes.
- Una actividad **Por iniciar** requiere equipo y descripción, pero no horas ni ejecutantes. También se pueden agregar actividades durante el turno.
- Usa **Actualizar** para completar ejecutantes, inicio/fin reales, actividades, observaciones y avance. Los horarios incluyen la fecha para trabajos que cruzan medianoche.
- **Terminada** requiere inicio, fin, actividades y ejecutantes. Puedes enviarla al jefe antes del cierre.
- Antes de cerrar, termina o deja pendiente cada actividad en proceso. Para pendientes y no iniciadas, explica el motivo y qué falta (mínimo 10 caracteres).
- **Revisar y cerrar turno** muestra el resumen. **Cerrar turno y enviar reporte** guarda el cierre, entrega los pendientes y envía las intervenciones terminadas, todo en una transacción. Reintentar el cierre no duplica entregas ni envíos.
- Una actividad no iniciada se conserva sin horas y se entrega para continuidad. Otro supervisor la toma desde Pendientes; se crea una nueva intervención en la misma orden. La toma simultánea está protegida en PostgreSQL.
- El jefe ve reportes completos del cierre en Validación y decide por intervención terminada. No iniciadas y pendientes se muestran para seguimiento, sin contarlas como ejecutadas.
- Si rechaza una intervención, se habilita una corrección para su supervisor. Desde Correcciones puede ajustar actividades, horarios y ejecutantes/observaciones. El cambio conserva la versión previa y se reenvía al jefe. El turno no se reabre ni se altera el reporte guardado al cerrar.
- Si una actividad no iniciada ya no debe realizarse, su creador solicita cancelación con motivo. El jefe la autoriza o mantiene la actividad. Nunca se elimina la orden.
- Las asignaciones A/B/C y Q1–Q5 y el manejo de domingos se conservan. Esta actualización no sustituye la programación real por control de asistencia, ni calcula automáticamente horas-hombre o descuenta descansos de registros individuales.

## Cambios de datos

Se agregan columnas de observaciones y motivo a intervenciones, un reporte JSON del cierre y metadatos de solicitud de cancelación a órdenes. Se permite POR_INICIAR sin horarios ni actividades ejecutadas. No se crean tablas nuevas ni se reemplazan datos históricos; se conservan las 30 tablas. Los cierres anteriores no tienen un reporte retrospectivo inventado.

La migración tiene bloqueo de ejecución e identifica si ya fue aplicada. También puede ejecutarse explícitamente con `npm run migrar:bitacora`. El archivo 002 por sí solo no es un script para ejecutar repetidamente: utiliza el comando o el arranque normal.

## Validación realizada

- Comprobación estática de seis pantallas y seis módulos.
- Pruebas en PostgreSQL 18, en una base desechable separada: captura inicial, validación, permisos, edición concurrente, cierre atómico, reintentos, entrega sin inicio, corrección versionada, reporte inmutable, cancelación y domingo.
- Servidor completo con cuentas temporales y autenticación real; toma simultánea de un pendiente con un único ganador y continuación sin duplicar la orden.
- Chromium: agregar y actualizar una fila, cerrar el turno, bloquear captura después del cierre y vista de 390 px sin desbordamiento de página ni errores JavaScript. La tabla utiliza desplazamiento horizontal.

Pruebas reproducibles: crea una copia desechable de la base llamada `mantix_bitacora_test`; configura PGHOST, PGPORT, PGUSER, PGPASSWORD y PGDATABASE con ese nombre; ejecuta `npm run test:bitacora`. La prueba crea datos artificiales y se niega a ejecutarse con otro nombre de base. Para la prueba visual opcional se requiere Playwright y Chromium instalados: BITACORA_BROWSER=1 y CHROMIUM_PATH con la ruta de Chromium. No son dependencias de la aplicación.

La validación local no equivale a homologación para producción ni a pruebas de carga. No se publicó el entorno ni se desplegó esta versión en la computadora del usuario.
