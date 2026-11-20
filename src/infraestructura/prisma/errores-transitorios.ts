import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

const prismaTransitorios = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034', 'P2037']);
const postgresTransitorios = new Set(['40001', '40P01', '55P03', '57014', '53300', '57P01', '57P02', '57P03']);
const adapterTransitorios = new Set(['TransactionWriteConflict', 'TooManyConnections', 'DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout']);

/** Examina campos estructurados del error Prisma/driver, no mensajes ni texto SQL. */
export function esErrorTransitorio(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) &&
      !(error instanceof Prisma.PrismaClientInitializationError)) return false;
  if (error instanceof Prisma.PrismaClientKnownRequestError && prismaTransitorios.has(error.code)) return true;
  if (error instanceof Prisma.PrismaClientInitializationError && error.errorCode && prismaTransitorios.has(error.errorCode)) return true;
  const seen = new Set<object>();
  function buscar(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || seen.has(value)) return false;
    seen.add(value);
    const obj = value as Record<string, unknown>;
    if ((typeof obj.code === 'string' && postgresTransitorios.has(obj.code)) ||
        (typeof obj.originalCode === 'string' && postgresTransitorios.has(obj.originalCode)) ||
        (typeof obj.kind === 'string' && adapterTransitorios.has(obj.kind))) return true;
    return ['meta', 'driverAdapterError', 'cause'].some(key => buscar(obj[key]));
  }
  return buscar(error);
}

export async function conErroresTransitorios<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (esErrorTransitorio(error)) throw new ServiceUnavailableException('Servicio temporalmente no disponible; reintente');
    throw error;
  }
}
