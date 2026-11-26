-- Aditiva, offline. No backfill desde JSON ni borrados históricos.
CREATE TABLE "identidades_aviso" ("digest" TEXT NOT NULL PRIMARY KEY);
ALTER TABLE "notificaciones" ADD COLUMN "tareaId" TEXT;
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_tareaId_fkey"
  FOREIGN KEY ("tareaId") REFERENCES "tareas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
