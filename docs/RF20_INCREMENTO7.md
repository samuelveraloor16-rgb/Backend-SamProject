# RF20 — Incremento 7: scheduler opt-in y frontera de retención

## Alcance y compatibilidad

Leídos AGENTS, DERCAS DOCX completo, adicendum, contrato §9, D21 e informe6. Preservados incrementos 1–6. No se declara RF20 completo. Sin app real, BD, migraciones/conexiones, HTTP/push, credenciales, ediciones .env, clientes, DECISIONES/ESTADO ni add/commit/push.

Nest instalado: common/core **11.2.10**. Selección final **@nestjs/schedule 6.1.3**, peers common/core `^10.0.0 || ^11.0.0`; compatible con CommonJS actual y suite Jest. Se consultó e instaló primero 12.0.4 (peers Nest11/12 compatibles), pero su ESM falló en Jest actual. Se sustituyó únicamente schedule por 6.1.3, sin cambiar configuración Jest ni actualizar otros paquetes. Ambos installs con `--save-exact --ignore-scripts --no-audit --no-fund`, sin force/legacy-peer-deps. No se ejecutaron lifecycle scripts.

Delta final lock respecto snapshot previo: añadidos `@nestjs/schedule@6.1.3`, `cron@4.4.0`, `luxon@3.7.2`, `@types/luxon@3.7.6`; ninguna entrada preexistente modificada o eliminada (excepto dependencia raíz añadida). Única dependencia directa nueva: schedule exacta.

## Invocación y garantías

AppModule importa PushSchedulingModule: ScheduleModule real registra intervalo `rf20-push` cada **60 000 ms**, sin ejecutar inmediatamente. Tick retorna sin efectos si `PUSH_SCHEDULER_ENABLED` no es exactamente string `true`. No se configuró esta variable. Activación operativa futura, solo bajo autorización en entorno seguro: habilitar ese flag en configuración del servidor; el flag independiente `EXPO_PUSH_ENABLED` controla el adaptador existente y no se habilita por activar scheduler. No poner credenciales en clientes. Desactivar scheduler no cancela I/O ya iniciado. Shutdown retira intervalo; no se promete cancelación/drenaje de I/O en vuelo.

Control seguro comprobado: construir el módulo con Test de Nest, reemplazar PushPersistenceModule por módulo doble y ConfigService por valores de prueba; no iniciar AppModule/app real. Sigue disponible `app.get(PushCoordinator).ejecutar()` para contexto autorizado; manual comparte guardia con tick. No hay CLI ni endpoint nuevo; endpoints y payloads existentes no cambian.

Una página de detector y lote dispatcher por tick, máximo 100 cada uno; checkpoint/retries y guardia local del coordinador sin modificaciones. Reinicio pierde cursor, no identidades durables. Workers múltiples usan unicidad/claim con reloj BD/leases/CAS preexistentes. No se modifica asignaciones/comentarios/vencimientos. Error inesperado produce mensaje fijo sin serializar error; errores sanitizados de coordinador producen aviso fijo de lote incompleto. Ticks posteriores pueden continuar. La cadencia es técnica, no SLA de entrega: backlog, duración de lote, retries, ventana, downtime y proveedor pueden demorar/omitir avisos. Sigue sin exactly-once externo; lease vencido con envío en vuelo sigue siendo límite conocido.

## Retención 90 días: propuesta, NO aplicada

Política segura aplicada: **conservar** outbox/diario íntegros, aun terminales viejos. No hay método ni timer de borrado nuevo. Las claves únicas de outbox son evidencia de no recreación; borrar terminales permite que detector/comentario vuelva a insertar. Cascadas pueden perder aceptaciones por dispositivo y reservas de frecuencia. `creadoEn` no demuestra 90 días desde estado terminal ni ausencia de I/O en vuelo. No reinterpretar propuesta como permiso de borrar identidades/aceptaciones/frecuencia. No se borró nada real.

Diseño pendiente, explicado antes de cualquier cambio: separar identidad/tombstone durable de datos purgables; conservar claves por evento y aceptación por dispositivo/generación mientras replay o I/O puedan existir; fijar instante terminal fiable; transición atómica bajo locks/CAS que detector/dispatcher consulten; impedir cascadas que eliminen protección. Definir datos realmente purgables, garantías tras borrar recurso/usuario y tests PostgreSQL de concurrencia/reinicio antes de schema/migración y retención efectiva. **No se introduce schema/migración aquí.** Borrado condicional existente de tokens permanentemente inválidos se mantiene; no se añade TTL ni receipts cleanup. La prueba con Set solo comprueba que el scheduler no limpia/recrea evidencias del doble: no prueba retención PostgreSQL.

## Archivos exclusivos del delta

1. `package.json` — dependencia exacta schedule.
2. `package-lock.json` — las cuatro entradas añadidas arriba y dependencia raíz.
3. `src/app.module.ts` — import del módulo scheduler.
4. `src/infraestructura/repositorios/push-persistence.module.ts` — solo comentario actualizado.
5. `src/infraestructura/push/push-scheduler.ts` — intervalo opt-in, DI y logs fijos.
6. `src/infraestructura/push/push-scheduling.module.ts` — composición schedule/DI.
7. `src/infraestructura/push/push-scheduler.spec.ts` — programación real sin Prisma.
8. `docs/RF20_INCREMENTO7.md` — informe.
9. `../docs/orquestacion/CONTRATO_API.md` — actualización §9 sin rutas nuevas.

## Validación

- Jest directo, sin pretest/ensure-pg: scheduler **1 suite/9 pruebas OK**; regresión no-integración **26 suites/364 pruebas OK**.
- Jest pertinente `--testPathPatterns='push|vencimientos|dispositivos|rf20|errores-transitorios'`: **11 suites/216 pruebas OK**. ESLint de los tres archivos nuevos con `--max-warnings=0`: OK.
- `npm run typecheck`: OK; `npm run lint`: 0 errores, 7 warnings any preexistentes en rf20.comentarios/persistence.
- `git diff --check`: OK (avisos LF/CRLF preexistentes).
- Tests nuevos: opt-in estricto, arranque sin ejecución, cadencia real ScheduleModule/fake timers/DI, shutdown, solapamiento manual y automático, liberación tras fallo, sanitización de rechazo inesperado y error detector, reinicio y conservación de evidencia con doble después de 90 días.
- Regresiones existentes incluyen multiproceso simulado/CAS, aceptación parcial, leases/reloj BD y revocación. Dobles no demuestran aislamiento PostgreSQL ni recepción Android/iOS.
- Snapshot SHA256 previo `C:/Users/samue/AppData/Local/Temp/opencode/rf20-inc7-baseline.json`; lock previo `rf20-inc7-lock.json`. Revisión contra baseline incluye untracked previos, sin tocar schema/migraciones ni lógica anterior. Sin dependencias ajenas ni upgrades. Pendientes: retención segura con diseño autorizado, validación PostgreSQL autorizada y entrega física.
- Comparación SHA256 final: exactamente cinco archivos existentes cambiados y cuatro nuevos, los nueve enumerados; schema/migraciones y todos los demás archivos del baseline conservan su hash.
