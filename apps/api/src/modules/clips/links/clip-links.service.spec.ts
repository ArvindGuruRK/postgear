/**
 * The link probe against a fake worker: every refusal, in the order the
 * service meets them, and the answers that pass. Redis is the real service's
 * in-process fallback (no `REDIS_URL`), so the throttle, the breaker and the
 * cache run their real code with no server.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { refusalMessage } from '@postgear/entitlements';
import type { LinkInfo, LinkRef } from '@postgear/video-engine';
import { EntitlementRefusedException } from '../../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { RedisService } from '../../redis/redis.service';
import type { ClipQueryOutcome, SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipLinksRepository } from './clip-links.repository';
import { ClipLinksService, PROBES_PER_MINUTE } from './clip-links.service';
import { BREAKER_THRESHOLD, ClipPlatformBreaker } from './platform-breaker';

const ORG = 'seed-demo-org';
const TWITCH_LINK = 'https://www.twitch.tv/videos/900000001';

function infoFor(overrides: Partial<LinkInfo> = {}): LinkInfo {
  return {
    platform: 'twitch',
    kind: 'past_stream',
    externalId: '900000001',
    canonicalUrl: 'https://www.twitch.tv/videos/900000001',
    title: 'A ten minute stream',
    channelName: 'Acme',
    durationMs: 10 * 60_000,
    live: false,
    thumbnailUrl: 'https://static-cdn.example/thumb.jpg',
    formats: [
      {
        id: 'h720',
        label: '720p',
        height: 720,
        fps: 30,
        ext: 'mp4',
        bytes: null,
        audioOnly: false,
      },
    ],
    ...overrides,
  };
}

function config(platforms = ['youtube', 'twitch', 'kick']): ConfigService {
  const values: Record<string, unknown> = { CLIPS_PLATFORMS: platforms };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** A resolver that answers from a table and throws the real refusal, as the real one does. */
function fakeResolver(values: { enabled?: boolean; maxMinutes?: number | null } = {}) {
  const table: Record<string, unknown> = {
    'clips.enabled': values.enabled ?? true,
    'clips.max_video_minutes': values.maxMinutes === undefined ? 60 : values.maxMinutes,
  };
  const codes: Record<string, string> = {
    'clips.enabled': 'clips_not_in_plan',
    'clips.max_video_minutes': 'clips_video_too_long',
  };
  return {
    assert: jest.fn(
      async (_org: string, key: string, predicate: (v: unknown) => boolean, refusal = {}) => {
        const limit = table[key];
        if (predicate(limit)) return limit;
        const n = typeof limit === 'number' ? limit : undefined;
        throw new EntitlementRefusedException(codes[key], refusalMessage(codes[key], { n }), {
          limit: n,
          ...(refusal as object),
        });
      },
    ),
  };
}

