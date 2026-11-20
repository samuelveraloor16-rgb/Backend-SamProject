import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { COMENTARIOS_REPOSITORY, type ComentariosRepository } from '../../dominio/puertos/comentarios.repository';

type Contexto = { get(token: symbol): ComentariosRepository & { limpiarVencidas(limite: number): Promise<number> }; close(): Promise<void> };

/** Un solo lote; el planificador del sistema debe invocarlo explícitamente. */
export async function ejecutarLimpieza(
  habilitada: string | undefined,
  argumentos: string[],
  crearContexto: () => Promise<Contexto>,
): Promise<number> {
  if (habilitada !== 'true' || argumentos.length !== 1 || argumentos[0] !== '--ejecutar') {
    throw new Error('Limpieza deshabilitada o sin autorización explícita');
  }
  const contexto = await crearContexto();
  try {
    return await contexto.get(COMENTARIOS_REPOSITORY).limpiarVencidas(100);
  } finally {
    await contexto.close();
  }
}

if (require.main === module) {
  void ejecutarLimpieza(process.env.RF19_LIMPIEZA_HABILITADA, process.argv.slice(2),
    () => NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false }),
  ).then(total => {
    console.log(`Limpieza RF-19: ${total} marcadores vencidos eliminados`);
  }).catch(() => {
    // Los detalles pueden incluir URLs de conexión o datos: no registrarlos.
    console.error('Limpieza RF-19 no realizada o incompleta; revisar configuración y monitoreo protegido');
    process.exitCode = 1;
  });
}
