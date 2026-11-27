# RF22 — Lector semanal seguro (entrega parcial local)

Responsable: backend. Fecha: 2026-11-26. Contrato v1.10 §13 escrito antes del código. **No es ritmo operativo ni RF22 completo.**

## Requisitos leídos y preservación

Leídos AGENTS.md raíz, DERCAS_SamProject_Movil.docx completo (extracción XML en memoria), ADICENDUM_DERCAS_v1.2.md y contrato v1.9 §11–12. Recuperados mem_current_project, mem_context y observaciones completas de contexto-general/adminweb-scope. Precedencia del adicendum respetada. No se auditó el panel ni se rehízo historial existente.

Árbol backend inicialmente dirty de métricas/historial preservado. No se tocó frontend/AdminWeb, schema, migraciones, dependencias, BD real ni escritor. Sin install, npm test/pretest/ensure-pg, migraciones aplicadas, envíos, git add/commit/push. Solo pruebas offline con dobles y HTTP sobre módulo Nest aislado, no AppModule productivo.

## Implementado

- GET `/api/v1/proyectos/:id/metricas` conserva campos base RF11/RF15 y añade `ritmo: {disponible:false, motivo:"COBERTURA_NO_ACREDITADA"}`. Sin endpoint nuevo, promedio, estimación ni conteos semanales públicos. Clientes no recalculan.
- Puerto de instantánea reemplaza lectura exclusiva de contables: reloj BD `statement_timestamp()` único, permiso/proyecto, tareas, frontera y agregados dentro del mismo RepeatableRead. `calculadoEn` ahora procede de BD, no reloj de proceso. No promete tiempo real ni timestamp de commit.
- SQL parametrizado por proyecto autorizado y `[inicio, corte)`, cuatro semanas cerradas anteriores más actual; agrupa lunes UTC en BD, máximo cinco filas. Sin carga ilimitada de eventos ni N+1. El filtro temporal y el índice existente proyecto/ocurridoEn acotan candidatos; costo depende del volumen de esa ventana (sin EXPLAIN ni prueba real de rendimiento).
- Solo FINALIZADA contable=true, sin joins a tareas actuales. REABIERTA no resta; recompletaciones suman eventos; padres no contables excluidos según fotografía RF11, subtareas contables incluidas sin reinterpretar estructura actual; movimientos/borrados no quitan ni reatribuyen eventos. Archivados consultables, ajenos/eliminados 404 e aislamiento por membresía del espacio existente.
- Calculadora pura interna clasifica cinco semanas: SIN_EVIDENCIA, SIN_DATOS, PARCIAL, COMPLETA e INCOMPLETA. Cero únicamente en semana completa cerrada con evidencia continua; anterior/parcial/sin evidencia devuelve null. La actual siempre tiene cerrada=false y conteo no publicado. No calcula promedio/divisor/estimación. Una prueba puede proporcionar evidencia explícita para probar clasificación; eso NO habilita evidencia productiva.

## Bloqueos exactos — partes detenidas

1. **Cobertura no acreditada:** frontera existente se fija con reloj al aplicar migración. No acredita que todos los escritores estén activos ni continuidad, rolling deploy, escritores antiguos o gaps. No se infiere cobertura del primer evento, fecha actual, edad de proyecto ni de fecha de migración. El adaptador siempre entrega `coberturaAcreditada:false`; no hay flag de entorno ni bypass público. Falta regla operativa y evidencia verificable de continuidad/gaps; no se inventó una frontera nueva ni se alteró la existente.
2. **DERCAS §5 exacto:** «Ritmo = promedio de tareas completadas por semana en las últimas 4 semanas» y «Menos de 2 semanas de historial o 0 tareas completadas → no se estima, se informa». §12.4 precisa dos semanas UTC completas cerradas. No define divisor para solo 2/3 semanas disponibles frente a ventana 4. No define si cero impide publicar ritmo o solo estimación. **Promedio, rama disponible=true, política de cero y estimación detenidos**, pendientes decisión explícita. No se rellenan semanas sin datos con ceros. Incluso con cuatro semanas acreditadas, esta entrega no activa promedio.
3. **Verificación real pendiente:** SQL, aislamiento, reloj, concurrencia, rollback y continuidad del despliegue no acreditados por dobles. No se aplicaron migraciones existentes.

