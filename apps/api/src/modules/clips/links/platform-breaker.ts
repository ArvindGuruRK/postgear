/**
 * The per-platform breaker (Module 03, section 3): five `platform_resting`
 * answers in ten minutes rest that platform for ten minutes, during which a
 * probe or a flat channel list answers `platform_resting` at once and no
 * tool is started.
 *
 * Shared by every API instance through Redis. The count window is fixed (its
 * expiry is set on the first answer), and reaching the threshold starts the
 * rest and clears the count, so the platform gets a clean slate after it.
 */
import { Injectable, Logger } from '@nestjs/common';
import type { ClipPlatformId } from '@postgear/video-engine';
import { RedisService } from '../../redis/redis.service';

export const BREAKER_THRESHOLD = 5;
export const BREAKER_WINDOW_SECONDS = 10 * 60;
export const BREAKER_REST_SECONDS = 10 * 60;

@Injectable()
export class ClipPlatformBreaker {
  private readonly logger = new Logger(ClipPlatformBreaker.name);

  constructor(private readonly redis: RedisService) {}

  /** True while the platform is resting. */
  async isResting(platform: ClipPlatformId): Promise<boolean> {
    return (await this.redis.get(restKey(platform))) !== null;
  }

  /** Counts one `platform_resting` answer, and rests the platform at the threshold. */
  async recordResting(platform: ClipPlatformId): Promise<void> {
    const count = await this.redis.incrementWithTtl(countKey(platform), BREAKER_WINDOW_SECONDS);
    if (count < BREAKER_THRESHOLD) return;
    await this.redis.set(restKey(platform), new Date().toISOString(), BREAKER_REST_SECONDS);
    await this.redis.delete(countKey(platform));
    this.logger.warn(
      JSON.stringify({
        event: 'clips.platform.resting',
        platform,
        restSeconds: BREAKER_REST_SECONDS,
      }),
    );
  }
}

function countKey(platform: ClipPlatformId): string {
  return `clips:breaker:${platform}:count`;
}

function restKey(platform: ClipPlatformId): string {
  return `clips:breaker:${platform}:rest`;
}
