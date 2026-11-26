# RF21 correo — núcleo seguro offline, NO canal operativo

2026-11-26. Entrega parcial para revisión. **RF21 no completo. ZeroSend en producción: sin wiring de hooks, dispatcher, adaptador de elegibilidad ni scheduler.** No confundir primitivas probadas con infraestructura desplegada.

## Requisitos y contrato

Leídos AGENTS, DERCAS docx (XML en memoria), adicendum, contrato v1.6 §8–10 e informes RF21/precheck. Antes de código se añadió extensión v1.7 y §10.5 al contrato raíz. Sin nuevas rutas/payloads/permisos HTTP. La sección formaliza autorización: identidad propia durable aun suprimido; incertidumbre sin reenvío; inicial + cinco reintentos únicamente ante rechazo probado; correo actual verificado; TLS y flags independientes defaultOFF; no retroactividad. No se modificaron DECISIONES/ESTADO, clientes ni correo RF03/RF06.

## Qué está implementado

- `src/dominio/puertos/correo-eventos.ts`: resultados tipados que no pierden incertidumbre, puerto de evidencia sobre dirección actual, adaptador `SinEvidenciaCorreo` explícitamente sin evidencia. No añade campo de verificación, endpoint o afirmación de verificado.
- `src/aplicacion/correo/correo-dispatcher.ts`: coordinador invocable por constructor, no registrado en Nest. Guard manual/proveedor y exclusión local; preparar debe confirmar la fase durable antes de llamar SMTP; una excepción del proveedor es incierta, fallo de persistencia posterior propaga sin volver a enviar. Función de presupuesto inicial + hasta cinco reintentos, backoff 1/2/4/8/16 minutos, cap técnico 2h.
- `src/infraestructura/correo/rf21-smtp.ts`: adaptador Nodemailer separado del de seguridad/invitaciones, configuración exclusivamente RF21 sin defaults RF03. `RF21_CORREO_ENABLED` exacttrue; host/puerto/from/auth/TLS validados localmente, TLS implícito o STARTTLS obligatorio, certificado verificado y TLS mínimo 1.2; sin verify ni logging externo. Mensaje genérico sin contenido/IDs del evento. DATA/reset/timeout/desconocido inciertos; solo respuestas estructuradas 4xx/5xx de comandos anteriores a DATA o conexión inequívocamente rechazada pueden demostrar rechazo previo. Aceptación SMTP no acredita buzón.
- `src/infraestructura/correo/prisma-correo-outbox.ts`: helper transaccional **todavía sin llamadas desde negocio**. Digest SHA256 de canal+identidad original+usuario; tipo/preferencia no permiten evadir dedup. Reserva incluso suprimidos/anteriores a frontera; default correo=false. Sin dirección almacenada. Frontera ausente o persistencia fallida propaga, no degrada silenciosamente. Instante original obligatorio; quien integre vencimientos debe proporcionar fecha o fecha−24h UTC, nunca instante de escaneo.
- Primitivas de claim/recuperación/finalización SQL en ese archivo: lock de fila antes de evaluar reloj BD, transición a EN_IO/incremento de presupuesto, generación y lease de dos minutos, CAS final con generación/intentos/lease; expiración => INCIERTO, jamás nuevo claim. Caída entre confirmar EN_IO y primer byte acepta pérdida; caída después de aceptar SMTP conserva incertidumbre. CAS no cancela I/O ni evita entrega ya iniciada.
- `prisma/schema.prisma`: tres modelos aditivos (IdentidadCorreo, FronteraCorreo, CorreoOutbox), sin tocar modelos anteriores. Tombstone solo digest, sin FK/cascada/purge; outbox no guarda direcciones/textos. No hay política de purga de datos ni borrados ejecutados.
- `prisma/migrations/20261126180000_rf21_correo/migration.sql`: migración nueva offline con checks, índice y frontera inicial `clock_timestamp()` de BD al aplicarla. No aplicada, sin fecha de despliegue inventada ni backfill. Debe aplicarse como parte del despliegue autorizado, no previamente como si fuese una fecha de activación posterior; si se necesita otra activación se requiere frontera explícita revisada. Ventana de transacción de despliegue también debe revisarse antes de activar hooks.
- `src/infraestructura/correo/rf21-correo.spec.ts`: 35 pruebas nuevas, solo dobles y aserciones SQL.

## Integración pendiente y dato indispensable

