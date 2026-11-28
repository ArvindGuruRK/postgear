/**
 * Security sweep, Sprint 13 Module 16: the Emote Maker's answers.
 *
 * What must hold, beyond `clip-emotes.service.spec.ts` (which proves the
 * 404 for another workspace's video and job with nothing charged, the 422
 * bounds with nothing charged, one download per press under the job's own
 * key, the reversal when the row is never written, and no link once the
 * stretch expired):
 * - a signed link covers only that job's own exports folder and lives five
 *   minutes at most, however the stored output reads: a tampered file name
 *   (a path, another job's folder, a query) gets no link at all;
 * - a hand-made body cannot ask for a watermark, AI work or another
 *   workspace's files: the schema is strict.
 */
import type { ClipJob } from '@postgear/db';
import type { PrivateStorage } from '@postgear/storage';
import type { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { jobRow, TEST_ORG, videoRow } from '../testing/rows';
import type { UsageService } from '../../entitlements/usage.service';
import type { ClipVideosRepository } from '../videos/clip-videos.repository';
import { emoteExportSchema } from './clip-emotes.schema';
import { ClipEmotesService } from './clip-emotes.service';
import { EMOTE_LINK_SECONDS } from './emotes.messages';

const JOB = '44444444-4444-4444-8444-444444444444';
const OTHER_JOB = '55555555-5555-4555-8555-555555555555';

function file(name: string) {
  return {
    name,
    size: 112,
    format: 'gif',
    bytes: 70_000,
    maxBytes: 512_000,
    fits: true,
    rung: 1,
    frames: 60,
    fps: 20,
    extra: false,
  };
}

function output(files: unknown[], zipName = 'emote-twitch.zip') {
  return { platform: 'twitch', files, zip: { name: zipName, bytes: 80_000 }, sharp: false };
}

function build(job: ClipJob) {
  const signedUrl = jest.fn(async (key: string) => `https://files.test/${key}`);
  const service = new ClipEmotesService(
    {
      findLive: jest.fn(async (org: string) => (org === TEST_ORG ? videoRow() : null)),
    } as unknown as ClipVideosRepository,
    {} as unknown as ClipJobsService,
    {
      find: jest.fn(async (org: string, id: string) =>
        org === job.organizationId && id === job.id ? job : null,
      ),
    } as unknown as ClipJobsRepository,
    {} as unknown as ClipLimitsGuard,
    {} as unknown as UsageService,
    { signedUrl } as unknown as PrivateStorage,
  );
  service.timing = { ...service.timing, now: () => Date.parse('2026-11-28T10:00:00Z') };
  return { service, signedUrl };
}

const doneJob = (out: unknown) =>
  jobRow({
    id: JOB,
    kind: 'EMOTE',
    status: 'DONE',
    output: out as ClipJob['output'],
    expiresAt: new Date('2026-11-29T10:00:00Z'),
  });

describe("an emote's links", () => {
  it("cover only this job's own exports folder, and live five minutes at most", async () => {
    const { service, signedUrl } = build(
      doneJob(output([file('emote-twitch-112.gif'), file('emote-twitch-56.gif')])),
    );
    const view = await service.get(TEST_ORG, JOB);
    expect(view.emote?.files.map((entry) => entry.url)).toHaveLength(2);
    expect(signedUrl).toHaveBeenCalledTimes(3);
    for (const [key, options] of signedUrl.mock.calls as unknown as Array<
      [string, { expiresInSeconds: number; downloadName: string }]
    >) {
      expect(key.startsWith(`clips/${TEST_ORG}/exports/${JOB}/`)).toBe(true);
      expect(key.slice(`clips/${TEST_ORG}/exports/${JOB}/`.length)).not.toContain('/');
      expect(options.expiresInSeconds).toBe(EMOTE_LINK_SECONDS);
      expect(options.downloadName).toBe(key.split('/').at(-1));
    }
    expect(EMOTE_LINK_SECONDS).toBeLessThanOrEqual(300);
  });

  it.each([
    ['a path out of the folder', '../../exports/other/emote-twitch-112.gif'],
    ['another job', `${OTHER_JOB}/emote-twitch-112.gif`],
    ['a query on the name', 'emote-twitch-112.gif?x-amz-expires=999999'],
    ['a name we never write', 'render.mp4'],
    ['a backslash path', '..\\emote-twitch-112.gif'],
  ])('give no link at all when the stored output names %s', async (_name, name) => {
    const { service, signedUrl } = build(doneJob(output([file(name)])));
    const view = await service.get(TEST_ORG, JOB);
    expect(view.emote).toBeNull();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('give no link when the stored zip name is tampered with', async () => {
    const { service, signedUrl } = build(
      doneJob(output([file('emote-twitch-112.gif')], `../${OTHER_JOB}/emote-twitch.zip`)),
    );
    expect((await service.get(TEST_ORG, JOB)).emote).toBeNull();
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('answers 404 for this job asked from another workspace, signing nothing', async () => {
    const { service, signedUrl } = build(doneJob(output([file('emote-twitch-112.gif')])));
    await expect(service.get('seed-second-org', JOB)).rejects.toMatchObject({ status: 404 });
    expect(signedUrl).not.toHaveBeenCalled();
  });
});

describe('a hand-made export body', () => {
  const good = {
    videoId: '22222222-2222-4222-8222-222222222222',
    platform: 'twitch',
    startMs: 12_400,
    endMs: 15_400,
    crop: { x: 620, y: 210, size: 480 },
    key: null,
    flip: false,
    still: false,
  };

  it('is taken as the page sends it', () => {
    expect(emoteExportSchema.safeParse(good).success).toBe(true);
  });

  it.each([
    ['a watermark', { watermark: true }],
    ['the mark left off', { watermark: false }],
    ['AI work', { aiMinutes: 0 }],
    ['another workspace', { organizationId: 'seed-second-org' }],
    ['its own job id', { jobId: JOB }],
    ['a frame of its own', { frame: { width: 99_999, height: 99_999 } }],
    ['a key in storage', { sourceKey: 'clips/seed-second-org/x/proxy.mp4' }],
  ])('is refused when it adds %s', (_name, extra) => {
    expect(emoteExportSchema.safeParse({ ...good, ...extra }).success).toBe(false);
  });
});
