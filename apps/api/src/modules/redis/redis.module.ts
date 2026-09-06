import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Global so guards can inject it without every feature module re-importing it.
 * There is exactly one connection per process.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
