# MANTIX

Sistema de bitácora y seguimiento de mantenimiento industrial de ISYSA. Incluye supervisores, revisión del jefe, consulta del coordinador, administración de usuarios y catálogos, programación interna, pendientes entre turnos y Dashboard.

Este repositorio contiene un solo sistema. `package.json` está en la raíz; ya no hay que buscar una carpeta de versión ni extraer otro ZIP dentro del proyecto.

## Estructura

| Ruta | Contenido |
|---|---|
| `tools/` | Servidor, pantallas y módulos actuales. |
| `public/` | Logotipo utilizado por la aplicación. |
| `database/` | Migraciones y referencia de esquema. No contiene respaldos ni registros operativos. |
| `tests/` | Pruebas de módulos, permisos, navegación y cálculos. |
| `docs/` | Operación, indicadores, verificación y preparación del servidor. |

## Ejecutar la instalación local actual

Requiere Node.js 22 o superior y la base existente `mantix_desarrollo`, esquema `mantix`, con la preparación previa de 31 tablas. Las dependencias se instalan desde el archivo de bloqueo:

```sh
npm ci
npm run comprobar
npm run comprobar:navegacion
npm run probar:turnos
npm run diagnostico
npm start
```

Los comandos de comprobación anteriores corresponden al repositorio completo. El paquete de traslado no incluye `tests/`: sus pruebas se ejecutan antes de empaquetarlo, y en el destino se utiliza la instalación descrita en [Despliegue](docs/DESPLIEGUE.md).

Abrir http://127.0.0.1:3102/ y dejar la terminal del servidor abierta. `npm start` y `npm run acceso:local` ejecutan el mismo servidor. El programa usa variables de entorno PG; **no carga `.env` automáticamente**. `.env.example` documenta las variables sin incluir contraseñas.

Al iniciar prepara las migraciones repetibles 003 y 004. No restaura datos, no crea una base nueva ni ejecuta la instalación de referencia. No repetir la migración 002 en una base ya preparada, importar los antiguos catálogos ni crear otro administrador para actualizar una instalación existente.

## Actualizar la carpeta en Laragon

1. Conservar la instalación anterior y un respaldo de la base fuera de Git.
2. Descargar el repositorio desde `main` y extraerlo en una carpeta nueva, por ejemplo `C:\laragon\www\MANTIX`. Dentro deben estar directamente `package.json`, `tools`, `public`, `database` y `tests`.
3. Reutilizar las variables PG de la instalación anterior y ejecutar las comprobaciones de arriba.
4. Detener el servidor anterior con Ctrl+C. Ejecutar `npm start` desde la carpeta nueva y actualizar el navegador con Ctrl+F5.

La limpieza de carpetas no cambia los registros ni las reglas de trabajo.

## Documentación

- [Operación por rol](docs/OPERACION.md).
- [Definiciones del Dashboard](docs/INDICADORES.md).
- [Revisión funcional](docs/VERIFICACION.md).
- [Preparación y límites del despliegue](docs/DESPLIEGUE.md).

**Estado para servidor:** el código está organizado para trasladarlo y generar un paquete. La configuración actual sigue siendo local: dominio, HTTPS, origen permitido y conexión a la base del servidor deben prepararse y probarse antes de habilitar el acceso real de varios usuarios. Véase la guía de despliegue.
