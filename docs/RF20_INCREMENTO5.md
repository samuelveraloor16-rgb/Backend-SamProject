# RF20 incremento 5 — detector de vencimientos invocable

2026-11-25. Implementación local; bloqueo resuelto por aprobación explícita de
claves por destinatario, registrada por el orquestador. No se declara RF20 completo.
Se leyeron AGENTS, DERCAS docx, adicendum, contrato §9 y D-21/aclaraciones.

## Archivos del incremento

Nuevos:
- `src/dominio/puertos/vencimientos.repository.ts`: puerto de escaneo/encolado.
- `src/aplicacion/push/detector-vencimientos.ts`: servicio explícito, sin timers.
- `src/infraestructura/repositorios/prisma-vencimientos.repository.ts`: adaptador.
- `src/infraestructura/repositorios/prisma-vencimientos.repository.spec.ts`: 22 pruebas con dobles.

Modificados:
- `src/infraestructura/push/prisma-push-dispatch.repository.ts`: comparación con
  destinatario y límite superior de ventana 24 h; legacy fail-closed.
- `src/infraestructura/push/prisma-push-dispatch.repository.spec.ts`: adapta prueba
  vigente y añade 4 casos (124 previos del conjunto tras adaptación).
- Este informe.
- Fuera del repo backend: `docs/orquestacion/CONTRATO_API.md` §9.4/9.6/9.11.

Sin cambios a claves de asignaciones/comentarios, schema, migraciones, módulos,
dependencias o clientes. No se editan DECISIONES/ESTADO.

## Invocación

No hay endpoint nuevo, registro DI automático, cron, listener ni hook de arranque.
Desde un contexto backend autorizado que ya dispone de PrismaService:

```ts
const detector = new DetectorVencimientos(new PrismaVencimientosRepository(prisma));
const ahora = new Date(); // capturar una vez por barrido, instante UTC
let cursor: string | undefined;
do {
  const pagina = await detector.ejecutar(ahora, 100, cursor);
  cursor = pagina.siguiente ?? undefined;
} while (cursor !== undefined);
```

Importar las clases de los archivos nuevos indicados arriba. Este ejemplo NO se
instaló en ningún arranque. Cada invocación procesa 1–100 candidatos; devuelve
`{ examinados, encolados, siguiente }`. Fecha inválida/límite inválido: RangeError.
`siguiente: null` termina el barrido; una página llena puede requerir otra vacía.
Reiniciar cada barrido desde el principio con nuevo instante. Tras error, conservar
cursor de entrada y repetir la página **con el mismo instante `ahora`**, sin avanzar
el cursor al fallar: commits anteriores deduplican. No existe retry automático de
conflictos/timeouts ni transacción global de todo el barrido. En particular, un
conflicto concurrente `P2034`, SQLSTATE `40001` (serialization failure) o `40P01`
(deadlock), según lo exponga Prisma/adaptador, puede abortar la invocación por
propagación del error. No se traduce ni se captura aquí: el consumidor debe repetir
la misma página/instante. La transacción fallida revierte su inserción; éxitos
parciales de candidatos anteriores permanecen y el índice único evita duplicados
al repetir. Estos códigos concretos no se reprodujeron contra PostgreSQL real.

## Garantías y semántica

- UTC: 24 h en `[F−24h,F)`; al vencer en `[F,∞)`. No recupera retrospectivamente
  aviso 24 h tras F; sí recupera aviso al vencer atrasado sin horizonte inferior.
  No altera el cálculo diario de «vencida» de §0 ni estados editables.
- Tareas y subtareas elegibles se procesan individualmente, incluidas tareas padre
  con fecha propia: esto no es el conteo de progreso.
- Identidad aprobada: `venc24:<tareaId>:<usuarioId>:<fechaISO>` y
  `vencfin:<tareaId>:<usuarioId>:<fechaISO>`. A→B→A con igual fecha reutiliza
  identidad de A incluso si su fila se descartó; fecha diferente es otra identidad.
