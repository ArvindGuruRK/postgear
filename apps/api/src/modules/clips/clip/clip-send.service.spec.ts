/**
 * Send To Composer (Module 17) against an in-memory database: the export it
 * needs (none, a deleted file, one out of date unless the old version is
 * asked for), the channels (another workspace's, one the clip does not
 * fit), the draft's shape, its `ClipPost` row, and tenancy.
 */
import { HttpException } from '@nestjs/common';
import { createClipDocument } from '@postgear/video-engine';
import type { ChannelsService } from '../../channels/channels.service';
import type { PostsService } from '../../posts/posts.service';
import {
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { TEST_ORG, videoRow } from '../testing/rows';
import { sendClipSchema } from './clip-item.schema';
import { ClipPostsService } from './clip-posts.service';
import { ClipSendService, nextFullHour } from './clip-send.service';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const VIDEO = videoRow().id;
const CLIP = '55555555-5555-4555-8555-555555555555';
const MEDIA_ID = '0d9c8b7a-6f5e-4d3c-8b2a-190817263544';
const MB = 1024 * 1024;

const CHANNELS = [
  { id: 'yt-1', name: 'Acme Shorts', providerIdentifier: 'youtube' },
  { id: 'ig-1', name: 'Acme Reels', providerIdentifier: 'instagram-standalone' },
  { id: 'li-1', name: 'Acme On LinkedIn', providerIdentifier: 'linkedin' },
  { id: 'tt-1', name: 'Acme TikTok', providerIdentifier: 'tiktok' },
];

function seed(media: { durationMs?: number; deleted?: boolean } = {}): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY' }));
  tables.clips.push(
    clipRow({
      id: CLIP,
      videoId: VIDEO,
      document: createClipDocument({ videoId: VIDEO, fromMs: 0, toMs: 40_000, ratio: '9:16' }),
      revision: 3,
      lastExportedRevision: 3,
      exportedMediaId: MEDIA_ID,
    }),
  );
  tables.media = [
    {
      id: MEDIA_ID,
      organizationId: TEST_ORG,
      name: 'A clip.mp4',
      path: 'media/a-clip.mp4',
      thumbnail: null,
      fileSize: 20 * MB,
      width: 1080,
      height: 1920,
      durationMs: media.durationMs ?? 40_000,
      deletedAt: media.deleted ? new Date('2026-11-18T10:00:00.000Z') : null,
    },
  ];
  return tables;
}

