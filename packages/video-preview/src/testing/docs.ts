/**
 * Small clip documents for the preview's tests (and the web app's playback
 * tests): a Vertical Fullscreen clip of the given parts, all from one video.
 */
import type { ClipDocument, LayoutArea, Segment } from '@postgear/video-engine';

export const TEST_VIDEO_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';

/** A 9:16 crop of a 16:9 picture, centred. */
export const CENTRED_VERTICAL_CROP = Object.freeze({
  x: (1 - 0.31640625) / 2,
  y: 0,
  w: 0.31640625,
  h: 1,
});

export function part(
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: Segment['speed'] = 1,
  volume = 1,
): Segment {
  return { id, source: 'src', sourceIn, sourceOut, speed, volume };
}

export function clipOf(
  segments: Segment[],
  options: { kind?: ClipDocument['layout']['kind']; areas?: LayoutArea[] } = {},
): ClipDocument {
  return {
    schemaVersion: 2,
    bleeps: [],
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: TEST_VIDEO_ID }],
    segments,
    layout: {
      kind: options.kind ?? 'fullscreen',
      areas: options.areas ?? [
        {
          id: 'main',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { ...CENTRED_VERTICAL_CROP } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
  };
}