- Antes de encolar: locks compartidos de tarea/proyecto/membresía, relectura en
  transacción Serializable de responsable/fecha originales del candidato, HECHA,
  archivo, borrado y membresía actual del espacio (permiso actual de lectura).
  Recurso inexistente o join de locks ausente: sin evento. No se exige membresía
  adicional de proyecto: el acceso actual del producto es por espacio.
- `createMany(skipDuplicates: true)` utiliza índice existente `claveUnica`, no un
  Set en producción. La simulación concurrente usa Set solo como doble del índice.
  Conflictos Serializable/deadlocks/timeouts propagan error, nunca envían push.
- Dispatcher revalida antes de cada I/O usando su mecanismo existente; compara
  exactamente responsable/fecha y clave nueva, descarta HECHA, archivo, pérdida de
  acceso, borrado y ventana 24 h expirada. Vínculo/tokenVersion siguen vigentes.
  Existe intervalo entre comprobación y I/O; no cancela envíos ya iniciados.
- Keyset `id > cursor`, orden ID ascendente y `take <= 100`. Cursor depende de
  examinados, no de inserciones: duplicados o inelegibles no bloquean páginas
  posteriores. Nuevas filas/cambios detrás del cursor esperan próximo barrido.
  No hay snapshot de todo el barrido ni cota de coste SQL: filtros pueden examinar
  muchas filas internamente; no se añadió índice de fecha ni se midió EXPLAIN.

## Legacy, dedup y límites operativos

Claves antiguas sin usuario NO se reinterpretan, transfieren ni reescriben.
Dispatcher devuelve inelegible; el procesador existente descarta sin I/O cuando
las procesa. No se consultó BD ni se afirma que existan tales filas. No se creó
migración ni se modificaron datos. Clave nueva no colisiona con legacy: si alguna
entrega legacy ya ocurrió, no garantiza dedup histórica contra identidad nueva;
requiere inspección autorizada y decisión independiente. Conservar la clave es
necesario para dedup: futura limpieza o cascada elimina esa memoria de identidad.
El evento descartado no se revive si vuelve a ser elegible con idéntica clave.

Sin conexiones BD, migraciones reales, credenciales, HTTP push, dependencias nuevas,
envíos, Git add/commit/push ni cambios frontend/AdminWeb. Pendientes: PostgreSQL
aislado autorizado (locks/concurrencia reales), activación periódica independiente,
política de retención que no recree avisos atrasados, y recepción Android/iOS real.

## Verificaciones ejecutadas

Desde Backend-SamProject, sin pretest/ensure-pg:

```text
node node_modules/jest/bin/jest.js --runInBand src/aplicacion/push src/infraestructura/push src/infraestructura/repositorios/rf20.persistence.spec.ts src/infraestructura/repositorios/rf20.asignaciones.spec.ts src/infraestructura/repositorios/rf20.comentarios.spec.ts src/infraestructura/repositorios/prisma-vencimientos.repository.spec.ts
npm run typecheck
npm run lint
git diff --check
```

Resultado final: **7 suites, 146 pruebas aprobadas**, typecheck correcto; lint
0 errores/7 warnings preexistentes no-explicit-any (6 comentarios, 1 persistence).
Diff-check correcto, solo avisos LF→CRLF de archivos previos. Primera ejecución
detectó TS2532 en doble de prueba (`data[0]`); corregido antes de repetir todo.

Cobertura nueva con dobles: límites UTC ±1 ms, offset equivalente, duplicados y
concurrencia simulada, A→B→A, fecha nueva, subtarea en segunda página, progreso
ante duplicados, filtros actuales de elegibilidad y locks, reintento de página,
legacy y descarte pre-I/O. Los seis escenarios de inelegibilidad verifican forma
del filtro y respuesta nula simulada; no prueban permisos/locks contra PostgreSQL.

Baseline SHA256 de archivos versionados/no ignorados al comenzar este incremento:
`C:\Users\samue\AppData\Local\Temp\opencode\rf20-inc5-approved-baseline.json`.
La comparación final contra ese baseline identifica exclusivamente los siete
archivos backend listados; el contrato es el octavo archivo fuera de ese repo.
Incrementos 1–4 ya estaban sin commit y se preservan fuera del delta descrito.
