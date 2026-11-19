/**
 * Sprint 12, Module 20 section 2: the API's share of the stories' edge cases
 * (section 5 of `docs/new-modules/user-stories-clips.md`) that no older spec
 * proves word for word.
 *
 * - My Channels, through the real factory under `CLIPS_SIMULATION=true`, with
 *   the forcing channels a hand check types into Add A Channel:
 *   `simempty` (no public videos), `simquota` (YouTube's list allowance is
 *   used) and `simflaky` (the list answers once, then cannot be read, so the
 *   last answer is served marked stale with the sentence). With simulation
 *   off the names are nobody special: they go to the real bindings.
 * - The ledger's refusal sentences for "The monthly import minutes are used
 *   up" and "Not enough AI minutes", with the stories' own numbers, from the
 *   real `UsageService.consume`.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import { refusalMessage } from '@postgear/entitlements';
import type { ChannelRef } from '@postgear/video-engine';
import { EntitlementRefusedException } from '../entitlements/entitlement-refused.exception';
import type { EntitlementResolver } from '../entitlements/entitlement-resolver';
import type { EntitlementsRepository } from '../entitlements/entitlements.repository';
import { UsageService } from '../entitlements/usage.service';
import { RedisService } from '../redis/redis.service';
import type { SchedulingService } from '../scheduling/scheduling.service';
import { ChannelListCache } from './channels/channel-list.cache';
import { ChannelListerSelector, type ListerSets } from './channels/channel-lister.selector';
import { createListerSets } from './channels/channel-listers.factory';
import type {
  ChannelRow,
  ClipChannelsRepository,
  CreateChannelOutcome,
} from './channels/clip-channels.repository';
import { ClipChannelsService } from './channels/clip-channels.service';
import { simulationChannel } from './channels/listers/simulation-switches.lister';
import { ClipPlatformBreaker } from './links/platform-breaker';

const ORG = 'seed-demo-org';
const T0 = Date.parse('2026-11-19T09:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const NOT_READABLE = "This channel's list is not available right now. Try again in a few minutes.";
const QUOTA =
  "We have reached today's limit for YouTube lists. Try again tomorrow, or paste a video link.";

beforeAll(() => Logger.overrideLogger(false));

// ---- My Channels ---------------------------------------------------------------------

/** A small in-memory channel table, scoped by workspace like the real one. */
function fakeRepository() {
  const rows = new Map<string, ChannelRow>();
  let next = 0;
  const repository = {
    list: jest.fn(async () => [...rows.values()]),
    find: jest.fn(async (_org: string, id: string) => rows.get(id) ?? null),
    count: jest.fn(async () => rows.size),
    findByHandle: jest.fn(async () => null),
    findByExternalId: jest.fn(async () => null),
    create: jest.fn(
      async (_org: string, _user: string | null, platform: string, ref: ChannelRef) => {
        next += 1;
        const id = `0b5e7c1a-2f3d-4e5f-8a9b-${String(next).padStart(12, '0')}`;
        const row: ChannelRow = {
          id,
          platform: platform as ChannelRow['platform'],
          handle: ref.handle,
          externalId: ref.externalId,
          displayName: ref.displayName,
          avatarUrl: ref.avatarUrl,
          uploadsListId: ref.uploadsListId ?? null,
          broadcasterType: ref.broadcasterType ?? null,
          lastSyncedAt: null,
          error: null,
          createdAt: new Date(T0),
        };
        rows.set(id, row);
        return { outcome: 'created', channel: row } as CreateChannelOutcome;
      },
    ),
    remove: jest.fn(async () => true),
    hiddenIds: jest.fn(async () => new Set<string>()),
    hide: jest.fn(async () => 'hidden'),
    unhide: jest.fn(async () => true),
    importedVideos: jest.fn(async () => new Map<string, string>()),
    markSynced: jest.fn(async (_org: string, id: string, at: Date | null, error: string | null) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, error, ...(at ? { lastSyncedAt: at } : {}) });
    }),
  };
  return repository;
}

