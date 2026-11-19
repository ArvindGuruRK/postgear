/**
 * The `ClipPost` rows (Module 17) against an in-memory database: the sync a
 * post save runs (a clip attached through the picker gets a row, a removed
 * one loses it, nothing is written twice), View Post's published posts, and
 * Coming Up's waiting posts (only QUEUE, only the next 14 days, soonest
 * first), each kept to its workspace.
 */
import type { ClipPost } from '@postgear/db';
import {
  clipRow,
  emptyTables,
  type FakeClipDb,
  type FakePost,
  type FakeTables,
  fakeClipDb,
} from '../testing/fake-clip-db';
import { TEST_ORG, videoRow } from '../testing/rows';
import { ClipPostsService, publishedPostsOf } from './clip-posts.service';

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
const CLIP_A = '55555555-5555-4555-8555-555555555555';
const CLIP_B = '56565656-5656-4565-8565-565656565656';
const MEDIA_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const MEDIA_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const GROUP = '11111111-aaaa-4aaa-8aaa-111111111111';
const GROUP_2 = '22222222-aaaa-4aaa-8aaa-222222222222';
const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 24 * 60 * 60_000;

function seed(): FakeTables {
  const tables = emptyTables();
  tables.videos.push(videoRow({ status: 'READY' }));
  tables.clips.push(
    clipRow({ id: CLIP_A, exportedMediaId: MEDIA_A, lastExportedRevision: 1, title: 'Boss fight' }),
    clipRow({ id: CLIP_B, exportedMediaId: MEDIA_B, lastExportedRevision: 1, title: 'Clutch' }),
  );
  return tables;
}

function link(clipId: string, postGroup: string, organizationId = TEST_ORG): ClipPost {
  return {
    id: `cp-${clipId.slice(0, 4)}-${postGroup.slice(0, 4)}`,
    organizationId,
    clipId,
    postGroup,
    mediaId: clipId === CLIP_A ? MEDIA_A : MEDIA_B,
    createdAt: NOW,
  };
}

function post(overrides: Partial<FakePost> & { group: string }): FakePost {
  return {
    id: `post-${Math.random().toString(36).slice(2, 10)}`,
    organizationId: TEST_ORG,
    state: 'QUEUE',
    deletedAt: null,
    publishDate: new Date(NOW.getTime() + DAY),
    ...overrides,
  };
}

describe('ClipPostsService.syncForPost', () => {
  it('links a clip whose export is on the post, and a second run writes nothing', async () => {
    const tables = seed();
    mockDb = fakeClipDb(tables);
    const service = new ClipPostsService();

    expect(await service.syncForPost(TEST_ORG, GROUP, [MEDIA_A, 'some-picture'])).toEqual({
      added: 1,
      removed: 0,
    });
    expect(tables.clipPosts).toEqual([
      expect.objectContaining({ clipId: CLIP_A, postGroup: GROUP, mediaId: MEDIA_A }),
    ]);
    expect(await service.syncForPost(TEST_ORG, GROUP, [MEDIA_A])).toEqual({ added: 0, removed: 0 });
    expect(tables.clipPosts).toHaveLength(1);
  });

  it('drops the link when the clip file leaves the post, and on a delete', async () => {
    const tables = seed();
    mockDb = fakeClipDb(tables);
    const service = new ClipPostsService();
    await service.syncForPost(TEST_ORG, GROUP, [MEDIA_A, MEDIA_B]);
    expect(tables.clipPosts).toHaveLength(2);

    expect(await service.syncForPost(TEST_ORG, GROUP, [MEDIA_B])).toEqual({ added: 0, removed: 1 });
    expect(tables.clipPosts.map((row) => row.clipId)).toEqual([CLIP_B]);
    await service.syncForPost(TEST_ORG, GROUP, []);
    expect(tables.clipPosts).toEqual([]);
  });

  it('keeps a link whose file is still on the post after the clip was exported again', async () => {
    const tables = seed();
    tables.clipPosts.push(link(CLIP_A, GROUP));
    if (tables.clips[0]) tables.clips[0].exportedMediaId = 'cccccccc-0000-4000-8000-00000000000c';
    mockDb = fakeClipDb(tables);
    expect(await new ClipPostsService().syncForPost(TEST_ORG, GROUP, [MEDIA_A])).toEqual({
      added: 0,
      removed: 0,
    });
    expect(tables.clipPosts).toHaveLength(1);
  });

  it('never links another workspace clip, nor touches its rows', async () => {
    const tables = seed();
    tables.clips.push(
      clipRow({
        id: '57575757-5757-4575-8575-575757575757',
        organizationId: OTHER_ORG,
        exportedMediaId: MEDIA_A,
      }),
    );
    tables.clipPosts.push(link(CLIP_B, GROUP, OTHER_ORG));
    mockDb = fakeClipDb(tables);
    await new ClipPostsService().syncForPost(TEST_ORG, GROUP, [MEDIA_A]);
    expect(tables.clipPosts.map((row) => [row.organizationId, row.clipId])).toEqual([
      [OTHER_ORG, CLIP_B],
      [TEST_ORG, CLIP_A],
    ]);
  });
});

