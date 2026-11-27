# RF23 — Reporte resumen backend (bloque 1)

## Preimplementación y revisión de dependencias

Base verificada: `d73d87b`, árbol backend inicialmente limpio. Alcance exclusivo backend y contrato delegado; sin Git write, BD real, AppModule ni envíos.

Elección propuesta antes de instalar: `pdfmake@0.3.15` (MIT), registro oficial npm, repositorio `github.com/bpampuch/pdfmake`, última modificación declarada 2026-11-20; Node >=20.19 (entorno v24.15). Motor declarativo sin HTML ni plantillas del usuario, sin URLs, imágenes ni acceso a recursos aportados por el usuario. CSV no necesita paquete. PDF se verificará con `pdfjs-dist@6.5.438` (Apache-2.0), exclusivamente dev: parser independiente para páginas, texto y fuentes, no una comprobación de firma. Su tamaño (~37.6MB sin comprimir) se acepta solo en desarrollo. No se incorporará un parser PDF al runtime.

Revisión previa: npm declara pdfmake -> pdfkit ^0.21.0, xmldoc ^2.0.3, linebreak ^2, @noble/hashes ^2.4 y @pdfmake/svg-to-pdfkit ~0.2. Se revisará resolución completa/advisories antes de instalar código; scripts deshabilitados. Roboto empaquetada necesita revisión de licencia y cobertura antes de fijar implementación. Sin promesa de Unicode universal.

Hallazgos baseline `npm audit --omit=dev`: 4 paquetes high (`nodemailer`, `effect`, `@prisma/config`, `prisma`). No son introducidos por RF23. Nodemailer 8 presenta múltiples advisories de acceso a recursos, parsing y SMTP (entre ellos GHSA-p6gq-j5cr-w38f, GHSA-6vj9-mwq6-2f5v y GHSA-4ffr-jq9g-5ffx); effect GHSA-7589-6fvf-x4pw. Requieren remediación separada y revisión antes de despliegue; no se ejecutarán envíos ni actualizaciones mayores ajenas al alcance.

Preinstalación: resolución aislada mediante `npm install --package-lock-only --ignore-scripts` (sin instalar código) y `npm audit --json`: 0 vulnerabilidades en el grafo propuesto, 30 dependencias contando opcionales. Fuente Roboto del tag 0.3.15 revisada en API GitHub; inicialmente se revisó Apache-2.0 del repositorio histórico `googlefonts/roboto`, pero **esa licencia no corresponde al TTF actual**. La comprobación del binario instalado (tabla name ids 0/13/14) detectó la diferencia antes de finalizar la implementación: `Copyright 2011 The Roboto Project Authors (https://github.com/googlefonts/roboto-classic)`, **SIL OFL-1.1**. Se corrigieron contrato y licencia local; no se oculta que la revisión exacta del metadato fue posterior a la instalación, aunque la resolución/advisories/elección de motor se revisaron antes. OFL permite empaquetar e incrustar, sin vender la fuente por separado y conservando aviso/licencia; no impone licencia al documento resultante. Texto completo verificado en `https://raw.githubusercontent.com/googlefonts/roboto-classic/main/OFL.txt`, incluido en `docs/licencias/Roboto-OFL-1.1.txt`. Fuente sin modificar y motor fijados por lock, sin descarga runtime.

## Dependencias y seguridad resultantes

Instalación real: `npm install --save-exact --ignore-scripts --no-fund pdfmake@0.3.15` y `npm install --save-dev --save-exact --ignore-scripts --no-fund pdfjs-dist@6.5.438`. No se ejecutaron scripts de paquetes. Grafo nuevo aislado sin advisories; audit completo final: **23 paquetes afectados (19 moderate, 4 high)**. Consulta read-only al endpoint npm bulk contra el lock original confirma que los advisories primarios ya estaban: effect, nodemailer, glob (GHSA-3g3m-2fjr-6pw4), minimatch (GHSA-g3hv-75wg-m249); estos dos últimos propagan los 19 moderate a herramientas Jest/Nest CLI. No se declara el repositorio libre de vulnerabilidades. Remediación del baseline y revisión de despliegue siguen pendientes, sin `audit fix` ni actualización ajena.

