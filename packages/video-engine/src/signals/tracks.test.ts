import {
  binTrack,
  chatMessageTotal,
  chatTrack,
  isCurrentTrack,
  onGrid,
  replayedTrack,
  sampleIndexAt,
  sampleStartMs,
  TRACKS,
  trackSampleCount,
  tracksSentence,
} from './tracks';
import { highlightReasonLabels } from './types';

describe('the grid', () => {
  it('has two samples a second, rounded up', () => {
    expect(trackSampleCount(10_000)).toBe(20);
    expect(trackSampleCount(10_100)).toBe(21);
    expect(trackSampleCount(0)).toBe(0);
    expect(trackSampleCount(Number.NaN)).toBe(0);
  });

  it('maps moments to samples and back', () => {
    expect(sampleIndexAt(1_499)).toBe(2);
    expect(sampleIndexAt(1_500)).toBe(3);
    expect(sampleStartMs(3)).toBe(1_500);
  });
});

describe('binTrack', () => {
  const points = [
    { sec: 0.1, value: 2 },
    { sec: 0.4, value: 5 },
    { sec: 1.6, value: 3 },
    { sec: 99, value: 9 },
    { sec: Number.NaN, value: 1 },
  ];

  it('takes the highest in a half second and drops what is outside the video', () => {
    const track = binTrack('scene', points, 2_000, { combine: 'max', empty: 'null' });
    expect(track.values).toEqual([5, null, null, 3]);
    expect(track).toMatchObject({
      name: 'scene',
      version: TRACKS.scene.version,
      sampleRateHz: 2,
      startSec: 0,
    });
  });

  it('adds, holds or zeroes as asked', () => {
    expect(binTrack('chat', points, 2_000, { combine: 'sum', empty: 'zero' }).values).toEqual([
      7, 0, 0, 3,
    ]);
    expect(binTrack('scene', points, 2_000, { combine: 'max', empty: 'hold' }).values).toEqual([
      5, 5, 5, 3,
    ]);
  });
});

describe('chatTrack', () => {
  it('counts weighted messages a second, from times and weights only', () => {
    const track = chatTrack(
      [
        { offsetMs: 100 },
        { offsetMs: 200, weight: 1.5 },
        { offsetMs: 1_200 },
        { offsetMs: 300, weight: 0 },
      ],
      2_000,
    );
    expect(track.values).toEqual([5, 0, 2, 0]);
    expect(track.unit).toBe('messages_per_second');
    // Nothing but the header and numbers: no name or text can be in it.
    expect(Object.keys(track).sort()).toEqual(
      ['name', 'sampleRateHz', 'startSec', 'unit', 'values', 'version'].sort(),
    );
    expect(track.values.every((value) => typeof value === 'number')).toBe(true);
    expect(chatMessageTotal(track)).toBeCloseTo(3.5);
  });
});

describe('replayedTrack', () => {
  it('reads each sample from the point that covers it', () => {
    const track = replayedTrack(
      [
        { startMs: 0, endMs: 1_000, value: 0.2 },
        { startMs: 1_000, endMs: 2_000, value: 1.4 },
      ],
      3_000,
    );
    expect(track?.values).toEqual([0.2, 0.2, 1, 1, null, null]);
  });

  it('is null with nothing to use', () => {
    expect(replayedTrack(undefined, 3_000)).toBeNull();
    expect(replayedTrack([], 3_000)).toBeNull();
    expect(replayedTrack([{ startMs: 5_000, endMs: 4_000, value: 1 }], 3_000)).toBeNull();
  });
});

describe('onGrid', () => {
  it('reads a track of another rate at each sample middle', () => {
    const tenHz = {
      name: 'loudness' as const,
      version: 1,
      sampleRateHz: 10,
      startSec: 0,
      unit: 'lufs' as const,
      values: Array.from({ length: 20 }, (_, i) => i),
    };
    expect(Array.from(onGrid(tenHz, 4))).toEqual([2, 7, 12, 17]);
  });

  it('turns no data into NaN', () => {
    const track = binTrack('scene', [{ sec: 0, value: 1 }], 1_000, {
      combine: 'max',
      empty: 'null',
    });
    expect(Array.from(onGrid(track, 3))).toEqual([1, Number.NaN, Number.NaN]);
  });
});

describe('versions and words', () => {
  it('only the current version of a known track is reusable', () => {
    expect(isCurrentTrack({ name: 'loudness', version: TRACKS.loudness.version })).toBe(true);
    expect(isCurrentTrack({ name: 'loudness', version: TRACKS.loudness.version + 1 })).toBe(false);
    expect(isCurrentTrack({ name: 'speech', version: 1 })).toBe(false);
  });

  it('names the tracks a run used', () => {
    expect(tracksSentence(['scene', 'loudness'])).toBe('Sound and picture');
    expect(tracksSentence(['chat', 'scene', 'loudness'])).toBe('Sound, picture and chat');
    expect(tracksSentence(['scene'])).toBe('Picture');
    expect(tracksSentence([])).toBe('');
  });

  it('gives reasons their words and drops unknown codes', () => {
    expect(highlightReasonLabels(['chat_burst', 'nope', 'loud'])).toEqual([
      'Chat exploded',
      'Loud reaction',
    ]);
  });
});
