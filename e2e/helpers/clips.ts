import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { type APIRequestContext, expect, type Page } from '@playwright/test';
import { prisma } from '@postgear/db';

/**
 * Shared pieces of the Clips suites (Sprint 12, Module 20): sign-in that is
 * done once per user, the simulation links, small API readers, and the run
 * register every test writes into so `afterAll` can take back what the run
 * made (videos, clips, downloads, channels, favourites, sound uploads,
 * drafts, Media files and the ledger rows they charged).
 *
 * Simulation only: every link here is one of the local testing guide's
 * section 5p links, answered from `packages/media-tools/fixtures`.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
export const DEMO_ORG = 'seed-demo-org';
export const SECOND_ORG = 'seed-second-org';
export const DEMO_EMAIL = 'demo@postgear.local';
export const MEMBER_EMAIL = 'member@postgear.local';
export const SEED_PASSWORD = 'DemoPassword123!';

/** The login throttle's window (10 a minute per address) plus a second. */
const THROTTLE_WINDOW_MS = 61_000;

/** The guide's simulation links (section 5p). */
export const LINKS = {
  /** A finished Kick stream (ten minutes); the demo workspace does not have it. */
  kickSample: 'https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001',
  twitchPrivate: 'https://www.twitch.tv/videos/900000002',
  twitchLive: 'https://www.twitch.tv/videos/900000003',
  /** Not a platform Clips reads: refused before any probe. */
  unsupported: 'https://vimeo.com/76979871',
} as const;

export const SENTENCES = {
  private: 'This video is private or needs a login, so we cannot read it.',
  live: 'This stream is still live. Come back when it has ended.',
  unsupported:
    'We can only read YouTube, Twitch and Kick links for now. You can upload the file instead.',
  rights: 'This video is mine, or I have permission to use it.',
  alreadyHere: 'You already have this video.',
  biggerScreen: 'Clips is made for a bigger screen. Open it on a laptop or desktop.',
  outOfDate: 'You changed this clip after the last export.',
  oneChannel: 'Your plan allows 1 channel. Remove one to add another.',
  qualityLocked: '1080p export needs a higher plan.',
} as const;

/** The three minute talk the simulation serves (180 s, 1280 by 720, 30 fps). */
export const SAMPLE_TALK = path.resolve('packages', 'media-tools', 'samples', 'talk.mp4');

/**
 * Signs `page` in as `email` and makes `org` the active workspace. One sign-in
 * per user per file: the API runs with the normal login throttle, so a 429
 * waits the window out once and tries again.
 */
export async function signInAs(
  page: Page,
  email: string,
  org: string | null,
  password = SEED_PASSWORD,
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.locator('#password').fill(password);
    const answered = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/auth/login',
    );
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    const response = await answered;
    if (response.status() === 429 && attempt === 1) {
      await page.waitForTimeout(THROTTLE_WINDOW_MS);
      continue;
    }
    expect(response.ok(), `sign-in answered HTTP ${response.status()}`).toBe(true);
    break;
  }
  await expect(page).toHaveURL(/\/[^/]+\/(home|calendar|channels)/, { timeout: 30_000 });
  if (org) await switchOrg(page.request, org);
}

/** Makes `org` the active workspace of the context `request` belongs to. */
export async function switchOrg(request: APIRequestContext, org: string): Promise<void> {
  const switched = await request.post(`${API_URL}/orgs/${encodeURIComponent(org)}/switch`);
  expect(switched.ok(), `workspace switch to ${org} answered HTTP ${switched.status()}`).toBe(true);
}

/** GET a JSON body from the API, failing loudly on anything but 200. */
export async function getJson<T>(request: APIRequestContext, route: string): Promise<T> {
  const response = await request.get(`${API_URL}${route}`);
  expect(response.status(), `GET ${route}`).toBe(200);
  return (await response.json()) as T;
}