Lock: solo dos dependencias directas nuevas y **30 entradas nuevas**, ninguna versión preexistente cambiada/eliminada. Runtime: pdfmake 0.3.15; pdfkit 0.21.0; fontkit 3.0.0; @pdfmake/svg-to-pdfkit 0.2.0; xmldoc 2.0.3; sax 1.6.1; linebreak 2.0.0; @noble/hashes 2.4.0 (dos ubicaciones); @noble/ciphers 2.4.0; fflate 0.8.3; png-js 3.0.0; brotli 2.1.0; dfa 2.0.0; restructure 3.0.2; unicode-properties 2.0.2; unicode-trie 3.0.0. Todos MIT salvo sax BlueOak-1.0.0 (permisiva, avisos conservados por npm). Dev: pdfjs-dist 6.5.438 Apache-2.0 y @napi-rs/canvas 1.2.1 + 11 binarios opcionales por plataforma, MIT; no se dibuja canvas ni se llama desde producción. Las integridades SHA512 y orígenes registry.npmjs.org quedan en lock.

Roboto-Regular.ttf empaquetada en dependencia runtime (157216 bytes), SHA256 `a6ec0ffaad7339c18c90c6a9728465e9003ae725a8769401af356a8afe523690`. No se copia ni descarga en ejecución; `require.resolve` de ruta constante del paquete y lectura local fija. Conservar `docs/licencias/Roboto-OFL-1.1.txt` en distribuciones. El motor se instancia por solicitud (API Printer interna del paquete fijado); no se usa el singleton global de pdfmake. Actualizar pdfmake exige revisar esta API, fuente, licencia y glifos otra vez.

## Contrato y arquitectura

`docs/orquestacion/CONTRATO_API.md` **v1.12 §15**, agregado antes del código (corrección posterior de licencia a OFL). Rutas bajo `/api/v1`:

- `GET /proyectos/:id/reportes/resumen.csv`
- `GET /proyectos/:id/reportes/resumen.pdf`

Se mantiene RF22 v1.11 §14. Se amplía solo el puerto interno de snapshot para seleccionar id/nombre en la misma consulta autorizada y transacción RepeatableRead; `MetricasService.obtenerResumenIdentificado` calcula una sola vez con las funciones RF22 actuales; `obtener` conserva exactamente su wire. Renderer detrás de puerto, sin repositorio, relojes ni operaciones de negocio; pruebas con cifras deliberadamente inconsistentes acreditan copia literal, no sumas del renderer. Permisos RF22 para administrador/miembro, archivo/Bandeja y 404 genérico. No nuevo 403. Una solicitud no acredita snapshot de otra solicitud.

CSV BOM UTF8, RFC4180, coma y CRLF, cabecera + una fila, neutralización de fórmula en todos los textos con prefijos Unicode/control, columnas fijas §15. Ritmo `NO_DISPONIBLE`, motivo literal, promedio vacío. PDF A4, fuente embebida/subconjunto, contenido declarativo fijo, sin HTML, tareas, gráficas, links o recursos remotos. Se verifica cmap Unicode BMP formato4 de la fuente; fuera de cobertura/control no representable -> 422, sin sustitución `.notdef`. Acentos/nombres largos probados, CJK/emoji/invisibles/tab en PDF rechazados explícitamente; CSV Unicode válido preservado con escape de seguridad. No se promete Unicode universal ni representación de todos los sistemas de escritura.

Límites: identificación <=1000 puntos de código/32 líneas por campo, sin truncado; salida <=1MiB. Justificación: solo 13 columnas/filas fijas, fuente fija ~157KB antes del subconjunto, margen holgado para el resumen sin permitir salida arbitraria. Acumulación PDF acotada; generación acaba antes del objeto de descarga. Entrada acotada limita layout, pero no se acredita DoS/carga ni cota total del heap interno del motor. Filename ASCII fijo, nunca nombre/id del usuario; no archivos temporales ni estado global. Cabeceras attachment, private/no-store y nosniff. Excepciones 422/500 JSON sin attachment ni contenido/stack crudo; no logs PDF/JWT.

