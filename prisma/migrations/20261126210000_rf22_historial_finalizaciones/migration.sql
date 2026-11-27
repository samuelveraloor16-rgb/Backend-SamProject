-- OFFLINE: no se ha aplicado. RF22 historial de finalizaciones.
-- Estructura dedicada, append-only: sin FK, sin cascadas, sin backfill y sin purgas.
-- El historial empieza a regir al aplicar esta migración y desplegar el código;
-- no se reconstruyen semanas anteriores.

CREATE TYPE "TipoEventoFinalizacion" AS ENUM ('FINALIZADA', 'REABIERTA');

-- Frontera de inicio: se fija al aplicar la migración. Permite distinguir
-- «sin datos» de «cero finalizaciones» en semanas anteriores al historial.
CREATE TABLE "frontera_historial_finalizaciones" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "desde" TIMESTAMPTZ(3) NOT NULL
);
INSERT INTO "frontera_historial_finalizaciones" ("id", "desde")
VALUES (1, clock_timestamp());

CREATE TABLE "eventos_finalizacion_tarea" (
  "id" TEXT NOT NULL,
  "tareaId" TEXT NOT NULL,
  "proyectoId" TEXT NOT NULL,
  "estadoAnterior" "EstadoTarea" NOT NULL,
  "estadoNuevo" "EstadoTarea" NOT NULL,
  "tipo" "TipoEventoFinalizacion" NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "contable" BOOLEAN NOT NULL,
  "ocurridoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "eventos_finalizacion_tarea_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "eventos_finalizacion_tarea_transicion_coherente" CHECK (
    ("tipo" = 'FINALIZADA' AND "estadoNuevo" = 'HECHA' AND "estadoAnterior" <> 'HECHA')
    OR
    ("tipo" = 'REABIERTA' AND "estadoAnterior" = 'HECHA' AND "estadoNuevo" <> 'HECHA')
  )
);

CREATE INDEX "eventos_finalizacion_tarea_proyectoId_ocurridoEn_idx"
  ON "eventos_finalizacion_tarea"("proyectoId", "ocurridoEn");
CREATE INDEX "eventos_finalizacion_tarea_tareaId_ocurridoEn_idx"
  ON "eventos_finalizacion_tarea"("tareaId", "ocurridoEn");

-- Append-only a nivel BD: ninguna actualización ni borrado de eventos.
CREATE FUNCTION "eventos_finalizacion_tarea_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'eventos_finalizacion_tarea es append-only';
END;
$$;

CREATE TRIGGER "eventos_finalizacion_tarea_sin_update_delete"
  BEFORE UPDATE OR DELETE ON "eventos_finalizacion_tarea"
  FOR EACH ROW EXECUTE FUNCTION "eventos_finalizacion_tarea_append_only"();

CREATE TRIGGER "eventos_finalizacion_tarea_sin_truncate"
  BEFORE TRUNCATE ON "eventos_finalizacion_tarea"
  FOR EACH STATEMENT EXECUTE FUNCTION "eventos_finalizacion_tarea_append_only"();
