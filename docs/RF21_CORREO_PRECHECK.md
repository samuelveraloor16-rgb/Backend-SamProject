# RF21 correo — precheck bloqueado antes de implementación

2026-11-26. No implementación, migración ni cambio contractual. RF21 no completo.

## Evidencia y alcance seguro

Leídos AGENTS.md, DERCAS v1.1 docx (XML en memoria), adicendum v1.2, contrato vigente v1.6 §§8–10 e informes RF21 preferencias/bloque2A/continuación2A. El baseline ya incluye preferencias y aplicación push/in-app no confirmadas; no se restaura contra HEAD.

- DERCAS RF21 exige correo/in-app configurables; sus invariantes excluyen recordatorios de proyectos archivados.
- §10 inicial anticipa outbox, reintentos y mensajes genéricos; §10.1 fija correo=false para los cinco tipos. Excluye INVITACION/SISTEMA, RF03 y RF06.
- §10.4 amplía **solo in-app**, no SMTP: sus tombstones, no retroactividad y reglas de replay no autorizan automáticamente el mismo diseño para correo.
- §9.6 define cinco intentos/backoff/ventanas para **push**. §9.11.4 programa únicamente PushCoordinator con PUSH_SCHEDULER_ENABLED exacto true. No son políticas SMTP aprobadas.
- La instrucción actual autoriza outbox durable/migración offline, preferencias al encolar y revalidación de acceso/preferencia/vigencia antes de SMTP, mensaje genérico, reintentos acotados, SMTP post-commit y programación default OFF hasta configuración válida. No resuelve las preguntas siguientes.

## Preguntas críticas para aprobación

Cada propuesta de esta sección está **NO aprobada**. No se implementa ni se presenta como decisión vigente.

1. **Entrega incierta:** ¿priorizar evitar duplicados o recuperar posibles pérdidas cuando SMTP aceptó DATA y se perdió respuesta, o murió el proceso antes de persistir aceptación? Message-ID estable no obliga al receptor a deduplicar; aceptación SMTP tampoco acredita llegada al buzón. Propuesta NO aprobada: estado durable INCIERTO sin reenvío automático ante resultado ambiguo, aceptando pérdida potencial; alternativa explícita, reintentar aceptando duplicados. Es necesario escoger y definir qué fallos se consideran inequívocos/ambiguos.
2. **Identidad y replay:** ¿cuál es la identidad SMTP por evento/destinatario, independiente de in-app/push/tipo, y consumen identidad los eventos con correo deshabilitado? ¿Activar después permite retroactividad? Propuesta NO aprobada: identidad propia del canal correo, digest único del evento confirmado+destinatario, consumir aun suprimido y no retroactividad; mismo comentario/responsable con precedencia MENCION sin fallback. Reutilizar el marcador in-app suprimiría indebidamente correo y no está autorizado.
3. **Borrado y retención:** ¿qué evidencia de dedup/aceptación/incertidumbre sobrevive al borrado de aviso, comentario, tarea, proyecto y usuario, por cuánto tiempo, y qué datos pueden purgarse? Propuesta NO aprobada: tombstone SMTP mínimo separado de datos purgables, sin FK destructiva ni limpieza automática inicialmente; aprobar expresamente conservación y tratamiento de usuario eliminado. Una FK CASCADE del outbox por sí sola permite recreación y no satisface durabilidad de identidad.
4. **Budget/reintentos/lease:** ¿cuántos intentos, qué errores SMTP transitorios/permanentes, backoff, antigüedad máxima por evento, límite por destinatario y qué consume budget? ¿Qué ocurre al vencer lease con sendMail todavía en vuelo? Propuesta NO aprobada: fijar budget y backoff SMTP explícitos, fencing/CAS para escrituras y exclusión local, pero **no** tratar expiración de lease como prueba de ausencia de envío. Un timeout o fencing no cancela un SMTP remoto ya aceptado; recuperación debe concordar con (1), sin nuevo envío concurrente por mera expiración. No importar automáticamente los cinco intentos push.
5. **Dirección del destinatario:** ¿resolver email actual al despachar, snapshot al encolar, o descartar si cambió? ¿Se exige email verificado y cómo se acredita? El modelo Usuario tiene email único pero no campo de verificación; PATCH /perfil no ofrece cambio de correo. Eso no decide una política futura ni habilita inventar verificación. Propuesta NO aprobada: resolver dirección actual inmediatamente antes del I/O, sin snapshot privado persistente, sujeto a aprobación explícita sobre cuentas no verificadas y cambio de dirección. Definir también si logout/tokenVersion afectan correo; no heredar la regla de dispositivos.
6. **Configuración válida y opt-in:** ¿qué combinación exacta de host/puerto/from/auth/TLS habilita RF21, se permite SMTP local sin TLS, exige STARTTLS y validación de certificado, y qué flags independientes controlan detector/despacho? Propuesta NO aprobada: flags exclusivos SMTP exactos true, validación local fail-closed sin verify/red ni defaults de desarrollo como prueba de validez; separar correo de PUSH_SCHEDULER_ENABLED/EXPO_PUSH_ENABLED y no tocar RF03/RF06. Especificar puertos/modos/auth y cadencia/lotes antes del wiring. El scheduler existente solo invoca push; usarlo como puerta de correo acoplaría canales.
7. **Eventos y vigencia exacta:** ¿se adoptan explícitamente destinatarios, exclusión de autor, precedencia MENCION, ventanas UTC y vencimiento sin responsable de §9, y qué vuelve obsoleta asignación/comentario (reasignación, tarea hecha, traslado, archivo, eliminación, edad)? Propuesta NO aprobada: adoptar explícitamente la matriz de eventos y precisar una tabla de elegibilidad SMTP por tipo antes de crear hooks/detector; acceso actual y preferencia actuales son necesarios, pero no definen por sí solos vigencia temporal. La revocación posterior a la última comprobación no puede retirar un SMTP ya iniciado.

