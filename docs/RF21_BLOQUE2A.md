# RF21 bloque 2A — entrega parcial local

## Delta respecto a bloque 1

- `prisma-push-outbox.repository.ts`: consulta preferencia propia por usuario/tipo en la misma transacción de negocio cuando existe; `push=false` omite inserción. Ausencia conserva true. Lectura fallida propaga error y no inserta (en hooks revierte transacción completa).
- `prisma-push-dispatch.repository.ts`: relectura de preferencia dentro de cada revalidación por dispositivo/intento, antes de reserva de frecuencia y llamada externa. False devuelve inelegible; error propaga al catch existente, conserva lease y no envía. No se modifica claim, diario, dedup, backoff ni límite de intentos.
- Pruebas de ambos puntos y actualización de dobles RF20 para default ausente. No cambia selección/precedencia MENCION: silenciarla no produce fallback COMENTARIO. No se consulta inApp/correo para decidir push.

Baseline SHA256 y status capturados en `%TEMP%/rf21-2a-baseline-{hashes,status}.txt`. Comparación final: solo siete archivos preexistentes cambiaron (los dos repositorios anteriores y cinco suites de pruebas). Todos los archivos locales del bloque 1, incluidos schema, migración, app.module y documentación, permanecen byte a byte intactos. Dos archivos nuevos de este incremento: suite `rf21.push-preferencias.spec.ts` y este informe.

## Bloqueo concreto: in-app

No se implementan asignación/comentario-al-responsable/vencimientos in-app sin resolver ampliación contractual. §8.4 solo crea MENCION, shape con comentarioId y relaciones originales verificables. Asignaciones/vencimientos no tienen comentario; Notificacion no tiene vínculo durable a tarea y unique nullable por comentario no deduplica esos eventos. No sirve colocar IDs en JSON ni crear avisos dependientes del éxito push/dispositivos. El texto histórico de §10 no constituye el bloqueo: ya se autorizó aplicar preferencias.

Propuesta mínima para aprobación: ampliar tipos/shape de §8.4 (comentarioId nullable según tipo), relación FK verificable a tarea con cascada y clave durable no nullable única por evento/destinatario. Definir conservación de identidad frente a borrado/replay antes de migración offline; los avisos de comentario mantienen FK original y precedencia MENCION obligatoria. Listar/contar/marcar deben comprobar relaciones y acceso actual; archivo mantiene lectura. Crear avisos en transacciones de hooks y detector independientemente de push/dispositivos, solo con inApp=true salvo MENCION obligatoria, sin retroactividad. Esta propuesta NO se implementó ni se considera aprobada.

## Verificación offline

- `node node_modules/jest/bin/jest.js --runInBand --testPathPatterns="(push|rf20|preferencias|vencimientos)"`: 12 suites, 209 pruebas aprobadas.
- `npm run typecheck`: OK.
- `npm run lint`: 0 errores, 7 advertencias any preexistentes.
- `git diff --check`: OK; advertencias de normalización LF/CRLF.

No pretest/ensure-pg, PostgreSQL, migraciones reales, HTTP/notificaciones externas, dependencias, correo, clientes ni Git add/commit/push. No endpoints nuevos ni cambios al contrato/ESTADO/DECISIONES. Pruebas con dobles: no acreditan aislamiento/concurrencia PostgreSQL ni entrega física. La preferencia se observa en la última lectura previa al I/O; un cambio posterior a esa lectura no cancela un I/O iniciado. Si la tabla de preferencias aún no fue desplegada, la lectura falla cerrada: requiere despliegue autorizado del bloque 1 antes de operar.
