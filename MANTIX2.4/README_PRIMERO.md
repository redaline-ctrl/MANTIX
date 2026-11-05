> **Actualización del módulo de revisión:** antes de instalar esta entrega, lee `ACTUALIZACION_REVISION.md`. Se conserva la base 2.4 y se agrega la migración 003 de fechas de revisión. Las instrucciones de la versión base que aparecen debajo se mantienen como referencia.

# MANTIX 2.4 — Navegación y lenguaje para operación diaria (ISYSA)

Actualización de la versión 2.3 **sin modificar el esquema de PostgreSQL ni importar datos**. Conserva el flujo acordado de turnos, órdenes preventivas de Easy Maint, trabajos operativos, ejecutantes, pendientes, revisiones, autorización, correcciones y control administrativo.

## Instalación segura

1. **Detener** cualquier versión de MANTIX que use el puerto 3102 (`Ctrl+C`).
2. **Respaldar** la carpeta actual `C:\laragon\www\MANTIX2.3` y, por prudencia, obtener un respaldo de `mantix_desarrollo` desde pgAdmin antes de probar operaciones de escritura.
3. Extraer este ZIP en `C:\laragon\www\MANTIX2.4`. Debe quedar `package.json` directamente dentro de esa carpeta; no anidar otra carpeta adicional.
4. En VS Code, abrir `MANTIX2.4`, ejecutar:

   ```powershell
   npm install
   npm run comprobar
   npm run probar:turnos
   npm run diagnostico
   npm run comprobar:navegacion
   npm run acceso:local
   ```

5. Abrir `http://127.0.0.1:3102/`, iniciar sesión con una cuenta existente y entrar al Centro del supervisor.

**No** ejecutar la migración 001 ni la migración 002 otra vez. **No** crear un administrador ni importar equipos o empleados nuevamente. Los datos anteriores permanecen en tu PostgreSQL local.

## Cambios de esta versión

- Todas las páginas de supervisor comparten navegación visible y contextual: `Mi centro`, `Mi bitácora`, `Registrar trabajo` o `Pendientes`, según la pantalla. Se quitaron enlaces repetidos que llevaban al mismo destino.
- `/bitacora` muestra la jornada operativa identificada automáticamente, carga sus registros sin exigir una fecha manual y ofrece un filtro opcional para fechas anteriores. Los trabajos no enviados ni entregados mantienen su edición controlada.
- La interfaz de Ejecución dice «Guardar mi trabajo», «Guardar trabajo» y muestra mensajes de éxito o error comprensibles, sin referencias internas a la base de datos.
- Se traducen visualmente varios estados internos (`EN_PROCESO`, etc.) a etiquetas para el usuario, sin alterar los valores en PostgreSQL.
- Administración de usuarios adopta colores oscuros/neón y devuelve al centro administrativo, conservando sus operaciones originales.
- El sistema **mantiene** la protección de permisos del servidor. No se agregaron botones ficticios ni pantallas sin ruta.

## Prueba manual esencial (supervisor)

1. Acceder como supervisor y confirmar que su centro aparece; desde él abrir **Mi bitácora**.
2. Comprobar que la bitácora abre la jornada activa y que **Mi centro** regresa a `/centro`.
3. Desde la bitácora abrir **Registrar trabajo**; comprobar los botones **Mi centro**, **Mi bitácora** y **Pendientes**.
4. Registrar un trabajo **de prueba** en la base de desarrollo: comprobar mensaje «¡Trabajo guardado correctamente!» y luego verlo en la bitácora. Evitar órdenes reales o números de Easy Maint usados por producción.
5. Abrir Pendientes y verificar que sus botones regresan a secciones que funcionan.
6. Abrir el historial y volver al centro usando su botón contextual.
7. Acceder como administrador y comprobar regreso desde **Administración de usuarios** y que el rol no muestra acciones de aprobación del jefe.
8. Probar acceso en móvil/tableta y comprobar la legibilidad de botones.

## Validación efectuada antes de entrega

- `node --check` de módulos principales, JavaScript embebido en seis páginas, rutas internas y pruebas automatizadas de rotación (A/B/C, Q1-Q5, domingo extraordinario).
- Revisión estática de los enlaces para evitar rutas inexistentes o destinos duplicados en Ejecución y Pendientes.
- **No** hubo conexión a tu PostgreSQL ni se efectuaron pruebas de guardado reales en tu instalación; esas pruebas quedan pendientes en Laragon.

## Qué hacer si algo falla

Detener el proceso, conservar la versión 2.3, compartir el mensaje de la terminal de Node y la URL donde ocurrió el fallo (sin contraseñas). No ejecutar migraciones ni reintentar guardados múltiples si no hay confirmación.
