/**
 * The abuse limits (Module 19 section 4): 30 starts a minute per person, and
 * the global ceiling on waiting jobs answered with "Clips is very busy right
 * now" (503 `clips_busy`). Also checks which routes carry the guard.
 */
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';
import { ClipItemController } from '../clip/clip-item.controller';
import { ClipDownloadsController } from '../downloads/clip-downloads.controller';
import { ClipHighlightsController } from '../highlights/clip-highlights.controller';
import { ClipVideosController } from '../videos/clip-videos.controller';
import {
  CLIP_STARTS_PER_MINUTE,
  ClipsCreateGuard,
  QUEUED_COUNT_CACHE_MS,
} from './clips-create.guard';

const count = jest.fn(async () => 0);
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { clipJob: { count: (...args: unknown[]) => count(...(args as [])) } },
}));

function build(ceiling = 500) {
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const config = { get: (key: string) => (key === 'CLIPS_QUEUE_CEILING' ? ceiling : undefined) };
  return new ClipsCreateGuard(redis, config as unknown as ConfigService);
}

function context(userId: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'POST',
        path: '/clips/videos',
        route: { path: '/clips/videos' },
        user: userId ? { id: userId } : undefined,
      }),
    }),
  } as never;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  count.mockReset();
  count.mockResolvedValue(0);
});

describe('ClipsCreateGuard', () => {
  it('lets 30 starts a minute through for one person, then answers 429 clips_throttled', async () => {
    const guard = build();
    for (let i = 0; i < CLIP_STARTS_PER_MINUTE; i += 1) {
      await expect(guard.canActivate(context('user-a'))).resolves.toBe(true);
    }
    expect(await refusal(guard.canActivate(context('user-a')))).toEqual({
      status: 429,
      body: {
        code: 'clips_throttled',
        message: 'You are going very quickly. Wait a minute, then try again.',
      },
    });
    // Another person is counted on their own.
    await expect(guard.canActivate(context('user-b'))).resolves.toBe(true);
  });

  it('refuses new work with 503 clips_busy once the waiting jobs reach the ceiling', async () => {
    count.mockResolvedValue(10);
    expect(await refusal(build(10).canActivate(context('user-c')))).toEqual({
      status: 503,
      body: {
        code: 'clips_busy',
        message: 'Clips is very busy right now. Try again in a few minutes.',
      },
    });
    expect(count).toHaveBeenCalledWith({ where: { status: 'QUEUED' } });
  });

  it('counts the waiting jobs once per cache window', async () => {
    const guard = build();
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await guard.canActivate(context('user-d'));
    await guard.canActivate(context('user-d'));
    expect(count).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + QUEUED_COUNT_CACHE_MS + 1);
    await guard.canActivate(context('user-d'));
    expect(count).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('has nothing to count without a session (JwtAuthGuard refused it already)', async () => {
    await expect(build().canActivate(context(undefined))).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });
});

describe('the routes that start work carry it', () => {
  const marked = (controller: object, method: string) =>
    (
      (Reflect.getMetadata(
        '__guards__',
        (controller as Record<string, object>)[method] as object,
      ) ?? []) as unknown[]
    ).includes(ClipsCreateGuard);

  it.each([
    [ClipVideosController, 'import'],
    [ClipVideosController, 'startUpload'],
    [ClipVideosController, 'retry'],
    [ClipVideosController, 'downloadOriginal'],
    [ClipItemController, 'create'],
    [ClipItemController, 'export'],
    [ClipItemController, 'preview'],
    [ClipDownloadsController, 'start'],
    [ClipDownloadsController, 'saveToMedia'],
    [ClipHighlightsController, 'start'],
  ] as const)('%p.%s', (controller, method) => {
    expect(typeof controller.prototype[method as keyof typeof controller.prototype]).toBe(
      'function',
    );
    expect(marked(controller.prototype, method)).toBe(true);
  });

  it('leaves reads alone', () => {
    expect(marked(ClipVideosController.prototype, 'list')).toBe(false);
  });
});
