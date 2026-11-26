import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PushPersistenceModule } from '../repositorios/push-persistence.module';
import { PushScheduler } from './push-scheduler';

@Module({
  imports: [ConfigModule, ScheduleModule.forRoot(), PushPersistenceModule],
  providers: [PushScheduler],
})
export class PushSchedulingModule {}
