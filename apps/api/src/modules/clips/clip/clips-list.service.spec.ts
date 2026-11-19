/**
 * `GET /clips` (Module 07 section 4) against an in-memory database that
 * evaluates the service's real filters: each state, each source, the
 * counts (which follow `source` and `videoId` but not `status`), Scheduled
 * read through fake posts, paging and order, the card's poster and preview
 * signed once per file, and tenancy.
 */
import { createClipDocument } from '@postgear/video-engine';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, videoRow } from '../testing/rows';
import type { ClipPlaybackService } from '../videos/clip-playback.service';
import { listClipsQuerySchema } from './clip-item.schema';
import { ClipPostsService } from './clip-posts.service';
import { ClipsListService } from './clips-list.service';

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

const OTHER_ORG = 'seed-second-org';
const VIDEO_A = 'a0000000-0000-4000-8000-000000000001';
const VIDEO_B = 'b0000000-0000-4000-8000-000000000002';
const VIDEO_X = 'c0000000-0000-4000-8000-000000000003';

const id = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (n: number) => new Date(Date.UTC(2026, 10, 1, 10, n));

function doc(videoId: string, fromMs: number, toMs: number) {
  return createClipDocument({ videoId, fromMs, toMs, ratio: '9:16' });
}

const FILM = {
  tileWidth: 160,
  tileHeight: 90,
  columns: 10,
  rows: 10,
  intervalMs: 2_000,
  count: 150,
  sheets: 2,
};

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(
    videoRow({ id: VIDEO_A, platform: 'TWITCH', status: 'READY', title: 'Stream A' }),
    videoRow({ id: VIDEO_B, platform: 'UPLOAD', status: 'READY', title: 'Upload B' }),
    videoRow({ id: VIDEO_X, organizationId: OTHER_ORG, status: 'READY', title: 'Theirs' }),
  );
  const clip = (n: number, videoId: string, extra: Parameters<typeof clipRow>[0] = {}) =>
    clipRow({
      id: id(n),
      videoId,
      createdAt: at(n),
      document: doc(videoId, 210_000, 240_000),
      ...extra,
    });
  tables.clips.push(
    clip(1, VIDEO_A, { status: 'NEW' }),
    clip(2, VIDEO_A),
    clip(3, VIDEO_A, { revision: 2, lastExportedRevision: 2 }),
    clip(4, VIDEO_B, { revision: 2, lastExportedRevision: 2 }),
    clip(5, VIDEO_B, { status: 'HIDDEN' }),
    clip(6, VIDEO_B),
    clip(7, VIDEO_A, { revision: 3, lastExportedRevision: 2 }),
    clip(9, VIDEO_X, { organizationId: OTHER_ORG }),
  );
  const clipPost = (n: number, clipId: string, postGroup: string, org = TEST_ORG) => ({
    id: `d1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    organizationId: org,
    clipId,
    postGroup,
    mediaId: 'media',
    createdAt: at(n),
  });
  tables.clipPosts.push(
    clipPost(1, id(4), 'group-waiting'),
    clipPost(2, id(6), 'group-published'),
    clipPost(3, id(7), 'group-deleted'),
    clipPost(4, id(9), 'group-theirs', OTHER_ORG),
  );
  const post = (group: string, state: 'QUEUE' | 'PUBLISHED', deleted = false, org = TEST_ORG) => ({
    id: `post-${group}-${state}`,
    organizationId: org,
    group,
    state,
    deletedAt: deleted ? at(0) : null,
  });
  tables.posts.push(
    post('group-waiting', 'PUBLISHED'),
    post('group-waiting', 'QUEUE'),
    post('group-published', 'PUBLISHED'),
    post('group-deleted', 'QUEUE', true),
    post('group-theirs', 'QUEUE', false, OTHER_ORG),
  );
  tables.assets.push(
    assetRow({ id: 'asset-a-proxy', videoId: VIDEO_A, kind: 'PROXY', key: 'key/a/proxy' }),
    assetRow({
      id: 'asset-a-film0',
      videoId: VIDEO_A,
      kind: 'FILMSTRIP',
      key: 'key/a/film0',
      meta: { ...FILM, sheet: 0 },
    }),
    assetRow({
      id: 'asset-a-film1',
      videoId: VIDEO_A,
      kind: 'FILMSTRIP',
      key: 'key/a/film1',
      meta: { ...FILM, sheet: 1 },
    }),
    assetRow({ id: 'asset-b-proxy', videoId: VIDEO_B, kind: 'PROXY', key: 'key/b/proxy' }),
    assetRow({
      id: 'asset-b-poster',
      videoId: VIDEO_B,
      kind: 'POSTER',
      key: 'key/b/poster',
      meta: { atMs: 0, width: 1280, height: 720 },
    }),
  );
  return tables;
}

function setup(tables = seed()) {
  mockDb = fakeClipDb(tables);
  const playback = {
    address: jest.fn(async (key: string) => ({
      url: `https://signed/${key}`,
      expiresAt: '2026-11-18T18:00:00.000Z',
    })),
  };
  const service = new ClipsListService(
    playback as unknown as ClipPlaybackService,
    new ClipPostsService(),
  );
  const list = (query: Record<string, unknown> = {}) =>
    service.list(TEST_ORG, listClipsQuerySchema.parse(query));
  return { service, playback, list, tables };
}

