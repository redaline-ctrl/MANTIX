# MANTIX 2.1 — Centro de mantenimiento industrial (ISYSA)

**Desarrollado por Jacqueline Reda.** Paquete unificado de desarrollo/pruebas **locales**. No es un despliegue homologado para producción ni reemplaza Easy Maint.

## 1. Qué cambia respecto a MANTIX 2.0 integral

- **Inicio de sesión industrial** con logotipo oficial de ISYSA, fondo técnico animado y crédito solicitado.
- **Navegación y portada distintas por rol**: SUPERVISOR (bitácora/órdenes/pendientes/turnos/correcciones), JEFE (revisión/Dashboard/preventivos/historial), COORDINADOR (Dashboard/historial en consulta) y ADMINISTRADOR (usuarios/catálogos/auditoría).
- **Rutas de pantalla protegidas en el servidor**; los permisos de las API también se verifican en PostgreSQL. Ocultar un botón no reemplaza permisos.
- **Bitácora diaria del supervisor**, filtrada por fecha operativa, con órdenes externas (Easy Maint) o trabajos operativos sin número, equipo(s), ejecutantes, horarios, estado y revisión.
- **Domingo:** se recomienda exclusivamente `EXTRA`; no se asigna A/B/C automáticamente; el supervisor captura hora real de inicio y completa la hora final antes de cerrar.
- **Lunes a sábado:** sugerencia de rotación A/B/C tomando como referencia el calendario confirmado de 02/11/2026 para Gerardo, Victor y Venancio. Es una recomendación que se debe comprobar contra la programación oficial. Los turnos Q1–Q5 se seleccionan manualmente según asignación.
- Se conservan las funciones de órdenes, intervenciones, continuidad, entregas, revisión, correcciones, preventivos y Dashboard del paquete integral anterior.

## 2. Instalación limpia y sin perder datos (Windows/Laragon)

1. **Detén** con `Ctrl+C` el servidor antiguo de MANTIX2.0.
2. **Respalda** la carpeta `C:\laragon\www\MANTIX2.0` y la base `mantix_desarrollo` usando el mecanismo de respaldo que prefiera TI. No borres ningún archivo de tu versión que ya funciona.
3. Extrae este ZIP en una **carpeta nueva**, por ejemplo `C:\laragon\www\MANTIX2.1`. No mezcles archivos con las carpetas antiguas.
4. Abre la nueva carpeta en Visual Studio Code y ejecuta:

   ```powershell
   npm install
   npm audit
   npm run comprobar
   npm run diagnostico
   npm run acceso:local
   ```

5. Abre `http://127.0.0.1:3102/` en tu navegador. Inicia sesión con las **cuentas existentes** de `mantix_desarrollo`. Entra al centro del rol correspondiente.
6. El puerto **3102** no puede estar ocupado por otra versión al mismo tiempo. Si aparece `EADDRINUSE`, detén la versión anterior.

**NO** vuelvas a ejecutar `admin:inicial`, la importación inicial de catálogos ni `REFERENCIA_INSTALACION_001_NO_REEJECUTAR.sql`: ya tienes las 30 tablas, 93 equipos, 41 empleados y las cuentas existentes.

## 3. Entorno y credenciales

- Conexión: `127.0.0.1:5432`, base **`mantix_desarrollo`**, esquema **`mantix`**.
- La contraseña PostgreSQL, si se requiere, debe configurarse como variable de entorno `PGPASSWORD` en tu entorno local. Nunca colocarla en HTML, Git, capturas ni enviarla por chat.
- Solo escucha en `127.0.0.1:3102`; para usarse en la red interna de ISYSA hará falta endurecer seguridad y configurar HTTPS y despliegue supervisado por TI.

## 4. Acceso según rol

| Perfil | Módulos autorizados |
|---|---|
| SUPERVISOR | Centro operativo, **Mi bitácora**, registrar orden/intervención, tomar y entregar pendientes, seguimiento, historial relacionado, turno/cierre, solicitudes de corrección, consulta de preventivos |
| JEFE | Bandeja de revisión y autorización, reprogramaciones preventivas, Dashboard e historial general |
| COORDINADOR | Dashboard e historial general en modo consulta |
| ADMINISTRADOR | Alta/baja lógica de usuarios, roles, equipos y personal, catálogos/importaciones y auditoría; **no aprueba trabajos** |

