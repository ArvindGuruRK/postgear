/**
 * Which file an export reads for a clip's own video (Module 05), with a brand
 * intro and outro from other videos (Module 10): they play in their own
 * video's time, so they never widen the clip's range on its video. Module 11:
 * a montage is judged per source, each on its own video's files.
 */
import { applyBrandKit, createClipDocument, createMontage } from '@postgear/video-engine';
import {
  allSourcesSharp,
  documentRange,
  sharpSourceFor,
  sharpSourcesFor,
  storedDocumentRange,
  storedRangesOnVideo,
} from './sharp-source';

const VIDEO = '22222222-2222-4222-8222-222222222222';
const INTRO = '23232323-2323-4232-8232-232323232323';
const OUTRO = '24242424-2424-4242-8242-242424242424';

const plain = createClipDocument({ videoId: VIDEO, fromMs: 60_000, toMs: 90_000, ratio: '9:16' });
const branded = applyBrandKit(plain, {
  id: '1b2c3d4e-5f60-4718-9a2b-3c4d5e6f7081',
  name: 'Acme',
  logo: null,
  logoPosition: null,
  captionStyleId: null,
  intro: { videoId: INTRO, durationMs: 3_000, width: 1280, height: 720 },
  outro: { kind: 'video', video: { videoId: OUTRO, durationMs: 2_000, width: 720, height: 1280 } },
});

describe('the sharp source of a branded clip', () => {
  it('reads the range on the clip video only', () => {
    expect(branded.segments.map((segment) => segment.role ?? 'main')).toEqual([
      'intro',
      'main',
      'outro',
    ]);
    expect(documentRange(branded)).toEqual({ fromMs: 60_000, toMs: 90_000 });
    expect(storedDocumentRange(branded)).toEqual({ fromMs: 60_000, toMs: 90_000 });
    expect(documentRange(plain)).toEqual({ fromMs: 60_000, toMs: 90_000 });
  });

  it('still picks the covering SEGMENT, not the light copy', () => {
    const at = new Date('2026-11-20T10:00:00Z');
    const assets = [
      { id: 'proxy', kind: 'PROXY' as const, key: 'p.mp4', meta: {}, createdAt: at },
      {
        id: 'seg',
        kind: 'SEGMENT' as const,
        key: 's.mp4',
        meta: { fromMs: 50_000, toMs: 100_000, height: 1080, fps: 30 },
        createdAt: at,
      },
    ];
    expect(sharpSourceFor(branded, assets)).toMatchObject({ kind: 'segment', assetId: 'seg' });
  });
});

describe('the sharp source of each video a montage plays (Module 11)', () => {
  const SECOND = '25252525-2525-4252-8252-252525252525';
  const at = new Date('2026-11-20T10:00:00Z');
  const first = createClipDocument({ videoId: VIDEO, fromMs: 60_000, toMs: 90_000, ratio: '9:16' });
  const second = createClipDocument({
    videoId: SECOND,
    fromMs: 5_000,
    toMs: 25_000,
    ratio: '9:16',
  });
  const made = createMontage(
    [
      { id: '55555555-5555-4555-8555-000000000001', title: 'One', document: first },
      { id: '55555555-5555-4555-8555-000000000002', title: 'Two', document: second },
    ],
    { transition: 'fade' },
  );
  if (!made.ok) throw new Error(made.code);
  const montage = made.document;

  const proxy = (id: string) => ({
    id,
    kind: 'PROXY' as const,
    key: `${id}.mp4`,
    meta: {},
    createdAt: at,
  });
  const segment = (id: string, fromMs: number, toMs: number) => ({
    id,
    kind: 'SEGMENT' as const,
    key: `${id}.mp4`,
    meta: { fromMs, toMs, height: 1080, fps: 30 },
    createdAt: at,
  });

  it('judges each source on its own range and its own video', () => {
    const assets: Record<string, ReturnType<typeof proxy | typeof segment>[]> = {
      [VIDEO]: [proxy('p1'), segment('s1', 50_000, 100_000)],
      [SECOND]: [proxy('p2')],
    };
    const answers = sharpSourcesFor(montage, (videoId) => assets[videoId] ?? []);
    expect(
      answers.map((entry) => [
        entry.videoId,
        entry.range,
        entry.source?.kind,
        entry.source?.assetId,
      ]),
    ).toEqual([
      [VIDEO, { fromMs: 60_000, toMs: 90_000 }, 'segment', 's1'],
      [SECOND, { fromMs: 5_000, toMs: 25_000 }, 'proxy', 'p2'],
    ]);
    expect(allSourcesSharp(answers)).toBe(false);

    // A SEGMENT of the first video that happens to cover the second's numbers counts for nothing.
    assets[VIDEO] = [...(assets[VIDEO] ?? []), segment('s0', 0, 30_000)];
    expect(allSourcesSharp(sharpSourcesFor(montage, (videoId) => assets[videoId] ?? []))).toBe(
      false,
    );
    assets[SECOND] = [proxy('p2'), segment('s2', 0, 30_000)];
    expect(allSourcesSharp(sharpSourcesFor(montage, (videoId) => assets[videoId] ?? []))).toBe(
      true,
    );
  });

  it('reads two far-apart clips of one video as sharp when each has its own SEGMENT, as the worker does', () => {
    const early = createClipDocument({
      videoId: VIDEO,
      fromMs: 10_000,
      toMs: 30_000,
      ratio: '9:16',
    });
    const late = createClipDocument({
      videoId: VIDEO,
      fromMs: 600_000,
      toMs: 620_000,
      ratio: '9:16',
    });
    const both = createMontage(
      [
        { id: '55555555-5555-4555-8555-000000000003', title: 'Early', document: early },
        { id: '55555555-5555-4555-8555-000000000004', title: 'Late', document: late },
      ],
      { transition: 'cut' },
    );
    if (!both.ok) throw new Error(both.code);
    const assets = [proxy('p'), segment('a', 5_000, 35_000), segment('b', 595_000, 625_000)];
    const answers = sharpSourcesFor(both.document, () => assets);
    expect(answers).toHaveLength(1);
    expect(answers[0]?.range).toEqual({ fromMs: 10_000, toMs: 620_000 });
    expect(allSourcesSharp(answers)).toBe(true);
    expect(
      allSourcesSharp(
        sharpSourcesFor(both.document, () => [proxy('p'), segment('a', 5_000, 35_000)]),
      ),
    ).toBe(false);
  });

  it('gives a clip of one video the single answer it always had', () => {
    const assets = [proxy('p'), segment('seg', 50_000, 100_000)];
    const [only] = sharpSourcesFor(branded, () => assets);
    expect(only?.source).toEqual(sharpSourceFor(branded, assets));
    expect(sharpSourcesFor(branded, () => assets)).toHaveLength(1);
    expect(allSourcesSharp(sharpSourcesFor(plain, () => [proxy('p')]))).toBe(false);
  });

  it('reads the ranges a stored document plays on one video, brand parts left out', () => {
    expect(storedRangesOnVideo(montage, SECOND)).toEqual([{ fromMs: 5_000, toMs: 25_000 }]);
    expect(storedRangesOnVideo(montage, VIDEO)).toEqual([{ fromMs: 60_000, toMs: 90_000 }]);
    expect(storedRangesOnVideo(branded, VIDEO)).toEqual([{ fromMs: 60_000, toMs: 90_000 }]);
    expect(storedRangesOnVideo(branded, INTRO)).toEqual([]);
    expect(storedRangesOnVideo({ not: 'a document' }, VIDEO)).toEqual([]);
  });
});
