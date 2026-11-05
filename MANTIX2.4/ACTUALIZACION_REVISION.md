# MANTIX 2.4 · Módulo de revisión del jefe

La base es el ZIP MANTIX_2_4 que eligió la usuaria. Se conservan la captura del supervisor, la bitácora, navegación, programación de turnos, pendientes, propuestas de catálogos y permisos existentes. El Dashboard se mantiene como estaba; su ampliación corresponde a la siguiente etapa.

## Instalación en Laragon

1. Crea un respaldo actualizado de `mantix_desarrollo` con pgAdmin y conserva la carpeta de tu versión 2.4 actual.
2. Detén el servidor anterior con Ctrl+C.
3. Descarga la rama `codex/bitacora-turno` desde GitHub con Code → Download ZIP. Dentro de la descarga utiliza **MANTIX2.4**, no la carpeta MANTIX3.0 ni el ZIP original.
4. Copia el contenido de MANTIX2.4 a una carpeta nueva: `C:\laragon\www\MANTIX2.4_REVISION`. `package.json` debe quedar directamente dentro de esa carpeta.
5. Ábrela en VS Code y utiliza las mismas variables de conexión PostgreSQL de tu instalación: PGHOST, PGPORT, PGUSER y PGPASSWORD si corresponde. No publiques contraseñas. El programa no carga `.env` automáticamente.
6. Ejecuta `npm ci`, `npm run comprobar`, `npm run probar:turnos`, `npm run comprobar:navegacion` y `npm run diagnostico`.
7. El diagnóstico de 2.4 debe confirmar **31 tablas**, incluida `propuestas_catalogo` de su migración 002. Esta actualización no ejecuta otra vez 001 ni 002; si faltan, detente y consulta el diagnóstico antes de escribir datos.
8. Ejecuta `npm run acceso:local`. El arranque aplica únicamente la migración 003 de revisión en una transacción y luego abre el servidor. El usuario PostgreSQL debe tener permiso para agregar columnas e índices en `mantix`.
9. Abre http://127.0.0.1:3102/ y pulsa Ctrl+F5. Con una cuenta de jefe, entra en **Validación del jefe**. Los supervisores conservan su captura 2.4; sus correcciones se abren desde **Correcciones**.

Si la migración falla, el servidor no arranca y muestra el error en la terminal. No ejecutes inicializadores de administrador ni importes catálogos para actualizar esta versión. El comando independiente `npm run migrar:revision` también ejecuta la migración 003 de manera repetible.

## Funciones del jefe

- **Por revisar:** intervenciones terminadas enviadas, con filtros por fecha operativa, supervisor, turno, estado y búsqueda de orden/actividad. Hay paginación; no se ocultan registros tras un límite fijo sin aviso.
- **Detalle:** descripción, equipos, ejecutantes, nombres provisionales identificados, inicio/fin reales, fechas de envío/resolución y versión. Incluye continuidad entre supervisores de la misma orden, decisiones previas y observaciones/entregas.
- **Aprobar o rechazar:** solo se decide sobre intervenciones terminadas y en revisión. El jefe no puede revisar su propio trabajo. Se comprueba la versión y se bloquea la fila en PostgreSQL para impedir dos decisiones sobre la misma entrega.
- **Rechazar:** exige un motivo de al menos 8 caracteres y habilita la corrección para el supervisor responsable, sin exigir otra autorización por el mismo rechazo.
- **Bitácoras por turno:** agrupa registros por supervisor, fecha operativa y turno vinculado. Muestra órdenes únicas, intervenciones, terminadas y pendientes. Se consultan también trabajos no enviados; estos no pueden aprobarse por aparecer en la bitácora. Esta vista refleja datos actuales, no representa un archivo inmutable del cierre.
- **Historial de revisión:** permite consultar el estado actual con filtros y abrir el historial completo de decisiones de cada orden. Las tarjetas cuentan intervenciones por estado actual, no eventos históricos de aprobación ni órdenes únicas.
- **Solicitudes:** conserva autorización de correcciones adicionales y reprogramaciones preventivas según permisos existentes.

## Correcciones del supervisor

El rechazo aparece automáticamente en Correcciones. El supervisor puede ajustar actividades, horarios y ejecutantes. Se conserva la versión anterior, incluidos sus datos y la selección previa de trabajadores. Las horas individuales de participaciones que no se modifican no se borran.

Guardar y reenviar crea una nueva versión y la devuelve al jefe. Si el guardado funciona y falla el envío, la pantalla permite reenviar sin volver a aplicar la corrección. El turno permanece cerrado. Un trabajo aprobado que después necesita cambios sigue requiriendo una solicitud y autorización adicional.

## Datos y compatibilidad

La migración 003 agrega dos columnas opcionales a `mantix.intervenciones`: `enviada_revision_en` y `resuelta_revision_en`, más un índice para la bandeja. No agrega tablas, no borra información ni asigna fechas artificiales a registros anteriores. Las fechas de versiones anteriores se conservan en revisiones, auditoría y versiones. Los registros históricos sin marca de envío muestran **Sin fecha registrada**.

Las decisiones se refieren a intervenciones. La orden conserva su identidad al continuar entre supervisores. El estado operativo de terminada no se interpreta como aprobación. El futuro Dashboard debe usar `estado_revision` para distinguir ejecución de validación.

No se cambió el cierre de 2.4: se siguen entregando los pendientes antes de cerrar y las intervenciones se envían a revisión por separado. Esta entrega no vuelve a introducir POR_INICIAR ni el formulario de versiones anteriores.

## Validación

- Comprobaciones estáticas de JavaScript, pantallas y enlaces.
- Pruebas de turnos A/B/C, Q1–Q5 y domingos de la base 2.4.
- Integración contra PostgreSQL 18 en `mantix_revision_test`, una copia desechable distinta de la base de desarrollo.
- Autenticación real de supervisor, jefe, coordinador y administrador; permisos, fechas inválidas, filtros, selección de nombres provisionales, duplicados en relaciones, paginación, bloqueo de revisión propia, versión desactualizada y decisiones simultáneas.
- Corrección tras rechazo, reenvío, aprobación posterior, historial de versiones y conservación del cierre de jornada.
- Chromium en escritorio y móvil: filtros, detalle, rechazo con motivo, consulta por turno, corrección desde la cuenta del supervisor y aprobación desde la cuenta del jefe.

Para repetir integración: restaura una copia desechable con el esquema existente en una base llamada `mantix_revision_test`, configura PGDATABASE con ese nombre y las variables PG de esa copia, detén cualquier proceso en el puerto 3102 y ejecuta `npm run test:revision`. La prueba se niega a usar otro nombre de base y crea cuentas y trabajos artificiales. Para la parte visual opcional se requieren Playwright y Chromium instalados; usa REVISION_BROWSER=1 y CHROMIUM_PATH si corresponde. No son dependencias de la aplicación.

No se desplegó esta actualización en la computadora de la usuaria ni se publicó el sistema. No es una homologación para producción ni una prueba de carga.