const ids = (page: { clips: Array<{ id: string }> }) => page.clips.map((clip) => clip.id).sort();

describe('ClipsListService.list', () => {
  it('counts every state, leaving hidden out of All and other workspaces out of all', async () => {
    const { list } = setup();
    const page = await list();
    expect(page.counts).toEqual({ all: 6, new: 1, draft: 3, exported: 1, scheduled: 1, hidden: 1 });
    expect(page.total).toBe(6);
    expect(page.pageSize).toBe(24);
    expect(page.page).toBe(1);
    expect(ids(page)).toEqual([id(1), id(2), id(3), id(4), id(6), id(7)]);
  });

  it.each([
    ['new', [1]],
    ['draft', [2, 6, 7]],
    ['exported', [3]],
    ['scheduled', [4]],
    ['hidden', [5]],
  ] as const)('filters %s, and each card reads that state', async (status, expected) => {
    const { list } = setup();
    const page = await list({ status });
    expect(ids(page)).toEqual(expected.map(id));
    expect(page.clips.every((clip) => clip.state === status)).toBe(true);
    expect(page.total).toBe(expected.length);
    // Counts never follow the status filter.
    expect(page.counts.all).toBe(6);
  });

  it('reads Scheduled only through a post group with a live post still waiting', async () => {
    const { list } = setup();
    const page = await list({ status: 'all' });
    const state = (n: number) => page.clips.find((clip) => clip.id === id(n))?.state;
    expect(state(4)).toBe('scheduled'); // one post published, one still queued
    expect(state(6)).toBe('draft'); // every post went out
    expect(state(7)).toBe('draft'); // the waiting post was deleted
  });

  it.each([
    [['upload'], { all: 2, new: 0, draft: 1, exported: 0, scheduled: 1, hidden: 1 }],
    [['twitch'], { all: 4, new: 1, draft: 2, exported: 1, scheduled: 0, hidden: 0 }],
    [['youtube'], { all: 0, new: 0, draft: 0, exported: 0, scheduled: 0, hidden: 0 }],
    [['kick'], { all: 0, new: 0, draft: 0, exported: 0, scheduled: 0, hidden: 0 }],
    [['twitch', 'upload'], { all: 6, new: 1, draft: 3, exported: 1, scheduled: 1, hidden: 1 }],
  ])('filters by source %j, and the counts follow it', async (source, counts) => {
    const { list } = setup();
    const page = await list({ source });
    expect(page.counts).toEqual(counts);
    expect(page.clips).toHaveLength(counts.all);
    expect(page.clips.every((clip) => source.includes(clip.platform))).toBe(true);
  });

  it('reads a repeated or comma separated source, and refuses an unknown one', () => {
    expect(listClipsQuerySchema.parse({ source: 'twitch,upload' }).source).toEqual([
      'twitch',
      'upload',
    ]);
    expect(listClipsQuerySchema.parse({ source: ['kick', 'kick'] }).source).toEqual(['kick']);
    expect(listClipsQuerySchema.safeParse({ source: 'vimeo' }).success).toBe(false);
    expect(listClipsQuerySchema.safeParse({ status: 'drafts' }).success).toBe(false);
    expect(listClipsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(listClipsQuerySchema.safeParse({ everything: 'true' }).success).toBe(false);
  });

  it('narrows to one video, counts included', async () => {
    const { list } = setup();
    const page = await list({ videoId: VIDEO_B, status: 'hidden' });
    expect(ids(page)).toEqual([id(5)]);
    expect(page.counts).toEqual({ all: 2, new: 0, draft: 1, exported: 0, scheduled: 1, hidden: 1 });
  });

  it("never shows another workspace's clips, even by its video id", async () => {
    const { list } = setup();
    const page = await list({ videoId: VIDEO_X });
    expect(page.clips).toEqual([]);
    expect(page.counts.all).toBe(0);
  });

  it('pages 24 at a time, newest first or oldest first', async () => {
    const tables = emptyTables();
    tables.videos.push(videoRow({ id: VIDEO_A, status: 'READY' }));
    for (let n = 1; n <= 25; n++) {
      tables.clips.push(
        clipRow({
          id: id(n),
          videoId: VIDEO_A,
          createdAt: at(n),
          document: doc(VIDEO_A, 0, 5_000),
        }),
      );
    }
    const { list } = setup(tables);
    const first = await list();
    expect(first.clips).toHaveLength(24);
    expect(first.clips[0]?.id).toBe(id(25));
    expect(first.total).toBe(25);
    const second = await list({ page: '2' });
    expect(second.clips.map((clip) => clip.id)).toEqual([id(1)]);
    const oldest = await list({ sort: 'oldest' });
    expect(oldest.clips[0]?.id).toBe(id(1));
  });

  it('gives each card its tile, its preview and its video, signing each file once', async () => {
    const { list, playback } = setup();
    const page = await list();
    const stream = page.clips.find((clip) => clip.id === id(2));
    // 210 s at one tile every 2 s is tile 105: the second sheet, sixth tile of its first row.
    expect(stream?.poster).toEqual({
      url: 'https://signed/key/a/film1',
      x: 800,
      y: 0,
      width: 160,
      height: 90,
      sheetWidth: 1600,
      sheetHeight: 900,
    });
    expect(stream?.preview).toEqual({
      url: 'https://signed/key/a/proxy',
      fromMs: 210_000,
      toMs: 240_000,
      expiresAt: '2026-11-18T18:00:00.000Z',
    });
    expect(stream).toMatchObject({
      videoId: VIDEO_A,
      videoTitle: 'Stream A',
      platform: 'twitch',
      range: { fromMs: 210_000, toMs: 240_000 },
    });
    expect(stream).not.toHaveProperty('document');

    // No filmstrip: the video's poster picture, whole.
    const upload = page.clips.find((clip) => clip.id === id(6));
    expect(upload?.poster).toEqual({
      url: 'https://signed/key/b/poster',
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      sheetWidth: 1280,
      sheetHeight: 720,
    });

    const keys = playback.address.mock.calls.map(([key]) => key).sort();
    expect(keys).toEqual(['key/a/film1', 'key/a/proxy', 'key/b/poster', 'key/b/proxy']);
    expect(JSON.stringify(page)).not.toContain('"key/');
  });

  it('answers no poster or preview for a clip whose video was deleted', async () => {
    const tables = seed();
    const video = tables.videos.find((row) => row.id === VIDEO_A);
    if (video) video.deletedAt = at(0);
    const { list } = setup(tables);
    const page = await list({ videoId: VIDEO_A });
    expect(page.clips.length).toBeGreaterThan(0);
    expect(page.clips.every((clip) => clip.poster === null && clip.preview === null)).toBe(true);
  });

  it("gives each card its open export's progress for the ring, never a preview's (Module 15)", async () => {
    const tables = seed();
    const render = (n: number, clipId: string, progress: number, proof: boolean) =>
      jobRow({
        id: `77777777-7777-4777-8777-${String(n).padStart(12, '0')}`,
        kind: 'RENDER',
        status: 'RUNNING',
        progress,
        clipId,
        input: { clipId, proof } as unknown as ReturnType<typeof jobRow>['input'],
      });
    tables.jobs.push(render(1, id(1), 42, false), render(2, id(2), 80, true));
    const { list } = setup(tables);
    const page = await list();
    const byId = new Map(page.clips.map((clip) => [clip.id, clip.exportProgress]));
    expect(byId.get(id(1))).toBe(42);
    expect(byId.get(id(2))).toBeNull();
    expect([...byId.values()].filter((value) => value !== null)).toEqual([42]);
  });

  describe('Module 17', () => {
    const exportedSeed = () => {
      const tables = seed();
      for (const [n, media] of [
        [3, 'media-3'],
        [4, 'media-4'],
        [5, 'media-5'],
        [7, 'media-7'],
      ] as const) {
        const row = tables.clips.find((clip) => clip.id === id(n));
        if (row) row.exportedMediaId = media;
      }
      return tables;
    };

    it('withExport lists every clip with an exported file, scheduled or changed since, hidden left out', async () => {
      const { list } = setup(exportedSeed());
      const newest = await list({ withExport: 'true' });
      expect(newest.clips.map((clip) => clip.id)).toEqual([id(7), id(4), id(3)]);
      expect(newest.clips.map((clip) => clip.state)).toEqual(['draft', 'scheduled', 'exported']);
      expect(newest.total).toBe(3);
      const oldest = await list({ withExport: 'true', sort: 'oldest' });
      expect(oldest.clips.map((clip) => clip.id)).toEqual([id(3), id(4), id(7)]);
    });

    it('gives each exported clip the date of its file, and none once the file left Media', async () => {
      const tables = exportedSeed();
      const made = (mediaId: string, deleted: boolean) => ({
        id: mediaId,
        organizationId: TEST_ORG,
        name: `${mediaId}.mp4`,
        path: `media/${mediaId}.mp4`,
        thumbnail: null,
        fileSize: 1024,
        width: 1080,
        height: 1920,
        durationMs: 30_000,
        deletedAt: deleted ? new Date('2026-11-10T00:00:00.000Z') : null,
        createdAt: new Date('2026-11-05T09:30:00.000Z'),
      });
      // media-4 was deleted from Media; media-7 belongs to another workspace's row id.
      tables.media = [
        made('media-3', false),
        made('media-4', true),
        { ...made('media-7', false), organizationId: OTHER_ORG },
      ];
      const { list } = setup(tables);
      const page = await list({ withExport: 'true' });
      const byId = new Map(page.clips.map((clip) => [clip.id, clip.exportedAt]));
      expect(byId.get(id(3))).toBe('2026-11-05T09:30:00.000Z');
      expect(byId.get(id(4))).toBeNull();
      expect(byId.get(id(7))).toBeNull();
      const all = await list();
      expect(all.clips.find((clip) => clip.id === id(1))?.exportedAt).toBeNull();
    });

    it('q finds clips by words of their name, any case', async () => {
      const tables = seed();
      const named = tables.clips.find((clip) => clip.id === id(2));
      if (named) named.title = 'Boss Fight Win';
      const { list } = setup(tables);
      const page = await list({ q: 'boss fight' });
      expect(page.clips.map((clip) => clip.id)).toEqual([id(2)]);
      expect((await list({ q: 'nothing like it' })).clips).toEqual([]);
    });

    it('gives each card the live posts it went out in, for View Post', async () => {
      const tables = seed();
      const published = tables.posts.find((row) => row.group === 'group-published');
      if (published) published.releaseURL = 'https://youtube.com/shorts/abc';
      const { list } = setup(tables);
      const page = await list();
      const byId = new Map(page.clips.map((clip) => [clip.id, clip.posts]));
      expect(byId.get(id(6))).toEqual([
        expect.objectContaining({
          url: 'https://youtube.com/shorts/abc',
          group: 'group-published',
        }),
      ]);
      expect(byId.get(id(4))).toEqual([]);
    });

    it('Coming Up answers the waiting clips with their cards, at most five and the total', async () => {
      const tables = exportedSeed();
      // The waiting post is on 1 November; look from two days before.
      const { service } = setup(tables);
      const answer = await service.comingUp(TEST_ORG, new Date('2026-10-30T10:00:00.000Z'));
      expect(answer.total).toBe(1);
      expect(answer.items).toEqual([
        {
          group: 'group-waiting',
          publishDate: '2026-11-01T10:00:00.000Z',
          channels: [
            { id: 'channel-1', name: 'Channel One', providerIdentifier: 'youtube', picture: null },
          ],
          clip: expect.objectContaining({ id: id(4), videoId: VIDEO_B, ratio: '9:16' }),
        },
      ]);
      expect(answer.items[0]?.clip.poster).toEqual(
        expect.objectContaining({ url: expect.any(String) }),
      );
      // From after it, nothing is coming up; another workspace sees only its own.
      expect(answer.anyExported).toBe(true);
      expect(await service.comingUp(TEST_ORG, new Date('2026-11-02T00:00:00.000Z'))).toEqual({
        items: [],
        total: 0,
        anyExported: true,
      });
      const theirs = await service.comingUp(OTHER_ORG, new Date('2026-10-30T10:00:00.000Z'));
      expect(theirs.items.map((item) => [item.group, item.clip.id])).toEqual([
        ['group-theirs', id(9)],
      ]);
    });

    it('Coming Up shows five and counts the rest', async () => {
      const tables = exportedSeed();
      for (let n = 0; n < 7; n += 1) {
        const group = `group-more-${n}`;
        tables.clipPosts.push({
          id: `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
          organizationId: TEST_ORG,
          clipId: id(3),
          postGroup: group,
          mediaId: 'media-3',
          createdAt: at(n),
        });
        tables.posts.push({
          id: `post-more-${n}`,
          organizationId: TEST_ORG,
          group,
          state: 'QUEUE',
          deletedAt: null,
          publishDate: new Date(Date.UTC(2026, 10, 2, n)),
        });
      }
      const { service } = setup(tables);
      const answer = await service.comingUp(TEST_ORG, new Date('2026-10-30T10:00:00.000Z'));
      expect(answer.total).toBe(8);
      expect(answer.items).toHaveLength(5);
      expect(answer.items[0]?.group).toBe('group-waiting');
    });

    it('Coming Up says whether the workspace has an exported clip, hidden ones left out', async () => {
      // The plain seed has no exported file at all.
      const none = setup(seed());
      expect((await none.service.comingUp(TEST_ORG)).anyExported).toBe(false);
      const hiddenOnly = seed();
      const row = hiddenOnly.clips.find((clip) => clip.id === id(1));
      if (row) {
        row.exportedMediaId = 'media-1';
        row.status = 'HIDDEN';
      }
      const hidden = setup(hiddenOnly);
      expect((await hidden.service.comingUp(TEST_ORG)).anyExported).toBe(false);
      const exported = setup(exportedSeed());
      expect((await exported.service.comingUp(TEST_ORG)).anyExported).toBe(true);
    });
  });
});
