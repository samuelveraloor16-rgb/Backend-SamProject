# RF21 continuación2A — ampliación in-app local

2026-11-26. Entrega para revisión del orquestador, no cierre RF21 ni despliegue.

## Baseline preservado

Leídos AGENTS.md, DERCAS docx (XML en memoria), adicendum, contrato §§8/9/10 y documentos RF21 bloques1/2A. Baseline local ya contenía cambios no confirmados de ambos bloques. `rf21-inapp-baseline-hashes.json` captura SHA256 de archivos versionados y nuevos no ignorados antes de editar. `rf21-inapp-delta-hashes.json` contiene antes/después de los siete archivos preexistentes modificados por esta continuación. No se restauró contra HEAD.

Permanecen byte a byte los archivos de preferencias, su migración, app.module, outbox push, dispatcher, sus pruebas de preferencias/dispatch y documentos históricos bloques1/2A. Schema conserva íntegra la ampliación de preferencias; suites RF20 conservan tests anteriores con dobles adaptados. No se editaron DECISIONES/ESTADO ni clientes. El contrato raíz está fuera del repositorio backend: su delta debe revisarse separadamente.

## Contrato previo y endpoints

Primera modificación: formalización §8.4 y §10.4 v1.6, antes de código. Cabecera actualizada a v1.6. Mantiene históricos RF19/20/bloque1 explícitamente delimitados; bloque2A push sigue vigente.

Sin endpoints nuevos. Amplía tipos admitidos por `GET /api/v1/notificaciones` y `PATCH /api/v1/notificaciones/:id/leida`; paginación, códigos y shape MENCION intactos. `comentarioId:null` solo para eventos sin comentario. Los GET/PATCH de preferencias existentes no cambian. Frontend no modificado: compatibilidad de shape RF19 preservada; presentar/navegar los tipos nuevos requiere que el cliente los soporte, no se reivindica prueba móvil.

## Archivos y deltas de implementación

- `prisma/schema.prisma`: vínculo opcional aviso→tarea con cascada; colección inversa; tabla IdentidadAviso de un solo digest, sin FK/TTL ni relaciones. La cascada solo elimina avisos, no identidades.
- Nueva `prisma/migrations/20261126120000_rf21_inapp/migration.sql`: crea tabla de identidades y columna/FK tarea. Offline, no aplicada. Sin modificar migraciones antiguas, backfill, delete ni limpieza.
- Nuevo `prisma-inapp.repository.ts`: helper transaccional para reservar digest SHA256 de JSON `[claveEvento, destinatario]` mediante inserción con conflicto ignorado. No incluye tipo ni preferencia. Reserva incluso si el canal se suprime; MENCION siempre habilitada; otros solo inApp explícito. Aviso genérico con cuerpo null, sin texto privado. No consulta dispositivos ni outbox push. Fallos se propagan al rollback de la transacción de negocio; no se capturan P2002 dentro de transacción abortada.
- `prisma-tarea.repository.ts`: usa un mismo objeto evento/clave del cambio efectivo para identidad in-app y outbox push; nuevo responsable salvo autor/noop. No añade idempotencia HTTP: acciones independientes y cambios A→B→A siguen siendo eventos distintos. La identidad asignación existente se crea una vez por cambio transaccional, no se genera una segunda clave para in-app.
- `prisma-comentarios.repository.ts`: elimina creación anidada de avisos para usar helper transaccional en la unión elegible responsable+mencionados; precedencia MENCION, sin autor. Replay RF19 permanece temprano, no genera efectos nuevos. Lectura usa SQL parametrizado de IDs autorizados desde relaciones actuales con comprobación de igualdad tarea/comentario, mención real cuando corresponde y usuario JWT. Total y lista comparten filtro en RepeatableRead; PATCH revalida tras locks y responde 404 genérico. Nunca acredita pertenencia desde JSON. Archivo no restringe lectura; referencias incoherentes no son visibles. Legacy solo MENCION con comentario/mención verificables; no se inventa tarea desde JSON.
- `prisma-vencimientos.repository.ts`: registra in-app antes de decidir push, dentro de la transacción Serializable y locks existentes; mismas ventanas UTC, responsable, fecha y subtareas. Elegibilidad/archivo se comprueban antes del helper. El contador `encolados` sigue contando push, no avisos in-app.
- Nuevo `rf21.inapp.spec.ts`; refuerzo de `rf20.comentarios.spec.ts`, `rf20.asignaciones.spec.ts`, `prisma-vencimientos.repository.spec.ts`: defaults, no retroactividad, replay tras borrado, dedup independiente del tipo/destinatario, fallos multi-escritura con rollback simulado, responsable mencionado solo MENCION, push false/inApp true, permisos aislados, revocación, archivo lectura/generación, referencias inválidas y legacy. Los cambios de fixtures son necesarios porque el negocio ahora escribe identidad aun cuando el canal está suprimido.
- Nuevos manifiestos SHA256 y este informe. No otros deltas sobre el baseline.

