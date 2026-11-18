/**
 * The pure parts of the `/dev/clips` test bench (Sprint 12, Module 05
 * section 5): the sample links, the 20 second range, and the five moments
 * the two players are compared at. Kept apart from the page so it is tested
 * on its own.
 */

/** The three good simulation links (README, Names table). Only answered under `CLIPS_SIMULATION`. */
export const SAMPLE_LINKS = [
  {
    id: 'twitch',
    label: 'Twitch Stream (10 Minutes)',
    url: 'https://www.twitch.tv/videos/900000001',
  },
  {
    id: 'youtube',
    label: 'YouTube Talk (3 Minutes)',
    url: 'https://www.youtube.com/watch?v=simtalk0001',
  },
  {
    id: 'kick',
    label: 'Kick Stream (10 Minutes)',
    url: 'https://kick.com/simstreamer/videos/00000000-0000-4000-8000-000000000001',
  },
] as const;

export type SampleId = (typeof SAMPLE_LINKS)[number]['id'];

export const CLIP_LENGTH_MS = 20_000;
/** Where the clip starts when the video is long enough: past any opening seconds. */
const PREFERRED_START_MS = 30_000;

/**
 * The 20 second range the bench clips: from 30 seconds in, or earlier when
 * the video is short, and null when the video is shorter than the clip.
 */
export function benchClipRange(durationMs: number | null): { fromMs: number; toMs: number } | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < CLIP_LENGTH_MS) {
    return null;
  }
  const fromMs = Math.max(0, Math.min(PREFERRED_START_MS, durationMs - CLIP_LENGTH_MS));
  return { fromMs, toMs: fromMs + CLIP_LENGTH_MS };
}

export interface CompareMoment {
  label: string;
  /** In the clip's own time, from its first frame. */
  atMs: number;
}

/** The start, a quarter, the middle, three quarters and the last second of a clip. */
export function compareMoments(clipDurationMs: number): CompareMoment[] {
  const length = Math.max(0, Math.round(clipDurationMs));
  return [
    { label: 'Start', atMs: 0 },
    { label: 'Quarter', atMs: Math.round(length / 4) },
    { label: 'Middle', atMs: Math.round(length / 2) },
    { label: 'Three Quarters', atMs: Math.round((length * 3) / 4) },
    { label: 'Last Second', atMs: Math.max(0, length - 1_000) },
  ];
}

/** "0:20.0": a moment to the tenth of a second, for the readout beside the players. */
export function formatMoment(ms: number): string {
  const safe = Math.max(0, Number.isFinite(ms) ? ms : 0);
  const tenths = Math.floor(safe / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}
