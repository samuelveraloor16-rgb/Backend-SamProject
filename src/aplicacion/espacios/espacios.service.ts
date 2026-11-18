import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import {
  ESPACIO_REPOSITORY,
  type EspacioEntity,
  type EspacioRepository,
  type RolEspacio,
} from '../../dominio/puertos/espacio.repository';
import {
  USUARIO_REPOSITORY,
  type UsuarioRepository,
} from '../../dominio/puertos/usuario.repository';
import { MAILER, type Mailer } from '../../dominio/puertos/mailer.port';
import { sha256Hex } from '../auth/auth.service';
import { asegurarAdministrador, asegurarMiembro } from '../comun/acceso-espacio';
import { envelope, paginarEnMemoria, type Envelope, type PaginacionDto } from '../comun/paginacion';
import {
  CrearEspacioDto,
  ActualizarEspacioDto,
  CrearInvitacionDto,
  ActualizarRolDto,
} from '../dtos/espacio-dtos';

export interface EspacioPublico {
  id: string;
  nombre: string;
  esPersonal: boolean;
  asistenteActivo: boolean;
  miRol: RolEspacio;
  totalMiembros: number;
  creadoEn: Date;
}

export function aEspacioPublico(
  espacio: EspacioEntity,
  miRol: RolEspacio,
  totalMiembros: number,
): EspacioPublico {
  return {
    id: espacio.id,
    nombre: espacio.nombre,
    esPersonal: espacio.esPersonal,
    asistenteActivo: espacio.asistenteActivo,
    miRol,
    totalMiembros,
    creadoEn: espacio.creadoEn,
  };
}

const INVITE_TTL_DIAS = 7; // Contrato RF-06: la invitación caduca a los 7 días.

@Injectable()
export class EspaciosService {
  private readonly logger = new Logger(EspaciosService.name);

