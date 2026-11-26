-- Diario técnico independiente: no guarda tokens, códigos ni contenido privado.
-- Sin FK a dispositivo: una transferencia/revocación no debe eliminar el registro
-- de aceptación de la generación anterior. Limpieza/retención pendiente sin cron.
CREATE TABLE "push_intentos" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "dispositivoId" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "vinculoEn" TIMESTAMP(3) NOT NULL,
  "aceptado" BOOLEAN NOT NULL DEFAULT false,
  "rechazado" BOOLEAN NOT NULL DEFAULT false,
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "push_intentos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "push_intentos_usuarioId_creadoEn_idx" ON "push_intentos"("usuarioId", "creadoEn");
CREATE INDEX "push_intentos_outboxId_dispositivoId_vinculoEn_aceptado_idx" ON "push_intentos"("outboxId", "dispositivoId", "vinculoEn", "aceptado");
