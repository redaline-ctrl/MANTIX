# MANTIX 2.4 · Dashboard integral

Esta entrega conserva la bitácora y el módulo de revisión. Reemplaza el Dashboard básico por un único tablero con cuatro áreas: mantenimiento, supervisores, trabajadores y revisiones. No agrega tablas ni cambia los registros de trabajo.

## Instalar en Laragon

1. Conserva una copia de tu carpeta actual y un respaldo actualizado de `mantix_desarrollo`.
2. Descarga la rama `codex/bitacora-turno` desde GitHub, con Code → Download ZIP. Utiliza la carpeta **MANTIX2.4** que contiene esta guía.
3. Extrae esa carpeta a un destino nuevo, por ejemplo `C:\laragon\www\MANTIX2.4_DASHBOARD`, dejando `package.json` directamente dentro. Conserva tu instalación anterior.
4. Abre la nueva carpeta en VS Code y reutiliza las mismas variables de conexión PG de tu instalación. No compartas contraseñas ni las guardes en Git. El programa no lee `.env` automáticamente.
5. Ejecuta `npm ci`, `npm run comprobar`, `npm run probar:turnos`, `npm run comprobar:navegacion` y `npm run diagnostico`. El diagnóstico de la base 2.4 debe confirmar 31 tablas.
6. Detén el servidor anterior con Ctrl+C y ejecuta `npm run acceso:local` en la nueva carpeta. Se conserva la preparación repetible de la migración 003 del módulo de revisión; el Dashboard no requiere otra migración.
7. Abre http://127.0.0.1:3102/ y pulsa Ctrl+F5. Ingresa como jefe o coordinador y abre **Dashboard**. Los supervisores no tienen acceso al tablero global.

No ejecutes de nuevo la instalación 001, la migración 002, importaciones de catálogos ni la creación de administrador para instalar este tablero. Si aún no instalaste el módulo de revisión, consulta también ACTUALIZACION_REVISION.md.

## Uso

El centro del jefe y del coordinador no tiene barra lateral ni un menú que repita las tarjetas. El jefe tiene una entrada por tarea: revisión de trabajos, indicadores, programación preventiva y consulta de órdenes. El coordinador tiene indicadores y consulta de órdenes. Dentro de cada pantalla hay un único acceso para volver al centro.

El Dashboard muestra una sola área a la vez mediante cuatro pestañas: Mantenimiento, Supervisores, Trabajadores y Revisiones. Cambiar de pestaña conserva los filtros. Mantenimiento comienza con cuatro indicadores principales; el detalle de actividad, programación, horas, confiabilidad y fórmulas se despliega cuando se necesita. El acceso del jefe a resolver reportes está dentro del área de Revisiones.

Selecciona un periodo de hasta un año, supervisor, equipo, tipo, turno o estado operativo. Los filtros actualizan los indicadores automáticamente; también puedes pulsar Consultar. Este mes, Este año y Limpiar filtros ofrecen accesos rápidos.

El filtro de trabajador afecta solo al área de personal y a su detalle. No cambia los indicadores generales de mantenimiento ni de supervisores. Pulsa el nombre de un supervisor o trabajador para consultar sus intervenciones. Puedes ordenar a los trabajadores por órdenes con participación, horas-hombre medidas o intervenciones aprobadas.

Las cuatro áreas muestran:

- **Mantenimiento:** órdenes únicas, intervenciones, terminadas, validadas, programación preventiva interna, cumplimiento, backlog actual y antigüedad. Distribución por tipo entre órdenes validadas, programación mensual, intervenciones mensuales y equipos atendidos.
- **Supervisores:** órdenes en las que participaron, intervenciones, terminadas, aprobadas, rechazadas, por revisar, horas registradas, aprobación y rechazo.
- **Trabajadores:** identidades oficiales únicas, relaciones trabajador–orden, intervenciones, horas-hombre medidas y cobertura de horas individuales. Se distinguen participaciones preventivas, correctivas y operativas según el tipo real de la orden. Un rechazo no se interpreta como culpa individual.
- **Revisiones:** estado actual de las intervenciones del periodo y tiempo medio de respuesta donde existen marcas de tiempo completas.

## Definiciones de los cálculos

**Órdenes e intervenciones.** La actividad se filtra por fecha operativa. Una orden atendida en varios turnos sigue contando una sola vez en el total de órdenes. Cada intervención conserva su supervisor real y turno vinculado. Las órdenes atribuidas a varios supervisores o equipos no deben sumarse para obtener el total general.

**Terminada frente a validada.** Una última intervención terminada no equivale a aprobación. Para considerar validada la orden, su última intervención debe estar terminada y aprobada y no debe haber otra intervención terminada sin validar. Una nueva continuidad pendiente impide considerar la orden validada. No se modifica el estado operativo almacenado para presentar estos indicadores.

**Programación.** La única fuente disponible de trabajos programados aún sin ejecutar es `ocurrencias_preventivas`, vinculada con los planes de la agenda interna. Se cuentan ocurrencias según la fecha original, excluyendo canceladas. No se presume que todas las órdenes de Easy Maint o indicaciones verbales estén incluidas en esa agenda. Si filtras por supervisor o turno, no es posible atribuir a esa persona o turno las programaciones que todavía no tienen intervenciones vinculadas.

