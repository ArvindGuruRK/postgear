import { aiMinutesCost } from '../pricing';
import type { HighlightRange } from '../signals/types';
import type { Transcript, TranscriptWord } from '../transcript/types';
import {
  type ActionCandidate,
  blendWithSignals,
  CLIP_AIR_MS,
  cleanParts,
  cleanRequest,
  clipSetupSchema,
  defaultClipSetup,
  fitToLength,
  GENRES,
  genreTuning,
  type MomentCandidate,
  type MomentPick,
  momentReasons,
  momentScore,
  rowWindows,
  setupPrice,
  type TitledCandidate,
  type TranscriptRow,
  toCandidate,
  transcriptRows,
  weightedScore,
} from './index';

/** Sentences of four words, one every 6 s from 10 s: rows 1 to N, each 5 s long. */
function talk(sentenceCount: number, startMs = 10_000): Transcript {
  const words: TranscriptWord[] = [];
  for (let s = 0; s < sentenceCount; s += 1) {
    for (let w = 0; w < 4; w += 1) {
      const start = startMs + s * 6_000 + w * 1_250;
      words.push({
        i: words.length,
        start,
        end: start + 1_000,
        text: w === 3 ? `end${s}.` : `word${s}x${w}`,
        sure: 0.9,
      });
    }
  }
  return {
    version: 1,
    language: 'en',
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 1_000_000 }],
    words,
    nextIndex: words.length,
  };
}

const PARTS = { hook: 16, standsAlone: 18, payoff: 12, clarity: 15, shareable: 9 };
function pick(fromRow: number, toRow: number, overrides: Partial<MomentPick> = {}): MomentPick {
  return { fromRow, toRow, parts: PARTS, funny: false, matchesRequest: false, ...overrides };
}

