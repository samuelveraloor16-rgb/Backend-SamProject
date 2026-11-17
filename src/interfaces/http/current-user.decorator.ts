import { createParamDecorator, ExecutionContext } from '@nestjs/common';

// Usuario autenticado adjuntado por JwtStrategy.validate()
export interface UsuarioAutenticado {
  id: string;
  email: string;
  nombre: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioAutenticado => {
    const request = ctx.switchToHttp().getRequest<{ user: UsuarioAutenticado }>();
    return request.user;
  },
);
