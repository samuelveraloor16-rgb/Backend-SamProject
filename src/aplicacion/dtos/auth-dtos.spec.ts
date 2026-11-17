import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegistroUsuarioDto } from './registro-usuario.dto';
import { LoginDto } from './login.dto';
import { RestablecerPasswordDto } from './restablecer-password.dto';
import { CambiarPasswordDto } from './cambiar-password.dto';

async function erroresDe(cls: new () => object, datos: object): Promise<string[]> {
  const instancia = plainToInstance(cls, datos);
  const errores = await validate(instancia as object);
  return errores.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('DTOs de autenticación (validación class-validator)', () => {
  it('registro acepta datos válidos', async () => {
    expect(
      await erroresDe(RegistroUsuarioDto, {
        nombre: 'Ana',
        email: 'ana@example.com',
        contrasena: 'secreta1',
      }),
    ).toHaveLength(0);
  });

  it('registro rechaza correo inválido', async () => {
    const errores = await erroresDe(RegistroUsuarioDto, {
      nombre: 'Ana',
      email: 'no-es-correo',
      contrasena: 'secreta1',
    });
    expect(errores.length).toBeGreaterThan(0);
  });

  it('registro rechaza contraseña de menos de 8 caracteres', async () => {
    const errores = await erroresDe(RegistroUsuarioDto, {
      nombre: 'Ana',
      email: 'ana@example.com',
      contrasena: 'abc123',
    });
    expect(errores.some((m) => m.includes('8 caracteres'))).toBe(true);
  });

  it('registro rechaza contraseña sin número', async () => {
    const errores = await erroresDe(RegistroUsuarioDto, {
      nombre: 'Ana',
      email: 'ana@example.com',
      contrasena: 'sololetras',
    });
    expect(errores.some((m) => m.includes('número'))).toBe(true);
  });

  it('login exige correo válido y contraseña no vacía', async () => {
    expect(await erroresDe(LoginDto, { email: 'x', contrasena: '' })).not.toHaveLength(0);
    expect(
      await erroresDe(LoginDto, { email: 'ana@example.com', contrasena: 'lo-que-sea' }),
    ).toHaveLength(0);
  });

  it('restablecer exige token y contraseña fuerte', async () => {
    const errores = await erroresDe(RestablecerPasswordDto, {
      token: 'corto',
      contrasenaNueva: '123',
    });
    expect(errores.length).toBeGreaterThanOrEqual(2);
  });

  it('cambiar contraseña exige la actual y una nueva válida', async () => {
    expect(
      await erroresDe(CambiarPasswordDto, { contrasenaActual: '', contrasenaNueva: 'nueva123' }),
    ).not.toHaveLength(0);
    expect(
      await erroresDe(CambiarPasswordDto, {
        contrasenaActual: 'actual123',
        contrasenaNueva: 'nueva123',
      }),
    ).toHaveLength(0);
  });
});
