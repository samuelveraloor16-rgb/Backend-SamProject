import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EspacioRepository, MembresiaEntity } from '../../dominio/puertos/espacio.repository';

// RF-06/07/08/09: regla de acceso común — un usuario solo ve datos de espacios
// en los que es miembro; :id ajenos responden 404 (no se filtra existencia).
// Autenticado pero sin rol suficiente en el espacio → 403.
export async function asegurarMiembro(
  repo: EspacioRepository,
  espacioId: string,
  usuarioId: string,
): Promise<MembresiaEntity> {
  const membresia = await repo.obtenerMembresia(espacioId, usuarioId);
  if (!membresia) {
    throw new NotFoundException('Espacio no encontrado');
  }
  return membresia;
}

export async function asegurarAdministrador(
  repo: EspacioRepository,
  espacioId: string,
  usuarioId: string,
): Promise<MembresiaEntity> {
  const membresia = await asegurarMiembro(repo, espacioId, usuarioId);
  if (membresia.rol !== 'ADMINISTRADOR') {
    throw new ForbiddenException('Se requiere el rol de administrador del espacio');
  }
  return membresia;
}