export interface MeterView {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface EntitlementsView {
  tier: string;
  values: Record<string, unknown>;
  meters: Record<string, MeterView>;
}

export function entitlements(request: APIRequestContext): Promise<EntitlementsView> {
  return getJson<EntitlementsView>(request, '/entitlements/me');
}

export interface JobView {
  id: string;
  kind: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  stageLabel: string;
  videoId: string | null;
  clipId: string | null;
}

/** Waits until a Clips job is over and returns it. */
export async function waitForJob(
  request: APIRequestContext,
  jobId: string,
  timeout = 120_000,
): Promise<JobView> {
  let last: JobView | null = null;
  await expect
    .poll(
      async () => {
        const body = await getJson<{ job: JobView } | JobView>(request, `/clips/jobs/${jobId}`);
        last = 'job' in body ? body.job : body;
        return last.status;
      },
      { timeout, intervals: [1_000, 2_000] },
    )
    .toMatch(/^(DONE|FAILED|CANCELLED)$/);
  return last as unknown as JobView;
}

export interface VideoView {
  id: string;
  title: string;
  status: string;
  durationMs: number | null;
}

export async function getVideo(request: APIRequestContext, id: string): Promise<VideoView> {
  const body = await getJson<{ video: VideoView } | VideoView>(request, `/clips/videos/${id}`);
  return 'video' in body ? body.video : body;
}

/** Waits until a video is READY (imports in simulation take a few seconds). */
export async function waitForVideoReady(
  request: APIRequestContext,
  id: string,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(async () => (await getVideo(request, id)).status, { timeout, intervals: [1_000] })
    .toBe('READY');
}

/** A short clip made through the API (setup for tests that need one, not the thing tested). */
export async function createClipApi(
  request: APIRequestContext,
  videoId: string,
  fromMs: number,
  toMs: number,
): Promise<{ clipId: string; jobId: string | null }> {
  const response = await request.post(`${API_URL}/clips`, { data: { videoId, fromMs, toMs } });
  expect(response.status(), `POST /clips: ${await response.text()}`).toBe(201);
  const body = (await response.json()) as { clip: { id: string }; job: { id: string } | null };
  return { clipId: body.clip.id, jobId: body.job?.id ?? null };
}

/** "38 of 300 AI minutes left" as numbers. */
export function parseAiChip(text: string): { left: number; limit: number } {
  const match = /([\d,]+) of ([\d,]+) AI minutes? left/.exec(text);
  if (!match) throw new Error(`Not an AI minutes chip: "${text}"`);
  return {
    left: Number((match[1] ?? '').replace(/,/g, '')),
    limit: Number((match[2] ?? '').replace(/,/g, '')),
  };
}

const SIZE_UNITS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

/** "1.2 GB of 15 GB" as bytes used. */
export function parseUsedBytes(text: string): number {
  const match = /([\d.,]+)\s*(B|KB|MB|GB|TB)\s+of/i.exec(text);
  if (!match) throw new Error(`Not a storage meter: "${text}"`);
  const unit = SIZE_UNITS[(match[2] ?? 'B').toUpperCase()] ?? 1;
  return Number((match[1] ?? '0').replace(/,/g, '')) * unit;
}

/** A short mono WAV of a soft tone, generated in memory (no file in the repo). */
export function toneWav(seconds = 1.5, hz = 440, rate = 22_050): Buffer {
  const samples = Math.floor(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 0.3 * 32_767);
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * One frame of a video at `atSeconds`, scaled down to a small grey picture
 * (FFmpeg, the same program the worker renders with), so two renders of the
 * same clip at different sizes can be compared cell by cell.
 */
export function greyFrame(source: string, atSeconds: number, width = 36, height = 64): Buffer {
  const run = spawnSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-ss',
      atSeconds.toFixed(2),
      '-i',
      source,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:${height}:flags=area,format=gray`,
      '-f',
      'rawvideo',
      '-',
    ],
    { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 },
  );
  if (run.status !== 0 || run.stdout.length !== width * height) {
    throw new Error(`ffmpeg could not read a frame of ${source}: ${run.stderr?.toString()}`);
  }
  return run.stdout;
}

/** The mean and the worst 4 by 4 block difference of two grey frames (0 to 255). */
export function frameDifference(
  a: Buffer,
  b: Buffer,
  width = 36,
  height = 64,
): { mean: number; worstBlock: number } {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  let worstBlock = 0;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      let block = 0;
      for (let y = by; y < by + 4; y += 1) {
        for (let x = bx; x < bx + 4; x += 1) {
          const at = y * width + x;
          block += (a[at] ?? 0) - (b[at] ?? 0);
        }
      }
      worstBlock = Math.max(worstBlock, Math.abs(block / 16));
    }
  }
  return { mean: total / a.length, worstBlock };
}

export function stamp(): string {
  return `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
}

/* -------------------------------------------------------------------------- */
/* The run register and cleanup                                               */
/* -------------------------------------------------------------------------- */

type Owned<T> = T & { org: string };

export interface ClipsRun {
  videos: Owned<{ id: string }>[];
  clips: Owned<{ id: string }>[];
  downloads: Owned<{ jobId: string }>[];
  channels: Owned<{ id: string }>[];
  groups: Owned<{ group: string }>[];
  media: Owned<{ id: string }>[];
  favourites: Owned<{ type: 'sticker' | 'sound'; id: string }>[];
  soundUploads: Owned<{ id: string }>[];
  /** Workspaces the run made in Postgres, removed whole at the end. */
  workspaces: string[];
  /** Users the run made in Postgres. */
  users: string[];
}

export function newClipsRun(): ClipsRun {
  return {
    videos: [],
    clips: [],
    downloads: [],
    channels: [],
    groups: [],
    media: [],
    favourites: [],
    soundUploads: [],
    workspaces: [],
    users: [],
  };
}

function note(problems: string[], step: string, status: number): void {
  if (status >= 400 && status !== 404) problems.push(`${step} answered HTTP ${status}`);
}

/**
 * Takes back what the run made, through the API (so files go too), in the
 * order the API allows: drafts, clips, Media files, downloads, channels,
 * favourites, sound uploads, then videos. `requests` holds one signed-in
 * request context per workspace (each with that workspace's org cookie).
 * Returns the steps that answered an error.
 */
export async function cleanUpClipsRun(
  requests: Record<string, APIRequestContext>,
  run: ClipsRun,
): Promise<string[]> {
  const problems: string[] = [];
  const req = (org: string): APIRequestContext | null => requests[org] ?? null;

  // AI clips (Find Clips) belong to the run's videos too.
  const videoIds = run.videos.map((one) => one.id);
  if (videoIds.length > 0) {
    const more = await prisma.clip.findMany({
      where: { videoId: { in: videoIds } },
      select: { id: true, organizationId: true },
    });
    for (const clip of more) {
      if (!run.clips.some((one) => one.id === clip.id)) {
        run.clips.push({ id: clip.id, org: clip.organizationId });
      }
    }
    // Exports of those clips are Media files the run made.
    const exports = await prisma.clip.findMany({
      where: { videoId: { in: videoIds }, exportedMediaId: { not: null } },
      select: { exportedMediaId: true, organizationId: true },
    });
    for (const one of exports) {
      if (one.exportedMediaId && !run.media.some((m) => m.id === one.exportedMediaId)) {
        run.media.push({ id: one.exportedMediaId, org: one.organizationId });
      }
    }
  }

  for (const { org, group } of run.groups) {
    const r = req(org);
    if (r)
      note(
        problems,
        `DELETE /posts/${group}`,
        (await r.delete(`${API_URL}/posts/${group}`)).status(),
      );
  }
  for (const { org, id } of run.clips) {
    const r = req(org);
    if (r)
      note(problems, `DELETE /clips/${id}`, (await r.delete(`${API_URL}/clips/${id}`)).status());
  }
  for (const { org, id } of run.media) {
    const r = req(org);
    if (r)
      note(problems, `DELETE /media/${id}`, (await r.delete(`${API_URL}/media/${id}`)).status());
  }
  for (const { org, jobId } of run.downloads) {
    const r = req(org);
    if (r) {
      const status = (await r.delete(`${API_URL}/clips/downloads/${jobId}`)).status();
      note(problems, `DELETE /clips/downloads/${jobId}`, status);
    }
  }
  for (const { org, id } of run.channels) {
    const r = req(org);
    if (r) {
      note(
        problems,
        `DELETE /clips/channels/${id}`,
        (await r.delete(`${API_URL}/clips/channels/${id}`)).status(),
      );
    }
  }
  for (const { org, type, id } of run.favourites) {
    const r = req(org);
    if (r) {
      const status = (await r.delete(`${API_URL}/clips/library/favourites/${type}/${id}`)).status();
      note(problems, `DELETE favourite ${type} ${id}`, status);
    }
  }
  for (const { org, id } of run.soundUploads) {
    const r = req(org);
    if (r) {
      const status = (await r.delete(`${API_URL}/clips/sounds/uploads/${id}`)).status();
      note(problems, `DELETE /clips/sounds/uploads/${id}`, status);
    }
  }
  for (const { org, id } of run.videos) {
    const r = req(org);
    if (r) {
      note(
        problems,
        `DELETE /clips/videos/${id}`,
        (await r.delete(`${API_URL}/clips/videos/${id}`)).status(),
      );
    }
  }

  await removeRunCharges(run);
  return problems;
}

/**
 * The run's own ledger rows (import minutes, downloads, AI minutes and their
 * reversals), keyed by the jobs and runs it started, so the seeded workspaces'
 * meters read as they did before. Deleting a video never refunds its minutes
 * by design; this is test cleanup, not a refund.
 */
async function removeRunCharges(run: ClipsRun): Promise<void> {
  const videoIds = run.videos.map((one) => one.id);
  const clipIds = run.clips.map((one) => one.id);
  const downloadIds = run.downloads.map((one) => one.jobId);
  const jobs = await prisma.clipJob.findMany({
    where: {
      OR: [{ videoId: { in: videoIds } }, { clipId: { in: clipIds } }, { id: { in: downloadIds } }],
    },
    select: { id: true },
  });
  const runs = videoIds.length
    ? await prisma.clipHighlightRun.findMany({
        where: { videoId: { in: videoIds } },
        select: { id: true },
      })
    : [];
  const ids = [...new Set([...jobs.map((j) => j.id), ...runs.map((r) => r.id), ...downloadIds])];
  if (ids.length === 0) return;
  const orgs = [...new Set([...run.videos, ...run.downloads].map((one) => one.org))];
  await prisma.usageEntry.deleteMany({
    where: {
      organizationId: { in: orgs },
      OR: [{ refId: { in: ids } }, ...ids.map((id) => ({ idempotencyKey: { contains: id } }))],
    },
  });
}

/** What of the run is still there, for the cleanup proof (all zero when clean). */
export async function runLeftovers(run: ClipsRun): Promise<Record<string, number>> {
  const videoIds = run.videos.map((one) => one.id);
  const clipIds = run.clips.map((one) => one.id);
  const downloadIds = run.downloads.map((one) => one.jobId);
  const channelIds = run.channels.map((one) => one.id);
  const groups = run.groups.map((one) => one.group);
  const mediaIds = run.media.map((one) => one.id);
  const jobs = await prisma.clipJob.findMany({
    where: {
      OR: [{ videoId: { in: videoIds } }, { clipId: { in: clipIds } }, { id: { in: downloadIds } }],
    },
    select: { id: true },
  });
  const jobIds = jobs.map((j) => j.id);
  return {
    liveVideos: await prisma.clipVideo.count({ where: { id: { in: videoIds }, deletedAt: null } }),
    clips: await prisma.clip.count({
      where: { OR: [{ id: { in: clipIds } }, { videoId: { in: videoIds } }] },
    }),
    openJobs: await prisma.clipJob.count({
      where: { id: { in: jobIds }, status: { in: ['QUEUED', 'RUNNING'] } },
    }),
    keptDownloads: await prisma.clipAsset.count({
      where: { OR: downloadIds.map((id) => ({ key: { contains: id } })) },
    }),
    channels: await prisma.clipChannel.count({ where: { id: { in: channelIds } } }),
    liveDrafts: await prisma.post.count({ where: { group: { in: groups }, deletedAt: null } }),
    liveMedia: await prisma.media.count({ where: { id: { in: mediaIds }, deletedAt: null } }),
    favourites: await prisma.clipFavourite.count({
      where: {
        OR: run.favourites.map((one) =>
          one.type === 'sticker'
            ? { stickerId: one.id, organizationId: one.org }
            : { soundId: one.id, organizationId: one.org },
        ),
      },
    }),
    soundUploads: await prisma.clipAsset.count({
      where: { id: { in: run.soundUploads.map((one) => one.id) } },
    }),
    charges: await prisma.usageEntry.count({
      where: {
        OR: [
          { refId: { in: jobIds } },
          ...jobIds.map((id) => ({ idempotencyKey: { contains: id } })),
        ],
      },
    }),
    workspaces: await prisma.organization.count({ where: { id: { in: run.workspaces } } }),
    users: await prisma.user.count({ where: { id: { in: run.users } } }),
  };
}

/* -------------------------------------------------------------------------- */
/* Throwaway workspaces                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A Free workspace (no subscription row) with `userId` as its admin, made in
 * Postgres so no extra sign-in or onboarding is spent on it.
 */
export async function createFreeWorkspace(userId: string, name: string): Promise<string> {
  const org = await prisma.organization.create({ data: { name }, select: { id: true } });
  await prisma.userOrganization.create({
    data: { userId, organizationId: org.id, role: 'ADMIN' },
  });
  return org.id;
}

/**
 * Removes a workspace the run made and everything hanging off it. Clips rows
 * cascade from the organization; the rest is removed first in dependency
 * order (Media is RESTRICT, so its rows go before the organization).
 */
export async function deleteWorkspace(orgId: string): Promise<void> {
  const where = { organizationId: orgId };
  await prisma.post.deleteMany({ where }).catch(() => undefined);
  await prisma.media.deleteMany({ where });
  await prisma.notifications.deleteMany({ where });
  await prisma.subscription.deleteMany({ where });
  await prisma.credits.deleteMany({ where });
  await prisma.customer.deleteMany({ where: { orgId } });
  await prisma.userOrganization.deleteMany({ where });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

export async function demoUserId(): Promise<string> {
  const user = await prisma.user.findFirstOrThrow({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  return user.id;
}

export { prisma };
