// Puerto: hashing de contraseñas (adaptador concreto: bcrypt).

export interface PasswordHasher {
  hash(plano: string): Promise<string>;
  comparar(plano: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
