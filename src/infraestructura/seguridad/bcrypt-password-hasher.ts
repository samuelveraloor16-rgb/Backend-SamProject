import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import type { PasswordHasher } from '../../dominio/puertos/password-hasher.port';

const SALT_ROUNDS = 12; // >= 10 exigido por RF-01

@Injectable()
export class BcryptPasswordHasher implements PasswordHasher {
  hash(plano: string): Promise<string> {
    return bcrypt.hash(plano, SALT_ROUNDS);
  }

  comparar(plano: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plano, hash);
  }
}
