# Backend-SamProject

API REST de **SamProject** — gestión de tareas y proyectos para equipos pequeños y emprendedores. NestJS + TypeScript + PostgreSQL (Prisma), arquitectura limpia (dominio → aplicación → infraestructura → interfaces) y monolito modular.

## Requisitos

- Node.js 24 (o 22.12+) y npm 10+
- PostgreSQL 16+ en `127.0.0.1:5432` (local, auth **trust** en desarrollo). La base de datos `samproject` debe existir.
- (Opcional) MailHog en `127.0.0.1:1025` para capturar correos de recuperación en desarrollo (UI en `http://127.0.0.1:8025`). Si SMTP no está disponible, el error se registra en consola y el flujo responde igual.

## Puesta en marcha

```bash
# 1. Crear .env a partir del ejemplo y rellenar valores
cp .env.example .env

# 2. Instalar dependencias
npm install

# 3. Base de datos (ver abajo "Arranque automático de PostgreSQL")
npm run prisma:migrate   # aplica las migraciones (prisma migrate dev)

# 4. Arrancar en desarrollo (predev arranca PostgreSQL si no responde)
npm run start:dev
```

La API queda en `http://localhost:3000/api/v1`.

### Arranque automático de PostgreSQL (desarrollo local)

No hace falta iniciar PostgreSQL a mano: `npm run start:dev` y `npm test` ejecutan antes `scripts/ensure-pg.cjs` (`predev` / `pretest`), que comprueba el puerto 5432 y, si no responde, lanza el binario local (`PG_CTL`/`pg_ctl`, rutas configurables vía `PG_HOME`, `PG_DATA`, `PGHOST`, `PGPORT`).

**CI no usa este script**: GitHub Actions levanta un servicio `postgres` (ver `.github/workflows/ci.yml`) y `ensure-pg` simplemente detecta que el puerto ya responde.

## Variables de entorno

Ver `.env.example`. Las esenciales:

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión PostgreSQL (`postgresql://postgres@localhost:5432/samproject` en local) |
| `JWT_SECRET` | Secreto HMAC del JWT. **Obligatorio; nunca en el repo.** Generar con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | Expiración del access token (p. ej. `12h`, `1d`; por defecto `12h`) |
| `PORT` | Puerto HTTP (defecto `3000`) |
| `CORS_ORIGIN` | Orígenes permitidos, separados por coma (desarrollo) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | SMTP (dev: MailHog) |
| `FRONTEND_URL` | URL base del enlace de recuperación (dev: `samproject://reset`) |
| `RESET_TOKEN_TTL_MINUTES` | Validez del token de recuperación (30–60 recomendado) |

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run start:dev` | Desarrollo con watch (arranca PG antes vía `predev`) |
| `npm run build` / `npm start` | Compila a `dist/` / arranca compilado |
| `npm test` | Jest (hook `pretest` → `ensure-pg.cjs`) |
| `npm run lint` | ESLint 10 (flat config) |
| `npm run typecheck` | `tsc --noEmit` (TS estricto) |
| `npm run prisma:generate` | Genera el cliente Prisma |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:deploy` | `prisma migrate deploy` (CI/producción) |

### Mantenimiento opt-in de idempotencia RF-19

Existe una entrada interna de mantenimiento, no un endpoint ni un job activado al iniciar la API. Tras compilar, un operador puede preparar una tarea periódica local (p. ej. Programador de tareas de Windows) que arranque `node dist/infraestructura/mantenimiento/limpiar-idempotencias.js --ejecutar` desde el directorio del backend, con la variable de proceso `RF19_LIMPIEZA_HABILITADA=true`. Ambas condiciones son obligatorias; sin ellas no se abre el contexto de aplicación. La variable debe configurarse en el entorno del proceso de mantenimiento, no en parámetros que contengan credenciales. La conexión se carga de la configuración habitual; proteger `.env`, cuenta, directorio de trabajo y registros. No usar secretos en la línea de comandos.

