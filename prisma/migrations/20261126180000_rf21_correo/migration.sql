-- OFFLINE: no se ha aplicado. La aplicación de esta migración fija el cutover.
CREATE TABLE "identidades_correo" ("digest" VARCHAR(64) PRIMARY KEY);
CREATE TABLE "frontera_correo" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "desde" TIMESTAMPTZ(3) NOT NULL
);
INSERT INTO "frontera_correo" ("id", "desde") VALUES (1, clock_timestamp());
CREATE TABLE "correo_outbox" (
  "digest" VARCHAR(64) PRIMARY KEY,
  "usuarioId" TEXT NOT NULL,
  "tareaId" TEXT NOT NULL,
  "comentarioId" TEXT,
  "tipo" TEXT NOT NULL CHECK ("tipo" IN ('TAREA_ASIGNADA','TAREA_POR_VENCER','TAREA_VENCIDA','COMENTARIO','MENCION')),
  "ocurridoEn" TIMESTAMPTZ(3) NOT NULL,
  "estado" TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK ("estado" IN ('PENDIENTE','EN_IO','ACEPTADO','INCIERTO','FALLIDO')),
  "intentos" INTEGER NOT NULL DEFAULT 0 CHECK ("intentos" BETWEEN 0 AND 6),
  "proximoIntentoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "generacion" TEXT,
  "leaseHasta" TIMESTAMPTZ(3),
  CHECK (("estado" = 'EN_IO') = ("generacion" IS NOT NULL AND "leaseHasta" IS NOT NULL))
);
CREATE INDEX "correo_outbox_estado_proximoIntentoEn_idx" ON "correo_outbox"("estado", "proximoIntentoEn");
-- No FK, cascadas, backfill ni purga: borrar recursos no borra identidad SMTP.
