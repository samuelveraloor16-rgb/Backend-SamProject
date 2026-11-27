# Fase 3 — módulo 12, bloque 1: base RF22

Fecha: 2026-11-26. Base comprobada: HEAD `aeee96d2de708b0841bc8a51d6645e9800653f30`, backend limpio antes de cambios. Entrega local sin commit/push; aceptación de Fase 2 abierta y pendientes preservados. No se declara RF22 ni Fase 3 completos.

## Contrato previo y endpoint

Se leyeron `agents.md` raíz (no existe AGENTS/agents local en backend), DERCAS DOCX, adicendum v1.2, contrato v1.7 completo y conteo RF11 antes de modificar. Se formalizó **v1.8 §11 antes de código**, sin editar registros de estado/decisiones/fases del orquestador.

`GET /api/v1/proyectos/:id/metricas`, JWT vigente, MIEMBRO o ADMINISTRADOR del espacio, sin exigir ProyectoMiembro. Archivado/Bandeja permiten leer; ajeno/inexistente/borrado físico o lógico → 404 genérico idéntico. Sin filtros, query/body ni paginación (objeto vacío admitido). Validación y errores estándar, sin nuevas políticas de autenticación o retry.

Respuesta bare: `proyectoId`, `calculadoEn`, `total`, `hechas`, `pendientes`, `enCurso`, `trabajoPendiente`, `vencidas`, `progreso`. Pendientes = estado PENDIENTE; trabajoPendiente = PENDIENTE + EN_CURSO. Los tres estados particionan total; vencidas es subconjunto de no hechas y no estado adicional. Todas las cifras usan la misma población RF11 (padre con subtareas excluido).

## Arquitectura y coherencia

- Servicio reutilizable `MetricasService`, exportado por módulo propio; puerto de lectura e infraestructura Prisma separados. Sin cálculos de negocio en controlador/cliente.
- Se reutiliza **sin modificar** `dominio/metricas/progreso.ts`: mismas reglas, porcentaje con un decimal, vacío 0. RF11 conserva wire y comportamiento funcional. Su adaptador pasa a usar la misma selección compartida `leerTareasContables`: `subtareas: { none: {} }` en una sentencia, en lugar de leer primero IDs de padres y después excluirlos; evita desfase entre esas dos consultas. No se duplica el algoritmo de conteo.
- Métricas consulta existencia, membresía y tareas dentro de transacción RepeatableRead. La membresía se restringe al espacio del proyecto en el predicado; no acepta espacio/usuario del cliente. Una sola colección alimenta todos los números. Referencia `calculadoEn` capturada una vez por backend al comenzar; no significa timestamp de commit/MVCC ni garantiza igualdad entre peticiones distintas.
- RF15 vigente usa inicio del día **local del servidor**, no instante exacto ni UTC de recordatorios. Se preserva esa regla: fecha igual al inicio del día no vence; fecha pasada dentro del día actual tampoco. Sin migración silenciosa de zona horaria.
- Tarea no tiene flag de borrado: solo se cuentan filas existentes. Eliminar última subtarea vuelve contable al padre; movimiento de padre/subtareas altera origen y destino. Proyecto tiene eliminadoEn; se excluye en nueva lectura sin cambiar endpoints existentes.
- Fuente única para integración futura: selección y cálculo compartidos RF11 + servicio exportado. Panel/asistente/AdminWeb no implementados aquí: **no se verificó coherencia integral entre clientes**.

## Lectura de historial (sin cambios)

`Tarea.creadoEn` y `fechaFinalizacion` existen. `TareasService.cambiarEstado` establece fecha al entrar en HECHA y la limpia al salir; recompletar sustituye fecha. `RegistroDeCambios` existe en schema, pero búsqueda en src no encuentra uso/escritura del modelo. No hay evidencia de historial completo de transiciones. Los borrados físicos pierden tareas; movimientos cambian la atribución actual.

DERCAS sí fija promedio de últimas **4 semanas**, rango mejor/peor semana y datos insuficientes con menos de 2 semanas o cero completadas. Campos actuales permiten estudiar completadas actuales por fecha, pero no reconstruir fielmente eventos históricos. Quedan decisiones para ritmo: ventana móvil vs semanas de calendario UTC y límites inclusivos, inicio verificable del historial, reapertura/recompletado y población histórica ante subtareas/borrado/movimiento. **No se implementan ritmo, estimación ni una política inventada**; esa parte queda detenida hasta decisión contractual.