**No habilitar ni registrar la tarea todavía sin verificar identidad de la BD y contar con respaldos PostgreSQL y del llavero HMAC recuperables.** Realizar primero una prueba en una BD aislada y obtener autorización operativa para la BD destino. Programar como máximo una instancia por intervalo (p. ej. cada hora), bajo una cuenta restringida, sin arranque simultáneo y con monitoreo de código de salida; un proceso omitido se reintenta en el siguiente intervalo. El comando solo procesa un lote de hasta 100 candidatos por invocación; si hay acumulación, el operador debe evaluar la frecuencia, no ejecutar un bucle ilimitado. No se instala ni registra automáticamente ninguna tarea.

Se reutiliza `limpiarVencidas`: compara la expiración con el reloj de PostgreSQL, toma el mismo advisory lock transaccional por usuario/clave que publicación y finalización, y vuelve a verificar expiración bajo lock antes de borrar. No elimina el marcador especial de año 9999, incluidos históricos sin generación, ni notificaciones. Varias instancias podrían seleccionar los mismos candidatos y gastar trabajo adicional; el lock por clave protege frente a publicación y borrado concurrentes, pero **no** hay elección global de líder ni límite de carga global. Un fallo puede dejar un lote parcialmente aplicado porque cada candidato se procesa en su propia transacción; la salida no cero no implica rollback del lote entero. Los mensajes de la CLI no imprimen excepciones, claves ni URLs; proteger también registros del runtime, Prisma y PostgreSQL, cuya configuración es independiente.

La entrada se probó mediante la función de mantenimiento contra una BD PostgreSQL aislada con marcadores sintéticos vencido, activo e histórico 9999. No se ha registrado una tarea periódica ni ejecutado mantenimiento sobre la BD de desarrollo. El llavero aún necesita una copia cifrada independiente y una prueba de recuperación antes de activar el mantenimiento.

## Estructura

```
prisma/                  Schema y migraciones
scripts/ensure-pg.cjs    Arranque de PostgreSQL local (predev/pretest)
src/
  dominio/               Entidades y puertos (interfaces) — sin dependencias de frameworks
    puertos/             USUARIO_REPOSITORY, PASSWORD_HASHER, TOKEN_SERVICE, MAILER
  aplicacion/            Casos de uso + DTOs (class-validator)
    auth/  perfil/  dtos/
  infraestructura/       Adaptadores: Prisma (adapter-pg), bcrypt, JWT, SMTP
    prisma/  repositorios/  seguridad/  correo/
  interfaces/            Interfaz HTTP: controllers, guards, strategies, filtros
    http/
  app.module.ts
  main.ts                helmet, CORS, ValidationPipe global, prefijo /api/v1
docs/                    (el contrato vive en ../docs/orquestacion/CONTRATO_API.md)
```

## Seguridad

- Contraseñas con bcrypt (cost 12). JWT con `{ sub, tokenVersion }`; el logout y el cambio/reset de contraseña incrementan `tokenVersion`, invalidando tokens emitidos.
- Tokens de recuperación: se persiste **solo el hash SHA-256** y su expiración (nunca el token plano).
- Respuestas de recuperación y login genéricas para no revelar si un correo existe.
- `class-validator` + `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`).
- `@nestjs/throttler`: 100 req/min globales; 5 req/min en `/auth/registro`, `/auth/login`, `/auth/recuperar`, `/auth/restablecer`.
- `helmet`, CORS por orígenes permitidos, prefijo global `/api/v1`.
- Formato de error consistente: `{ statusCode, message, error }` (filtro global). `message` puede ser `string[]` en errores de validación.

## CI

GitHub Actions (`.github/workflows/ci.yml`) en `ubuntu-latest` con servicio `postgres:18` (trust, db `samproject`): `npm ci` → `lint` → `typecheck` → `prisma generate` → `prisma migrate deploy` → `npm test`. **No usa `ensure-pg.cjs`.** Trigger: push/PR a `main`.

## Notas de fases

- Fase 1: auth (RF-01..04) implementado. Espacios, proyectos, tareas y Kanban: contrato en `docs/orquestacion/CONTRATO_API.md`, implementación según el plan de Fase 1.
- «Vencida» nunca es un estado: `fechaLimite < hoy && estado != HECHA`.
- Progreso (RF-11): cuenta tareas sin subtareas + subtareas; la tarea padre con subtareas no se duplica.
# Idempotencia segura de comentarios (RF-19)

