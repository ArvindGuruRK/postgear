/**
 * Security sweep, Sprint 13 Module 16: a site that is switched off
 * (`CLIPS_PLATFORMS`) cannot be reached by crafting a link, nor by retrying
 * an old import of one.
 *
 * Existing tests this builds on: `clip-links.service.spec.ts` "answers
 * platform_paused for a platform switched off, and still reads the others"
 * and "pauses each site on its own switch, with the site in the sentence"
 * (one plain link per site). Here every Module 12 site is tried with the
 * spellings a person could craft (capitals, a trailing dot, its other hosts,
 * an embed or player address, extra parameters, a fragment), and links on a
 * site that is on that carry an off site's address in their parameters:
 * none of them ever reaches the worker as the off site. A failed import of
 * a site switched off since is refused on retry before any job is written
 * (the fix made in this sweep: `ClipVideosService.retry` probes the link
 * again, as a new import does).
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { ClipJob, ClipVideo } from '@postgear/db';
import { type LinkInfo, type LinkRef, SITES } from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import { RedisService } from '../../redis/redis.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import type { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { ClipRetentionService } from '../retention/clip-retention.service';
import { jobRow, TEST_ORG, TEST_USER, videoRow } from '../testing/rows';
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import type { ClipSampleLink } from '../videos/clip-sample';
import type { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipVideosService } from '../videos/clip-videos.service';
import type { ClipLinksRepository } from './clip-links.repository';
import { ClipLinksService } from './clip-links.service';
import { ClipPlatformBreaker } from './platform-breaker';

beforeAll(() => Logger.overrideLogger(false));

const SPRINT_12 = ['youtube', 'twitch', 'kick'] as const;

function infoFor(link: LinkRef): LinkInfo {
  return {
    platform: link.platform,
    kind: link.kind,
    externalId: link.externalId,
    canonicalUrl: link.canonicalUrl,
    title: 'A video',
    channelName: 'Acme',
    durationMs: 60_000,
    live: false,
    thumbnailUrl: null,
    formats: [],
  } as LinkInfo;
}

function linkService(platforms: readonly string[] = SPRINT_12) {
  const asked: LinkRef[] = [];
  const scheduling = {
    runClipQuery: jest.fn(async (request: { args: [LinkRef] }) => {
      asked.push(request.args[0]);
      return { outcome: 'answered', value: infoFor(request.args[0]) };
    }),
  };
  const store = new RedisService({ get: () => undefined } as unknown as ConfigService);
  const service = new ClipLinksService(
    scheduling as unknown as SchedulingService,
    { assert: jest.fn(async () => true) } as unknown as EntitlementResolver,
    store,
    new ClipPlatformBreaker(store),
    {
      existingVideoId: jest.fn(async () => null),
      isBlocked: jest.fn(async () => false),
    } as unknown as ClipLinksRepository,
    { get: () => [...platforms] } as never,
  );
  return { service, asked };
}

/** What a person could paste for each Module 12 site, every one of them pointing at that site. */
const CRAFTED: Record<string, string[]> = {
  vimeo: [
    'https://VIMEO.COM/123456789',
    'https://vimeo.com./123456789',
    'https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0',
    'vimeo.com/123456789?share=copy#t=10',
    'https://www.vimeo.com/channels/staffpicks/123456789',
  ],
  rumble: [
    'https://RUMBLE.com/v4abcde-postgear-sample-talk.html?mref=abc',
    'rumble.com/v4abcde-x.html',
  ],
  dailymotion: [
    'https://dai.ly/x8abcde',
    'https://geo.dailymotion.com/player.html?video=x8abcde',
    'https://www.DailyMotion.com./video/x8abcde',
  ],
  loom: [
    'https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=1',
    'loom.com/share/0123456789abcdef0123456789abcdef',
  ],
  x: [
    'https://twitter.com/postgear/status/1854123456789012345/video/1',
    'https://mobile.twitter.com/i/web/status/1854123456789012345',
    'https://X.com/postgear/status/1854123456789012345?s=20',
  ],
  facebook: [
    'https://m.facebook.com/postgear/videos/a-title/1234567890123456',
    'https://www.facebook.com/watch/?v=1234567890123456',
    'https://web.facebook.com/reel/1234567890123456',
  ],
  linkedin: [
    'https://www.linkedin.com/posts/simsamples_postgear-sample-video-activity-7254123456789012345-AbCd?utm_source=share',
  ],
  reddit: ['https://old.reddit.com/r/videos/comments/1abcdef', 'https://redd.it/1abcdef'],
  pinterest: ['https://in.pinterest.com/pin/123456789012345678/'],
  threads: ['https://www.threads.net/@postgear/post/DAbC123xyz_'],
  zoom: ['https://us02web.zoom.us/rec/share/AbC-123_def.ghiJKL456?startTime=1'],
  tiktok: ['https://m.tiktok.com/@postgear/video/7254123456789012345?lang=en'],
  instagram: [
    'https://www.instagram.com/p/CzAbC123xyz/',
    'https://instagram.com/reel/CzAbC123xyz/?igsh=1',
  ],
  dropbox: ['https://www.dropbox.com/s/abc123def456ghi/talk.mp4?dl=1'],
};

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return (error.getResponse() as { code?: string }).code ?? null;
  }
}

