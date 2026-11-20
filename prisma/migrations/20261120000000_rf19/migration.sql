-- Aditiva: las notificaciones existentes conservan sus datos y no tienen vínculo verificable.
ALTER TABLE "notificaciones" ADD COLUMN "comentarioId" TEXT;
CREATE UNIQUE INDEX "notificaciones_comentarioId_usuarioId_tipo_key" ON "notificaciones"("comentarioId", "usuarioId", "tipo");
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "comentarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "menciones" (
    "comentarioId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "posicion" INTEGER NOT NULL,
    CONSTRAINT "menciones_pkey" PRIMARY KEY ("comentarioId", "usuarioId"),
    CONSTRAINT "menciones_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "comentarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "menciones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "idempotencias_comentario" (
    "usuarioId" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "huella" TEXT NOT NULL,
    "comentarioId" TEXT,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "idempotencias_comentario_pkey" PRIMARY KEY ("usuarioId", "clave"),
    CONSTRAINT "idempotencias_comentario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "idempotencias_comentario_comentarioId_fkey" FOREIGN KEY ("comentarioId") REFERENCES "comentarios"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "idempotencias_comentario_expiraEn_idx" ON "idempotencias_comentario"("expiraEn");
