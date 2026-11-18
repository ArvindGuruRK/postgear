/**
 * Hand-built clip documents for the render tests (and the media-tools parity
 * test and scripts). Not exported from the package index: `createClipDocument`
 * is the real way to make one.
 */
import type { ClipDocument, Segment } from '../document/schema';
import type { Rect } from '../geometry';
import type { RenderContext, RenderSourceAsset } from './plan';

export const TEST_VIDEO_ID = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
export const TEST_ASSET_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** A 9:16 crop of a 16:9 picture, centred: the Fullscreen preset for a landscape video. */
export const CENTRED_VERTICAL_CROP: Rect = Object.freeze({
  x: (1 - 0.31640625) / 2,
  y: 0,
  w: 0.31640625,
  h: 1,
});

export function testSegment(
  id: string,
  sourceIn: number,
  sourceOut: number,
  speed: Segment['speed'] = 1,
  volume = 1,
): Segment {
  return { id, source: 'src', sourceIn, sourceOut, speed, volume };
}

/** A Vertical Fullscreen clip of the given segments with a constant crop. */
export function testDocument(
  segments: Segment[],
  options: { crop?: Rect; fadeInMs?: number; fadeOutMs?: number } = {},
): ClipDocument {
  return {
    schemaVersion: 1,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: 30, background: '#000000' },
    sources: [{ id: 'src', videoId: TEST_VIDEO_ID }],
    segments,
    layout: {
      kind: 'fullscreen',
      areas: [
        {
          id: 'main',
          name: 'Video',
          frame: { x: 0, y: 0, w: 1, h: 1 },
          crop: [{ at: 0, rect: { ...(options.crop ?? CENTRED_VERTICAL_CROP) } }],
          fit: 'cover',
        },
      ],
    },
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: options.fadeInMs ?? 0, outMs: options.fadeOutMs ?? 0 },
    tracks: [],
  };
}

/** A 1920 by 1080, 30 fps file holding source 0 to 120 s, with sound. */
export function testSource(overrides: Partial<RenderSourceAsset> = {}): RenderSourceAsset {
  return {
    file: 'source.mp4',
    sourceOffsetMs: 0,
    durationMs: 120_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    ...overrides,
  };
}

export function testContext(overrides: Partial<RenderContext> = {}): RenderContext {
  return {
    quality: '1080p',
    proof: false,
    watermark: false,
    assets: { sources: { src: testSource() } },
    ...overrides,
  };
}
