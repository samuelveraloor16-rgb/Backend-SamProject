import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './interfaces/http/http-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true;
  app.enableCors({ origin: corsOrigin });

  // Base URL de la API: /api/v1 (ver docs/orquestacion/CONTRATO_API.md)
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`SamProject API escuchando en http://localhost:${port}/api/v1`);
}

void bootstrap();
