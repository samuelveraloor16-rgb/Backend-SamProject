# Módulo 15 — Historial general, bloque backend integrado

2026-11-27. Sustituye el informe parcial anterior: se completó la integración de
escritores y lectores solicitada. **Verificado offline; NO desplegado ni acreditado
con PostgreSQL real.** No se aplicó la migración. No activar este código sobre el
schema antiguo: sus escrituras requieren las columnas/constraints nuevas.

## Alcance y fuentes

AGENTS raíz (sin AGENTS local encontrado), DERCAS docx completo por extracción de
word/document.xml, adicendum prioritario, contrato v1.13 §16 completo, diseño local
y memorias contexto-general/adminweb-scope leídos. Solo Backend-SamProject cambió.
`docs/MODULO15_DISENO_CONTRACTUAL.md` preexistente se conservó intacto; contrato,
ESTADO/DECISIONES y clientes no se modificaron. Sin nuevas dependencias,
instalaciones, BD/servicios, migraciones aplicadas, Git add/commit/push,
almacenamiento/scanner/adjuntos nuevos, outbox/worker nuevos ni purga automática.

## API conectada

- `GET /api/v1/proyectos/:id/historial`
- `GET /api/v1/tareas/:id/historial`

Registradas en AppModule mediante HistorialController y puerto HistorialRepository.
JWT con JwtAuthGuard y estrategia existente. ADMINISTRADOR/MIEMBRO actuales por
espacio; ProyectoMiembro no restringe. Proyecto archivado permite lectura.
Inexistente/ajeno/borrado/vínculo no verificable → 404 `Recurso no encontrado`.
Primero recurso actual; luego validación de body/query; luego clave/cursor/página.
No se habilita consulta de recursos borrados por contexto durable.

Query exclusiva `limite` decimal 1–100 (20 default) y `cursor`; body ausente/vacío.
400 para campos extra, límite inválido, cursor malformado, manipulado, scope
distinto, corte futuro o corte anterior a ventana180d. Respuesta allowlist §16.6:
`datos` y `meta:{limite,siguienteCursor}`; sin total, offset, filtros ni campos ORM.

El SQL aplica **antes de LIMIT** versión tipada, detalle allowlist, contexto,
referencias actuales del mismo espacio y retención. Orden descendente
`(creadoEn,id)`, consulta `limite+1`; tarea no agrega subtareas implícitamente.
Proyecto incluye contextos origen/destino del movimiento y eventos propios de
tareas/subtareas; no reatribuye pasado al proyecto nuevo. Movimientos solo se
publican si ambos proyectos siguen verificables en el mismo espacio actual.
De una tarea eliminada se admite solo el evento mínimo ELIMINADO en proyecto
vivo; los eventos previos con referencia ya no verificable se ocultan. GET de la
tarea borrada continúa404. Sin nombres ni contenido de recursos borrados.

## Cursor y corte concurrente

No existía codec de cursor reutilizable; el HMAC de comentarios existente es
específico de huellas/idempotencia de comentarios y no se reutilizó como secreto.
Codec nuevo con **AES-256-GCM autenticado (AEAD)**: opaco, integridad autenticada,
IV aleatorio y versión interna. No JWT ni credencial de acceso. Payload interno
solo versión, scope ruta/recurso/espacio/usuario/límite, corte BD y última pareja.
Ni JWT, ni clave, ni texto libre en payload. Scope comprobado cada página y
autorización repetida; membresía revalidada bajo FOR SHARE durante la página.

`HISTORIAL_CURSOR_SECRET` es configuración exclusiva del servidor, independiente
de JWT; `.env.example` contiene solo valor vacío. Sin configuración →503 genérico
tras autorización y validación, incluso página vacía. Rotación invalida cursores.
Pruebas usan claves exclusivamente de test; no se creó credencial productiva.

