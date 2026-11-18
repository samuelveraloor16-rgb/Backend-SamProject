import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthService } from './aplicacion/auth/auth.service';
import { PerfilService } from './aplicacion/perfil/perfil.service';
import { EspaciosService } from './aplicacion/espacios/espacios.service';
import { ProyectosService } from './aplicacion/proyectos/proyectos.service';
import { PrismaModule } from './infraestructura/prisma/prisma.module';
import { PrismaUsuarioRepository } from './infraestructura/repositorios/prisma-usuario.repository';
import { PrismaEspacioRepository } from './infraestructura/repositorios/prisma-espacio.repository';
import { PrismaProyectoRepository } from './infraestructura/repositorios/prisma-proyecto.repository';
import { BcryptPasswordHasher } from './infraestructura/seguridad/bcrypt-password-hasher';
import { JwtTokenService } from './infraestructura/seguridad/jwt-token.service';
import { SmtpMailer } from './infraestructura/correo/smtp-mailer';
import { AuthController } from './interfaces/http/auth.controller';
import { PerfilController } from './interfaces/http/perfil.controller';
import { EspaciosController, InvitacionesController } from './interfaces/http/espacios.controller';
import { ProyectosController } from './interfaces/http/proyectos.controller';
import { JwtStrategy } from './interfaces/http/jwt.strategy';
import {
  USUARIO_REPOSITORY,
} from './dominio/puertos/usuario.repository';
import { ESPACIO_REPOSITORY } from './dominio/puertos/espacio.repository';
import { PROYECTO_REPOSITORY } from './dominio/puertos/proyecto.repository';
import { PASSWORD_HASHER } from './dominio/puertos/password-hasher.port';
import { TOKEN_SERVICE } from './dominio/puertos/token-service.port';
import { MAILER } from './dominio/puertos/mailer.port';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // ms.StringValue (p. ej. "12h", "1d"); viene de variable de entorno, se confía en el formato documentado.
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '12h') as never },
      }),
    }),
    PrismaModule,
  ],
  controllers: [AuthController, PerfilController, EspaciosController, InvitacionesController, ProyectosController],
  providers: [
    AuthService,
    PerfilService,
    EspaciosService,
    ProyectosService,
    JwtStrategy,
    { provide: USUARIO_REPOSITORY, useClass: PrismaUsuarioRepository },
    { provide: ESPACIO_REPOSITORY, useClass: PrismaEspacioRepository },
    { provide: PROYECTO_REPOSITORY, useClass: PrismaProyectoRepository },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: TOKEN_SERVICE, useClass: JwtTokenService },
    { provide: MAILER, useClass: SmtpMailer },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