## Identidad, historia y límites

Digest sin texto ni IDs reversibles de recursos/usuario; no FK bloqueante a comentario/proyecto/tarea. El borrado del aviso o recurso no borra su identidad; replay del mismo evento no recrea fila. Reserva suprimida también persiste: habilitar después no reproduce eventos pasados. Deshabilitar no borra históricos. No depende de insertar outbox ni de que push esté habilitado. No se modificaron locks, leases, frecuencia ni dispatcher.

Sin backfill: legacy MENCION con relaciones originales sigue legible. Si se reprocesa un evento con aviso legacy verificable, se registra identidad sin duplicar fila. No se garantiza dedup histórica de avisos eliminados antes de esta migración ni se recuperan sus identidades sin evidencia. No hay retención automática de identidades nuevas. La caducidad del marcador HTTP RF19 no se amplía: una publicación nueva tras esa frontera puede tener otro comentario/evento.

Las pruebas de autorización usan un adaptador simulado y aserciones del SQL; **no ejecutan SQL real**. El filtro autorizado materializa IDs accesibles antes de paginar: requiere evaluar rendimiento/volumen en PostgreSQL antes de despliegue. No se afirma prueba exhaustiva de concurrencia ni límites de grandes volúmenes.

## Verificaciones ejecutadas offline

Binarios locales existentes, sin pretest/ensure-pg ni npm test:

1. `node node_modules/prisma/build/index.js validate`: correcto (incluida ejecución final).
2. `node node_modules/prisma/build/index.js generate --no-hints`: Prisma Client 7.10.1 generado localmente, sin instalación solicitada.
3. `node node_modules/typescript/bin/tsc --noEmit`: correcto final.
4. `node node_modules/jest/bin/jest.js --runInBand --testPathIgnorePatterns='integration.spec.ts'`: **30 suites, 432/432 pruebas** final. Excluidas explícitamente suites PostgreSQL integration; incluye RF19 offline, RF20, preferencias y nuevas pruebas in-app.
5. ESLint sobre ocho archivos TS modificados/nuevos: **0 errores, 6 advertencias any preexistentes** en suite RF20 comentarios.
6. `git diff --check`: correcto, únicamente avisos de normalización LF/CRLF. No staging/commit/push.

Hubo corridas intermedias fallidas por mocks antiguos sin modelo identidad y tipado estricto de fixtures; corregidas. No se ejecutó PostgreSQL, migración real, SMTP, HTTP externo, notificaciones reales ni installs. Prisma validate/generate no prueban FK ni aislamiento. Rollback/carreras/cascadas/durabilidad real requieren PostgreSQL aislado autorizado; mocks no las acreditan. La disponibilidad de tablas nuevas es requisito de despliegue: falta de esquema falla cerrada y revierte negocio, no degrada a generación insegura. Correo y verificación física siguen pendientes.