El límite propuesto2048 no se convirtió en política aprobada. La entrada se acota
por el tamaño **derivable del formato serializado**: scope conocido, dos ISO24,
ID de registro máximo36 (UUID generado por escritor), versión y overhead AEAD.
Se verifica la cota antes de decodificar; no se acepta longitud ilimitada.

Fence transaccional advisory151613: append toma shared antes del reloj BD y lo
conserva hasta commit; lector toma exclusive y luego hace las lecturas bajo
ReadCommitted (no snapshot anterior a la espera del fence). Nunca toma locks de
proyectos/tareas después del fence. Los escritores mantienen su orden de locks
de negocio y no se reintenta un commit ambiguo. El límite superior es corte
**exclusivo** en precisión milisegundos; evita incluir nuevas inserciones del
mismo milisegundo. Escrituras pendientes que aún no alcanzaron append obtienen
su reloj después del lector. Esta coordinación está en código; su funcionamiento
real multi-conexión y rendimiento requieren prueba SQL autorizada.

No snapshot fijo entre páginas: permisos/purga pueden reducir resultados. Corte
superior se conserva en cursor; retención inferior usa reloj BD actual de página,
`creadoEn >= ahoraBD-180d` (igualdad incluida). Un corte ya vencido obliga reinicio.

## Matriz de escrituras conectadas

Todas usan appendHistorial con **TransactionClient de la misma transacción de
negocio**. No callbacks postcommit. Error de append revierte negocio; error
posterior revierte append. Los tests de copia de estado verifican este contrato
del adaptador, no el motor PostgreSQL.

| Operación | Integración / exclusión mutua / evento |
|---|---|
| Crear proyecto | Puerto recibe actor; tx, workspace SHARE, usuarios ordenados KEY SHARE y membresías SHARE; valida membresía vigente y miembros seleccionados; CREADO. |
| Editar proyecto/miembros | Proyecto UPDATE→usuarios ordenados→membresías SHARE; lee valores/conjuntos bajo lock, valida fechas actuales, EDITADO solo nombres changedFields efectivos. |
| Reemplazar miembros (puerto técnico) | Delega al mismo escritor autorizado de edición con actor, no bypass sin auditoría. |
| Archivar/desarchivar | Puerto recibe actor; tx con proyecto UPDATE y membresía actual SHARE; preserva prohibición Bandeja; evento ARCHIVADO/DESARCHIVADO solo si cambia. |
| Eliminar proyecto | Tx proyecto UPDATE→usuario→membresía SHARE con rol ADMINISTRADOR vigente; no amplía permiso delete; Bandeja no eliminable. Bloquea tareas ordenadas, captura ELIMINADO por tarea/subtarea y proyecto antes de cascada. Proyecto archivado conserva permiso de borrado original. |
| Crear tarea / rápida | Misma tx existente de asignación/in-app/outbox y autorización/archivo; CREADO antes de commit. Rápida reutiliza escritor y proyecto Bandeja existente. |
| Crear subtarea | Tx ubicación actual/proyecto SHARE/padre UPDATE/usuarios/membresías; CREADO contextual. Crear con padre por puerto genérico redirige aquí, sin bypass. Etiquetas en misma tx. |
| Editar tarea/etiquetas | Ubicación revalidada y fila UPDATE; lee valores/etiquetas bajo lock; EDITADO solo diferencias efectivas, conjunto orden-independiente. Misma tx de asignación/outbox. |
| Cambiar estado | Preserva lectura bajo lock, no-op, fechaFinalizacion y foto RF11. Un ESTADO_CAMBIADO general por transición; exactamente un dedicado FINALIZADA/REABIERTA cuando corresponde, misma tx; normales no generan dedicado. |
| Mover padre/subtareas | Proyectos ordenados SHARE, fila padre UPDATE, autorización de ambos espacios actuales y prohibición entre espacios; hijas ordenadas UPDATE y contexto verificado; MOVIDO por padre e hija, origen/destino capturados sin reescribir pasado. No-op no genera. |
| Eliminar tarea/subtareas | Puerto recibe actor; ubicación revalidada en tx, proyecto SHARE, tarea UPDATE, membresía actual y archivo; hijas ordenadas UPDATE y contexto verificado; ELIMINADO por fila antes de cascada. Miembro conserva permiso original. |
| Bandeja de registro | CREADO de proyecto dentro de tx original que crea usuario/espacio/membresía; actor nuevo, sin copiar nombre/email. |
| Bandeja de nuevo espacio | CREADO de proyecto dentro de tx original de espacio/membresía admin, con actor creador. |