No se publican cifras/indicador de ritmo antes de dos semanas cerradas verificables; en este modelo tampoco se pueden acreditar esas dos semanas. La API devuelve indisponibilidad explícita, no cero ficticio.

## Pruebas y comandos ejecutados

Desde `Backend-SamProject`, sin hooks npm:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/dominio/metricas/ritmo-semanal.spec.ts src/dominio/metricas/historial-finalizaciones.spec.ts src/infraestructura/repositorios/prisma-ritmo-semanal.spec.ts src/infraestructura/repositorios/prisma-metricas.repository.spec.ts src/infraestructura/repositorios/prisma-tarea.estado.spec.ts src/interfaces/http/metricas.spec.ts src/interfaces/http/tareas.estado.spec.ts
# PASS: 70 pruebas / 7 suites

node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/dominio/metricas/progreso.spec.ts src/dominio/metricas/ritmo-semanal.spec.ts src/dominio/metricas/historial-finalizaciones.spec.ts src/aplicacion/tareas/tareas.service.spec.ts src/aplicacion/espacios/espacios.service.spec.ts src/aplicacion/espacios/espacios.calendario.spec.ts src/infraestructura/repositorios/prisma-ritmo-semanal.spec.ts src/infraestructura/repositorios/prisma-metricas.repository.spec.ts src/infraestructura/repositorios/prisma-tarea.estado.spec.ts src/interfaces/http/metricas.spec.ts src/interfaces/http/tareas.estado.spec.ts
# PASS: 145 pruebas / 11 suites (incluye las 70 anteriores, no sumarlas)

node node_modules/typescript/bin/tsc --noEmit
# PASS
node node_modules/eslint/bin/eslint.js "src/**/*.ts" eslint.config.mjs --no-error-on-unmatched-pattern
# PASS: 0 errores, 7 warnings previos no-explicit-any en rf20.comentarios.spec.ts y rf20.persistence.spec.ts
git diff --check
# PASS; avisos de normalización LF/CRLF de archivos locales preexistentes
```

Cobertura focalizada: lunes00/domingo23:59:59.999/lunes siguiente/corte exclusivo; actual incompleta; frontera lunes/mitad/ausente/no acreditada; 0/1/2/3/4/>4 semanas; vacías observadas vs sin datos; reapertura/recompletación/contable false y fotografía independiente de población actual; tareas borradas/movidas, archivados, ajenos/eliminados/aislamiento, payload base/progreso y regresión de historial/transiciones. El doble del lector inspecciona texto/parametrización y emula agrupación: **no demuestra que PostgreSQL ejecute correctamente ese SQL**. No se implementaron ni probaron divisores o estimación inventados.

## Archivos del incremento

- `src/dominio/metricas/ritmo-semanal.ts` y `.spec.ts`: calendario/clasificación interna y disponibilidad pública cerrada.
- `src/dominio/puertos/metricas.repository.ts`: instantánea con corte/contables/historial.
- `src/infraestructura/repositorios/prisma-metricas.repository.ts`, `.spec.ts` y `prisma-ritmo-semanal.spec.ts`: lector agregado y regresión.
- `src/aplicacion/metricas/metricas.service.ts`: consume instantánea y añade indisponibilidad.
- `src/interfaces/http/metricas.spec.ts`: shape aditivo y permisos/errores conservados.
- `../docs/orquestacion/CONTRATO_API.md`: extensión v1.10 §13 y aviso superior, sin reescribir historia de §11–12.

## Registro de orquestación pendiente por permisos de herramienta

Se intentó añadir exclusivamente sección nueva RF22 a ESTADO.md y DECISIONES.md por delegación, junto con aviso de versión del contrato. El lote fue rechazado por la herramienta con `Permission denied: edit`; ningún archivo de ese lote cambió. El aviso del contrato se aplicó luego de forma independiente porque ese archivo sí está autorizado. **No se reintentó ni se eludió la protección de ESTADO/DECISIONES.** Orquestador debe registrar allí: responsable backend, lector/calculadora parcial local, 145 pruebas/11 suites, tsc/lint/diff-check y los bloqueos 1–3 anteriores, sin alterar historia ni declarar ritmo listo.