function setup(
  options: {
    answer?: ClipQueryOutcome<unknown>;
    platforms?: string[];
    enabled?: boolean;
    maxMinutes?: number | null;
    existing?: string | null;
  } = {},
) {
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const scheduling = {
    runClipQuery: jest.fn(async () => options.answer ?? { outcome: 'answered', value: infoFor() }),
  };
  const repository = { existingVideoId: jest.fn(async () => options.existing ?? null) };
  const breaker = new ClipPlatformBreaker(redis);
  const resolver = fakeResolver({ enabled: options.enabled, maxMinutes: options.maxMinutes });
  const service = new ClipLinksService(
    scheduling as unknown as SchedulingService,
    resolver as unknown as EntitlementResolver,
    redis,
    breaker,
    repository as unknown as ClipLinksRepository,
    config(options.platforms) as never,
  );
  return { service, scheduling, repository, breaker, redis, resolver };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

/** A Temporal-shaped failure: an activity failure wrapping the application failure with our details. */
function workerFailure(code: string, platform?: string) {
  return {
    name: 'ActivityFailure',
    cause: { name: 'ApplicationFailure', details: [{ code, platform }] },
  };
}

beforeAll(() => Logger.overrideLogger(false));

describe('ClipLinksService.probe', () => {
  it('answers a recognised link with the worker answer and the canonical link', async () => {
    const { service, scheduling } = setup();
    const result = await service.probe(ORG, `${TWITCH_LINK}?t=1h2m`);
    expect(result.link).toEqual({
      platform: 'twitch',
      kind: 'past_stream',
      externalId: '900000001',
      canonicalUrl: 'https://www.twitch.tv/videos/900000001',
    } satisfies LinkRef);
    expect(result.info.title).toBe('A ten minute stream');
    expect(result.existingVideoId).toBeNull();
    const call = scheduling.runClipQuery.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(call[0]).toMatchObject({
      workflowType: 'clipProbeWorkflow',
      taskQueue: 'postgear-media-quick',
      waitMs: 25_000,
      args: [result.link],
    });
    expect(String(call[0].workflowId)).toMatch(/^clip-probe:[0-9a-f]{32}$/);
  });

  it('refuses a link it does not read with 422 and the refusal code, before any tool', async () => {
    const { service, scheduling } = setup();
    const answer = await refusal(service.probe(ORG, 'https://vimeo.com/123456'));
    expect(answer.status).toBe(422);
    expect(answer.body.code).toBe('link_unsupported');
    expect(answer.body.message).toBe(
      'We can only read YouTube, Twitch and Kick links for now. You can upload the file instead.',
    );
    const channel = await refusal(service.probe(ORG, 'https://www.youtube.com/@acme'));
    expect(channel).toMatchObject({ status: 422, body: { code: 'link_not_a_video' } });
    expect(scheduling.runClipQuery).not.toHaveBeenCalled();
  });

  it('answers platform_paused for a platform switched off, and still reads the others', async () => {
    const { service } = setup({ platforms: ['twitch', 'kick'] });
    const answer = await refusal(service.probe(ORG, 'https://www.youtube.com/watch?v=simtalk0001'));
    expect(answer.status).toBe(422);
    expect(answer.body).toMatchObject({
      code: 'platform_paused',
      message: 'YouTube links are paused for now. You can upload the file instead.',
    });
    await expect(service.probe(ORG, TWITCH_LINK)).resolves.toBeDefined();
  });

  it('rests a platform after five resting answers and then answers at once', async () => {
    const { service, scheduling } = setup({
      answer: { outcome: 'failed', error: workerFailure('platform_resting', 'twitch') },
    });
    for (let index = 0; index < BREAKER_THRESHOLD; index++) {
      const answer = await refusal(
        service.probe(ORG, `https://www.twitch.tv/videos/90000000${index}`),
      );
      expect(answer).toMatchObject({ status: 503, body: { code: 'platform_resting' } });
    }
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(BREAKER_THRESHOLD);
    const rested = await refusal(service.probe(ORG, 'https://www.twitch.tv/videos/900000009'));
    expect(rested.status).toBe(503);
    expect(rested.body.message).toBe(
      'Twitch is not answering us right now. Try again in a little while, or upload the file instead.',
    );
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(BREAKER_THRESHOLD);
  });

  it('throttles the eleventh probe in a minute with 429 probe_throttled', async () => {
    const { service } = setup();
    for (let index = 0; index < PROBES_PER_MINUTE; index++) {
      await service.probe(ORG, TWITCH_LINK);
    }
    const answer = await refusal(service.probe(ORG, TWITCH_LINK));
    expect(answer).toMatchObject({ status: 429, body: { code: 'probe_throttled' } });
    // Another workspace has its own minute.
    await expect(service.probe('another-org', TWITCH_LINK)).resolves.toBeDefined();
  });

  it('answers the second probe of a link from the cache', async () => {
    const { service, scheduling } = setup();
    await service.probe(ORG, TWITCH_LINK);
    const second = await service.probe(ORG, 'https://twitch.tv/videos/900000001');
    expect(second.info.title).toBe('A ten minute stream');
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(1);
  });

  it('never caches a live answer, and refuses it with 422 link_live', async () => {
    const { service, scheduling } = setup({
      answer: { outcome: 'answered', value: infoFor({ live: true }) },
    });
    expect(await refusal(service.probe(ORG, TWITCH_LINK))).toMatchObject({
      status: 422,
      body: { code: 'link_live' },
    });
    await refusal(service.probe(ORG, TWITCH_LINK));
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(2);
  });

  it('refuses a video longer than the plan with the 402 and whole-number details', async () => {
    const { service } = setup({
      answer: { outcome: 'answered', value: infoFor({ durationMs: 95 * 60_000 + 1 }) },
      maxMinutes: 90,
    });
    const answer = await refusal(service.probe(ORG, TWITCH_LINK));
    expect(answer.status).toBe(402);
    expect(answer.body).toEqual({
      message:
        'This video is longer than your plan allows (90 minutes). Upgrade the plan to bring in longer videos.',
      code: 'clips_video_too_long',
      details: { limit: 90, needed: 96 },
    });
  });

  it('lets any length through on an unlimited plan', async () => {
    const { service } = setup({
      answer: { outcome: 'answered', value: infoFor({ durationMs: 20 * 60 * 60_000 }) },
      maxMinutes: null,
    });
    await expect(service.probe(ORG, TWITCH_LINK)).resolves.toBeDefined();
  });

  it('refuses a workspace without Clips with 402 clips_not_in_plan before asking the worker', async () => {
    const { service, scheduling } = setup({ enabled: false });
    expect(await refusal(service.probe(ORG, TWITCH_LINK))).toMatchObject({
      status: 402,
      body: { code: 'clips_not_in_plan' },
    });
    expect(scheduling.runClipQuery).not.toHaveBeenCalled();
  });

  it('says when the workspace already has the video', async () => {
    const { service, repository } = setup({ existing: 'a2b9c8d0-1111-4222-8333-444455556666' });
    const result = await service.probe(ORG, TWITCH_LINK);
    expect(result.existingVideoId).toBe('a2b9c8d0-1111-4222-8333-444455556666');
    expect(repository.existingVideoId).toHaveBeenCalledWith(ORG, 'twitch', '900000001');
  });

  it('answers 503 tools_offline when no worker answers in time', async () => {
    const { service } = setup({ answer: { outcome: 'unavailable' } });
    expect(await refusal(service.probe(ORG, TWITCH_LINK))).toMatchObject({
      status: 503,
      body: {
        code: 'tools_offline',
        message: 'Video tools are not running right now. Try again in a minute.',
      },
    });
  });

  it("maps the worker's link codes to 422 and anything else to 502 tool_failed", async () => {
    const privateLink = setup({
      answer: { outcome: 'failed', error: workerFailure('link_private') },
    });
    expect(await refusal(privateLink.service.probe(ORG, TWITCH_LINK))).toMatchObject({
      status: 422,
      body: { code: 'link_private' },
    });
    const unknown = setup({
      answer: { outcome: 'failed', error: new Error('yt-dlp said something') },
    });
    const answer = await refusal(unknown.service.probe(ORG, TWITCH_LINK));
    expect(answer).toMatchObject({ status: 502, body: { code: 'tool_failed' } });
    expect(String(answer.body.message)).not.toContain('yt-dlp');
  });

  it('refuses an answer about another video as tool_failed and does not cache it', async () => {
    const { service, scheduling } = setup({
      answer: { outcome: 'answered', value: infoFor({ externalId: '123' }) },
    });
    expect(await refusal(service.probe(ORG, TWITCH_LINK))).toMatchObject({ status: 502 });
    await refusal(service.probe(ORG, TWITCH_LINK));
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(2);
  });
});
