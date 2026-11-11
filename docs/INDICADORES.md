# Indicadores de MANTIX

El Dashboard lee la misma base que la bitácora. Sus fórmulas se conservan en esta limpieza.

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
