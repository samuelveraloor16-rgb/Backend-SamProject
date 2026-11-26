# RF20 — Incremento 6 (2026-11-25)

## Estado y bloqueos

Parcial local; NO se declara RF20 completo. Leídos agents.md, DERCAS DOCX, adicendum y contrato §9/D21. Incrementos 1–5 preservados. No se instalaron dependencias, iniciaron conexiones/migraciones BD, enviaron HTTP/push reales, ni modificaron clientes, DECISIONES o ESTADO. Sin add/commit/push.

- No existe `@nestjs/schedule` en package.json ni programación periódica de RF20. Se informó antes de cualquier instalación; no se instaló ni se reemplazó por timers. Activación periódica bloqueada por permiso de dependencia y configuración del scheduler.
- «p. ej. 30 días» en contrato no aprueba un TTL. No se implementa borrado arbitrario de outbox ni diario: faltan plazo/estados/condiciones y conservación de identidades que evite recrear vencimientos/comentarios. El diario contiene aceptaciones para evitar reenvíos y reservas de frecuencia 10/min; limpiar por edad sin política puede invalidar ambas garantías. Receipts sin política: no se inventa una.
- Limpieza de tokens permanentemente inválidos ya existente: compare-and-delete por dispositivo/dueño/token/versión/generación. Se mantiene y verifica; no se agrega expiración arbitraria de tokens.

## Baseline y delta exclusivo

Baseline previo a editar: `C:\Users\samue\AppData\Local\Temp\opencode\rf20-inc6-baseline.json`, SHA256 + contenido de src/docs/prisma y CONTRATO_API. `git status` inicial tenía 8 archivos tracked modificados y los incrementos RF20 sin seguimiento; no se revirtió ninguno. El baseline es local operativo, no un archivo a versionar.

Archivos del incremento:

1. `src/aplicacion/push/push-coordinator.ts` (nuevo).
2. `src/aplicacion/push/push-coordinator.spec.ts` (nuevo).
3. `src/infraestructura/repositorios/push-persistence.module.ts` (DI/export del detector y coordinador).
4. `src/infraestructura/push/prisma-push-dispatch.repository.ts` (reloj BD para claim; CAS terminal exige lease vencido).
5. `src/infraestructura/push/prisma-push-dispatch.repository.spec.ts` (regresiones de reloj/lease).
6. `docs/RF20_INCREMENTO6.md` (este informe).
7. `../docs/orquestacion/CONTRATO_API.md` (estado real y límites; sin rutas/payloads nuevos).

## Invocación y garantías

Desde un contexto Nest ya autorizado/configurado que importe `PushPersistenceModule`: `await app.get(PushCoordinator).ejecutar()`; no se añadió CLI, endpoint, hook ni invocación al arrancar. Construir/resolver el provider no envía. Invocarlo sí llama al dispatcher existente, por lo que su uso operativo requiere autorización/configuración; aquí solo se invocó con dobles.

- Una página de hasta 100 candidatos y lote de hasta 100 filas outbox por invocación; no se barre toda la BD en un bucle ilimitado. El operador/scheduler futuro debe repetir invocaciones. No se garantiza coste SQL total acotado ni tiempo máximo de respuesta.
- Conserva instante UTC y cursor hasta completar página. Tres intentos como máximo ante errores transitorios reconocidos por el clasificador existente (incluido P2034/SQLSTATE Serializable); cada retry repite **misma página e instante**, no avanza tras commit parcial. Tras fallo conserva checkpoint para próxima invocación. Error permanente no se reintenta dentro de esa llamada; se devuelve ERROR sin datos sensibles.
- Páginas completadas avanzan cursor; al terminar, próximo barrido usa nuevo instante desde principio. Reinicio pierde checkpoint pero no claves durables. Solapamiento en la misma instancia se omite con guardia liberada en finally. Varias instancias no comparten guardia: se apoyan en unicidad BD del detector y claim/locks/lease/CAS del dispatcher.
- Detección fallida no impide despacho de outbox ya confirmado. El coordinador no reintenta el dispatcher: conserva sus cinco intentos/backoff y journal por dispositivo. No toca autorización: se mantiene revalidación de vínculo/sesión/acceso/evento inmediatamente antes de cada I/O.
- Claim toma reloj PostgreSQL tras lock de destinatario, evitando que un worker adelantado reclame antes del lease real. CAS de quinto intento requiere que siga pendiente, mismo contador y fecha de disponibilidad alcanzada. Worker antiguo no puede finalizar un intento nuevo (CAS ya existente).

## Límites de concurrencia y retención

Pruebas con dobles NO prueban aislamiento PostgreSQL ni todas las intercalaciones. Un lease puede caducar mientras un I/O sigue en vuelo; una aceptación puede llegar tras reclamar otro worker. Aceptación externa seguida de caída antes de journal puede reenviarse: NO exactly-once externo. No se cancela un I/O ya iniciado por revocaciones posteriores a la revalidación. El reloj del worker aún preselecciona filas; atrasos pueden demorar selección, pero el claim usa BD para no anticipar envíos.

No se borran filas de outbox, intentos/aceptaciones ni identidades de comentarios/vencimientos. Por tanto la retención acotada periódica sigue pendiente, no completada. La exclusión por destinatario preexistente usa la disponibilidad/lease del pendiente y puede posponer otros eventos durante backoff; no se cambia esa política en este incremento.

## Validación offline ejecutada

- `node node_modules/jest/bin/jest.js --runInBand --testPathPatterns='push|vencimientos|dispositivos|rf20|errores-transitorios'`: **10 suites / 207 pruebas OK**.
- `node node_modules/jest/bin/jest.js --runInBand --testPathIgnorePatterns='integration'`: **25 suites / 355 pruebas OK**; sin pretest/ensure-pg.
- `npm run typecheck`: OK.
- `npm run lint`: 0 errores; 7 warnings any preexistentes en rf20.comentarios.spec.ts y rf20.persistence.spec.ts, sin cambios en este delta.
- `git diff --check`: OK (avisos de conversión LF/CRLF preexistentes, no errores whitespace).
- ESLint exclusivo de los cinco archivos TS del delta con `--max-warnings=0`: OK. `git diff --no-index --check -- NUL <archivo>` sobre los tres archivos nuevos: sin errores whitespace.
- Revisión delta contra baseline por SHA256 y diff de contenido, incluidos archivos sin seguimiento; sin cambios en package.json/lock, schema/migraciones ni módulos de negocio de incrementos anteriores. El propio informe se revisó además de los archivos cubiertos inicialmente por baseline.

La comparación SHA256 confirmó exactamente cuatro archivos existentes alterados y tres nuevos, enumerados arriba. El snapshot textual JSON de PowerShell perdió algunos símbolos Unicode al serializar (los hashes se calcularon antes, sobre los archivos originales); su diff textual puede mostrar sustituciones `?` que no son ediciones reales. La revisión del contrato se limitó a los parches §9; no se reescribieron sus demás secciones.

Nuevas pruebas: repetición de página/instante en error, límite de retry, checkpoint entre invocaciones, continuidad del dispatcher ante fallo detector, no retry externo indiscriminado, solapamiento local, instancias independientes con doble de dedup, reloj BD y protección del lease del quinto intento. Pruebas existentes reejecutadas cubren envío parcial aceptado, concurrencia CAS, compare-and-delete tras transferencia/rotación/revinculación y revocación previa al I/O.