El servidor necesita `COMENTARIOS_HMAC_CLAVE_ACTIVA` (identificador ASCII alfanumérico, `_` o `-`, de hasta 32 caracteres) y `COMENTARIOS_HMAC_CLAVES` (objeto JSON que asocia cada identificador a una clave de 32 bytes codificada como 64 caracteres hexadecimales minúsculos). Cada clave debe generarse independientemente con un generador criptográfico seguro y distribuirse mediante un gestor de secretos, nunca en repositorio, cliente ni logs. La validación del formato no demuestra entropía. Mantener la configuración idéntica en las instancias; una clave activa inexistente, configuración inválida o clave histórica faltante provoca 503 únicamente al publicar o recuperar un replay, sin escrituras parciales. Las consultas de comentarios y avisos siguen disponibles.

Las nuevas huellas usan `hmac-sha256-v1:<id>:<verificador>:<mac>` con separación de dominio y serialización JSON de `[tareaId,texto]`. El verificador HMAC de dominio separado detecta un cambio accidental del secreto bajo el mismo identificador; hace esencial que el secreto tenga alta entropía, pues permite comprobar conjeturas fuera de línea. Las huellas hexadecimales SHA-256 anteriores se comprueban mediante comparación de tiempo constante; si coinciden se convierten bajo el lock transaccional sin cambiar la caducidad, incluso cuando el comentario fue eliminado. No se crean nuevas huellas legacy. Marcadores con formato desconocido fallan cerrados.

## Despliegue y rotación

1. Respaldar y validar el plan de recuperación; no resetear ni truncar la BD. Aplicar la migración aditiva que agrega `generacion` después de la migración RF-19. No modifica las filas antiguas. Comprobar la configuración de secretos sin imprimir valores.
2. Drenar y detener **todos** los escritores RF-19 de la versión anterior antes de habilitar el nuevo código: la versión antigua no entiende HMAC ni participa en la finalización/limpieza con generación. La migración por sí sola no hace seguro un despliegue gradual con escritores viejos. Configurar todas las instancias nuevas con el mismo anillo y versión activa antes de reanudar publicaciones.
3. Para rotar, distribuir la nueva clave a todas las instancias manteniendo las anteriores; después cambiar coordinadamente el identificador activo. Nunca reutilizar un identificador con otra clave. Conservar cada clave anterior hasta verificar que no existe ningún marcador que la requiera, incluidos tombstones y marcadores 9999, y considerar los backups restaurables. Perderla o retirarla antes de tiempo impide el replay y provoca 503; no permite recrear la operación.
4. El código de verificación legacy debe mantenerse hasta demostrar, en **todas** las bases y backups relevantes y tras drenar escritores antiguos, que no quedan marcadores legacy que puedan requerir replay. La ausencia en una base de desarrollo no prueba ausencia en otros entornos. Su retirada posterior requiere cambio y verificación separados.

Los marcadores históricos `9999-12-31` sin generación no se eliminan ni se les cambia el vencimiento automáticamente; pueden conservarse indefinidamente. Cualquier resolución futura requiere una política y autorización explícitas. Para los marcadores nuevos, tras commit se fija la caducidad a 24 horas y 10 segundos con reloj de PostgreSQL, bajo el mismo lock de publicación y la generación correspondiente. Si falla se registra advertencia y queda el marcador seguro; un replay confirmado de esa generación puede volver a finalizarlo. Un proceso antiguo o tardío no debe finalizar otra generación.

`PrismaComentariosRepository.limpiarVencidas(limite)` es una operación interna explícita, no un endpoint ni un job automático: admite lotes de 1 a 100, obtiene el lock de cada clave y revalida el vencimiento en la transacción antes de borrar. Excluye los marcadores 9999. No ejecutarla junto a escritores anteriores que no respeten el protocolo nuevo. Errores de limpieza se propagan; instrumentar y supervisar cualquier integración operativa futura.
