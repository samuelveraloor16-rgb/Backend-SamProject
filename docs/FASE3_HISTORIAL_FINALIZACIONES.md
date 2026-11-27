# Fase 3 — módulo 12, bloque 2: historial de finalizaciones (RF22)

Fecha: 2026-11-26. Base comprobada: HEAD `aeee96d2de708b0841bc8a51d6645e9800653f30`, con el bloque 1 de métricas (`docs/FASE3_METRICAS_BLOQUE1.md`) aún sin commit. Entrega local **offline**: no se aplicó la migración contra PostgreSQL real, no se ejecutó `npm test`/`pretest`/`ensure-pg`, no se instalaron dependencias y no se hizo `git add/commit/push`. No se declara RF22 ni Fase 3 completos.

Este bloque **no publica ningún endpoint nuevo**. En particular **no** se expone `GET .../ritmo` ni la estimación de término: §11 del contrato queda intacto y la numeración pública no cambia.

## Contrato previo (v1.9)

Antes del código se actualizó `docs/orquestacion/CONTRATO_API.md`:

- Cabecera con la extensión **v1.9 (2026-11-26)**.
- Nueva **§12** con: decisión de persistencia, reglas de registro, semántica de semanas lun–dom UTC, umbral de estimación (aún no implementado) y efecto sobre el contrato existente.
- Corrección en **§4**: `HECHA → HECHA` deja de reescribir `fechaFinalizacion` y no genera evento. Es el único cambio de comportamiento observable del bloque; permisos, códigos y shape de `<Tarea>` en `PATCH /tareas/:id/estado` se conservan.

No se tocaron `ESTADO`, `DECISIONES` ni `FASES` del orquestador.

## Por qué no se reutiliza `RegistroDeCambios`

`RegistroDeCambios` no sirve como diario de finalizaciones:

- `entidadId` es texto libre: no hay FK a tarea, proyecto ni usuario.
- `detalle` es `Json?` sin tipado ni validación, por lo que no se puede filtrar por estado/tipo ni por fecha de negocio fiable.
- No tiene índices por proyecto ni por fecha de ocurrencia.
- Es una tabla de auditoría compartida con RF-34 (historial de cambios de AdminWeb): mezclar ambos usos impide afirmar que sea un diario completo.
- No existe garantía append-only a nivel de base de datos.

Tampoco se hace backfill: no se derivan eventos de `Tarea.fechaFinalizacion`, `Tarea.actualizadoEn` ni de `RegistroDeCambios`. **El historial empieza a regir al aplicar la migración y desplegar el código**; las semanas anteriores se representan como *sin datos*, nunca como cero.

## Estructura de datos

### `EventoFinalizacionTarea` (`eventos_finalizacion_tarea`)

Persistencia interna, **no es recurso de la API pública**. Campos: `id`, `tareaId`, `proyectoId` (proyecto en el instante del evento), `estadoAnterior`, `estadoNuevo`, `tipo` (`FINALIZADA` | `REABIERTA`), `usuarioId`, `contable` (regla RF-11 en ese instante: `true` si la tarea no tenía subtareas) y `ocurridoEn`.

- **Sin FK** a tarea, proyecto ni usuario: el evento sobrevive al borrado físico y al movimiento, y conserva el `proyectoId` de ese momento.
- Índices: `(proyectoId, ocurridoEn)` y `(tareaId, ocurridoEn)`.
- **Append-only**: la aplicación solo inserta; el repositorio no expone update/delete. La migración instala además un trigger `BEFORE UPDATE OR DELETE` y otro `BEFORE TRUNCATE` que lanzan excepción.
- `CHECK` de coherencia: `FINALIZADA` exige `estadoNuevo = 'HECHA'` y `estadoAnterior <> 'HECHA'`; `REABIERTA` exige `estadoAnterior = 'HECHA'` y `estadoNuevo <> 'HECHA'`. Con esto la BD rechaza eventos imposibles aunque un futuro código lo intente.

### `FronteraHistorialFinalizaciones` (`frontera_historial_finalizaciones`)

