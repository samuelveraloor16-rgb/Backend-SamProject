-- CreateEnum
CREATE TYPE "PlataformaDispositivo" AS ENUM ('ANDROID', 'IOS');

-- CreateEnum
CREATE TYPE "EstadoPushOutbox" AS ENUM ('PENDIENTE', 'ENVIADO', 'FALLIDO', 'DESCARTADO');

-- CreateTable
CREATE TABLE "dispositivos" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "plataforma" "PlataformaDispositivo" NOT NULL,
    "tokenPush" TEXT NOT NULL,
    "tokenVersionVinculado" INTEGER NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    "ultimoEnvioEn" TIMESTAMP(3),
    "codigoTransferenciaHash" TEXT,
    "codigoTransferenciaExpiraEn" TIMESTAMP(3),

    CONSTRAINT "dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_outbox" (
    "id" TEXT NOT NULL,
    "claveUnica" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "tareaId" TEXT NOT NULL,
    "comentarioId" TEXT,
    "estado" "EstadoPushOutbox" NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "proximoIntentoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoError" TEXT,
    "enviadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispositivos_tokenPush_key" ON "dispositivos"("tokenPush");

-- CreateIndex
CREATE INDEX "dispositivos_usuarioId_idx" ON "dispositivos"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "push_outbox_claveUnica_key" ON "push_outbox"("claveUnica");

-- CreateIndex
CREATE INDEX "push_outbox_estado_proximoIntentoEn_idx" ON "push_outbox"("estado", "proximoIntentoEn");

-- CreateIndex
CREATE INDEX "push_outbox_usuarioId_estado_idx" ON "push_outbox"("usuarioId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "push_outbox_comentarioId_usuarioId_key" ON "push_outbox"("comentarioId", "usuarioId");

-- AddForeignKey
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_tareaId_fkey" FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "comentarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariantes RF-20 no expresables como CHECK en el esquema Prisma.
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_token_valido"
  CHECK (char_length(btrim("tokenPush")) BETWEEN 1 AND 512);
ALTER TABLE "dispositivos" ADD CONSTRAINT "dispositivos_codigo_hash_expiracion"
  CHECK (("codigoTransferenciaHash" IS NULL AND "codigoTransferenciaExpiraEn" IS NULL)
    OR ("codigoTransferenciaHash" IS NOT NULL AND "codigoTransferenciaExpiraEn" IS NOT NULL
      AND "codigoTransferenciaHash" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_intentos_validos"
  CHECK ("intentos" BETWEEN 0 AND 5);
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_tipo_valido"
  CHECK ("tipo" IN ('TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO', 'MENCION'));
ALTER TABLE "push_outbox" ADD CONSTRAINT "push_outbox_clave_no_vacia"
  CHECK (char_length(btrim("claveUnica")) > 0);