## Archivos exactos

Modificados:
- `docs/orquestacion/CONTRATO_API.md` (raíz del workspace): extensión v1.8 y ruta en resumen.
- `Backend-SamProject/src/app.module.ts`: importar MetricasModule; sin tocar RF19/20/21 ni cron.
- `Backend-SamProject/src/infraestructura/repositorios/prisma-proyecto.repository.ts`: delegar selección RF11 al helper común.

Añadidos:
- `Backend-SamProject/src/dominio/puertos/metricas.repository.ts`
- `Backend-SamProject/src/aplicacion/metricas/metricas.service.ts`
- `Backend-SamProject/src/infraestructura/repositorios/tareas-contables.ts`
- `Backend-SamProject/src/infraestructura/repositorios/prisma-metricas.repository.ts`
- `Backend-SamProject/src/infraestructura/metricas/metricas.module.ts`
- `Backend-SamProject/src/interfaces/http/metricas.controller.ts`
- `Backend-SamProject/src/infraestructura/repositorios/prisma-metricas.repository.spec.ts`
- `Backend-SamProject/src/interfaces/http/metricas.spec.ts`
- `Backend-SamProject/docs/FASE3_METRICAS_BLOQUE1.md` (este informe).

## Verificaciones ejecutadas

Desde Backend-SamProject, usando herramientas ya instaladas, **sin npm test/pretest/ensure-pg**:

```text
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/infraestructura/repositorios/prisma-metricas.repository.spec.ts src/interfaces/http/metricas.spec.ts src/dominio/metricas/progreso.spec.ts src/aplicacion/proyectos/proyectos.service.spec.ts
→ 4 suites, 54 tests PASS (13.313 s)
node node_modules/typescript/bin/tsc --noEmit
→ PASS, sin diagnósticos
node node_modules/eslint/bin/eslint.js "src/**/*.ts" eslint.config.mjs --no-error-on-unmatched-pattern
→ 0 errores, 7 warnings preexistentes en rf20.comentarios.spec.ts / rf20.persistence.spec.ts
git diff --check
→ PASS; Git avisa normalización LF/CRLF, sin errores whitespace
```

Primera pasada detectó cuatro accesos a arrays de fixture posiblemente undefined y tres variables destructuradas sin usar; corregidos antes de la pasada verde anterior. No se ejecutó build ni suite de integración/BD.

Cobertura pertinente: proyecto vacío; simples/subtareas/padre no duplicado; estados/reapertura; 33.3/66.7/100 y vacío; fechas antes/igual/después del inicio del día, después del reloj, null y HECHA; pendientes/enCurso/vencidas subconjunto; referencia única incluso cruzando medianoche durante lectura; roles miembro/admin y sin acceso, distintos espacios, proyecto lógico/físico eliminado, archivado, última subtarea eliminada, movimiento y cascada simulados; regresión wire RF11; JWT ausente/malformado/caducado/revocado/usuario inexistente; rutas/métodos, query y body con campos no permitidos, formato 404 indistinguible.

## Límites y pendientes preservados

- Dobles de puerto/Prisma + módulo Nest de pruebas HTTP aislado con JWT real y persistencia simulada. No AppModule real, conexión BD, migración, arranque productivo, instalación, envíos SMTP/push ni llamadas externas. No se modificaron .env ni datos reales.
- El doble comprueba forma de predicados, selección compartida, transacción solicitada y composición. **No ejecuta SQL ni demuestra aislamiento RepeatableRead, concurrencia, locks o rendimiento PostgreSQL reales**. Cambios simulados son secuenciales, no evidencia de carreras reales.
- Pendiente prueba real autorizada de selección/aislamiento ante borrado, revocación, archivo y movimiento concurrentes. Carga completa de contables en memoria, sin promesa de escalabilidad independiente del tamaño del proyecto.
- Fase 2 sigue abierta: no se modificaron correo existente, cron, RF19/20/21 ni sus bloqueos de verificación/despliegue/entrega física.
- Sin gráficas, frontend, RF23, IA, estimación ni AdminWeb. Sin git add/commit/push. Orquestador mantiene sus registros y decide aceptación/publicación.