Tabla de una sola fila (`id = 1`) con `desde TIMESTAMPTZ(3)`, fijada a `clock_timestamp()` **cuando se aplica la migración**. Permite distinguir «semana sin datos» de «semana con cero finalizaciones»: sin esta frontera ambas se leerían igual. **Todavía no existe código de lectura de esa frontera**; se añadió ahora porque fijarla retroactivamente después sería imposible.

### Migración

`prisma/migrations/20261126210000_rf22_historial_finalizaciones/migration.sql` — creada pero **no aplicada**. No se modificó ninguna migración anterior; el bloque 1 (métricas) no altera el esquema.

## Reglas de registro implementadas

- Las reglas puras viven en `src/dominio/metricas/historial-finalizaciones.ts` (`resolverTransicion`), sin reloj ni BD:
  - `PENDIENTE|EN_CURSO → HECHA` ⇒ `FINALIZADA` y `fechaFinalizacion = ocurridoEn`.
  - `HECHA → PENDIENTE|EN_CURSO` ⇒ `REABIERTA` y `fechaFinalizacion = null`.
  - `HECHA → HECHA` y transiciones entre estados no `HECHA` ⇒ sin evento y `NO_TOUCH`.
- `PrismaTareaRepository.cambiarEstado` ejecuta todo en **una transacción**:
  1. Lee `proyectoId` y autoriza con la ubicación actual (mismos 404/403 genéricos de siempre).
  2. Bloquea el proyecto `FOR SHARE` y la tarea `FOR UPDATE`; deriva `estadoAnterior` **dentro** de la transacción, de modo que dos `PATCH` concurrentes no inventan ni duplican transiciones.
  3. Bloquea las subtareas `FOR SHARE` y toma la fotografía `contable = (hijos === 0)`.
  4. Lee `clock_timestamp()` de PostgreSQL (reloj de BD, no del proceso) y lo usa tanto para `fechaFinalizacion` como para `ocurridoEn`.
  5. Actualiza la tarea y, si hay transición real, inserta el evento con `registrarEventoFinalizacion` en la **misma** transacción: si la inserción falla, el cambio de estado revierte.
  6. Mismo estado (`HECHA→HECHA` incluido) ⇒ **no-op total**: no se escribe la fila ni se inserta evento.
- `TareasService.cambiarEstado` ya no calcula fechas en aplicación: delega en el repositorio. `PATCH` sigue exigiendo tarea escribible y devolviendo `<Tarea>` con el mismo shape.

### Bypass cerrado

`DatosActualizarTarea` (puerto de actualización genérica) ya **no** acepta `estado` ni `fechaFinalizacion`. Antes era posible saltarse el historial con un `PATCH /tareas/:id`; ahora esas columnas solo se modifican por `cambiarEstado`, junto con su evento. El `ActualizarTareaDto` HTTP tampoco las declaraba, y el `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`) rechaza campos extra.

## Archivos exactos

Modificados:

- `docs/orquestacion/CONTRATO_API.md` (raíz del workspace): v1.9, §12 nueva y corrección de §4.
- `Backend-SamProject/prisma/schema.prisma`: enum `TipoEventoFinalizacion`, modelo `EventoFinalizacionTarea`, modelo `FronteraHistorialFinalizaciones`.
- `Backend-SamProject/src/dominio/puertos/tarea.repository.ts`: método `cambiarEstado`; `DatosActualizarTarea` sin `estado`/`fechaFinalizacion`.
- `Backend-SamProject/src/infraestructura/repositorios/prisma-tarea.repository.ts`: `cambiarEstado` transaccional con locks, reloj BD y evento.
- `Backend-SamProject/src/aplicacion/tareas/tareas.service.ts`: delegación de `cambiarEstado`.
- `Backend-SamProject/src/aplicacion/tareas/tareas.service.spec.ts`: doble con `cambiarEstado` y expectativas actualizadas.
- `Backend-SamProject/src/aplicacion/espacios/espacios.service.spec.ts` y `espacios.calendario.spec.ts`: dobles de `TareaRepository` completados con el método nuevo.

Añadidos:

