import { testDocument, testSegment } from '../render/test-docs';
import { frameState } from '../render/frame-state';
import { findItem } from '../time/items';
import { outputDuration } from '../time/time-map';
import type { AudioItem, ClipDocument } from './schema';
import { clipDocumentSchema } from './schema';
import {
  addSound,
  countSounds,
  defaultSoundItem,
  MAX_SOUNDS,
  removeSound,
  SOUND_FADE_MS,
  setSegmentVolume,
  setVideoVolume,
  soundFileMsAt,
  soundFilesNeeded,
  soundGainAt,
  soundMaxDuration,
  soundRefKey,
  updateSound,
  videoVolumeOf,
} from './sound';

const LIBRARY = { library: 'sound' as const, id: '11111111-1111-4111-8111-111111111111' };
const UPLOAD = { asset: '22222222-2222-4222-8222-222222222222' };

/** A 20 s clip of two parts. */
function clip(): ClipDocument {
  return testDocument([testSegment('a', 0, 10_000), testSegment('b', 20_000, 30_000)]);
}

function added(doc: ClipDocument, type: AudioItem['type'], atMs: number, fileMs: number) {
  const result = addSound(doc, type === 'music' ? UPLOAD : LIBRARY, type, atMs, { durationMs: fileMs });
  if (!result.ok) throw new Error(result.code);
  const item = findItem(result.doc, result.itemId as string)?.item as AudioItem;
  return { doc: result.doc, item };
}

