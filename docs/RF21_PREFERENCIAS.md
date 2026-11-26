# RF21 — Bloque 1: preferencias (entrega local para revisión)

Fecha: 2026-11-25. **No declara RF21 completo.**

## Baseline y alcance

- `git status --short` inicial vacío; HEAD `a8009fe feat(backend): implement RF-20 push notification infrastructure`.
- Leídos agents.md, DERCAS docx (extracción XML en memoria), Adicendum v1.2, FASES_Y_MODULOS, DECISIONES y contrato §§8/9; límites de permisos recibidos del orquestador.
- Solo cambios en Backend-SamProject y contrato técnico raíz. Sin DECISIONES/ESTADO, clientes, deps/lockfiles, credenciales, edición de .env, staging, commit o push.
- Contrato redactado antes de código: extensión v1.5 exclusivamente §10; histórico RF20 conservado.

## API y comportamiento

- `GET /api/v1/perfil/preferencias-notificaciones`: JWT vigente, matriz de cinco tipos, defaults sin escritura ni backfill.
- `PATCH /api/v1/perfil/preferencias-notificaciones`: JWT vigente, parcial por tipo/canal, 1–5 tipos únicos, uno o más canales booleanos reales por fila. Valida todo antes de transacción; MENCION.inApp=false rechaza 400 sin mutación parcial.
- Usuario exclusivamente desde JWT; sin IDs cliente ni necesidad de roles/membresías. Query desconocida rechazada; respuestas sin usuarioId.
- Defaults: push true todos; correo false todos; inApp true solo MENCION (obligatorio), false demás. Sin INVITACION/SISTEMA ni configuración de correo RF03/RF06.
- **Persistir no aplica todavía preferencias a entregas existentes**: no prometer silenciamiento de push. Ningún hook/dispatcher RF19/20 modificado; sin nuevos eventos in-app ni envíos de correo. Aplicación multicanal, outbox de correo/reintentos y mensajes genéricos quedan diferidos.

## Cambios exactos

- `src/dominio/puertos/preferencias.repository.ts`: tipos admitidos, puerto, token DI y matriz efectiva.
- `src/aplicacion/dtos/preferencias.dto.ts`: DTO parser y pipe estricto sin coerción/null opcional; errores genéricos.
- `src/aplicacion/perfil/preferencias.service.ts`: casos de uso consultar/actualizar propios y fallback.
- `src/interfaces/http/preferencias.controller.ts`: GET/PATCH con guard JWT existente.
- `src/infraestructura/repositorios/prisma-preferencias.repository.ts`: lectura proyectada y upsert SQL parametrizado por tipo, solo canales enviados, transacción única, orden fijo.
- `src/app.module.ts`: registro controller/servicio/repositorio DI, sin conexión al dispatcher.
- `prisma/schema.prisma`: enum restringido, tabla independiente `PreferenciaNotificacion`, relación Usuario.
- `prisma/migrations/20261125180000_rf21_preferencias/migration.sql`: migración offline nueva; PK usuario+tipo, FK CASCADE, CHECK MENCION.inApp. No modifica antiguas.
- `src/interfaces/http/preferencias.spec.ts`: defaults, parcial/repetido, cuentas distintas, validación sin mutación, JWT ausente/malformado/expirado/revocado/inexistente, rechazo IDs/query/body ajenos.
- `src/infraestructura/repositorios/prisma-preferencias.repository.spec.ts`: inspección parametrización y columnas parciales/orden/transacción, propagación de fallos e inspección textual SQL.
- `../docs/orquestacion/CONTRATO_API.md`: versión adicional mínima v1.5, §10 endpoints/payload/respuesta/defaults/permisos/errores/concurrencia/límites.
- Este informe.

## Concurrencia y límites

`INSERT ... ON CONFLICT ... DO UPDATE` modifica únicamente canales presentes: no lee matriz para reemplazar fila y no pisa canales omitidos. Al insertar se usan defaults de canales ausentes; ante conflicto solo se actualizan los explícitos. PostgreSQL serializa cambios de la misma fila: para mismo canal prevalece última escritura serializada, no orden de llegada HTTP. Todas las filas se actualizan dentro de una transacción y en orden fijo de tipo. Respuesta de la transacción no promete incluir commits futuros.

Es razonamiento del SQL y pruebas del adaptador con dobles, **no evidencia de concurrencia PostgreSQL ejecutada**. Inspección textual del CHECK/FK/enum no acredita aplicación real. Fallos antes de commit revierten transacción en PostgreSQL; respuesta perdida/commit incierto requiere consultar y no implica rollback garantizado. No se sustituyó PostgreSQL por SQLite.

## Verificaciones ejecutadas (offline, sin pretest)

Binarios locales ya instalados; sin npm/npx install ni downloads solicitados. No BD iniciada, consultada ni migraciones aplicadas; sin app real, SMTP, proveedor push ni credenciales.

1. `node node_modules/prisma/build/index.js validate` — correcto, schema válido.
2. `node node_modules/prisma/build/index.js generate --no-hints` — correcto, Prisma Client 7.10.1 generado en node_modules (no versionado).
3. `node node_modules/typescript/bin/tsc --noEmit` — correcto (dos ejecuciones, incluida posterior a pruebas nuevas).
4. `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/interfaces/http/preferencias.spec.ts src/infraestructura/repositorios/prisma-preferencias.repository.spec.ts` — **2 suites, 34/34 pruebas**.
5. `node node_modules/eslint/bin/eslint.js` con los siete TS nuevos y `src/app.module.ts` explícitos — correcto, sin salida.
6. `node node_modules/jest/bin/jest.js --runInBand --testPathIgnorePatterns='integration.spec.ts'` — **28 suites, 398/398 pruebas** (regresión offline incluida RF19/20). Suites de integración con PostgreSQL excluidas explícitamente.
7. `git diff --check` — correcto; solo advertencia Git LF→CRLF para archivos existentes, no error de whitespace. Nuevos archivos inspeccionados y verificados adicionalmente al finalizar.

Los tests HTTP usan Nest/JWT/guard reales y repositorio de preferencias/usuario simulado, sin dependencia de BD. No demuestran durabilidad, locks, rollback o cascadas reales. El harness no incluye Throttler en esta suite: límite global se hereda de AppModule, no se reivindica nueva prueba 429 RF21.

## Pendientes para orquestador

- Revisar contrato §10 y código; no se declara cierre RF21 ni autorización de Git.
- Autorizar posteriormente aplicación/verificación de migración sobre PostgreSQL aislado: defaults sin backfill, reinicio/durabilidad, CHECK/enum/FK/cascadas, rollback multi-fila real y carreras de creación/actualización canales distintos e iguales.
- Integración móvil, aplicación efectiva de preferencias en encolado/despacho y revalidación previa al envío, correo outbox con reintentos, nuevos eventos in-app y validación física en bloques futuros autorizados.
