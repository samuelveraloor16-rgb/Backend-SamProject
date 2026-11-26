# RF20 — incremento 4: asignaciones y comentarios durables

Base `ad2b88e`; se preservan los incrementos locales 1–3. Sin modificaciones al
trabajos previos. Continuación: contrato aclarado por aprobación del usuario en D-21;
sin editar DECISIONES/ESTADO, esquema ni migraciones. Baseline capturado con
`git status --short`, `git diff --stat` y diff en `%TEMP%/rf20-inc4-baseline.diff`.

## Implementado

- Creación de tarea/subtarea y PATCH: el autor autenticado llega al repositorio.
  El outbox se escribe con `enTransaccion(tx)` dentro de la transacción original.
  La operación no invoca dispatcher, proveedor ni HTTP.
- Solo el nuevo responsable recibe `TAREA_ASIGNADA`, excluido el autor. No hay
  evento por desasignación, mismo responsable, PATCH sin responsable ni estado.
  Mover sigue sin generar asignación.
- Cada cambio efectivo usa `asig:<UUID>` no nullable. §9.4 no prescribe formato
  para asignaciones, sino una fila por cambio en la misma transacción. No se usa
  la unicidad nullable de Notificacion. A→B→A son cambios distintos.
- Proyecto SHARE, tarea UPDATE, usuarios KEY SHARE y membresías SHARE: se
  revalidan membresía del autor/destinatario y archivo antes de escribir. PATCH
  lee el responsable anterior bajo lock, no desde la lectura previa del servicio.
  Se reutiliza el reintento acotado de ubicación, solo antes de escrituras; no se
  reintenta un commit ambiguo. Subtareas conservan sus locks y reglas anteriores.
- Un fallo de escritura del outbox revierte el negocio. Un fallo posterior
  dentro de esa transacción también revierte el outbox. Un fallo externo de Expo
  no participa en esta operación; se conserva el dispatcher del incremento 3.

## Comentarios / menciones: bloqueo resuelto

- Aprobación del usuario recogida por el orquestador en D-21: RF19 mantiene 20
  mencionados distintos incluida automención; push hasta 21 destinatarios
  (responsable elegible UNION mencionados elegibles MENOS autor). Contrato §9
  actualizado, sin truncar ni rechazar comentarios válidos por la unión de 21.
- `PrismaComentariosRepository` reutiliza `enTransaccion(tx)` del outbox dentro
  de la transacción existente: comentario, menciones, avisos RF19, eventos y
  marcador idempotente confirman juntos. Clave `com:<comentarioId>:<usuarioId>`;
  `MENCION` prevalece cuando responsable y mencionado coinciden. No hay HTTP.
- Replay toma la rama existente antes de encolar: conserva identidad y no
  genera efectos adicionales; sin acceso actual del autor devuelve 404.
- Responsable leído bajo tarea SHARE: una reasignación concurrente espera.
  Proyecto SHARE y usuarios KEY SHARE (ordenados, incluidos responsable y
  mencionados) preceden membresías SHARE. Las membresías elegibles quedan
  protegidas hasta commit frente a bajas. Responsable adicional ya sin membresía
  se omite sin impedir comentar; si fue mencionado, RF19 rechaza la petición.
  Una pérdida de acceso posterior al commit sigue sujeta a revalidación del
  dispatcher existente. No se afirma ausencia general de deadlocks: baja física
  con cascadas y otros órdenes de locks puede provocar contención; se conserva
  la traducción RF19 de errores transitorios, sin reintento de commit ambiguo.

### Delta de esta continuación (archivos exactos)

- `src/infraestructura/repositorios/prisma-comentarios.repository.ts`
- `src/infraestructura/repositorios/rf20.comentarios.spec.ts` (nuevo)
- `docs/RF20_INCREMENTO4.md` (este informe)
- `../docs/orquestacion/CONTRATO_API.md` (§9 y referencias de estado pertinentes)

Asignaciones e incrementos 1–3 preexistentes no se reimplementaron ni editaron.

## Verificación sin PostgreSQL ni servicios

- `npx jest --runInBand`: 321 pasan, 44 omitidas, 25 suites (23 pasan,
  2 suites de integración omitidas por su guarda opt-in).
- Nueva `rf20.asignaciones.spec.ts`: 24 pruebas. Rollback y concurrencia se
  modelan en memoria; no acreditan locks ni atomicidad reales de PostgreSQL.
  El spy sobre `ExpoPushProvider.enviar` verifica cero llamadas desde negocio.
- Las cinco suites previas RF20: 120/120 pasan (dispositivos, persistencia,
  dispatcher, proveedor Expo y repositorio de despacho).
- Nueva `rf20.comentarios.spec.ts`: 11 pruebas pasan: unión 20/21,
  automención, precedencia, replay con pérdida de acceso, rollback modelado,
  responsable sin membresía, aislamiento y orden de consultas/locks.
  Ejecución focal inicial: 15 pasan/1 falla por defecto del doble (lookup del
  marcador no filtraba clave); corregido y verificado por la suite completa.
- `npm run typecheck`: correcto. `git diff --check`: correcto
  (advertencias informativas de conversión LF/CRLF).
- Jest se ejecuta directamente; no se invocó `pretest` ni `ensure-pg`.
  No se modificó esquema: validate/generate no requeridos. Migraciones locales
  anteriores continúan offline, no aplicadas. Staging vacío; sin commit/push.

Pendientes: verificación PostgreSQL aislada autorizada de asignaciones y comentarios,
vencimientos/cron/limpieza/receipts y validación Android/iOS del alcance restante.
No hay nuevas rutas ni activación automática del dispatcher.