describe('transcript rows and windows', () => {
  it('numbers the sentences of the range in time order', () => {
    const rows = transcriptRows(talk(10), { fromMs: 20_000, toMs: 50_000 });
    expect(rows.map((row) => row.n)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({ from: 22_000, to: 26_750 });
    expect(rows[0]?.text).toBe('word2x0 word2x1 word2x2 end2.');
  });

  it('groups whole rows into overlapping windows that cover every row', () => {
    const rows = transcriptRows(talk(40), { fromMs: 0, toMs: 1_000_000 });
    const windows = rowWindows(rows, { windowMs: 60_000, overlapMs: 20_000 });
    expect(windows.length).toBeGreaterThan(3);
    for (const window of windows) {
      const first = window[0] as TranscriptRow;
      const last = window.at(-1) as TranscriptRow;
      expect(last.to - first.from).toBeLessThanOrEqual(60_000);
    }
    const seen = new Set(windows.flat().map((row) => row.n));
    expect(seen.size).toBe(rows.length);
    // Consecutive windows share rows.
    const a = new Set(windows[0]?.map((row) => row.n));
    expect(windows[1]?.some((row) => a.has(row.n))).toBe(true);
  });
});

describe('picks, scores and reasons', () => {
  const rows = transcriptRows(talk(10), { fromMs: 0, toMs: 1_000_000 });

  it('turns row numbers into a stretch and adds the five parts', () => {
    const candidate = toCandidate(rows, pick(2, 4));
    expect(candidate).toMatchObject({
      fromRow: 2,
      toRow: 4,
      fromMs: 16_000,
      toMs: 32_750,
      score: 70,
    });
  });

  it('drops a pick with rows that do not exist or run backwards, never trusting it', () => {
    expect(toCandidate(rows, pick(0, 3))).toBeNull();
    expect(toCandidate(rows, pick(3, 99))).toBeNull();
    expect(toCandidate(rows, pick(5, 2))).toBeNull();
    expect(toCandidate(rows, pick(1.5, 3))).toBeNull();
  });

  it('holds each part to 0 to 20, so the score never passes 100', () => {
    const parts = cleanParts({
      hook: 50,
      standsAlone: -3,
      payoff: Number.NaN,
      clarity: 12.6,
      shareable: 20,
    });
    expect(parts).toEqual({ hook: 20, standsAlone: 0, payoff: 0, clarity: 13, shareable: 20 });
    expect(momentScore(parts)).toBe(53);
  });

  it('gives plain reasons from the parts, the request first', () => {
    expect(momentReasons({ parts: PARTS, funny: true, matchesRequest: true })).toEqual([
      'matches_request',
      'strong_opening',
      'complete_thought',
      'funny_exchange',
    ]);
    expect(momentReasons({ parts: cleanParts({}), funny: false, matchesRequest: false })).toEqual(
      [],
    );
  });
});

describe('fitting to a length', () => {
  const transcript = talk(30);
  const rows = transcriptRows(transcript, { fromMs: 0, toMs: 1_000_000 });
  const options = { durationMs: 600_000, range: { fromMs: 0, toMs: 600_000 } };
  const candidate = toCandidate(rows, pick(5, 5)) as MomentCandidate;

  it('grows a short moment by whole rows, after it first, and always on a sentence', () => {
    const fitted = fitToLength(candidate, rows, '30to60', options);
    if (!fitted) throw new Error('Not fitted');
    expect(fitted.fromRow).toBe(5);
    expect(fitted.toRow).toBeGreaterThan(5);
    const head = rows.find((row) => row.n === fitted.fromRow) as TranscriptRow;
    const tail = rows.find((row) => row.n === fitted.toRow) as TranscriptRow;
    expect(fitted.fromMs).toBe(head.from - CLIP_AIR_MS);
    expect(fitted.toMs).toBe(tail.to + CLIP_AIR_MS);
    expect(tail.to - head.from).toBeGreaterThanOrEqual(30_000);
    expect(tail.to - head.from).toBeLessThanOrEqual(60_000);
  });

  it('shrinks a long moment from its end, keeping the opening row', () => {
    const long = toCandidate(rows, pick(3, 20)) as MomentCandidate;
    const fitted = fitToLength(long, rows, 'under30', options);
    expect(fitted?.fromRow).toBe(3);
    expect((fitted?.toMs ?? 0) - (fitted?.fromMs ?? 0)).toBeLessThanOrEqual(
      30_000 + 2 * CLIP_AIR_MS,
    );
  });

  it('never leaves the chosen stretch', () => {
    const fitted = fitToLength(candidate, rows, '60to90', {
      durationMs: 600_000,
      range: { fromMs: 30_000, toMs: 70_000 },
    });
    expect(fitted?.fromMs).toBeGreaterThanOrEqual(30_000);
    expect(fitted?.toMs).toBeLessThanOrEqual(70_000);
  });
});

describe('genre and blending', () => {
  const rows = transcriptRows(talk(30), { fromMs: 0, toMs: 1_000_000 });
  const titled = (
    from: number,
    to: number,
    overrides: Partial<MomentPick> = {},
  ): TitledCandidate => ({
    ...(toCandidate(rows, pick(from, to, overrides)) as MomentCandidate),
    title: `Moment ${from}`,
  });
  const loud: HighlightRange = {
    fromMs: 60_000,
    toMs: 80_000,
    peakMs: 70_000,
    score: 90,
    reasons: ['loud'],
  };

  it('keeps auto neutral: the weighted score is the plain sum', () => {
    expect(genreTuning('auto').note).toBe('');
    const candidate = titled(2, 4);
    expect(weightedScore(candidate, genreTuning('auto'))).toBe(candidate.score);
    for (const genre of GENRES) expect(genreTuning(genre).weights.hook).toBeGreaterThan(0);
  });

  it('lets gaming weigh a loud moment above a quiet one that scores the same, unlike podcast', () => {
    // Rows 9 to 12 sit on the loud highlight (58 s to 81 s); rows 20 to 23 are quiet.
    const onLoud = titled(9, 12);
    const quiet = titled(20, 23);
    const gaming = blendWithSignals([quiet, onLoud], [loud], genreTuning('gaming'));
    expect(gaming[0]?.fromMs).toBe(onLoud.fromMs);
    const podcast = blendWithSignals([quiet, onLoud], [], genreTuning('podcast'));
    expect(podcast[0]?.score).toBe(podcast[1]?.score);
  });

  it('shows a moment found by speech and by signals once, with both kinds of reasons', () => {
    const blended = blendWithSignals([titled(9, 12)], [loud], genreTuning('auto'));
    expect(blended).toHaveLength(1);
    expect(blended[0]?.reasons).toEqual(['strong_opening', 'complete_thought', 'loud']);
    expect(blended[0]?.origin).toBe('AI_TRANSCRIPT');
  });

  it('keeps a strong wordless signal moment as its own clip, and drops a weak one', () => {
    const weak: HighlightRange = { ...loud, fromMs: 300_000, toMs: 320_000, score: 40 };
    const strong: HighlightRange = { ...loud, fromMs: 400_000, toMs: 420_000, score: 88 };
    const blended = blendWithSignals([titled(2, 4)], [weak, strong], genreTuning('auto'));
    expect(blended.map((clip) => clip.origin)).toEqual(['AI_SIGNALS', 'AI_TRANSCRIPT']);
  });

  it('blends bursts of movement as a third input', () => {
    const speech = titled(9, 12);
    const burstInside: ActionCandidate = {
      fromMs: speech.fromMs - 5_000,
      toMs: speech.toMs,
      peakMs: speech.fromMs + 2_000,
      score: 80,
      reason: 'something_unexpected',
      seen: 'A car flips over a ramp.',
    };
    const alone: ActionCandidate = {
      fromMs: 300_000,
      toMs: 318_000,
      peakMs: 308_000,
      score: 70,
      reason: 'sudden_movement',
      seen: null,
    };
    const weak: ActionCandidate = {
      ...alone,
      fromMs: 400_000,
      toMs: 418_000,
      peakMs: 408_000,
      score: 20,
    };
    const without = blendWithSignals([speech], [], genreTuning('auto'));
    const blended = blendWithSignals([speech], [], genreTuning('auto'), 20, [
      burstInside,
      alone,
      weak,
    ]);
    // Inside a transcript pick: its reason and sentence join that clip, and it scores a little higher.
    const home = blended.find((clip) => clip.origin === 'AI_TRANSCRIPT');
    expect(home?.reasons[0]).toBe('something_unexpected');
    expect(home?.seen).toBe('A car flips over a ramp.');
    expect(home?.score).toBe((without[0]?.score ?? 0) + 8);
    // Alone and strong enough: its own clip; too weak alone: dropped.
    const own = blended.filter((clip) => clip.origin === 'AI_SIGNALS');
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({
      fromMs: 300_000,
      reasons: ['sudden_movement'],
      seen: null,
      title: null,
    });
  });

  it('puts a moment that matches the request first, and drops near-duplicates', () => {
    const asked = titled(20, 23, { matchesRequest: true, parts: cleanParts({ hook: 5 }) });
    const better = titled(2, 5);
    const overlapping = titled(3, 6);
    const blended = blendWithSignals([better, overlapping, asked], [], genreTuning('auto'));
    expect(blended[0]?.matchesRequest).toBe(true);
    expect(blended[0]?.reasons[0]).toBe('matches_request');
    expect(blended).toHaveLength(2);
  });
});

describe('Clip Setup', () => {
  it('opens on the whole video and accepts its own default', () => {
    const setup = defaultClipSetup(600_000);
    expect(setup.range).toEqual({ fromMs: 0, toMs: 600_000 });
    expect(clipSetupSchema.safeParse(setup).success).toBe(true);
  });

  it('refuses unknown keys and bad values', () => {
    const setup = defaultClipSetup(600_000);
    expect(clipSetupSchema.safeParse({ ...setup, action: true }).success).toBe(true);
    expect(clipSetupSchema.safeParse({ ...setup, extra: 1 }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, genre: 'sports' }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, range: { fromMs: 0, toMs: 2_000 } }).success).toBe(
      false,
    );
  });

  it('opens Module 10: silences, hook title, a recipe and a brand kit', () => {
    const setup = defaultClipSetup(600_000);
    expect(setup).toMatchObject({
      silences: false,
      hookTitle: false,
      recipeId: null,
      brandKitId: null,
    });
    const kit = '0b3e4c1a-2f5d-4e6a-9b7c-8d9e0f1a2b3c';
    for (const recipeId of ['starter-social-edit', kit, null]) {
      expect(
        clipSetupSchema.safeParse({
          ...setup,
          silences: true,
          hookTitle: true,
          recipeId,
          brandKitId: kit,
        }).success,
      ).toBe(true);
    }
    expect(clipSetupSchema.safeParse({ ...setup, recipeId: 'bad id!' }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, recipeId: 'x'.repeat(65) }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, recipeId: '' }).success).toBe(false);
    // A Studio kit id: a uuid, or a readable one for a kit seeded by hand; never free text.
    expect(
      clipSetupSchema.safeParse({ ...setup, brandKitId: 'seed-brand-kit-lotus' }).success,
    ).toBe(true);
    expect(clipSetupSchema.safeParse({ ...setup, brandKitId: 'kit one' }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, brandKitId: '' }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, silences: 'yes' }).success).toBe(false);
    expect(clipSetupSchema.safeParse({ ...setup, hookTitle: null }).success).toBe(false);
  });

  it('still reads a setup stored before Module 10', () => {
    const stored = {
      range: { fromMs: 0, toMs: 600_000 },
      language: 'auto',
      request: '',
      genre: 'auto',
      length: 'auto',
      ratio: '9:16',
      captions: { on: false, styleId: 'bold-pop' },
      action: false,
      follow: false,
      silences: false,
      hookTitle: false,
      recipeId: null,
      brandKitId: null,
    };
    expect(clipSetupSchema.safeParse(stored).success).toBe(true);
    // Prices do not change: silences and hook titles are free.
    expect(setupPrice({ ...stored, action: false }, 3)).toEqual(
      setupPrice(defaultClipSetup(600_000), 3),
    );
  });

  it('takes Follow The Speaker on a vertical, portrait or square shape, never a wide one', () => {
    const setup = defaultClipSetup(600_000);
    expect(setup.follow).toBe(false);
    for (const ratio of ['9:16', '4:5', '1:1'] as const) {
      expect(clipSetupSchema.safeParse({ ...setup, ratio, follow: true }).success).toBe(true);
    }
    const wide = clipSetupSchema.safeParse({ ...setup, ratio: '16:9', follow: true });
    expect(wide.success).toBe(false);
    expect(wide.error?.issues[0]?.path).toEqual(['follow']);
    // Off is fine on any shape.
    expect(clipSetupSchema.safeParse({ ...setup, ratio: '16:9', follow: false }).success).toBe(
      true,
    );
    expect(clipSetupSchema.safeParse({ ...setup, follow: 'yes' }).success).toBe(false);
  });

  it('Follow The Speaker is free: the price does not change', () => {
    const setup = defaultClipSetup(600_000);
    const following = { ...setup, follow: true };
    expect(setupPrice(following, 4)).toEqual(setupPrice(setup, 4));
  });

  it('prices each step from the same rates the charge uses', () => {
    const setup = { ...defaultClipSetup(600_000), range: { fromMs: 0, toMs: 600_000 } };
    expect(setupPrice(setup, 10)).toEqual({
      lines: [
        { step: 'listen', aiMinutes: 10 },
        { step: 'read', aiMinutes: aiMinutesCost('read', 600_000) },
        { step: 'signals', aiMinutes: 0 },
      ],
      total: 10 + aiMinutesCost('read', 600_000),
      rangeMs: 600_000,
    });
    // Already listened to: sound and picture are priced as Sprint 12's Find Clips.
    const covered = setupPrice(setup, 0);
    expect(covered.lines.find((line) => line.step === 'signals')?.aiMinutes).toBe(
      aiMinutesCost('signals', 600_000),
    );
    // Half the stretch costs less to read.
    const half = setupPrice({ ...setup, range: { fromMs: 0, toMs: 300_000 } }, 0);
    expect(half.total).toBeLessThan(covered.total);
  });

  it('adds Looking For Action at half an AI minute a minute of the stretch', () => {
    const setup = { ...defaultClipSetup(600_000), action: true };
    const price = setupPrice(setup, 0);
    expect(price.lines.at(-1)).toEqual({ step: 'action', aiMinutes: 5 });
    expect(price.total).toBe(setupPrice({ ...setup, action: false }, 0).total + 5);
    // A short stretch still costs its minimum of one.
    expect(
      setupPrice({ ...setup, range: { fromMs: 0, toMs: 10_000 } }, 0).lines.at(-1)?.aiMinutes,
    ).toBe(1);
  });

  it('cleans a request to one bounded line', () => {
    expect(cleanRequest('  funny\\n\\tmoments \u0000 please ')).toBe('funny\\n\\tmoments please');
    expect(cleanRequest('a\nb\tc')).toBe('a b c');
    expect(cleanRequest('x'.repeat(400))).toHaveLength(300);
  });
});