## Hallazgos de integración (no cambios)

`src/infraestructura/correo/smtp-mailer.ts:14–24` crea Nodemailer con defaults RF03 locales, sin requisito STARTTLS explícito. `enviar():Promise<boolean>` (27–44) descarta la distinción rechazo/resultado incierto y registra asunto/mensaje de error externo. No basta para clasificación segura RF21; cambiarlo globalmente afectaría recuperación e invitaciones. Se requiere política aprobada y adaptación compatible, con diagnóstico sanitizado, no sustituirlo especulativamente ni exponer direcciones/errores SMTP crudos.

`src/infraestructura/push/push-scheduler.ts:13–16` tiene intervalo de 60 s con opt-in solo push. Su coordinador combina detección/despacho push; no se añade correo allí ni se activa ningún canal. Schema actual tiene IdentidadAviso de in-app, PushOutbox y PushIntento, no una política durable SMTP. No se crean schema, estados, interfaces muertas, procesador o migración para anticipar respuestas.

## Resultado y verificaciones

Todos los cambios ejecutables solicitados dependen de estas decisiones: se detiene la implementación entera antes de tocar código. Único archivo nuevo de esta entrega: `docs/RF21_CORREO_PRECHECK.md`. Contrato/DECISIONES/ESTADO y clientes son solo lectura; sin endpoints nuevos.

Baseline SHA256 de 146 archivos backend versionados y no ignorados guardado antes de editar en `%TEMP%/rf21-correo-precheck-baseline.json`; incluye avances locales RF20/RF21. La comparación final se informa al orquestador. No se crea manifiesto nuevo dentro del repositorio.

Jest, Prisma validate/generate, typecheck y lint **no ejecutados**: bloqueo previo a cambios de código/schema, según instrucción; no se atribuyen a esta entrega las verificaciones de informes anteriores. Tampoco PostgreSQL, migraciones aplicadas, app/ensure-pg/pretest, HTTP/SMTP reales, dependencias ni add/commit/push. Solo inspección estática y comprobación de preservación/whitespace documental.

Tras aprobación contractual del orquestador: implementar y probar preferencias/revocación/replay/fallos inequívocos e inciertos SMTP, concurrencia simulada, expiración con I/O en vuelo y separación de flags; ejecutar checks offline solicitados. Los dobles no demostrarán concurrencia PostgreSQL ni entrega física.
