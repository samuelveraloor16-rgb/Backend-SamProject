-- Offline RF21 bloque 1. No backfill; GET resuelve defaults sin escribir.
CREATE TYPE "TipoPreferenciaNotificacion" AS ENUM ('TAREA_ASIGNADA', 'TAREA_POR_VENCER', 'TAREA_VENCIDA', 'COMENTARIO', 'MENCION');
CREATE TABLE "preferencias_notificaciones" (
  "usuarioId" TEXT NOT NULL,
  "tipo" "TipoPreferenciaNotificacion" NOT NULL,
  "inApp" BOOLEAN NOT NULL DEFAULT false,
  "correo" BOOLEAN NOT NULL DEFAULT false,
  "push" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "preferencias_notificaciones_pkey" PRIMARY KEY ("usuarioId", "tipo"),
  CONSTRAINT "preferencias_mencion_inapp_check" CHECK ("tipo" <> 'MENCION' OR "inApp" = true),
  CONSTRAINT "preferencias_notificaciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