**Cada cuenta debe tener el rol correcto**, y su nombre debe corresponder al usuario vinculado al empleado real. Si una cuenta se llama `supervisor_prueba`, no debe confundirse con una persona de producción; revisa la relación desde Administración.

## 5. Reglas operativas que se mantienen

- El **número externo** proviene del flujo Easy Maint; si se requiere es obligatorio y único. **Trabajo operativo** sin número externo conserva ID interno.
- Una orden admite uno o varios equipos; cada intervención uno o varios ejecutantes. No se duplica la orden al continuar entre turnos.
- La intervención tiene su propio supervisor, fecha y horas, estados operativos y estados de revisión separados.
- Los pendientes no se reasignan automáticamente. Se entregan al cierre de turno, pueden ser retomados por cualquier supervisor autorizado y el servidor impide toma simultánea.
- El jefe aprueba o rechaza cada intervención; las correcciones requieren autorización y guardan historial de versiones.
- Los preventivos pueden ser únicos o recurrentes; el jefe autoriza reprogramaciones solicitadas.
- Dashboard: contar órdenes una sola vez y atribuir intervenciones a sus responsables. No mostrar métricas de MTTR/MTBF o disponibilidad sin denominadores y datos suficientes.

## 6. Pruebas de aceptación en el navegador (NO usar órdenes reales)

1. **Supervisor:** iniciar sesión; solo ve su centro, captura, Mi bitácora, pendientes, turnos y su historial. Confirmar ausencia de botones de administración/revisión/Dashboard. Registrar una actividad **de prueba** en un día de lunes a sábado, comprobar en bitácora por **fecha operativa**.
2. **Supervisor domingo:** elegir domingo en Mi turno; se sugiere `EXTRA`. Intentar A/B/C: servidor debe rechazarlo. Registrar EXTRA con inicio real; añadir salida y cerrar solo cuando pendientes estén entregados.
3. **Supervisor relevos:** dejar orden pendiente, entregar, iniciar sesión con otro supervisor y tomar esa **misma orden**. Debe guardar otra intervención, no otra orden.
4. **Jefe:** acceder a bandeja de revisión, aprobar/rechazar (motivo obligatorio si rechaza) y consultar Dashboard. Intentar registrar nueva orden: acceso denegado.
5. **Coordinador:** acceder a Dashboard/historial y confirmar que no puede modificar trabajos.
6. **Administrador:** administrar usuario, empleado y equipo, pero no aprobar intervención ni registrar orden.
7. Validar consultas del Dashboard frente a los totales PostgreSQL, usando registros de prueba identificables y sin duplicación.
8. Verificar que las pruebas no afecten las bases `postgres` ni `monitoreocol`.

## 7. Alcances y límites IMPORTANTES

**Implementado en código / no equivale a homologado:** módulos e interfaces de cuatro roles, bitácora, rutas, turnos extra, revisiones y preventivos. **No se ha probado este ZIP contra tu base privada**; el comando `npm run comprobar` revisa código de manera estática, no ejecuta el flujo completo de PostgreSQL.

**Pendiente de completar o verificar antes de producción:**
- El calendario **A/B/C** es solo una recomendación semanal anclada en 02/11/2026; no sustituye la asignación oficial de jefatura ni impone Q1–Q5 automáticamente. Para Q se debe modelar el intervalo de descanso 12:00–14:00 para análisis precisos de horas.
- La importación de catálogos es por **pegado tabular desde Excel**, no todavía un lector directo de `.xlsx` dentro de la interfaz.
- Las sesiones son **temporales en memoria**, se pierden al reiniciar y no son aptas para producción. Falta sesión persistente/segura, HTTPS interno, política de respaldo y pruebas de concurrencia con varios equipos.
- Los borradores locales (si están habilitados) no se consideran registros oficiales hasta recibir confirmación del servidor; deben revisarse las políticas para dispositivos compartidos.
- Automatizar completamente la rotación por colaborador, y hacer pruebas del cierre dividido Q y del seguimiento de domingo, requiere validación operativa con ISYSA.

## 8. Diagnósticos

- `npm run comprobar` — sintaxis y presencia de rutas/roles/domingos (sin acceso a DB).
- `npm run diagnostico` — verifica conexión local y tablas (solo lectura).
- `npm audit` — revisa dependencias instaladas.
- **No ejecutes** `src/server_legacy_NO_INICIAR.js` ni el archivo de referencia SQL.

Este paquete está pensado para una ronda de **pruebas funcionales integrales**, no para uso real de producción sin autorización y validación de TI.