  constructor(
    @Inject(ESPACIO_REPOSITORY) private readonly espacios: EspacioRepository,
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepository,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  // RF-05/RF-06: lista los espacios del usuario. Personales primero, luego por creadoEn.
  async listar(usuarioId: string, page: PaginacionDto): Promise<Envelope<EspacioPublico>> {
    const items = await this.espacios.listarDeUsuario(usuarioId);
    const ordenados = [...items].sort((a, b) => {
      if (a.espacio.esPersonal !== b.espacio.esPersonal) {
        return a.espacio.esPersonal ? -1 : 1;
      }
      return a.espacio.creadoEn.getTime() - b.espacio.creadoEn.getTime();
    });
    const datos = ordenados.map((e) => aEspacioPublico(e.espacio, e.miRol, e.totalMiembros));
    const corte = paginarEnMemoria(datos, page.page, page.pageSize);
    return envelope(corte.datos, corte.total, page.page, page.pageSize);
  }

  // RF-06: crea espacio de equipo; el creador queda ADMINISTRADOR y se crea la Bandeja (transacción en el repo).
  async crear(usuarioId: string, dto: CrearEspacioDto): Promise<EspacioPublico> {
    const nombre = dto.nombre?.trim();
    if (!nombre) {
      throw new BadRequestException('El nombre del espacio no puede estar vacío');
    }
    const espacio = await this.espacios.crearConAdmin({ nombre, creadorId: usuarioId });
    return aEspacioPublico(espacio, 'ADMINISTRADOR', 1);
  }

  // GET /espacios/:id — miembro del espacio.
  async obtener(id: string, usuarioId: string): Promise<EspacioPublico> {
    const membresia = await asegurarMiembro(this.espacios, id, usuarioId);
    const espacio = await this.espacios.buscarPorId(id);
    if (!espacio) {
      throw new NotFoundException('Espacio no encontrado');
    }
    const totalMiembros = await this.espacios.contarMiembros(id);
    return aEspacioPublico(espacio, membresia.rol, totalMiembros);
  }

  // RF-08: editar espacio (nombre, asistenteActivo) solo ADMINISTRADOR.
  async actualizar(id: string, usuarioId: string, dto: ActualizarEspacioDto): Promise<EspacioPublico> {
    await asegurarAdministrador(this.espacios, id, usuarioId);
    const cambios: { nombre?: string; asistenteActivo?: boolean } = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre.trim();
    if (dto.asistenteActivo !== undefined) cambios.asistenteActivo = dto.asistenteActivo;
    if (Object.keys(cambios).length === 0) {
      throw new BadRequestException('No hay cambios que aplicar');
    }
    const espacio = await this.espacios.actualizar(id, cambios);
    if (cambios.asistenteActivo === false) {
      this.logger.log(`Asistente desactivado en espacio ${id} por usuario ${usuarioId}`);
    }
    const totalMiembros = await this.espacios.contarMiembros(id);
    const membresia = await asegurarMiembro(this.espacios, id, usuarioId);
    return aEspacioPublico(espacio, membresia.rol, totalMiembros);
  }

  // RF-06: invitar por correo. Solo ADMINISTRADOR. El token plano solo viaja en el correo.
  async invitar(
    espacioId: string,
    usuarioId: string,
    dto: CrearInvitacionDto,
  ): Promise<{ id: string; email: string; rol: RolEspacio; expiraEn: Date }> {
    await asegurarAdministrador(this.espacios, espacioId, usuarioId);
    const email = dto.email.trim().toLowerCase();
    const rol: RolEspacio = dto.rol ?? 'MIEMBRO';

    const espacio = await this.espacios.buscarPorId(espacioId);
    if (!espacio) {
      throw new NotFoundException('Espacio no encontrado');
    }

    const existente = await this.espacios.buscarUsuarioPorEmail(email);
    if (existente) {
      const yaMiembro = await this.espacios.obtenerMembresia(espacioId, existente.id);
      if (yaMiembro) {
        throw new ConflictException('El usuario ya es miembro del espacio');
      }
    }

    const tokenPlano = randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(tokenPlano); // NUNCA se persiste el token plano
    const expiraEn = new Date(Date.now() + INVITE_TTL_DIAS * 24 * 60 * 60 * 1000);
    const invitacion = await this.espacios.crearInvitacion({
      tokenHash,
      email,
      rol,
      espacioId,
      invitadoPorId: usuarioId,
      expiraEn,
    });

    const inviteUrl = (this.config.get<string>('INVITE_URL') ?? 'samproject://invitar').replace(/\/+$/, '');
    const enlace = `${inviteUrl}?token=${tokenPlano}`;
    const enviado = await this.mailer.enviar({
      para: email,
      asunto: `SamProject - Te invitaron al espacio "${espacio.nombre}"`,
      html: [
        `<p>Hola:</p>`,
        `<p>Te han invitado al espacio <strong>${espacio.nombre}</strong> en SamProject.</p>`,
        `<p>Abre este enlace para aceptar la invitación (válido ${INVITE_TTL_DIAS} días):</p>`,
        `<p><a href="${enlace}">${enlace}</a></p>`,
        `<p>Si no esperabas esta invitación, ignora este correo.</p>`,
      ].join(''),
      texto: `Te invitaron al espacio "${espacio.nombre}". Acepta con: ${enlace} (válido ${INVITE_TTL_DIAS} días)`,
    });
    if (!enviado) {
      // Falla controlada: la invitación existe; puede reenviarse repitiendo el POST.
      this.logger.warn(`No se pudo enviar el correo de invitación ${invitacion.id} a ${email}`);
    }
    // El token NUNCA se devuelve en la respuesta.
    return { id: invitacion.id, email: invitacion.email, rol: invitacion.rol, expiraEn: invitacion.expiraEn };
  }

  // RF-06: aceptar invitación. El :token es el del enlace del correo. Un solo uso.
  async aceptarInvitacion(
    tokenPlano: string,
    usuarioId: string,
  ): Promise<{ espacio: { id: string; nombre: string; miRol: RolEspacio }; mensaje: string }> {
    const tokenHash = sha256Hex(tokenPlano);
    const invitacion = await this.espacios.buscarInvitacionPorTokenHash(tokenHash);
    if (
      !invitacion ||
      invitacion.aceptadaEn !== null ||
      invitacion.expiraEn.getTime() < Date.now()
    ) {
      throw new BadRequestException('La invitación es inválida o ha caducado');
    }
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (!usuario) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (usuario.email.toLowerCase() !== invitacion.email.toLowerCase()) {
      throw new ForbiddenException('La invitación pertenece a otro correo');
    }
    const yaMiembro = await this.espacios.obtenerMembresia(invitacion.espacioId, usuarioId);
    if (yaMiembro) {
      throw new ConflictException('Ya eres miembro del espacio');
    }
    const espacio = await this.espacios.buscarPorId(invitacion.espacioId);
    if (!espacio) {
      throw new NotFoundException('Espacio no encontrado');
    }
    try {
      await this.espacios.aceptarInvitacion({
        invitacionId: invitacion.id,
        usuarioId,
        espacioId: invitacion.espacioId,
        rol: invitacion.rol,
      });
    } catch (error) {
      // Carrera: la membresía se creó entre el check y la transacción (unique constraint).
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException('Ya eres miembro del espacio');
      }
      throw error;
    }
    return {
      espacio: { id: espacio.id, nombre: espacio.nombre, miRol: invitacion.rol },
      mensaje: 'Invitación aceptada',
    };
  }