## Archivos exactos

Modificados:
- `package.json`, `package-lock.json` (dependencias anteriores).
- `src/aplicacion/metricas/metricas.service.ts` (proyección interna compartida).
- `src/dominio/puertos/metricas.repository.ts` (identificación en snapshot).
- `src/infraestructura/repositorios/prisma-metricas.repository.ts` (select nombre en misma consulta).
- `src/infraestructura/repositorios/prisma-metricas.repository.spec.ts` (regresión + snapshot identificado).
- `src/infraestructura/metricas/metricas.module.ts` (DI/controlador reportes).
- `../docs/orquestacion/CONTRATO_API.md` (delegación exclusiva v1.12 §15).

Nuevos:
- `src/aplicacion/reportes/reportes.service.ts`.
- `src/dominio/puertos/reporte-resumen.renderer.ts`.
- `src/infraestructura/reportes/resumen.renderer.ts`, `fuente.ts`, `pdfmake-printer.d.ts`.
- `src/interfaces/http/reportes.controller.ts`, `reportes.spec.ts`.
- `scripts/inspeccionar-pdf-rf23.mjs` (parser offline solo pruebas).
- `docs/licencias/Roboto-OFL-1.1.txt`.
- `docs/RF23_REPORTES_BACKEND.md` (este informe).

Artefactos transitorios de revisión aislada retirados; ningún schema/migración/código de clientes/registro de orquestación cambiado.

## Verificaciones

Comandos directos, evitando `pretest`/ensure-pg:

```powershell
$env:NODE_OPTIONS='--experimental-vm-modules'
npx jest --runInBand --runTestsByPath src/interfaces/http/reportes.spec.ts src/interfaces/http/metricas.spec.ts src/infraestructura/repositorios/prisma-metricas.repository.spec.ts
npx jest --runInBand
npx tsc --noEmit
npm run lint
git diff --check
```

Jest necesita VM modules para las transitivas ESM del motor, incluso en Node24; sin la opción la primera ejecución falla al cargar fontkit (no un fallo de la API productiva). Parser independiente pdfjs ejecutado en proceso Node offline por stdin sin archivos temporales; acredita parseo de páginas/operadores/texto y fuente incrustada (no solo firma PDF).

Focalizadas: **59/59** (3 suites), incluidas 31 RF23 y 28 RF22; typecheck correcto. Lint focal RF23 sin errores/warnings; global 0 errores/7 warnings preexistentes en RF20. Diff-check correcto, avisos Git LF/CRLF no son errores. La primera regresión global encontró una aserción de espacio final eliminada por extracción PDF; se corrigió a comparación semántica sin modificar valores exportados.

Regresión global final: **40 suites correctas, 2 omitidas; 582 pruebas correctas, 44 omitidas (626 total)**, 55.821s. Incluye métricas RF22, ritmo sintético e historial/escritor previo. Las omitidas no constituyen evidencia de BD/concurrencia real. No se modificó configuración Jest para ocultar fallos. `--experimental-vm-modules` es requisito del comando de pruebas con este grafo; no ejecuta servicios externos.

## Aceptación y límites pendientes

Entrega local backend, sin add/commit/push. **No completa RF23 sin móvil**: faltan consumo/descarga/compartir y verificación en dispositivos; no se modificó Frontend/AdminWeb. RF19/20/21/22 conservan aceptación abierta, SQL/aislamiento/concurrencia reales no acreditados. Cobertura histórica RF22 sigue no acreditada y ritmo no disponible; no se habilitó estimación ni rama pública disponible. No se arrancó AppModule/scheduler, no hubo SMTP/push, BD real/migración aplicada, APK ni pruebas físicas. No se certifica despliegue ni operación bajo carga. Los findings de seguridad baseline requieren seguimiento antes de despliegue.
