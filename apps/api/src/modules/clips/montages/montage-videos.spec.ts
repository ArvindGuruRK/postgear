/**
 * A montage's videos (Sprint 13, Module 11): `meta.videoIds` read and never
 * trusted, every video a clip is "of", the `where` that finds the montages
 * of a video, and the 422 a montage with a removed video answers (for the
 * read route here, for the exports in builder C's service).
 */
import { HttpException } from '@nestjs/common';
import { clipRow, emptyTables, fakeClipDb } from '../testing/fake-clip-db';
import { TEST_ORG, videoRow } from '../testing/rows';
import {
  assertMontageVideosLive,
  clipsPlayingVideo,
  metaVideoIds,
  touchVideosOfClip,
  videosOfClip,
} from './montage-videos';

const A = videoRow().id;
const B = '99999999-9999-4999-8999-00000000000b';
const C = '99999999-9999-4999-8999-00000000000c';

function montage(overrides: Parameters<typeof clipRow>[0] = {}) {
  return clipRow({ origin: 'MONTAGE', videoId: A, meta: { videoIds: [B, C] }, ...overrides });
}

describe('the videos of a montage', () => {
  it('reads meta.videoIds as UUIDs only, each once', () => {
    expect(metaVideoIds({ videoIds: [B, B, 'not-an-id', 7, C] })).toEqual([B, C]);
    expect(metaVideoIds({ videoIds: 'nope' })).toEqual([]);
    expect(metaVideoIds(null)).toEqual([]);
    expect(metaVideoIds([B])).toEqual([]);
  });

  it('is of every video it plays; any other clip only of its own', () => {
    expect(videosOfClip(montage())).toEqual([A, B, C]);
    expect(videosOfClip(clipRow({ videoId: A, meta: { videoIds: [B] } }))).toEqual([A]);
  });

  it('is found among the clips of each of its videos, and never for another workspace', () => {
    const tables = emptyTables();
    tables.clips.push(
      montage({ id: '55555555-5555-4555-8555-000000000001' }),
      clipRow({ id: '55555555-5555-4555-8555-000000000002', videoId: B }),
      clipRow({ id: '55555555-5555-4555-8555-000000000003', videoId: C }),
      montage({ id: '55555555-5555-4555-8555-000000000004', organizationId: 'other-org' }),
    );
    const db = fakeClipDb(tables);
    return Promise.all([
      db.clip.findMany({ where: clipsPlayingVideo(TEST_ORG, B) }),
      db.clip.findMany({ where: clipsPlayingVideo(TEST_ORG, A) }),
    ]).then(([ofB, ofA]) => {
      expect(ofB.map((clip) => clip.id.slice(-1)).sort()).toEqual(['1', '2']);
      expect(ofA.map((clip) => clip.id.slice(-1))).toEqual(['1']);
    });
  });

  it('answers 422 montage_video_removed when one of its videos is removed or deleted', async () => {
    const tables = emptyTables();
    tables.videos.push(
      videoRow({ id: A, status: 'READY' }),
      videoRow({ id: B, status: 'REMOVED', deletedAt: new Date() }),
      videoRow({ id: C, status: 'READY' }),
    );
    const db = fakeClipDb(tables);

    const error = await assertMontageVideosLive(db as never, TEST_ORG, montage()).catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(422);
    expect((error as HttpException).getResponse()).toEqual({
      code: 'montage_video_removed',
      message: 'One of the videos in this montage was removed.',
    });

    // A deleted video counts the same; so does a montage the removal marked.
    (tables.videos[1] as { status: string }).status = 'READY';
    await expect(assertMontageVideosLive(db as never, TEST_ORG, montage())).rejects.toThrow();
    (tables.videos[1] as { deletedAt: Date | null }).deletedAt = null;
    await expect(
      assertMontageVideosLive(db as never, TEST_ORG, montage()),
    ).resolves.toBeUndefined();
    await expect(
      assertMontageVideosLive(db as never, TEST_ORG, montage({ removedAt: new Date() })),
    ).rejects.toThrow();
    // Another workspace's video is not this montage's.
    (tables.videos[2] as { organizationId: string }).organizationId = 'other-org';
    await expect(assertMontageVideosLive(db as never, TEST_ORG, montage())).rejects.toThrow();
  });

  it('lets any other clip through without a query', async () => {
    const db = { clipVideo: { count: jest.fn() } };
    await assertMontageVideosLive(db as never, TEST_ORG, clipRow({ removedAt: new Date() }));
    expect(db.clipVideo.count).not.toHaveBeenCalled();
  });

  it('touches every video of a montage', async () => {
    const retention = { touchVideo: jest.fn(async () => true) };
    await touchVideosOfClip(retention, TEST_ORG, montage());
    expect(retention.touchVideo.mock.calls).toEqual([
      [TEST_ORG, A],
      [TEST_ORG, B],
      [TEST_ORG, C],
    ]);
  });
});
