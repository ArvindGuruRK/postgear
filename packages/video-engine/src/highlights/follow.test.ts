import type { SignalTrack } from '../signals/types';
import type { Transcript, TranscriptWord } from '../transcript/types';
import {
  canFollow,
  FOLLOW_FACES_TOP,
  followFacesClipIds,
  sceneCutsMs,
  speechSpansIn,
} from './index';
import { SPEECH_JOIN_GAP_MS } from '../reframe/tuning';

function scene(values: Array<number | null>, startSec = 0, sampleRateHz = 2): SignalTrack {
  return { name: 'scene', version: 1, sampleRateHz, startSec, unit: 'scene_score', values };
}

function word(i: number, start: number, end: number): TranscriptWord {
  return { i, start, end, text: 'word', sure: 0.9 };
}

function heard(
  words: TranscriptWord[],
  covered = [{ fromMs: 0, toMs: 600_000 }],
): Pick<Transcript, 'words' | 'covered'> {
  return { words, covered };
}

describe('canFollow', () => {
  it('follows tall and square shapes, never a wide one', () => {
    expect(canFollow('9:16')).toBe(true);
    expect(canFollow('4:5')).toBe(true);
    expect(canFollow('1:1')).toBe(true);
    expect(canFollow('16:9')).toBe(false);
  });
});

describe('sceneCutsMs', () => {
  it('answers each cut once, at its first sample, inside the stretch', () => {
    // Samples every 500 ms: a cut at 1.0 s held for two samples, one under the level, one at 4.0 s.
    const track = scene([0, 1, 40, 40, 3, 9.9, 2, 2, 12, 0]);
    expect(sceneCutsMs(track, 0, 10_000)).toEqual([1_000, 4_000]);
    expect(sceneCutsMs(track, 1_500, 10_000)).toEqual([4_000]);
    // The end is not inside the stretch.
    expect(sceneCutsMs(track, 0, 4_000)).toEqual([1_000]);
  });

  it('reads a track on its own start and rate', () => {
    expect(sceneCutsMs(scene([0, 30, 0], 10, 1), 0, 60_000)).toEqual([11_000]);
  });

  it('a gap in the track ends a held cut, and no track means no cuts', () => {
    expect(sceneCutsMs(scene([20, null, 20]), 0, 10_000)).toEqual([0, 1_000]);
    expect(sceneCutsMs(null, 0, 10_000)).toEqual([]);
    expect(sceneCutsMs(scene([20]), 5_000, 5_000)).toEqual([]);
  });
});

describe('speechSpansIn', () => {
  it('joins words closer than the join gap and clips to the stretch', () => {
    const gapStart = 2_000 + SPEECH_JOIN_GAP_MS;
    const transcript = heard([
      word(0, 1_000, 1_400),
      word(1, 1_600, 2_000), // 200 ms gap: joined
      word(2, gapStart, gapStart + 500), // exactly the gap: a new stretch
      word(3, 5_000, 6_000),
    ]);
    expect(speechSpansIn(transcript, 1_200, 5_500)).toEqual([
      { from: 1_200, to: 2_000 },
      { from: gapStart, to: gapStart + 500 },
      { from: 5_000, to: 5_500 },
    ]);
  });

  it('is null when nothing in the stretch was listened to, and [] when nobody spoke', () => {
    const transcript = heard([word(0, 1_000, 2_000)], [{ fromMs: 0, toMs: 30_000 }]);
    expect(speechSpansIn(transcript, 60_000, 90_000)).toBeNull();
    expect(speechSpansIn(transcript, 10_000, 20_000)).toEqual([]);
    expect(speechSpansIn(heard([], []), 0, 10_000)).toBeNull();
  });

  it('never carries the words themselves', () => {
    const spans = speechSpansIn(heard([word(0, 0, 500)]), 0, 1_000) ?? [];
    expect(spans.every((span) => Object.keys(span).join() === 'from,to')).toBe(true);
  });
});

describe('followFacesClipIds', () => {
  it('takes the best three by score, a clip with no score last', () => {
    const clips = [
      { id: 'a', score: 40 },
      { id: 'b', score: null },
      { id: 'c', score: 90 },
      { id: 'd', score: 70 },
      { id: 'e', score: 10 },
    ];
    expect(FOLLOW_FACES_TOP).toBe(3);
    expect(followFacesClipIds(clips)).toEqual(['c', 'd', 'a']);
    expect(followFacesClipIds(clips.slice(0, 2))).toEqual(['a', 'b']);
    expect(followFacesClipIds([])).toEqual([]);
  });
});
