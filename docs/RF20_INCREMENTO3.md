# RF20 — incremento 3 (sin activación automática)

Contrato público v1.4 §9 y D-21 sin cambios. Los cinco endpoints del incremento 2
permanecen iguales. `PushDispatcher.despachar(limite=100)` está exportado por
`PushPersistenceModule`; no tiene controlador, cron ni listeners. No se conectan
todavía eventos de asignación, comentarios o vencimientos.

## Operación y almacenamiento

- `PushProvider` es el puerto; `ExpoPushProvider` recibe fetch inyectado, aborta y
  acota a 10 s cada petición. La composición Nest lee **solo servidor**
  `EXPO_PUSH_ENABLED=true` y `EXPO_ACCESS_TOKEN`. Sin ambos no hace HTTP; no existe
  secreto por defecto. No se modificó ningún archivo de entorno.
- Claim CAS de `PENDIENTE`, intentos y fecha, serializado con advisory lock por
  usuario en transacción **corta**. Consume intento, reserva lease de 2 min.
  No se mantiene transacción durante el envío. Un worker viejo no finaliza un
  intento nuevo. Caída del proceso: el lease permite recuperar; si ya consumió
  cinco intentos, pasa a `FALLIDO` sin sexto envío.
- Hasta cinco intentos por fila. Backoff `min(2 h, 1 min * 2^(intento-1))`:
  en errores normales las cuatro esperas útiles son 1, 2, 4, 8 min. Red, timeout,
  HTTP 429/5xx y `MessageRateExceeded` son transitorios. Error de configuración
  seguro también se reprograma con este límite. Otros rechazos son definitivos.
- `DeviceNotRegistered` y token sintácticamente malformado borran **solo** el
  dispositivo con mismo id, propietario, token, versión y generación leída;
  no borran una transferencia o revinculación posterior. `actualizadoEn` del
  vínculo avanza al menos 1 ms incluso dentro del mismo milisegundo, para evitar
  ABA en respuestas tardías. La hora del último envío no cambia esa generación.
- Antes de **cada** petición se consulta nuevamente el claim, vínculo/propietario,
  versión actual del usuario, membresía actual del espacio, tarea/proyecto y,
  para comentario, existencia, autor excluido y mención/responsable actual RF19.
  Vencimientos comprueban estado, archivado, ventana UTC y fecha de la clave
  contra la fecha actual (trabajo atrasado de una fecha reemplazada se descarta).
- Migración adicional **offline, no aplicada** `20261125130000_rf20_dispatch_journal`:
  el diario `PushIntento` es necesario porque el outbox anterior no podía guardar
  aceptación parcial por dispositivo ni reservar frecuencia entre workers.
  No contiene token, código, contenido, credenciales ni ticket del proveedor.
  Registra aceptación/rechazo definitivo por outbox y generación de vínculo.
  Las aceptaciones conocidas se deduplican por evento, dispositivo y cuenta
  incluso tras refrescar el vínculo, evitando repetir éxitos en reintentos
  parciales. Se reservan como
  máximo **10 intentos/minuto por usuario**, entre workers, antes de cada I/O.
  Una reserva cuenta aunque el proceso caiga antes de hacer HTTP; fail-closed.
  Los límites y errores consumen el presupuesto acotado de la fila.
- Estados: sin destinos elegibles/tokens inválidos → `DESCARTADO`; aceptaciones
  sin fallos → `ENVIADO`; rechazo definitivo o quinto fallo → `FALLIDO`;
  fallo transitorio con presupuesto → `PENDIENTE`. Con varios dispositivos,
  se conservan éxitos parciales en el diario. Un rechazo definitivo de otro
  dispositivo hace que la fila termine `FALLIDO`, aunque existan éxitos parciales.
- Solo logs técnicos fijos. Ni errores originales ni respuestas del proveedor
  se imprimen. Caída de Expo no toca ni revierte transacciones de negocio.

## Límites explícitos (no garantías de entrega)

- `ENVIADO` significa **ticket de aceptación por Expo**, NO recepción ni
  visualización en Android/iOS. §9 no define polling/retención de tickets y
  receipts: este incremento no consulta receipts ni detecta un
  `DeviceNotRegistered` que aparezca exclusivamente en un receipt posterior.
  Esa política requiere definición antes de implementarse; no se inventa aquí.
- No hay transacción distribuida con Expo: un timeout ambiguo, caída tras la
  aceptación pero antes de escribir el diario, o pausa del proceso que exceda
  el lease pueden causar duplicados. La clave única deduplica el evento local;
  NO constituye exactly-once externo. Los tests prueban CAS y predicados con
  mocks; no acreditan locks/concurrencia reales de PostgreSQL.
- La revalidación es inmediatamente anterior al I/O, pero existe una carrera
  inevitable entre esa consulta y la aceptación del proveedor. No bloquea
  transferencias/logout durante una petición de red. No puede retirar un push
  ya aceptado/en tránsito/mostrado; payload siempre mínimo. Ningún test acredita
  cero entregas físicas después de una invalidación concurrente.
- JWT caducado **no** cambia tokenVersion: §9.7 acepta que continúen pushes.
  No hay sesión con caducidad por dispositivo en el esquema. Logout sin red
  tampoco es detectable hasta reconectar. No se inventa expiración adicional.
- Se serializan conservadoramente filas del mismo destinatario: un backoff
  pendiente también demora otras filas de ese usuario. No se promete throughput.
- Pendientes: activar eventos y cron autorizados, limpieza periódica y retención
  del outbox **y del diario**, política de receipts, aplicar migraciones solo en
  entorno aislado autorizado, credenciales, Android/iOS reales. No se conectó
  PostgreSQL ni se hicieron peticiones reales en este incremento.
