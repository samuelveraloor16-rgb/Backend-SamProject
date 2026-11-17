// Puerto: emisión de tokens de sesión. La verificación vive en la estrategia JWT (passport).

export interface JwtPayload {
  sub: string;
  tokenVersion: number;
}

export interface TokenService {
  firmar(payload: JwtPayload): string;
}

export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