function setup(tables = seed()) {
  mockDb = fakeClipDb(tables);
  const create = jest.fn(async () => ({ group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  const list = jest.fn(async (orgId: string) => (orgId === TEST_ORG ? CHANNELS : []));
  const service = new ClipSendService(
    { create } as unknown as PostsService,
    { list } as unknown as ChannelsService,
    new ClipPostsService(),
  );
  const send = (body: Record<string, unknown>, clipId = CLIP, orgId = TEST_ORG) =>
    service.send(orgId, clipId, sendClipSchema.parse(body));
  return { service, create, list, send, tables };
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; code?: string; message?: string }> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    const body = error.getResponse() as { code?: string; message?: string };
    return { status: error.getStatus(), code: body.code, message: body.message };
  }
  throw new Error('expected a refusal');
}

describe('ClipSendService.send', () => {
  it('makes a draft with the clip on every chosen channel, parked at the next full hour, and links the clip', async () => {
    const { send, create, tables } = setup();
    const before = Date.now();
    const answer = await send({
      channelIds: ['yt-1', 'ig-1'],
      caption: '  Big moment \r\n tonight ',
    });

    expect(answer).toEqual({ group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(create).toHaveBeenCalledTimes(1);
    const [orgId, input] = create.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(orgId).toBe(TEST_ORG);
    expect(input).toMatchObject({
      state: 'DRAFT',
      channels: [
        { channelId: 'yt-1', customized: false },
        { channelId: 'ig-1', customized: false },
      ],
    });
    const shared = input.shared as { content: unknown; media: { id: string }[] }[];
    expect(shared).toHaveLength(1);
    expect(shared[0]?.media).toEqual([{ id: MEDIA_ID }]);
    expect(JSON.stringify(shared[0]?.content)).toContain('Big moment');
    const publishDate = new Date(input.publishDate as string);
    expect(publishDate.getUTCMinutes()).toBe(0);
    expect(publishDate.getTime()).toBeGreaterThan(before);
    expect(publishDate.getTime() - before).toBeLessThanOrEqual(60 * 60_000);

    expect(tables.clipPosts).toEqual([
      expect.objectContaining({
        organizationId: TEST_ORG,
        clipId: CLIP,
        postGroup: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        mediaId: MEDIA_ID,
      }),
    ]);
  });

  it('refuses a clip with no export, or whose exported file was deleted', async () => {
    const none = seed();
    if (none.clips[0]) {
      none.clips[0].exportedMediaId = null;
      none.clips[0].lastExportedRevision = null;
    }
    const first = setup(none);
    expect(await refusal(first.send({ channelIds: ['yt-1'] }))).toMatchObject({
      status: 409,
      code: 'clip_not_exported',
      message: 'Export this clip first, then send it.',
    });
    expect(first.create).not.toHaveBeenCalled();

    const deleted = setup(seed({ deleted: true }));
    expect(await refusal(deleted.send({ channelIds: ['yt-1'] }))).toMatchObject({
      status: 409,
      code: 'clip_not_exported',
    });
  });

  it('refuses a clip changed since its export, unless the old version is asked for', async () => {
    const tables = seed();
    if (tables.clips[0]) tables.clips[0].revision = 5;
    const { send, create } = setup(tables);
    expect(await refusal(send({ channelIds: ['yt-1'] }))).toMatchObject({
      status: 409,
      code: 'clip_export_outdated',
    });
    expect(create).not.toHaveBeenCalled();

    await expect(send({ channelIds: ['yt-1'], oldVersion: true })).resolves.toEqual({
      group: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('refuses a channel that is not this workspace own, and writes nothing', async () => {
    const { send, create, tables } = setup();
    expect(await refusal(send({ channelIds: ['yt-1', 'someone-elses'] }))).toMatchObject({
      status: 400,
      code: 'channel_unavailable',
    });
    expect(create).not.toHaveBeenCalled();
    expect(tables.clipPosts).toEqual([]);
  });

  it('refuses a channel the clip does not fit, naming it, in the dialog sentence', async () => {
    const { send, create } = setup();
    expect(await refusal(send({ channelIds: ['yt-1', 'li-1'] }))).toMatchObject({
      status: 422,
      code: 'clip_does_not_fit',
      message:
        'This channel cannot take this clip. Acme On LinkedIn: LinkedIn does not take video here.',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('holds a long clip to each platform limit, by calling the API directly too', async () => {
    const { send } = setup(seed({ durationMs: 11 * 60_000 }));
    const answer = await refusal(send({ channelIds: ['tt-1', 'ig-1', 'yt-1'] }));
    expect(answer).toMatchObject({ status: 422, code: 'clip_does_not_fit' });
    expect(answer.message).toBe(
      'This channel cannot take this clip. Acme TikTok: This clip is 11 min. TikTok takes up to 10 minutes.',
    );
  });

  it('answers not found for another workspace clip, or a word for an id', async () => {
    const { send } = setup();
    expect(await refusal(send({ channelIds: ['yt-1'] }, CLIP, 'seed-second-org'))).toMatchObject({
      status: 404,
      code: 'clip_not_found',
    });
    expect(await refusal(send({ channelIds: ['yt-1'] }, 'coming-up'))).toMatchObject({
      status: 404,
    });
  });
});

describe('nextFullHour', () => {
  it('is the top of the next hour', () => {
    expect(nextFullHour(new Date('2026-11-19T10:20:30.000Z')).toISOString()).toBe(
      '2026-11-19T11:00:00.000Z',
    );
    expect(nextFullHour(new Date('2026-11-19T23:00:00.000Z')).toISOString()).toBe(
      '2026-11-20T00:00:00.000Z',
    );
  });
});
