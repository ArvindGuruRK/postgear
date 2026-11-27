/**
 * Which file an export reads for a clip's own video (Module 05), with a brand
 * intro and outro from other videos (Module 10): they play in their own
 * video's time, so they never widen the clip's range on its video.
 */
import { applyBrandKit, createClipDocument } from '@postgear/video-engine';
import { documentRange, sharpSourceFor, storedDocumentRange } from './sharp-source';

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