  // RF-07: quitar miembro. Solo ADMINISTRADOR. No se puede quitar al último ADMIN ni de un espacio personal.
  async quitarMiembro(
    espacioId: string,
    usuarioId: string,
    objetivoUsuarioId: string,
  ): Promise<void> {
    await asegurarAdministrador(this.espacios, espacioId, usuarioId);
    const espacio = await this.espacios.buscarPorId(espacioId);
    if (!espacio) {
      throw new NotFoundException('Espacio no encontrado');
    }
    if (espacio.esPersonal) {
      throw new BadRequestException('No se pueden quitar miembros de un espacio personal');
    }
    const objetivo = await this.espacios.obtenerMembresia(espacioId, objetivoUsuarioId);
    if (!objetivo) {
      throw new NotFoundException('Miembro no encontrado');
    }
    if (objetivo.rol === 'ADMINISTRADOR') {
      const admins = await this.espacios.contarAdministradores(espacioId);
      if (admins <= 1) {
        throw new BadRequestException('Debe quedar al menos un administrador en el espacio');
      }
    }
    await this.espacios.eliminarMembresia(espacioId, objetivoUsuarioId);
  }

  // RF-07: cambiar rol. Solo ADMINISTRADOR. No se puede degradar al último ADMIN.
  async cambiarRol(
    espacioId: string,
    usuarioId: string,
    objetivoUsuarioId: string,
    dto: ActualizarRolDto,
  ): Promise<{ usuarioId: string; espacioId: string; rol: RolEspacio }> {
    await asegurarAdministrador(this.espacios, espacioId, usuarioId);
    const objetivo = await this.espacios.obtenerMembresia(espacioId, objetivoUsuarioId);
    if (!objetivo) {
      throw new NotFoundException('Miembro no encontrado');
    }
    if (dto.rol === 'MIEMBRO' && objetivo.rol === 'ADMINISTRADOR') {
      const admins = await this.espacios.contarAdministradores(espacioId);
      if (admins <= 1) {
        throw new BadRequestException('Debe quedar al menos un administrador en el espacio');
      }
    }
    const actualizada = await this.espacios.actualizarRolMembresia(
      espacioId,
      objetivoUsuarioId,
      dto.rol,
    );
    if (!actualizada) {
      throw new NotFoundException('Miembro no encontrado');
    }
    return { usuarioId: objetivoUsuarioId, espacioId, rol: actualizada.rol };
  }

  // Salir del espacio. Miembro. 400 si es personal, o si es el único ADMIN y quedan otros miembros.
  async salir(espacioId: string, usuarioId: string): Promise<void> {
    const membresia = await asegurarMiembro(this.espacios, espacioId, usuarioId);
    const espacio = await this.espacios.buscarPorId(espacioId);
    if (!espacio) {
      throw new NotFoundException('Espacio no encontrado');
    }
    if (espacio.esPersonal) {
      throw new BadRequestException('No puedes salir de un espacio personal');
    }
    if (membresia.rol === 'ADMINISTRADOR') {
      const [admins, miembros] = await Promise.all([
        this.espacios.contarAdministradores(espacioId),
        this.espacios.contarMiembros(espacioId),
      ]);
      if (admins === 1 && miembros > 1) {
        throw new BadRequestException(
          'Debe quedar al menos un administrador en el espacio. Transfiere el rol antes de salir.',
        );
      }
    }
    await this.espacios.eliminarMembresia(espacioId, usuarioId);
  }
}
