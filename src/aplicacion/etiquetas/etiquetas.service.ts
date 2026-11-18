import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  ETIQUETA_REPOSITORY,
  type EtiquetaRepository,
} from '../../dominio/puertos/etiqueta.repository';
import {
  ESPACIO_REPOSITORY,
  type EspacioRepository,
} from '../../dominio/puertos/espacio.repository';
import { asegurarMiembro } from '../comun/acceso-espacio';
import { envelope, paginarEnMemoria, type Envelope, PaginacionDto } from '../comun/paginacion';
import { CrearEtiquetaDto } from '../dtos/tarea-dtos';

export interface EtiquetaPublica {
  id: string;
  nombre: string;
  color: string | null;
}

@Injectable()
export class EtiquetasService {
  constructor(
    @Inject(ETIQUETA_REPOSITORY) private readonly etiquetas: EtiquetaRepository,
    @Inject(ESPACIO_REPOSITORY) private readonly espacios: EspacioRepository,
  ) {}

  // GET /espacios/:espacioId/etiquetas — RF-12 (miembro del espacio).
  async listar(
    espacioId: string,
    usuarioId: string,
    query: PaginacionDto,
  ): Promise<Envelope<EtiquetaPublica>> {
    await asegurarMiembro(this.espacios, espacioId, usuarioId);
    const filas = await this.etiquetas.listarPorEspacio(espacioId);
    const ordenadas = [...filas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    const datos = ordenadas.map((e) => ({ id: e.id, nombre: e.nombre, color: e.color }));
    const corte = paginarEnMemoria(datos, query.page, query.pageSize);
    return envelope(corte.datos, corte.total, query.page, query.pageSize);
  }

  // POST /espacios/:espacioId/etiquetas — RF-12 (miembro). Nombre único por espacio (case-insensitive) → 409.
  async crear(
    espacioId: string,
    usuarioId: string,
    dto: CrearEtiquetaDto,
  ): Promise<EtiquetaPublica> {
    await asegurarMiembro(this.espacios, espacioId, usuarioId);
    const nombre = dto.nombre?.trim();
    if (!nombre) {
      throw new BadRequestException('El nombre de la etiqueta no puede estar vacío');
    }
    if (await this.etiquetas.existeNombreEnEspacio(espacioId, nombre)) {
      throw new ConflictException('Ya existe una etiqueta con ese nombre en el espacio');
    }
    try {
      const creada = await this.etiquetas.crear({
        nombre,
        color: dto.color ?? null,
        espacioId,
      });
      return { id: creada.id, nombre: creada.nombre, color: creada.color };
    } catch (error) {
      // Carrera contra el unique (nombre, espacioId) del schema.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Ya existe una etiqueta con ese nombre en el espacio');
      }
      throw error;
    }
  }
}
