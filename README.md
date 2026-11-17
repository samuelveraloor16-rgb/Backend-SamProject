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
