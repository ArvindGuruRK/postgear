import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/** Health checks and the Sentry test route (Sprint 8). */
@Module({ controllers: [HealthController] })
export class HealthModule {}
