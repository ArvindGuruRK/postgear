import type { CaptionsTrack, ClipDocument } from '@postgear/video-engine';
import { trackNeeds } from './montage-captions';

const VIDEO_A = '3f2a9c1e-0000-4000-8000-00000000000a';
const VIDEO_B = '3f2a9c1e-0000-4000-8000-00000000000b';

const doc = {
  sources: [
    { id: 'src_1', videoId: VIDEO_A },
    { id: 'src_2', videoId: VIDEO_B },
  ],
  segments: [
    { id: 'seg_1', source: 'src_1', sourceIn: 1_000, sourceOut: 4_000, speed: 1, volume: 1 },
    { id: 'seg_2', source: 'src_2', sourceIn: 5_000, sourceOut: 9_000, speed: 1, volume: 1 },
    { id: 'seg_3', source: 'src_2', sourceIn: 12_000, sourceOut: 14_000, speed: 1, volume: 1 },
  ],
} as unknown as Pick<ClipDocument, 'sources' | 'segments'>;

const track = (id: string, transcriptAssetId: string, source?: string) =>
  ({ id, kind: 'captions', transcriptAssetId, source }) as unknown as CaptionsTrack;

describe("a montage's captions", () => {
  const tracks = [track('trk_a', 'tr-a', 'src_1'), track('trk_b', 'tr-b', 'src_2')];

  it("reads each track's words from its own video, over that video's parts", () => {
    expect(trackNeeds(doc, tracks, new Set(), 0)).toEqual([
      { transcriptId: 'tr-a', videoId: VIDEO_A, fromMs: 1_000, toMs: 4_000 },
      { transcriptId: 'tr-b', videoId: VIDEO_B, fromMs: 5_000, toMs: 14_000 },
    ]);
  });

  it('leaves the first track to useCaptions on an ordinary clip, and skips what is held', () => {
    expect(trackNeeds(doc, tracks, new Set()).map((need) => need.transcriptId)).toEqual(['tr-b']);
    expect(trackNeeds(doc, tracks, new Set(['tr-a', 'tr-b']), 0)).toEqual([]);
  });
});