describe('sound items', () => {
  it('adds an effect for its file length on its moment, with no fades', () => {
    const { doc, item } = added(clip(), 'sfx', 3_000, 1_200);
    expect(item).toMatchObject({
      type: 'sfx',
      start: 3_000,
      duration: 1_200,
      anchor: 'moment',
      offsetMs: 0,
      volume: 1,
      fadeInMs: 0,
      fadeOutMs: 0,
      duck: false,
    });
    expect(item.id).toMatch(/^snd_/);
    expect(doc.tracks[0]?.kind).toBe('audio');
    expect(clipDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('adds music from the playhead to the clip end on the clip clock, fades on', () => {
    const { item } = added(clip(), 'music', 5_000, 4_000);
    expect(item).toMatchObject({
      type: 'music',
      start: 5_000,
      duration: 15_000,
      anchor: 'clip',
      fadeInMs: SOUND_FADE_MS,
      fadeOutMs: SOUND_FADE_MS,
    });
    expect(item.id).toMatch(/^mus_/);
  });

  it('keeps a sound inside the clip and never longer than what is left', () => {
    const { item } = added(clip(), 'sfx', 19_500, 3_000);
    expect(item.start + item.duration).toBeLessThanOrEqual(outputDuration(clip()));
    expect(item.duration).toBeGreaterThanOrEqual(100);
  });

  it('puts overlapping sounds on their own rows', () => {
    const first = added(clip(), 'sfx', 1_000, 2_000);
    const second = added(first.doc, 'sfx', 1_500, 2_000);
    expect(second.doc.tracks.filter((track) => track.kind === 'audio')).toHaveLength(2);
  });

  it('refuses the 21st sound', () => {
    let doc = clip();
    for (let k = 0; k < MAX_SOUNDS; k += 1) {
      doc = added(doc, 'sfx', (k % 10) * 1_000, 500).doc;
    }
    expect(countSounds(doc)).toBe(MAX_SOUNDS);
    expect(addSound(doc, LIBRARY, 'sfx', 0, { durationMs: 500 })).toEqual({
      ok: false,
      code: 'too_many_sounds',
    });
  });

  it('updates volume, fades and the start in the file, each kept in range', () => {
    const { doc, item } = added(clip(), 'music', 0, 4_000);
    const result = updateSound(doc, item.id, { volume: 2.456, fadeInMs: 9_000, fadeOutMs: -5, offsetMs: 1_234.4 });
    if (!result.ok) throw new Error(result.code);
    const next = findItem(result.doc, item.id)?.item as AudioItem;
    expect(next.volume).toBe(2);
    expect(next.fadeInMs).toBe(5_000);
    expect(next.fadeOutMs).toBe(0);
    expect(next.offsetMs).toBe(1_234);
    // Nothing changed: the same document.
    const same = updateSound(result.doc, item.id, { volume: 2 });
    expect(same.ok && same.doc).toBe(result.doc);
  });

  it('removes only sounds', () => {
    const { doc, item } = added(clip(), 'sfx', 0, 500);
    const removed = removeSound(doc, item.id);
    expect(removed.ok && countSounds(removed.doc)).toBe(0);
    expect(removeSound(doc, 'nope')).toEqual({ ok: false, code: 'item_not_found' });
  });

  it('lists each sound file once, by its key', () => {
    let { doc } = added(clip(), 'sfx', 0, 500);
    doc = added(doc, 'sfx', 600, 500).doc;
    doc = added(doc, 'music', 0, 4_000).doc;
    expect(soundFilesNeeded(doc)).toEqual([
      { key: soundRefKey(LIBRARY), library: LIBRARY.id },
      { key: soundRefKey(UPLOAD), asset: UPLOAD.asset },
    ]);
    expect(soundRefKey(LIBRARY)).toBe(`library:${LIBRARY.id}`);
    expect(soundRefKey(UPLOAD)).toBe(`asset:${UPLOAD.asset}`);
  });
});

describe('the volume and fade curve', () => {
  const item = { volume: 0.8, fadeInMs: 1_000, fadeOutMs: 500, duration: 4_000 };

  it('is the volume times straight fades, silent outside the item', () => {
    expect(soundGainAt(item, -1)).toBe(0);
    expect(soundGainAt(item, 0)).toBe(0);
    expect(soundGainAt(item, 250)).toBeCloseTo(0.2, 12);
    expect(soundGainAt(item, 1_000)).toBeCloseTo(0.8, 12);
    expect(soundGainAt(item, 3_750)).toBeCloseTo(0.4, 12);
    expect(soundGainAt(item, 4_000)).toBe(0);
  });

  it('is what frameState plays, times the clip fade', () => {
    const doc = testDocument([testSegment('a', 0, 10_000)], { fadeInMs: 2_000 });
    const { doc: withSound, item: sound } = added(doc, 'sfx', 1_000, 3_000);
    const state = frameState(withSound, 1_500);
    expect(state.sounds).toHaveLength(1);
    expect(state.sounds[0]).toMatchObject({ id: sound.id, refKey: soundRefKey(LIBRARY), loop: false, fileMs: 500 });
    // Fade in of the clip at 1.5 s of 2 s is 0.75; the effect has no fades.
    expect(state.sounds[0]?.gain).toBeCloseTo(0.75, 12);
  });

  it('wraps music and stops an effect at its file end', () => {
    expect(soundFileMsAt({ type: 'music', offsetMs: 1_000 }, 3_500, 4_000)).toBe(500);
    expect(soundFileMsAt({ type: 'sfx', offsetMs: 1_000 }, 2_999, 4_000)).toBe(3_999);
    expect(soundFileMsAt({ type: 'sfx', offsetMs: 1_000 }, 3_000, 4_000)).toBeNull();
    expect(soundFileMsAt({ type: 'sfx', offsetMs: 0 }, 9_000, null)).toBe(9_000);
  });

  it('lets music run to the clip end but an effect only to its file end', () => {
    expect(soundMaxDuration({ type: 'music', offsetMs: 0, start: 2_000 }, 1_000, 20_000)).toBe(18_000);
    expect(soundMaxDuration({ type: 'sfx', offsetMs: 500, start: 2_000 }, 1_500, 20_000)).toBe(1_000);
  });
});

describe('the video volume', () => {
  it('sets one part, or every part, from 0 to 200%', () => {
    const doc = clip();
    const one = setSegmentVolume(doc, 'b', 1.5);
    expect(one.segments.map((segment) => segment.volume)).toEqual([1, 1.5]);
    expect(videoVolumeOf(one, null)).toBeNull();
    expect(videoVolumeOf(one, 'b')).toBe(1.5);
    const all = setVideoVolume(one, 3);
    expect(all.segments.map((segment) => segment.volume)).toEqual([2, 2]);
    expect(videoVolumeOf(all, null)).toBe(2);
    expect(setVideoVolume(all, 2)).toBe(all);
    expect(setSegmentVolume(all, 'a', Number.NaN)).toBe(all);
    expect(clipDocumentSchema.safeParse(setVideoVolume(doc, 0)).success).toBe(true);
  });

  it('is the video gain frameState plays', () => {
    const doc = setVideoVolume(clip(), 1.5);
    expect(frameState(doc, 1_000).videoGain).toBeCloseTo(1.5, 12);
  });

  it('builds the default item without adding it', () => {
    const item = defaultSoundItem(clip(), Number.NaN, LIBRARY, 'sfx', { durationMs: 40 });
    expect(item.start).toBe(0);
    expect(item.duration).toBe(100);
  });
});