No-op de edición, archivo y movimiento no escribe auditoría. Repetir HECHA no
reescribe fecha ni diario. Crear entidades no adquiere idempotencia nueva no
definida por contrato; no se prometió deduplicar nuevas intenciones POST.

## Persistencia, privacidad y compatibilidad

Reutiliza RegistroDeCambios, no diario RF22. Columnas nuevas nullable para versión,
tipo actor y contexto durable workspace/proyecto/tarea/origen/destino sin FK
destructivas a entidades. Usuario conserva FK nullable SetNull existente, sin foto
histórica de identidad. Reloj DB UTC con precisión milisegundos, no reloj cliente;
se conserva tipo timestamp legado sin reinterpretar sus fechas.

Migración expansiva transaccional offline, índices keyset por contexto/fecha/id y
retención. Función SQL allowlist total usada por CHECK y lector antes de LIMIT;
constraints versión/actor/entidad/acción/contexto. Para este bloque solo se
acreditan acciones de proyecto/tarea; no se habilitan eventos de adjuntos.
Legacy `versionHistorial=NULL` queda intacto y excluido; sin backfill de updatedAt,
sin validar historia antigua ni fabricar cobertura.

Detalles: vacíos en create/delete/archive; edición nombres enum, sin valores;
estado enums anterior/nuevo; movimiento IDs resueltos contra contexto y proyectos
actuales. Sin nombres, títulos, descripciones, filenames, emails, passwords,
tokens, comentarios, URLs, rutas ni secretos en detalles o nuevas trazas.

Retención general180d solo lectura; sin purga, cron ni nueva capacidad de purga
activada. Historial sobrevive eliminación de tareas/proyectos/espacios y baja
del actor por ausencia de FK destructivas y SetNull existente. Esto no prueba
ejecución real de FK. No se añadieron triggers ni roles de BD ni se afirmó
protección append-only general vía privilegios ya desplegados.

RF19–21 preservan locks y la misma transacción in-app/outbox. RF22 dedicado sigue
separado/append-only, sin modificar migraciones/triggers ni contabilidad. RF11
foto padre/subtareas se conserva. RF23 wire/cálculos/renderer intactos. Historial
general jamás se suma al ritmo; cobertura/estimación disponibles NO activadas.
Pendientes de operación de RF19–23 anteriores no se cierran con esta entrega.
RF34 UI sigue Fase5. Cascadas de adjuntos legacy no acreditan borrado físico:
storage/scanner/deuda física son trabajo posterior fuera de este bloque.

## Archivos exactos

Rutas relativas a Backend-SamProject:

```text
.env.example
prisma/schema.prisma
prisma/migrations/20261127190000_historial_general_expansivo/migration.sql
src/app.module.ts
src/dominio/historial/detalle.ts
src/dominio/historial/detalle.spec.ts
src/dominio/puertos/historial.repository.ts
src/dominio/puertos/proyecto.repository.ts
src/dominio/puertos/tarea.repository.ts
src/aplicacion/proyectos/proyectos.service.ts
src/aplicacion/proyectos/proyectos.service.spec.ts
src/aplicacion/tareas/tareas.service.ts
src/infraestructura/historial/cursor.ts
src/infraestructura/historial/cursor.spec.ts
src/infraestructura/historial/prisma-historial.repository.ts
src/infraestructura/historial/prisma-historial.repository.spec.ts
src/infraestructura/repositorios/prisma-historial-append.ts
src/infraestructura/repositorios/historial-atomicidad.spec.ts
src/infraestructura/repositorios/prisma-proyecto.repository.ts
src/infraestructura/repositorios/prisma-tarea.repository.ts
src/infraestructura/repositorios/prisma-tarea.estado.spec.ts
src/infraestructura/repositorios/prisma-usuario.repository.ts
src/infraestructura/repositorios/prisma-espacio.repository.ts
src/infraestructura/repositorios/rf20.asignaciones.spec.ts
src/interfaces/http/historial.controller.ts
src/interfaces/http/historial.controller.spec.ts
docs/MODULO15_HISTORIAL_BLOQUE1.md
```

## Comandos y resultados

Todos desde Backend-SamProject; sin npm test/pretest/ensure-pg, sin AppModule en
tests. Pruebas HTTP usan módulo aislado sin Prisma/cron/envíos reales.

1. `node node_modules/typescript/bin/tsc --noEmit` — correcto (última ejecución tras integración final).
2. `node node_modules/prisma/build/index.js validate` — schema válido; no BD ni SQL aplicado. Generate no necesario: nuevos campos escritos/leídos por SQL parametrizado; no se ejecutó.
3. `node node_modules/eslint/bin/eslint.js src` — 0 errores, 7 warnings preexistentes no-explicit-any en rf20.comentarios/rf20.persistence, archivos sin modificar.
4. `git diff --check` — correcto; advertencias Git LF→CRLF, no errores whitespace.
5. `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand` — última global **45 suites/652 tests aprobados; 2 suites/44 tests omitidos; total696**.
6. `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand src/infraestructura/historial src/interfaces/http/historial.controller.spec.ts src/infraestructura/repositorios/historial-atomicidad.spec.ts` — después de revalidación membresía final, **4 suites/53 tests aprobados**.

Durante integración se detectaron y corrigieron mocks anteriores que carecían de
executeRaw/findUniqueOrThrow y expectativas del puerto sin actor. No se ocultaron
los fallos: la primera global integrada tuvo18 fallos RF20, todos corregidos con
modelo de auditoría transaccional y sin debilitar assertions del outbox.

Pruebas nuevas: éxito/rollback por append en todas las familias de escritores,
desarchivo, fallo posterior de delete, cascadas padre/hijas/proyecto, foto RF11,
diario dedicado único y rollback de ambos diarios, no-ops/replays PATCH,
outbox/asignación rollback por fallo general, permisos revocados/admin/archivo,
detalle sin secretos anidados/legacy/accesores, cursor manipulado/versión/clave/
scope/límite/fechas, cota de consulta/keyset empates/corte/180d, proyección actor
null, JWT401 y delegación HTTP de las dos rutas.

**Límite de evidencia:** dobles transaccionales restauran copias de negocio y
ambos diarios; no son PostgreSQL. Tests de lectura verifican forma/parametrización
SQL y flujo/proyección, no ejecutan función/checks/índices/retención ni permisos
SQL. No hay evidencia real aún de locks, deadlocks, simultaneidad multi-conexión,
fence/corte bajo contención, SetNull/cascadas/rollback SQL ni rendimiento. Esa
validación y aplicar migración requieren autorización separada de BD; no son
excusa para dejar la adaptación pendiente (ya está conectada).

## Pendientes operativos, no escritores omitidos

- Aplicar/verificar migración y regresión SQL real solo cuando se autorice.
- Provisionar HISTORIAL_CURSOR_SECRET independiente y aleatorio en servidor;
  comprobar rotación, contention503 y rendimiento del fence bajo carga.
- Definir/equipar capacidad separada de purga controlada180d sin tocar RF22;
  no hay job activado ni se promete borrado físico automático.
- Adjuntos/storage/scanner y AdminWeb/UI permanecen expresamente fuera de alcance.
