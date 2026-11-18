/**
 * The flat list through the worker, with a fake scheduler: the request it
 * sends, the breaker shared with the probe, the two slots per platform, and
 * how no answer and a failure read.
 */
import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { ChannelRef } from '@postgear/video-engine';
import { RedisService } from '../../../redis/redis.service';
import type { ClipQueryOutcome, SchedulingService } from '../../../scheduling/scheduling.service';
import { ClipPlatformBreaker } from '../../links/platform-breaker';
import { WorkerFlatLister } from './worker-flat.lister';

const CHANNEL: ChannelRef = {
  platform: 'kick',
  handle: 'acme',
  externalId: 'acme',
  displayName: 'Acme',
  avatarUrl: null,
};

function setup(answer: ClipQueryOutcome<unknown>) {
  const redis = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const breaker = new ClipPlatformBreaker(redis);
  const scheduling = { runClipQuery: jest.fn(async () => answer) };
  const lister = new WorkerFlatLister('kick', {
    scheduling: scheduling as unknown as SchedulingService,
    breaker,
    redis,
    sleep: async () => undefined,
  });
  return { lister, scheduling, breaker, redis };
}

beforeAll(() => Logger.overrideLogger(false));

describe('WorkerFlatLister', () => {
  it('asks the list workflow on the quick queue and answers its page', async () => {
    const page = { items: [], nextCursor: '51' };
    const { lister, scheduling } = setup({ outcome: 'answered', value: { op: 'list', page } });
    await expect(lister.list(CHANNEL, { kind: 'streams', limit: 50 })).resolves.toEqual(page);
    const [request] = scheduling.runClipQuery.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(request).toMatchObject({
      workflowType: 'clipListChannelWorkflow',
      taskQueue: 'postgear-media-quick',
      args: [
        { op: 'list', platform: 'kick', channel: CHANNEL, query: { kind: 'streams', limit: 50 } },
      ],
    });
    expect(String(request.workflowId)).toMatch(/^clip-list:[0-9a-f]{32}$/);
  });

  it('answers tools_offline when no worker answers', async () => {
    const { lister } = setup({ outcome: 'unavailable' });
    await expect(lister.resolve('acme')).rejects.toMatchObject({ code: 'tools_offline' });
  });

  it("carries the worker's code, counts a resting answer, and rests with the probe's breaker", async () => {
    const failure = { cause: { details: [{ code: 'platform_resting', platform: 'kick' }] } };
    const { lister, scheduling, breaker } = setup({ outcome: 'failed', error: failure });
    for (let index = 0; index < 5; index++) {
      await expect(lister.resolve('acme')).rejects.toMatchObject({ code: 'platform_resting' });
    }
    expect(await breaker.isResting('kick')).toBe(true);
    await expect(lister.resolve('acme')).rejects.toMatchObject({ code: 'platform_resting' });
    expect(scheduling.runClipQuery).toHaveBeenCalledTimes(5);

    const notFound = setup({
      outcome: 'failed',
      error: { details: [{ code: 'channel_not_found' }] },
    });
    await expect(notFound.lister.resolve('acme')).rejects.toMatchObject({
      code: 'channel_not_found',
    });
    const odd = setup({ outcome: 'failed', error: new Error('boom') });
    await expect(odd.lister.resolve('acme')).rejects.toMatchObject({
      code: 'channel_listing_failed',
    });
  });

  it('answers clips_busy when both slots of the platform are taken, and frees its own slot', async () => {
    const { lister, redis } = setup({
      outcome: 'answered',
      value: { op: 'resolve', channel: CHANNEL },
    });
    await lister.resolve('acme');
    expect(await redis.get('clips:flat:kick:slot:0')).toBeNull();
    await redis.setIfAbsent('clips:flat:kick:slot:0', 'someone', 45);
    await redis.setIfAbsent('clips:flat:kick:slot:1', 'someone', 45);
    await expect(lister.resolve('acme')).rejects.toMatchObject({ code: 'clips_busy' });
  });
});
