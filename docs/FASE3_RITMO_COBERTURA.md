# RF22 — Promedio y cobertura (parcial local, protegido)

Fecha: 2026-11-26. Continuación del lector v1.10, sin rehacer historial ni panel. Contrato §14 v1.11 escrito antes del código. Leídos AGENTS.md, DERCAS completo mediante XML en memoria, adicendum prioritario, contrato §11–13, informe previo y escritor/lector. Recuperados mem_current_project/context/search y observaciones completas contexto-general/adminweb-scope.

## Resultado y compatibilidad

- Calculadora pura: últimas cuatro semanas cerradas lunes-lunes UTC; suma de semanas verificadas / 2, 3 o 4 semanas verificadas. No rellena ausencias con cero ni busca semanas anteriores. Actual incompleta excluida incluso lunes exacto.
- Evidencia interna por intervalos íntegros y existencia histórica acreditada del proyecto. Parciales/gaps no verifican; no fusiona intervalos. Booleano legado y fecha de frontera no acreditan la nueva calculadora. Intervalos son entradas sintéticas en pruebas, no certificados emitidos por este sistema.
- Cero observado es válido; con mínimo dos semanas devuelve promedio 0. No implementa estimación ni la habilita. Cociente Number IEEE-754 sin redondeo de negocio; conserva numerador/divisor, prueba 1/3.
- Mismo snapshot RepeatableRead y reloj BD para permisos, tareas, eventos y ausencia de cobertura. Adaptador productivo entrega `evidencia:null`: GET sigue exactamente `ritmo:{disponible:false,motivo:"COBERTURA_NO_ACREDITADA"}`. No endpoints nuevos ni campos base alterados; sin cambios a panel/clientes, RF11/RF15, filtros, errores o permisos.
- Historial existente reutilizado: FINALIZADA contable=true por proyecto fotografiado, REABIERTA no resta, recompletado suma; borrados/movimientos no reinterpretan pasado. Regresión lector/transiciones cubre archivado, eliminado, aislamiento y foto RF11.

## Mecanismo mínimo evaluado y bloqueo real

El escritor actual inserta evento y cambia estado en una transacción con locks; protege esa ruta, no escritores antiguos, SQL directo ni futuras rutas bypass. El trigger existente append-only impide modificar eventos insertados, **no obliga a registrar cambios de tareas**. Ni migración, primer evento, marca manual, heartbeat ni lease prueban captura completa o ausencia de gaps. Rolling deployment con escritor antiguo puede perder transiciones aunque el heartbeat esté vivo.

Alternativa mínima fiable a desarrollar posteriormente: captura obligatoria transaccional en BD, o revocación de DML directo y única operación DB obligatoria que capture; activación verificada bajo barrera que drene escritores antiguos y transacciones en vuelo; garantía de foto RF11 frente a altas/borrados/movimientos concurrentes; atribución segura del actor; coordinación para evitar doble registro con el escritor actual. Necesita identidad/privilegios de despliegue separados del runtime (runtime sin ownership, DDL, TRUNCATE, deshabilitación de triggers ni bypass por replication role). Un trigger de estado aislado no resuelve por sí solo todo ello.

Comprobar hoy que un trigger existe no prueba que ayer no fue deshabilitado/eliminado: requiere control verificable y durable de cambios privilegiados y cortes de cobertura ante cualquier pérdida de garantía. Superusuario/owner puede evadir protecciones: sin delimitar y verificar ese ámbito de confianza no hay evidencia completa. También deben sellarse semanas frente a transacciones cuyo `ocurridoEn` es anterior al límite pero cuyo commit llega después del snapshot: un reloj y RepeatableRead no acreditan cierre definitivo de ese historial. No se redefine aquí el instante de evento.

No hay infraestructura/privilegios/registro continuo verificados para emitir intervalos ni existencia histórica del proyecto. No se crea tabla/heartbeat/migración offline que solo almacene una afirmación imposible de validar: costo y falsa seguridad sin beneficio operativo. **Mecanismo propuesto NO implementado ni probado.** Implementado únicamente consumidor puro de futura evidencia y ausencia explícita productiva. Sin backfill, sin períodos previos habilitados, sin flags de entorno true. Estado protegido es un bloqueo operativo honesto, no ritmo operativo ni RF22 completo.

## Archivos de este incremento

- `../docs/orquestacion/CONTRATO_API.md`: §14 aditivo (v1.11).
- `src/dominio/metricas/ritmo-semanal.ts`: tipos de evidencia y promedio puro; clasificador previo preservado como diagnóstico legado, no autoridad del promedio.
- `src/dominio/metricas/ritmo-cobertura.spec.ts`: 12 pruebas nuevas de aritmética/cobertura sintética.
- `src/aplicacion/metricas/metricas.service.ts`: usa calculadora centralizada.
- `src/infraestructura/repositorios/prisma-metricas.repository.ts`: ausencia explícita de evidencia, sin SQL nuevo.
- `src/infraestructura/repositorios/prisma-ritmo-semanal.spec.ts`: certifica solo comportamiento fail-closed del doble con frontera antigua/ausente, no cobertura real.
- Este informe. Cambios anteriores dirty preservados, sin tocar historial/escritor/schema/migraciones en este incremento.

## Verificación offline

Desde Backend-SamProject, sin hooks npm:

```powershell
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/dominio/metricas/ritmo-cobertura.spec.ts src/dominio/metricas/progreso.spec.ts src/dominio/metricas/ritmo-semanal.spec.ts src/dominio/metricas/historial-finalizaciones.spec.ts src/aplicacion/tareas/tareas.service.spec.ts src/aplicacion/espacios/espacios.service.spec.ts src/aplicacion/espacios/espacios.calendario.spec.ts src/infraestructura/repositorios/prisma-ritmo-semanal.spec.ts src/infraestructura/repositorios/prisma-metricas.repository.spec.ts src/infraestructura/repositorios/prisma-tarea.estado.spec.ts src/interfaces/http/metricas.spec.ts src/interfaces/http/tareas.estado.spec.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js "src/**/*.ts" eslint.config.mjs --no-error-on-unmatched-pattern
git diff --check
```

Resultados: 157/157 pruebas, 12/12 suites; tsc correcto; ESLint 0 errores y 7 warnings previos RF20; diff-check correcto con avisos LF/CRLF preexistentes. Incluye compatibilidad HTTP y regresión de transiciones/lector. Dobles y SQL inspeccionado/emulado **no acreditan ejecución SQL, concurrencia, rollback real, continuidad, activación ni garantías de privilegios**. No BD real, migraciones aplicadas, instalaciones, dependencias, npm test/pretest/ensure-pg, frontend/AdminWeb, ESTADO/DECISIONES ni git add/commit/push. Orquestador conserva sus registros.