describe('publishedPostsOf', () => {
  it('gives each clip its published root posts with an address, newest first, once each', async () => {
    const tables = seed();
    tables.clipPosts.push(link(CLIP_A, GROUP), link(CLIP_A, GROUP_2), link(CLIP_B, GROUP));
    tables.integrations = [
      { id: 'yt-1', name: 'Acme Shorts', providerIdentifier: 'youtube', picture: null },
      { id: 'ig-1', name: 'Acme Reels', providerIdentifier: 'instagram-standalone', picture: null },
    ];
    tables.posts.push(
      post({
        group: GROUP,
        state: 'PUBLISHED',
        integrationId: 'yt-1',
        releaseURL: 'https://youtube.com/shorts/abc',
        publishDate: new Date('2026-11-18T10:00:00.000Z'),
      }),
      post({
        group: GROUP_2,
        state: 'PUBLISHED',
        integrationId: 'ig-1',
        releaseURL: 'https://instagram.com/reel/xyz',
        publishDate: new Date('2026-11-19T09:00:00.000Z'),
      }),
      // A thread reply, a failed post, an unsafe address and a deleted post never show.
      post({
        group: GROUP,
        state: 'PUBLISHED',
        parentPostId: 'root',
        releaseURL: 'https://youtube.com/reply',
      }),
      post({ group: GROUP_2, state: 'ERROR', releaseURL: 'https://instagram.com/failed' }),
      post({ group: GROUP_2, state: 'PUBLISHED', releaseURL: 'javascript:alert(1)' }),
      post({
        group: GROUP,
        state: 'PUBLISHED',
        releaseURL: 'https://youtube.com/deleted',
        deletedAt: NOW,
      }),
    );
    mockDb = fakeClipDb(tables);

    const found = await publishedPostsOf(TEST_ORG, [CLIP_A, CLIP_B]);
    expect(found.get(CLIP_A)).toEqual([
      {
        group: GROUP_2,
        channelName: 'Acme Reels',
        providerIdentifier: 'instagram-standalone',
        url: 'https://instagram.com/reel/xyz',
        publishedAt: '2026-11-19T09:00:00.000Z',
      },
      {
        group: GROUP,
        channelName: 'Acme Shorts',
        providerIdentifier: 'youtube',
        url: 'https://youtube.com/shorts/abc',
        publishedAt: '2026-11-18T10:00:00.000Z',
      },
    ]);
    expect(found.get(CLIP_B)?.map((entry) => entry.url)).toEqual([
      'https://youtube.com/shorts/abc',
    ]);
    expect(await publishedPostsOf(OTHER_ORG, [CLIP_A])).toEqual(new Map());
  });

  it('gives nothing for a clip that is only scheduled', async () => {
    const tables = seed();
    tables.clipPosts.push(link(CLIP_A, GROUP));
    tables.posts.push(post({ group: GROUP }));
    mockDb = fakeClipDb(tables);
    expect((await publishedPostsOf(TEST_ORG, [CLIP_A])).has(CLIP_A)).toBe(false);
  });
});

describe('ClipPostsService.comingUpRows', () => {
  it('lists the waiting posts in the next 14 days that use a clip, soonest first, with their channels', async () => {
    const tables = seed();
    const DRAFT = '33333333-aaaa-4aaa-8aaa-333333333333';
    const SENT = '44444444-aaaa-4aaa-8aaa-444444444444';
    const FAILED = '55555555-aaaa-4aaa-8aaa-555555555555';
    const LATER = '66666666-aaaa-4aaa-8aaa-666666666666';
    const PAST = '77777777-aaaa-4aaa-8aaa-777777777777';
    for (const group of [GROUP, GROUP_2, DRAFT, SENT, FAILED, LATER, PAST]) {
      tables.clipPosts.push(link(CLIP_A, group));
    }
    tables.clipPosts.push(link(CLIP_B, GROUP));
    tables.integrations = [
      { id: 'yt-1', name: 'Acme Shorts', providerIdentifier: 'youtube', picture: null },
      { id: 'ig-1', name: 'Acme Reels', providerIdentifier: 'instagram-standalone', picture: null },
    ];
    tables.posts.push(
      // Same time: the id breaks the tie, so the ids are fixed here.
      post({
        id: 'post-a-shorts',
        group: GROUP,
        integrationId: 'yt-1',
        publishDate: new Date(NOW.getTime() + 3 * DAY),
      }),
      post({
        id: 'post-b-reels',
        group: GROUP,
        integrationId: 'ig-1',
        publishDate: new Date(NOW.getTime() + 3 * DAY),
      }),
      post({ group: GROUP_2, integrationId: 'yt-1', publishDate: new Date(NOW.getTime() + DAY) }),
      post({ group: DRAFT, state: 'DRAFT' }),
      post({ group: SENT, state: 'PUBLISHED' }),
      post({ group: FAILED, state: 'ERROR' }),
      post({ group: LATER, publishDate: new Date(NOW.getTime() + 15 * DAY) }),
      post({ group: PAST, publishDate: new Date(NOW.getTime() - DAY) }),
    );
    // Another workspace's waiting post never counts.
    tables.posts.push(post({ group: GROUP, organizationId: OTHER_ORG }));
    mockDb = fakeClipDb(tables);

    const rows = await new ClipPostsService().comingUpRows(TEST_ORG, NOW);
    expect(rows.map((row) => [row.group, row.clipId])).toEqual([
      [GROUP_2, CLIP_A],
      [GROUP, CLIP_A],
      [GROUP, CLIP_B],
    ]);
    expect(rows[1]?.channels.map((channel) => channel.name)).toEqual(['Acme Shorts', 'Acme Reels']);
    expect(rows[0]?.publishDate.toISOString()).toBe('2026-11-20T12:00:00.000Z');
    expect(await new ClipPostsService().comingUpRows(OTHER_ORG, NOW)).toEqual([]);
  });
});
