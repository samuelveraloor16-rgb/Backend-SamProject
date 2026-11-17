import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import {
  USUARIO_REPOSITORY,
  type UsuarioRepository,
  type UsuarioEntity,
} from '../../dominio/puertos/usuario.repository';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../dominio/puertos/password-hasher.port';
import { TOKEN_SERVICE, type TokenService } from '../../dominio/puertos/token-service.port';
import { MAILER, type Mailer } from '../../dominio/puertos/mailer.port';
import { RegistroUsuarioDto } from '../dtos/registro-usuario.dto';
import { LoginDto } from '../dtos/login.dto';
import { RecuperarPasswordDto } from '../dtos/recuperar-password.dto';
import { RestablecerPasswordDto } from '../dtos/restablecer-password.dto';

export interface UsuarioPublico {
  id: string;
  email: string;
  nombre: string;
  fotoUrl: string | null;
  creadoEn: Date;
}

export interface RespuestaAuth {
  usuario: UsuarioPublico;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export function sha256Hex(valor: string): string {
  return createHash('sha256').update(valor).digest('hex');
}

function aUsuarioPublico(u: UsuarioEntity): UsuarioPublico {
  return {
    id: u.id,
    email: u.email,
    nombre: u.nombre,
    fotoUrl: u.fotoUrl,
    creadoEn: u.creadoEn,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(USUARIO_REPOSITORY) private readonly usuarios: UsuarioRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(TOKEN_SERVICE) private readonly tokens: TokenService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  // RF-01: registro con correo + contraseña; crea espacio personal + membresía admin + Bandeja de entrada.
  async registro(dto: RegistroUsuarioDto): Promise<RespuestaAuth> {
    const email = dto.email.trim().toLowerCase();
    const existente = await this.usuarios.buscarPorEmail(email);
    if (existente) {
      throw new ConflictException('Ya existe una cuenta con este correo');
    }
    const passwordHash = await this.hasher.hash(dto.contrasena);
    const usuario = await this.usuarios.crearConEspacioPersonal({
      nombre: dto.nombre.trim(),
      email,
      passwordHash,
    });
    this.logger.log(`Registro de usuario ${usuario.id} (espacio personal creado)`);
    return this.respuestaAuth(usuario);
  }

  // RF-02: login; el token lleva { sub, tokenVersion }.
  async login(dto: LoginDto): Promise<RespuestaAuth> {
    const email = dto.email.trim().toLowerCase();
    const usuario = await this.usuarios.buscarPorEmail(email);
    const hashParaComparar =
      usuario?.passwordHash ?? '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const credencialesValidas = await this.hasher.comparar(dto.contrasena, hashParaComparar);
    if (!usuario || !credencialesValidas) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.respuestaAuth(usuario);
  }

  // RF-02: logout invalida el token incrementando tokenVersion.
  async logout(usuarioId: string): Promise<{ mensaje: string }> {
    await this.usuarios.incrementarTokenVersion(usuarioId);
    return { mensaje: 'Sesión cerrada correctamente' };
  }

  // RF-03: solicitar recuperación. Respuesta SIEMPRE genérica (anti-enumeración).
  async recuperar(dto: RecuperarPasswordDto): Promise<{ mensaje: string }> {
    const email = dto.email.trim().toLowerCase();
    const respuestaGenerica = {
      mensaje: 'Si el correo existe, recibirás un enlace para restablecer tu contraseña.',
    };
    const usuario = await this.usuarios.buscarPorEmail(email);
    if (!usuario) {
      return respuestaGenerica;
    }
    const tokenPlano = randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(tokenPlano); // NUNCA se persiste el token plano
    const ttlMinutos = Number(this.config.get('RESET_TOKEN_TTL_MINUTES') ?? 45);
    const expira = new Date(Date.now() + ttlMinutos * 60 * 1000);
    await this.usuarios.guardarResetToken(usuario.id, tokenHash, expira);

    const frontendUrl = (this.config.get<string>('FRONTEND_URL') ?? 'samproject://reset').replace(/\/+$/, '');
    const enlace = `${frontendUrl}?token=${tokenPlano}`;
    const enviado = await this.mailer.enviar({
      para: usuario.email,
      asunto: 'SamProject - Recupera tu contraseña',
      html: [
        `<p>Hola ${usuario.nombre}:</p>`,
        `<p>Para restablecer tu contraseña, abre este enlace (válido ${ttlMinutos} minutos):</p>`,
        `<p><a href="${enlace}">${enlace}</a></p>`,
        `<p>Si no solicitaste este cambio, ignora este correo.</p>`,
      ].join(''),
      texto: `Para restablecer tu contraseña abre: ${enlace} (válido ${ttlMinutos} minutos)`,
    });
    if (!enviado) {
      // Falla controlada: no se rompe la respuesta ni se revela si el correo existe.
      this.logger.warn(`No se pudo enviar el correo de recuperación a usuario ${usuario.id}`);
    }
    return respuestaGenerica;
  }

  // RF-03: restablecer con token. Valida hash + expiración; invalida sesiones abiertas.
  async restablecer(dto: RestablecerPasswordDto): Promise<{ mensaje: string }> {
    const tokenHash = sha256Hex(dto.token);
    const usuario = await this.usuarios.buscarPorResetTokenHash(tokenHash);
    if (!usuario || !usuario.resetTokenExpires || usuario.resetTokenExpires.getTime() < Date.now()) {
      throw new BadRequestException('El enlace es inválido o ha caducado');
    }
    const passwordHash = await this.hasher.hash(dto.contrasenaNueva);
    await this.usuarios.restablecerPassword(usuario.id, passwordHash);
    return { mensaje: 'Contraseña actualizada correctamente. Inicia sesión con tu nueva contraseña.' };
  }

  private respuestaAuth(usuario: UsuarioEntity): RespuestaAuth {
    const accessToken = this.tokens.firmar({ sub: usuario.id, tokenVersion: usuario.tokenVersion });
    return {
      usuario: aUsuarioPublico(usuario),
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN') ?? '12h',
    };
  }
}