1. **No existe evidencia de dirección verificada en el modelo actual.** Hace falta integrar una fuente autorizada que acredite la dirección actual del usuario, no solo existencia o formato. El adaptador disponible responde false; diferir no consume intento SMTP. No inventar verificación ni convertir este bloqueo en descarte permanente.
2. **Falta política temporal completa para asignaciones/comentarios:** edad máxima y cuándo quedan obsoletos tras reasignar, hacer tarea, mover o archivar/desarchivar. Acceso actual y preferencia son necesarios, pero no definen solos esa vigencia. No se fijó TTL arbitrario. Se pueden aprobar reglas concretas o limitar primera integración a vencimientos con ventanas ya definidas.
3. **No hay adaptador productivo de `CorreoDispatchRepository`.** El puerto exige revalidación bajo locks de permiso, preferencia, archivo, relación comentario/mención, vigencia, dirección actual y evidencia. Las primitivas SQL no hacen esa autorización por sí mismas y no deben exponerse como endpoint. No se atribuye a esta entrega cobertura de revocación/archivo/mención/UTC en producción. Falta implementar ese adaptador y probar cambios concurrentes reales en PostgreSQL autorizado.
4. **Hooks no conectados deliberadamente en este incremento parcial.** Reutilizar objeto evento/identidad del cambio, unión de destinatarios y precedencia existentes; nada de reencolar desde outbox push ni ejecutar SMTP dentro de transacción. Integrar helpers en misma transacción hará que fallo de persistencia correo revierta negocio, mientras fallo SMTP posterior no lo hará. Hoy no hay nuevas escrituras de negocio correo.
5. **Sin scheduler añadido:** `RF21_CORREO_SCHEDULER_ENABLED` está reservado en contrato, no implementado ni leído. Debe añadirse tick independiente a infraestructura schedule existente sin otro forRoot y sin depender/bloquear push; no habilitarlo hasta completar (1–4). Flag de proveedor y guard manual sí implementados. No se afirma intervalo RF21 operativo.
6. Identidad histórica perdida antes del despliegue no es reconstruible sin evidencia. El diseño de frontera impide crear correo de eventos anteriores cuando el integrador proporciona instante original correcto; no acredita automáticamente que todos los futuros hooks lo hagan.

## Baseline y archivos exactos

`docs/rf21-correo-baseline-hashes.json` captura hashes antes de esta entrega de archivos backend versionados y no ignorados, incluido baseline dirty. `docs/rf21-correo-delta-hashes.json` compara esos mismos archivos al finalizar: **único preexistente cambiado: prisma/schema.prisma** (ampliación aditiva). Preferencias, push/in-app, hooks, app.module, migraciones anteriores, RF03/RF06 y sus pruebas permanecen byte a byte. No restauración contra HEAD.

Nuevos: los cinco TS listados (incluida suite), la migración, ambos manifiestos y este informe. Fuera de backend solo `docs/orquestacion/CONTRATO_API.md` (v1.7/§10.5). El manifiesto backend no incluye el contrato raíz. No deps/lockfiles/.env ni git add/commit/push.

## Verificaciones ejecutadas

Binarios locales, sin npm test/pretest/ensure-pg, downloads ni instalación:

- Prisma validate: OK; generate --no-hints: Prisma Client 7.10.1 generado en node_modules. No acredita aplicación SQL ni checks reales.
- TypeScript `tsc --noEmit`: OK final.
- Jest offline excluyendo `integration.spec.ts`: **31 suites, 467/467 pruebas**. Tras reforzar lock previo al claim: suite correo **35/35** y typecheck repetidos OK.
- ESLint cinco TS nuevos: 0 errores/advertencias.
- `git diff --check`: OK, avisos LF→CRLF preexistentes. Comparación SHA256: solo schema entre archivos baseline.

Corrida inicial falló por indexación estricta en fixture de prueba; corregida. No BD real, migración aplicada, SMTP/HTTP externo, app real ni credenciales. Concurrencia/reinicio en tests son simulados, no prueba de locks/CAS SQL reales. Cobertura nueva: config/defaultOFF, incertidumbre DATA, rechazos previos, presupuesto, replay/supresión/borrado simulado, frontera, fallo persistencia, ausencia de evidencia, aceptación+crash y reserva compartida simulada. **No** cobertura ejecutada de adaptador de permisos/preferencias/archivo/vigencia porque ese adaptador falta; esos puntos no se declaran terminados.
