/**
 * A finished job's facts, per kind (Module 15 section 3): which provider did
 * it, the units it used, and whether any unit was estimated.
 */
import {
  type CostContext,
  type CostJob,
  costFacts,
  readTokens,
  translateTokens,
} from './clip-cost.facts';
import { CLIP_PRICES_DATE } from './clip-prices';

const START = new Date('2026-11-28T10:00:00.000Z');
const after = (seconds: number) => new Date(START.getTime() + seconds * 1000);

function job(overrides: Partial<CostJob>): CostJob {
  return {
    kind: 'IMPORT',
    status: 'DONE',
    stage: null,
    input: {},
    output: null,
    startedAt: START,
    finishedAt: after(10),
    ...overrides,
  };
}

const context = (overrides: Partial<CostContext> = {}): CostContext => ({
  aiModel: 'openai:gpt-4.1-mini',
  videoDurationMs: 600_000,
  storedBytes: null,
  run: null,
  ...overrides,
});

describe('costFacts', () => {
  it('records an import: FFmpeg on our box, 2 vCPU, the first month of its files', () => {
    const facts = costFacts(
      job({ output: { durationMs: 600_000, assets: 6 } }),
      context({ storedBytes: 900_000_000 }),
    );
    expect(facts).toEqual({
      videoSeconds: 600,
      ranSeconds: 10,
      provider: 'ffmpeg',
      units: { processorSeconds: 20, storedGbMonths: 0.9 },
      estimated: false,
      prices: CLIP_PRICES_DATE,
    });
  });

  it('takes a failed import length from the video and counts no storage', () => {
    const facts = costFacts(job({ status: 'FAILED', output: null }), context());
    expect(facts.videoSeconds).toBe(600);
    expect(facts.units).toEqual({ processorSeconds: 20 });
  });

  it('counts nothing run for a job that never started', () => {
    const facts = costFacts(job({ status: 'CANCELLED', startedAt: null }), context());
    expect(facts.ranSeconds).toBe(0);
    expect(facts.units.processorSeconds).toBe(0);
  });

  it('records a sharp copy over its range', () => {
    const facts = costFacts(
      job({ kind: 'SEGMENT', input: { fromMs: 5_000, toMs: 65_000 } }),
      context({ storedBytes: 50_000_000 }),
    );
    expect(facts.videoSeconds).toBe(60);
    expect(facts.units).toEqual({ processorSeconds: 20, storedGbMonths: 0.05 });
  });

  it('records an export on a 4 vCPU slot with a month of its file, a preview with a day', () => {
    const exportFacts = costFacts(
      job({
        kind: 'RENDER',
        input: { proof: false },
        output: { durationMs: 30_000, bytes: 30_000_000 },
        finishedAt: after(60),
      }),
      context(),
    );
    expect(exportFacts).toMatchObject({
      videoSeconds: 30,
      ranSeconds: 60,
      provider: 'ffmpeg',
      units: { processorSeconds: 240, storedGbMonths: 0.03 },
      estimated: false,
    });
    const preview = costFacts(
      job({
        kind: 'RENDER',
        input: { proof: true },
        output: { durationMs: 30_000, bytes: 3_000_000 },
      }),
      context(),
    );
    expect(preview.units.storedGbMonths).toBe(0.0001);
  });

  it('records a download with one day of its file', () => {
    const facts = costFacts(
      job({ kind: 'DOWNLOAD', input: { durationMs: 120_000 }, output: { bytes: 300_000_000 } }),
      context(),
    );
    expect(facts.videoSeconds).toBe(120);
    expect(facts.units).toEqual({ processorSeconds: 20, storedGbMonths: 0.01 });
  });

  describe('listening', () => {
    const listened = (model: string) => ({
      transcriptAssetId: null,
      language: 'en',
      wordCount: 10,
      noSpeech: false,
      secondsListened: 120,
      model,
    });

    it('takes the listener from the output: a hosted one bills audio seconds, no processor', () => {
      const facts = costFacts(
        job({ kind: 'TRANSCRIBE', output: listened('groq:whisper-large-v3-turbo') }),
        context(),
      );
      expect(facts).toMatchObject({
        provider: 'groq:whisper-large-v3-turbo',
        videoSeconds: 120,
        units: { audioSeconds: 120, processorSeconds: 0 },
        estimated: false,
      });
    });

    it('prices our own listener by the seconds it ran on every thread', () => {
      const facts = costFacts(
        job({ kind: 'TRANSCRIBE', output: listened('faster-whisper:small') }),
        context(),
      );
      expect(facts).toMatchObject({
        provider: 'faster-whisper:small',
        units: { audioSeconds: 120, processorSeconds: 80 },
        estimated: false,
      });
    });

    it('prices the stand-in as our own box at research 07 speed, estimated', () => {
      const facts = costFacts(
        job({ kind: 'TRANSCRIBE', output: listened('simulation') }),
        context(),
      );
      expect(facts).toMatchObject({
        provider: 'simulation',
        units: { audioSeconds: 120, processorSeconds: 960 },
        estimated: true,
      });
    });

    it('prices a failed listen with no output as our own box over the asked ranges, estimated', () => {
      const facts = costFacts(
        job({
          kind: 'TRANSCRIBE',
          status: 'FAILED',
          input: {
            ranges: [
              { fromMs: 0, toMs: 60_000 },
              { fromMs: 120_000, toMs: 150_000 },
            ],
          },
        }),
        context(),
      );
      expect(facts).toMatchObject({
        provider: 'unknown',
        videoSeconds: 90,
        units: { audioSeconds: 90, processorSeconds: 80 },
        estimated: true,
      });
    });
  });

  describe('Find Clips', () => {
    const run = { readMs: 1_800_000, vision: false, listenOverlapSeconds: 4 };

    it('is FFmpeg alone for Quick Find (no setup)', () => {
      const facts = costFacts(
        job({ kind: 'HIGHLIGHTS', output: { found: 5 } }),
        context({ run: null }),
      );
      expect(facts).toMatchObject({
        provider: 'ffmpeg',
        videoSeconds: 600,
        units: { processorSeconds: 20 },
        estimated: false,
      });
    });

    it('is the AI engine when it read: tokens for the stretch, less its listening wait', () => {
      const facts = costFacts(
        job({
          kind: 'HIGHLIGHTS',
          output: { found: 5, ai: { read: true, noSpeech: false, asked: false, matched: 0 } },
        }),
        context({ run }),
      );
      expect(facts).toEqual({
        videoSeconds: 1800,
        ranSeconds: 10,
        provider: 'openai:gpt-4.1-mini',
        units: { processorSeconds: 12, tokensIn: 16_000, tokensOut: 2_500 },
        estimated: true,
        prices: CLIP_PRICES_DATE,
      });
    });

    it('reads nothing when no one spoke', () => {
      const facts = costFacts(
        job({
          kind: 'HIGHLIGHTS',
          output: { found: 2, ai: { read: false, noSpeech: true, asked: false, matched: 0 } },
        }),
        context({ run }),
      );
      expect(facts.provider).toBe('ffmpeg');
      expect(facts.units.tokensIn).toBeUndefined();
      expect(facts.estimated).toBe(false);
    });

    it('counts the vision check pictures when it looked', () => {
      const facts = costFacts(
        job({
          kind: 'HIGHLIGHTS',
          output: {
            found: 5,
            ai: {
              read: true,
              noSpeech: false,
              asked: false,
              matched: 0,
              watched: true,
              actions: 2,
            },
          },
        }),
        context({ run: { ...run, vision: true }, aiModel: 'simulation' }),
      );
      expect(facts.provider).toBe('simulation');
      expect(facts.units.pictures).toBe(48);
    });

    it('counts a failed run as read once it reached the reading stage', () => {
      const reading = costFacts(
        job({ kind: 'HIGHLIGHTS', status: 'FAILED', stage: 'reading' }),
        context({ run }),
      );
      expect(reading.units.tokensIn).toBe(16_000);
      expect(reading.estimated).toBe(true);
      const early = costFacts(
        job({ kind: 'HIGHLIGHTS', status: 'FAILED', stage: 'loudness' }),
        context({ run }),
      );
      expect(early.units.tokensIn).toBeUndefined();
    });
  });

  it('records faces and the voice on the media service, 4 vCPU', () => {
    const faces = costFacts(job({ kind: 'FACES', input: { fromMs: 0, toMs: 45_000 } }), context());
    expect(faces).toMatchObject({
      provider: 'media-service',
      videoSeconds: 45,
      units: { processorSeconds: 40 },
    });
    const voice = costFacts(job({ kind: 'SPEECH', output: { durationMs: 2_000 } }), context());
    expect(voice).toMatchObject({
      provider: 'media-service',
      videoSeconds: 2,
      units: { processorSeconds: 40 },
    });
  });

  it('records a translation as model tokens, estimated', () => {
    const facts = costFacts(
      job({ kind: 'TRANSLATE', input: { fromMs: 0, toMs: 60_000 } }),
      context({ aiModel: null }),
    );
    expect(facts).toMatchObject({
      provider: 'unknown',
      videoSeconds: 60,
      units: { tokensIn: 200, tokensOut: 200 },
      estimated: true,
    });
  });

  it('records nothing of its own for Auto-Edit', () => {
    const facts = costFacts(
      job({ kind: 'AUTO_EDIT', input: { range: { fromMs: 0, toMs: 90_000 } } }),
      context(),
    );
    expect(facts).toMatchObject({ provider: 'api', videoSeconds: 90 });
    expect(facts.units).toEqual({});
  });

  it('records an emote with one day of the files it kept', () => {
    const facts = costFacts(
      job({
        kind: 'EMOTE',
        input: { startMs: 1_000, endMs: 3_500 },
        output: {
          files: [
            { bytes: 150_000, fits: true },
            { bytes: 900_000, fits: false },
          ],
          zip: { bytes: 150_000 },
        },
      }),
      context(),
    );
    expect(facts.videoSeconds).toBe(2.5);
    expect(facts.units).toEqual({ processorSeconds: 20, storedGbMonths: 0.00001 });
  });

  it('reads old or odd rows without throwing', () => {
    for (const kind of [
      'IMPORT',
      'SEGMENT',
      'HIGHLIGHTS',
      'RENDER',
      'DOWNLOAD',
      'TRANSCRIBE',
      'FACES',
      'TRANSLATE',
      'SPEECH',
      'AUTO_EDIT',
      'EMOTE',
    ] as const) {
      const facts = costFacts(job({ kind, input: 'nonsense', output: [1, 2] }), context());
      expect(Number.isFinite(facts.videoSeconds)).toBe(true);
    }
  });
});

describe('token estimates', () => {
  it('reads an hour twice at 16,000 in and 2,500 out a pass', () => {
    expect(readTokens(3600)).toEqual({ tokensIn: 32_000, tokensOut: 5_000 });
  });

  it('translates a minute as 200 tokens in and 200 out', () => {
    expect(translateTokens(60)).toEqual({ tokensIn: 200, tokensOut: 200 });
  });
});
