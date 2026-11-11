# Preparación del servidor

El repositorio contiene la versión funcional vigente en una sola raíz. Esta limpieza no publica el servicio ni cambia su configuración local. No equivale a una homologación de producción.

## Lo que ya está organizado

- Servidor actual y rutas protegidas por rol.
- Instalación reproducible mediante `npm ci` y `package-lock.json`.
- `npm start` como acceso estándar al mismo servidor que `acceso:local`.
- Migraciones 002, 003 y 004, esquema de referencia y pruebas de los módulos.
- Archivos de ejecución y documentación seleccionados por `scripts/preparar_paquete.js`.
- Exclusión de dependencias instaladas, artefactos de prueba, logs, respaldos, secretos y comprimidos del seguimiento normal de Git.

## Configuración pendiente en el servidor autorizado

Antes de habilitar usuarios reales hay que conocer el sistema operativo, la dirección de acceso y la base que se utilizará. Debe prepararse una copia de validación y confirmar:

1. **Acceso HTTP y HTTPS.** El servidor escucha actualmente en `127.0.0.1:3102` y valida las escrituras contra el origen exacto `http://127.0.0.1:3102`. Un dominio o un proxy inverso no funcionará para las escrituras sin adaptar y verificar esta configuración. No abrir todos los orígenes para resolverlo. El uso de cookies seguras debe acompañar el HTTPS definitivo.
2. **PostgreSQL.** El código local fija `mantix_desarrollo` y utiliza `PGHOST`, `PGPORT`, `PGUSER` y `PGPASSWORD`. No basta con definir `PGDATABASE` para cambiar la conexión de la aplicación. Se debe acordar y adaptar la conexión del servidor, los permisos y los respaldos. `.env.example` no se carga automáticamente.
3. **Base existente.** La aplicación necesita el esquema `mantix` con sus 31 tablas. Los registros se trasladan con un respaldo autorizado, fuera de Git. La referencia 001 no se ejecuta sobre una base existente; la 002 corresponde a la preparación inicial ya realizada. El inicio aplica 003 y 004 de forma repetible.
4. **Servicio y reinicio.** Instalar Node.js y configurar el arranque y reinicio mediante el gestor del servidor. Las sesiones actuales viven en memoria: reiniciar obliga a iniciar sesión nuevamente. Si se habilitan varias instancias habrá que compartir las sesiones antes de usarlas en paralelo.
5. **Validación desde las computadoras reales.** Probar acceso, roles, dos supervisores tomando un mismo trabajo, continuidad, cierre, revisión, corrección, Dashboard y exportaciones con la URL final. Verificar también restauración de respaldo y registros de errores.

Estas adaptaciones pertenecen al despliegue. No se introdujeron cambios de negocio, de base ni de exposición de red durante la limpieza.

## Paquete para traslado

Desde la raíz:

```sh
npm run paquete:servidor
```

Se genera `dist/mantix-servidor.tar.gz`, ignorado por Git. Requiere el comando `tar` disponible (Linux y versiones actuales de Windows lo incluyen). El paquete contiene una carpeta MANTIX con el código, `package.json`, `package-lock.json`, migraciones, plantilla de variables y documentación. No incluye `node_modules`, pruebas, evidencias generadas ni archivos privados. Al extraerlo, ejecutar `npm ci --omit=dev` dentro de MANTIX.

Para disponer de las pruebas se utiliza el repositorio completo, no el paquete de ejecución. En ambos casos debe configurarse el servidor antes de considerarlo producción.

## Pruebas del repositorio

Las comprobaciones estáticas no necesitan escribir en PostgreSQL:

```sh
npm run comprobar
npm run comprobar:navegacion
npm run probar:turnos
```

Las pruebas de integración requieren copias desechables:

- `mantix_revision_test`: administración, programación, supervisor y revisión.
- `mantix_dashboard_test`: Dashboard.

Configurar las variables PG para esas copias y usar los comandos `test:administracion`, `test:programacion`, `test:supervisor`, `test:revision` y `test:dashboard`. Las pruebas se niegan a ejecutarse con otros nombres de base. Las variantes de navegador requieren Playwright y Chromium disponibles como herramientas de prueba; no son dependencias de ejecución de la aplicación.

Las capturas y exportaciones van a `artifacts/` por defecto, o al directorio configurado en `MANTIX_ARTIFACTS_DIR`. No se necesitan rutas `/workspace` ni Python para comprobar la navegación.