**Cumplimiento.** Programaciones vinculadas a órdenes validadas, con finalización y aprobación registradas hasta la fecha final, divididas entre las programaciones válidas del periodo × 100. Una ocurrencia marcada COMPLETADA pero aún sin aprobación no cuenta como cumplida. Si no hay programación, aparece N/D. Se evalúa con los datos y versiones actuales; no reconstruye una fotografía inmutable de cierres históricos.

**Backlog.** Son órdenes actualmente sin validación final con origen hasta la fecha final; incluye las heredadas. Las programaciones aún sin orden se muestran aparte. No equivale simplemente a programadas menos aprobadas. El estado es el actual, no una reconstrucción de cómo estaba cada orden en un cierre pasado. Para antigüedad se usa la primera fecha operativa conocida o, si no hay intervenciones, la creación de la orden; no se proyectan días futuros. Una orden se considera vencida solo si tiene una fecha de programación vencida, no por tener muchas horas de reparación.

**Horas.** Solo se suman intervalos reales completos. En Q1–Q5 se descuenta la pausa de 12:00 a 14:00, usando la zona operativa de Mérida. No se inventan finales para intervalos abiertos. La suma de actividades simultáneas no debe interpretarse como tiempo exclusivo de ocupación del supervisor o equipo.

**Horas-hombre.** Solo se suman horas individuales de `intervencion_ejecutantes`. No se multiplica automáticamente la duración total del trabajo por el número de personas. Los valores parciales se llaman horas-hombre medidas y muestran cobertura; sin horas individuales aparece N/D. Una participación corresponde a un trabajador y una orden; varias intervenciones de ese trabajador en la misma orden se cuentan una vez como participación y varias veces como intervenciones.

**Aprobación y revisión.** Aprobadas ÷ (aprobadas + rechazadas) × 100. Rechazo = rechazadas ÷ (aprobadas + rechazadas) × 100. Se excluyen los pendientes del denominador. Los indicadores reflejan el estado actual de las intervenciones, no el número total de decisiones históricas. El tiempo medio usa envío y resolución de la versión actual con fechas conocidas. Los datos históricos sin fechas no se sustituyen con la fecha de creación ni con la fecha actual.

**Confiabilidad.** MTTR, MTBF y disponibilidad aparecen como N/D. La base 2.4 no identifica de manera suficiente las reparaciones por falla, las horas reales de operación ni los paros por falla. OPERATIVO no se interpreta como CORRECTIVO. No se usa la duración media de todos los trabajos como MTTR. Las fórmulas quedan visibles: MTTR = horas de reparación por falla ÷ reparaciones por falla; MTBF = horas de operación ÷ fallas; disponibilidad = horas de operación ÷ (horas de operación + horas de paro por falla) × 100. Sin los datos necesarios no se calcula un porcentaje ficticio.

## Excel y PDF

Exportar Excel genera un `.xlsx` real con siete hojas: Resumen, Supervisores, Trabajadores, Intervenciones, Programación, Backlog y Distribuciones. Incluye criterios, filtros y gráficas vinculadas a los datos cuando hay información. Los textos se escriben como cadenas, no como fórmulas.

PDF / Imprimir abre el diálogo del navegador; elige Guardar como PDF. La versión imprimible incluye tablas completas y gráficas de todas las áreas, aunque solo una pestaña esté visible. Excel también incluye todas las áreas. Excel y PDF usan la respuesta que ya se muestra en pantalla: no ejecutan otra consulta que pueda traer valores diferentes. Los resultados corresponden a esa consulta; para obtener datos más recientes, vuelve a consultar.

## Validación y límites

Se probaron con PostgreSQL 18 y cuentas temporales: permisos de jefe/coordinador, exclusión de supervisores/administradores, relaciones sin duplicación, relevos, cumplimiento sujeto a aprobación, backlog heredado, pausa Q, horas individuales parciales, filtros, fechas inválidas, periodos vacíos, nueva continuidad y exportación. Chromium verificó detalles, filtros automáticos, pestañas con una sola área visible, conservación de filtros, navegación sin destinos duplicados, Excel, PDF y vista móvil. Se comprobó también que OPERATIVO y CORRECTIVO se calculan por separado y que aprobación y rechazo excluyen los pendientes. Los archivos Excel se validaron además con un lector independiente y el PDF con extracción de texto.

Para repetir pruebas crea una copia desechable llamada `mantix_dashboard_test`, configura PGDATABASE y las variables PG para esa copia y ejecuta `npm run test:dashboard`. El puerto 3102 debe estar libre. DASHBOARD_BROWSER=1 habilita el navegador si Playwright y Chromium ya están instalados (CHROMIUM_PATH permite indicar la ruta). No se ejecuta contra otro nombre de base. No son dependencias adicionales de la aplicación.

El módulo es de solo lectura. Las pruebas no modificaron la base de desarrollo. No se realizaron pruebas de carga ni una homologación de producción. No se publicó el sistema ni se actualizó automáticamente la instalación de Laragon.