describe('a site that is off', () => {
  it('has crafted links here for every Module 12 site', () => {
    const off = SITES.filter((site) => !(SPRINT_12 as readonly string[]).includes(site.id)).map(
      (site) => site.id,
    );
    expect(Object.keys(CRAFTED).sort()).toEqual([...off].sort());
  });

  it.each(
    Object.entries(CRAFTED).flatMap(([site, links]) => links.map((link) => [site, link] as const)),
  )('%s: %s is paused and never reaches the worker', async (_site, pasted) => {
    const { service, asked } = linkService();
    const code = await codeOf(service.probe(TEST_ORG, pasted));
    // Paused, or not read as a video at all: never fetched either way.
    expect(code === 'platform_paused' || code?.startsWith('link_')).toBe(true);
    expect(asked).toEqual([]);
  });

  it('is read once its switch is on, so the refusals above are the switch', async () => {
    const { service, asked } = linkService([...SPRINT_12, 'vimeo']);
    await service.probe(TEST_ORG, 'https://player.vimeo.com/video/123456789?h=abcdef1234');
    expect(asked.map((link) => link.platform)).toEqual(['vimeo']);
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&u=https://vimeo.com/123456789',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ#https://www.tiktok.com/@a/video/7254123456789012345',
    'https://youtu.be/dQw4w9WgXcQ?next=https%3A%2F%2Fx.com%2Fi%2Fstatus%2F1854123456789012345',
    'https://www.twitch.tv/videos/900000001?redirect=https://dai.ly/x8abcde',
  ])('a site that is on carries no off site through its parameters: %s', async (pasted) => {
    const { service, asked } = linkService();
    await service.probe(TEST_ORG, pasted);
    expect(asked).toHaveLength(1);
    const [sent] = asked;
    expect(['youtube', 'twitch']).toContain(sent?.platform);
    const host = new URL(sent?.canonicalUrl ?? '').hostname;
    expect(['www.youtube.com', 'www.twitch.tv']).toContain(host);
    expect(sent?.canonicalUrl).not.toMatch(/vimeo|tiktok|x\.com|dai\.ly|%2F/);
  });
});

describe('a retry of an import from a site switched off since', () => {
  function videosService(prober: ClipLinksService) {
    const video = videoRow({ status: 'FAILED', error: { code: 'import_failed', message: 'x' } });
    const previous = jobRow({
      status: 'FAILED',
      videoId: video.id,
      input: {
        videoId: video.id,
        origin: {
          type: 'link',
          link: {
            platform: 'vimeo',
            kind: 'video',
            externalId: '123456789',
            canonicalUrl: 'https://vimeo.com/123456789',
          },
        },
        limits: { maxVideoMs: 1, storageBytes: 1, retentionDays: 1 },
        expectedBytes: null,
      },
    });
    const charges: string[] = [];
    const jobs = { newJobId: jest.fn(() => 'job-new'), build: jest.fn(), start: jest.fn() };
    const jobsRepository = { create: jest.fn() };
    const limits = {
      assertEnabled: jest.fn(),
      assertLength: jest.fn(),
      assertStorage: jest.fn(),
      importLimits: jest.fn(),
      chargeImport: jest.fn(async (_org: string, id: string) => charges.push(id)),
    };
    const service = new ClipVideosService(
      {
        findLive: jest.fn(async (org: string, id: string) =>
          org === TEST_ORG && id === video.id ? video : null,
        ),
        latestImport: jest.fn(async () => previous as ClipJob),
      } as unknown as ClipVideosRepository,
      jobs as unknown as ClipJobsService,
      jobsRepository as unknown as ClipJobsRepository,
      limits as unknown as ClipLimitsGuard,
      { reverseAllFor: jest.fn() } as unknown as UsageService,
      {} as unknown as ClipPlaybackService,
      prober,
      {} as never,
      {} as unknown as ClipSampleLink,
      {} as unknown as ClipRetentionService,
    );
    return { service, video: video as ClipVideo, jobs, jobsRepository, charges };
  }

  it('is refused as paused before any job, charge or worker call', async () => {
    const links = linkService();
    const { service, video, jobs, jobsRepository, charges } = videosService(links.service);
    expect(await codeOf(service.retry(TEST_ORG, TEST_USER, video.id))).toBe('platform_paused');
    expect(links.asked).toEqual([]);
    expect(jobs.build).not.toHaveBeenCalled();
    expect(jobsRepository.create).not.toHaveBeenCalled();
    expect(jobs.start).not.toHaveBeenCalled();
    expect(charges).toEqual([]);
  });
});