- `Backend-SamProject/prisma/migrations/20261126210000_rf22_historial_finalizaciones/migration.sql`
- `Backend-SamProject/src/dominio/metricas/historial-finalizaciones.ts`
- `Backend-SamProject/src/infraestructura/repositorios/prisma-eventos-finalizacion.ts`
- `Backend-SamProject/src/dominio/metricas/historial-finalizaciones.spec.ts`
- `Backend-SamProject/src/infraestructura/repositorios/prisma-tarea.estado.spec.ts`
- `Backend-SamProject/src/interfaces/http/tareas.estado.spec.ts`
- `Backend-SamProject/docs/FASE3_HISTORIAL_FINALIZACIONES.md` (este informe)

## Verificaciones ejecutadas

Desde `Backend-SamProject`, con herramientas ya instaladas y **sin** `npm test`/`pretest`/`ensure-pg`:

```text
npx prisma validate
→ The schema at prisma\schema.prisma is valid 🚀
npx prisma generate
→ Generated Prisma Client (v7.10.1), incluye los modelos nuevos
npx tsc --noEmit
→ PASS, sin diagnósticos
npx jest --runInBand src/dominio/metricas/historial-finalizaciones.spec.ts \
  src/infraestructura/repositorios/prisma-tarea.estado.spec.ts \
  src/interfaces/http/tareas.estado.spec.ts \
  src/aplicacion/tareas/tareas.service.spec.ts
→ 4 suites, 56 tests PASS
npx jest --runInBand
→ 36 suites PASS, 2 skipped; 521 tests PASS, 44 skipped (565)
npx jest --runInBand src/aplicacion/metricas src/infraestructura/repositorios/prisma-metricas.repository.spec.ts \
  src/interfaces/http/metricas.spec.ts src/aplicacion/espacios/espacios.calendario.spec.ts
→ 3 suites, 37 tests PASS (regresión del bloque 1)
npx eslint "src/**/*.ts"
→ 0 errores, 7 warnings preexistentes (rf20.comentarios.spec.ts, rf20.persistence.spec.ts)
git diff --check
→ PASS (solo avisos LF→CRLF de Git)
```

Cobertura del bloque (`historial-finalizaciones.spec.ts` 10, `prisma-tarea.estado.spec.ts` 13, `tareas.estado.spec.ts` 3, `tareas.service.spec.ts` 30):

- Reglas puras: las cuatro transiciones con evento y fecha; los cinco mismos-estado/intermedios como no-op; `HECHA→HECHA` explícita.
- Repositorio (dobles transaccionales): evento `FINALIZADA`/`REABIERTA` con `proyectoId`, `usuarioId` y `contable` correctos; `HECHA→HECHA` sin update ni evento; `contable=false` con subtareas; fallo de inserción revierte el cambio de estado; movimiento/borrado no reescriben eventos; foto tomada antes de la actualización.
- HTTP: `PATCH /tareas/:id/estado` conserva 200, 400 por estado inválido, 401 sin token, 404 genérico y shape de `<Tarea>`.

## Límites y pendientes

- **La migración no se aplicó**: el trigger anti-mutación, el `CHECK` de coherencia y los índices son SQL offline; no se probaron contra PostgreSQL real. `prisma validate`/`generate` no sustituyen una prueba de migración.
- Los dobles serializan transacciones con cola FIFO y restauran estado al fallar; **no acreditan locks, aislamiento ni rollback reales** de PostgreSQL.
- Limitación conocida: una tarea finalizada mientras tenía subtareas registra `contable = false`. Si más tarde se queda sin subtareas, el pasado **no** se reinterpreta (decisión explícita: la foto es del instante).
- La frontera existe pero **no hay lector** todavía; el cálculo de ritmo, la estimación y el endpoint de §12.4 quedan para el siguiente bloque.
- Sigue abierto el pendiente de Fase 2 preservado: RF-19/20/21, SMTP no operativo y migraciones sin aplicar.
- Sin frontend, sin AdminWeb, sin IA, sin gráficas y sin `git add/commit/push`. El orquestador decide aceptación y publicación.