function allowEverything() {
  return {
    assert: jest.fn(async (_org: string, key: string) =>
      key === 'clips.browse_channels' ? 3 : true,
    ),
  };
}

function config(values: Record<string, unknown>) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** The lister sets exactly as the API builds them at boot. */
function listerSets(simulation: 'true' | 'false') {
  const redis = new RedisService(config({}));
  const runClipQuery = jest.fn(async () => ({ outcome: 'unavailable' as const }));
  const http = jest.fn(async () => {
    throw new Error('no network in tests');
  });
  const sets = createListerSets({
    config: config({ CLIPS_SIMULATION: simulation }) as never,
    scheduling: { runClipQuery } as unknown as SchedulingService,
    redis,
    breaker: new ClipPlatformBreaker(redis),
    http,
  });
  return { sets, runClipQuery, http };
}

/** The channel routes over one clock the test moves. */
function channels(sets: ListerSets) {
  const clock = { now: T0 };
  const redis = new RedisService(config({}));
  const cache = new ChannelListCache(redis, () => clock.now);
  const service = new ClipChannelsService(
    fakeRepository() as unknown as ClipChannelsRepository,
    new ChannelListerSelector(sets),
    cache,
    allowEverything() as unknown as EntitlementResolver,
    redis,
    config({ CLIPS_PLATFORMS: ['youtube', 'twitch', 'kick'] }) as never,
  );
  return { service, clock };
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

describe('"A channel has no public videos" (simempty)', () => {
  it.each(['youtube', 'twitch', 'kick'] as const)(
    'adds on %s and lists nothing, which is not an error',
    async (platform) => {
      const { service } = channels(listerSets('true').sets);
      const channel = await service.add(ORG, null, { platform, handle: 'simempty' });
      expect(channel.displayName).toBe('Sample: No Public Videos');
      const page = await service.streams(ORG, channel.id, {});
      expect(page).toMatchObject({ items: [], stale: false, notice: null, nextCursor: null });
    },
  );
});

describe('"The platform\'s list allowance for the day is used" (simquota)', () => {
  it('answers 503 quota_exhausted with the story sentence on YouTube', async () => {
    const { service } = channels(listerSets('true').sets);
    const channel = await service.add(ORG, null, { platform: 'youtube', handle: '@simquota' });
    const answer = await refusal(service.streams(ORG, channel.id, {}));
    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({ code: 'quota_exhausted', message: QUOTA });
  });

  it('is a YouTube switch only: on Twitch the name is an unknown channel', async () => {
    expect(simulationChannel('twitch', 'simquota')).toBeNull();
    const { service } = channels(listerSets('true').sets);
    const answer = await refusal(
      service.add(ORG, null, { platform: 'twitch', handle: 'simquota' }),
    );
    expect(answer.body).toMatchObject({ code: 'channel_not_found' });
  });
});

describe('"A channel list cannot be read" (simflaky)', () => {
  it('serves the last answer, marked stale with its time and the story sentence', async () => {
    const { sets } = listerSets('true');
    const { service, clock } = channels(sets);
    const channel = await service.add(ORG, null, { platform: 'twitch', handle: 'simflaky' });

    const first = await service.streams(ORG, channel.id, {});
    expect(first.stale).toBe(false);
    expect(first.notice).toBeNull();
    expect(first.items.length).toBeGreaterThan(0);

    // Three hours on, the copy is no longer fresh and the list cannot be read.
    clock.now = T0 + 3 * HOUR;
    const later = await service.streams(ORG, channel.id, {});
    expect(later).toMatchObject({
      stale: true,
      updatedAt: new Date(T0).toISOString(),
      notice: NOT_READABLE,
    });
    expect(later.items.map((item) => item.externalId)).toEqual(
      first.items.map((item) => item.externalId),
    );

    // Past a day the old copy is never shown: the sentence comes as the refusal.
    clock.now = T0 + 25 * HOUR;
    const tooOld = await refusal(service.streams(ORG, channel.id, {}));
    expect(tooOld.status).toBe(503);
    expect(tooOld.body).toEqual({ code: 'channel_listing_failed', message: NOT_READABLE });
  });

  it('with no copy to fall back on, refuses with the same sentence', async () => {
    const { sets } = listerSets('true');
    const warm = channels(sets);
    const added = await warm.service.add(ORG, null, { platform: 'kick', handle: 'simflaky' });
    await warm.service.streams(ORG, added.id, {});

    // A second API process (its own empty cache) over the same listers.
    const cold = channels(sets);
    const channel = await cold.service.add(ORG, null, { platform: 'kick', handle: 'simflaky' });
    const answer = await refusal(cold.service.streams(ORG, channel.id, {}));
    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({ code: 'channel_listing_failed', message: NOT_READABLE });
  });
});

describe('the forcing channels with simulation off', () => {
  it('are ordinary names: the real bindings are asked, never the switches', async () => {
    const { sets, runClipQuery, http } = listerSets('false');
    const selector = new ChannelListerSelector(sets);
    for (const [platform, handle] of [
      ['twitch', 'simempty'],
      ['youtube', '@simquota'],
      ['kick', 'simflaky'],
    ] as const) {
      await expect(selector.resolve(platform, handle)).rejects.toMatchObject({
        code: 'tools_offline',
      });
    }
    // No keys: every platform goes to the worker's flat list (not running here).
    expect(runClipQuery).toHaveBeenCalledTimes(3);
    expect(http).not.toHaveBeenCalled();
  });
});

// ---- The ledger's refusal sentences ----------------------------------------------------

const NOW = new Date('2026-11-19T12:00:00.000Z');
const CYCLE_START = new Date('2026-11-01T00:00:00.000Z');
const CYCLE_END = new Date('2026-12-01T00:00:00.000Z');

function ledger(limit: number, usedMinutes: number) {
  const repository = {
    findByKey: jest.fn(async () => null),
    sumUnits: jest.fn(async () => usedMinutes * 1_000),
    insert: jest.fn(async () => {
      throw new Error('a refused charge must not write a row');
    }),
  };
  const resolver = {
    exactMeter: jest.fn(async () => ({
      limitValue: limit,
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
    })),
  };
  jest
    .spyOn(prisma, '$transaction')
    .mockImplementation((async (fn: (tx: unknown) => unknown) => fn({})) as never);
  const usage = new UsageService(
    repository as unknown as EntitlementsRepository,
    resolver as unknown as EntitlementResolver,
  );
  return { usage, repository };
}

async function refused(promise: Promise<unknown>): Promise<EntitlementRefusedException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EntitlementRefusedException) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe("the ledger refusals, in the stories' words", () => {
  afterEach(() => jest.restoreAllMocks());

  it('"The monthly import minutes are used up": 900 of 900 used', async () => {
    const { usage, repository } = ledger(900, 900);
    const error = await refused(
      usage.consume(ORG, 'clips.import_minutes_per_month', 12, {
        idempotencyKey: 'clips.import:job-1',
        now: NOW,
      }),
    );
    expect(error.getStatus()).toBe(402);
    expect(error.getResponse()).toMatchObject({
      code: 'clips_minutes_used',
      message:
        'You have used all 900 import minutes for this month. They come back on 1 December, or you can upgrade the plan.',
    });
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('"Not enough AI minutes": needs 56, 9 left', async () => {
    const { usage } = ledger(300, 291);
    const error = await refused(
      usage.consume(ORG, 'clips.ai_minutes_per_month', 56, {
        idempotencyKey: 'clips.ai:job-2',
        now: NOW,
      }),
    );
    expect(error.getStatus()).toBe(402);
    expect(error.getResponse()).toMatchObject({
      code: 'clips_ai_minutes_used',
      message:
        'This needs 56 AI minutes and you have 9 left. They come back on 1 December, or you can upgrade the plan.',
      details: { limit: 300, used: 291, needed: 56, remaining: 9 },
    });
    // The same words the entitlements package builds for the web's own check.
    expect((error.getResponse() as { message: string }).message).toBe(
      refusalMessage('clips_ai_minutes_used', { need: 56, n: 9, date: CYCLE_END }),
    );
  });
});
