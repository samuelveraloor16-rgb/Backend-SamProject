import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushDispatcher } from '../../aplicacion/push/push-dispatcher';
import { PushCoordinator } from '../../aplicacion/push/push-coordinator';
import { DetectorVencimientos } from '../../aplicacion/push/detector-vencimientos';
import { PrismaVencimientosRepository } from './prisma-vencimientos.repository';
import { esErrorTransitorio } from '../prisma/errores-transitorios';
import type { PushOutboxRepository } from '../../dominio/puertos/push-outbox.repository';
import { ExpoPushProvider } from '../push/expo-push.provider';
import { PrismaPushDispatchRepository } from '../push/prisma-push-dispatch.repository';
import { PrismaService } from '../prisma/prisma.service';
import { DISPOSITIVO_REPOSITORY } from '../../dominio/puertos/dispositivo.repository';
import { PUSH_OUTBOX_REPOSITORY } from '../../dominio/puertos/push-outbox.repository';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaDispositivoRepository } from './prisma-dispositivo.repository';
import { PrismaPushOutboxRepository } from './prisma-push-outbox.repository';

/** Providers invocables; la programación opt-in vive en PushSchedulingModule. */
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: DetectorVencimientos, inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new DetectorVencimientos(new PrismaVencimientosRepository(prisma)) },
    { provide: PushCoordinator, inject: [DetectorVencimientos, PushDispatcher],
      useFactory: (detector: DetectorVencimientos, dispatcher: PushDispatcher) => new PushCoordinator(detector, dispatcher, esErrorTransitorio) },
    { provide: DISPOSITIVO_REPOSITORY, useClass: PrismaDispositivoRepository },
    { provide: PUSH_OUTBOX_REPOSITORY, useClass: PrismaPushOutboxRepository },
    {
      provide: PushDispatcher,
      inject: [PUSH_OUTBOX_REPOSITORY, PrismaService, ConfigService],
      useFactory: (outbox: PushOutboxRepository, prisma: PrismaService, config: ConfigService) => {
        const provider = new ExpoPushProvider((url, init) => fetch(url, init), {
          habilitado: config.get<string>('EXPO_PUSH_ENABLED') === 'true',
          accessToken: config.get<string>('EXPO_ACCESS_TOKEN'),
        });
        const logger = new Logger('PushDispatcher');
        return new PushDispatcher(outbox, new PrismaPushDispatchRepository(prisma), provider, message => logger.warn(message));
      },
    },
  ],
  exports: [DISPOSITIVO_REPOSITORY, PUSH_OUTBOX_REPOSITORY, PushDispatcher, DetectorVencimientos, PushCoordinator],
})
export class PushPersistenceModule {}
