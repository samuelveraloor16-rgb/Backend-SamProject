-- OFFLINE / NO APLICADA. Expansiva: ningún legacy se acredita ni reescribe.
-- Conserva creadoEn y FK usuario SetNull preexistentes. No toca diario RF22.
BEGIN;
ALTER TABLE "registro_de_cambios"
  ADD COLUMN "versionHistorial" INTEGER,
  ADD COLUMN "actorTipo" TEXT,
  ADD COLUMN "espacioId" TEXT,
  ADD COLUMN "proyectoId" TEXT,
  ADD COLUMN "tareaId" TEXT,
  ADD COLUMN "proyectoOrigenId" TEXT,
  ADD COLUMN "proyectoDestinoId" TEXT;

-- Constraints aplican solo a filas nuevas tipadas; legacy permanece NULL.
-- No acredita allowlist JSON ni permisos: requieren escritor/lector tipados.
ALTER TABLE "registro_de_cambios" ADD CONSTRAINT "historial_contexto_v1" CHECK (
  "versionHistorial" IS NULL OR (
    "versionHistorial" = 1
    AND "actorTipo" IS NOT NULL AND "actorTipo" IN ('USUARIO', 'SISTEMA')
    AND ("actorTipo" <> 'SISTEMA' OR "usuarioId" IS NULL)
    AND "espacioId" IS NOT NULL AND "proyectoId" IS NOT NULL
    AND "entidad" IN ('PROYECTO', 'TAREA', 'ADJUNTO')
    AND "accion" IN ('CREADO', 'EDITADO', 'ESTADO_CAMBIADO', 'MOVIDO',
      'ARCHIVADO', 'DESARCHIVADO', 'ELIMINADO', 'ADJUNTO_ACEPTADO',
      'ADJUNTO_LISTO', 'ADJUNTO_ELIMINACION_SOLICITADA', 'ADJUNTO_ELIMINADO_FISICAMENTE')
    AND ("entidad" <> 'TAREA' OR "tareaId" IS NOT NULL)
    AND ("accion" <> 'MOVIDO' OR ("proyectoOrigenId" IS NOT NULL AND "proyectoDestinoId" IS NOT NULL))
  )
);

CREATE INDEX "historial_proyecto_keyset" ON "registro_de_cambios" ("espacioId", "proyectoId", "creadoEn", "id");
CREATE INDEX "historial_tarea_keyset" ON "registro_de_cambios" ("espacioId", "tareaId", "creadoEn", "id");
CREATE INDEX "historial_origen_keyset" ON "registro_de_cambios" ("espacioId", "proyectoOrigenId", "creadoEn", "id");
CREATE INDEX "historial_destino_keyset" ON "registro_de_cambios" ("espacioId", "proyectoDestinoId", "creadoEn", "id");
CREATE INDEX "historial_retencion" ON "registro_de_cambios" ("creadoEn");

-- Valida ANTES de LIMIT. Legacy no se acredita; no conversiones de texto libre.
CREATE FUNCTION historial_detalle_valido(a text, d jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
SELECT COALESCE(CASE WHEN jsonb_typeof(d) <> 'object' THEN false
 WHEN a IN ('CREADO','ELIMINADO','ARCHIVADO','DESARCHIVADO') THEN d = '{}'::jsonb
 WHEN a = 'EDITADO' THEN CASE
   WHEN d - 'changedFields' <> '{}'::jsonb OR jsonb_typeof(d->'changedFields') <> 'array' THEN false
   ELSE jsonb_array_length(d->'changedFields') > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'changedFields') e WHERE jsonb_typeof(e) <> 'string'
       OR e #>> '{}' NOT IN ('nombre','descripcion','fechaInicio','fechaFin','miembros','titulo','prioridad','fechaLimite','responsableId','etiquetas'))
     AND (SELECT count(*) = count(DISTINCT e) FROM jsonb_array_elements(d->'changedFields') e)
   END
 WHEN a = 'ESTADO_CAMBIADO' THEN d - ARRAY['estadoAnterior','estadoNuevo'] = '{}'::jsonb
   AND d->>'estadoAnterior' IN ('PENDIENTE','EN_CURSO','HECHA')
   AND d->>'estadoNuevo' IN ('PENDIENTE','EN_CURSO','HECHA')
   AND d->>'estadoAnterior' <> d->>'estadoNuevo'
 WHEN a = 'MOVIDO' THEN d - ARRAY['proyectoOrigenId','proyectoDestinoId'] = '{}'::jsonb
   AND jsonb_typeof(d->'proyectoOrigenId') = 'string' AND jsonb_typeof(d->'proyectoDestinoId') = 'string'
   AND length(d->>'proyectoOrigenId') > 0 AND length(d->>'proyectoDestinoId') > 0
   AND d->>'proyectoOrigenId' <> d->>'proyectoDestinoId'
 ELSE false END, false)
$$;
ALTER TABLE "registro_de_cambios" ADD CONSTRAINT "historial_detalle_v1" CHECK (
 "versionHistorial" IS NULL OR ("entidad" IN ('PROYECTO','TAREA') AND historial_detalle_valido("accion", "detalle"))
);
ALTER TABLE "registro_de_cambios" ADD CONSTRAINT "historial_entidad_contexto_v1" CHECK (
 "versionHistorial" IS NULL OR (
   (("entidad" = 'PROYECTO' AND "entidadId" = "proyectoId" AND "tareaId" IS NULL AND "accion" IN ('CREADO','EDITADO','ARCHIVADO','DESARCHIVADO','ELIMINADO'))
    OR ("entidad" = 'TAREA' AND "entidadId" = "tareaId" AND "accion" IN ('CREADO','EDITADO','ESTADO_CAMBIADO','MOVIDO','ELIMINADO')))
   AND ("accion" <> 'MOVIDO' OR ("proyectoId" = "proyectoOrigenId" AND "detalle"->>'proyectoOrigenId' = "proyectoOrigenId" AND "detalle"->>'proyectoDestinoId' = "proyectoDestinoId"))
  )
);
COMMIT;
