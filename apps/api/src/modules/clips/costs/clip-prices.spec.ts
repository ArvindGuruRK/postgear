/**
 * The price table and `estimate` (Module 15 section 3): every figure is
 * pinned, so a drive-by edit fails here, and every figure names where it came
 * from and when it was read.
 */
import {
  CLIP_ESTIMATES,
  CLIP_PRICES,
  CLIP_PRICES_DATE,
  type ClipCostFacts,
  DEFAULT_MODEL,
  estimate,
  KIND_VCPUS,
  LISTENER_PRICES,
  MODEL_PRICES,
  modelPriceOf,
  processorCentsPerSecond,
  roundCents,
  vcpusFor,
} from './clip-prices';

function facts(overrides: Partial<ClipCostFacts>): ClipCostFacts {
  return {
    videoSeconds: 60,
    ranSeconds: 0,
    provider: 'ffmpeg',
    units: {},
    estimated: false,
    prices: CLIP_PRICES_DATE,
    ...overrides,
  };
}

describe('the price table', () => {
  it('pins every figure from research 07 and the hosting guide', () => {
    expect(CLIP_PRICES_DATE).toBe('2026-11-14');
    expect(CLIP_PRICES.eurToUsd.value).toBe(1.1);
    expect(CLIP_PRICES.box.value).toBe(0.1891);
    expect(CLIP_PRICES.boxVcpus.value).toBe(8);
    expect(CLIP_PRICES.railwayVcpuMonth.value).toBe(20);
    expect(CLIP_PRICES.storage.value).toBe(0.015);
    expect(CLIP_PRICES.listenerMinSeconds.value).toBe(10);
    expect(LISTENER_PRICES['groq:whisper-large-v3-turbo']?.value).toBe(0.04);
    expect(LISTENER_PRICES['groq:whisper-large-v3']?.value).toBe(0.111);
    expect(MODEL_PRICES['gpt-4.1-mini']).toMatchObject({ inPerMillion: 0.4, outPerMillion: 1.6 });
    expect(MODEL_PRICES['gpt-6-luna']).toMatchObject({ inPerMillion: 0.1, outPerMillion: 0.5 });
    expect(MODEL_PRICES['gpt-5-mini']).toMatchObject({ inPerMillion: 0.25, outPerMillion: 2 });
    expect(DEFAULT_MODEL).toBe('gpt-4.1-mini');
    expect(CLIP_ESTIMATES.readTokensInPerHour.value).toBe(16_000);
    expect(CLIP_ESTIMATES.readTokensOutPerHour.value).toBe(2_500);
    expect(CLIP_ESTIMATES.readPasses.value).toBe(2);
    expect(CLIP_ESTIMATES.transcriptTokensPerHour.value).toBe(12_000);
    expect(CLIP_ESTIMATES.pictureTokens.value).toBe(500);
    expect(CLIP_ESTIMATES.visionPictures.value).toBe(48);
    expect(CLIP_ESTIMATES.ownListenRealTime.value).toBe(1);
  });

  it('names a source and a checked day for every figure', () => {
    const figures = [
      ...Object.values(CLIP_PRICES),
      ...Object.values(CLIP_ESTIMATES),
      ...Object.values(LISTENER_PRICES),
      ...Object.values(MODEL_PRICES),
    ];
    for (const figure of figures) {
      expect(figure.source.length).toBeGreaterThan(5);
      expect(figure.checked).toMatch(/^2026-11-\d{2}$/);
    }
  });

  it('pins the vCPUs each kind holds', () => {
    expect(KIND_VCPUS).toEqual({
      IMPORT: 2,
      SEGMENT: 2,
      HIGHLIGHTS: 2,
      RENDER: 4,
      DOWNLOAD: 2,
      TRANSCRIBE: 8,
      FACES: 4,
      TRANSLATE: 0,
      SPEECH: 4,
      AUTO_EDIT: 0,
      EMOTE: 2,
    });
    expect(vcpusFor('TRANSCRIBE', 'groq:whisper-large-v3-turbo')).toBe(0);
    expect(vcpusFor('TRANSCRIBE', 'faster-whisper:small')).toBe(8);
  });

  it('prices one vCPU-second at the box hour over 8 vCPU (EUR at 1.10)', () => {
    // 0.1891 EUR x 1.10 = $0.20801 an hour for 8 vCPU.
    expect(processorCentsPerSecond()).toBeCloseTo(0.000722257, 9);
  });
});

describe('modelPriceOf', () => {
  it('reads the model id after the provider prefix and an OpenRouter vendor', () => {
    expect(modelPriceOf('openai:gpt-6-luna').inPerMillion).toBe(0.1);
    expect(modelPriceOf('openrouter:openai/gpt-5-mini').outPerMillion).toBe(2);
  });

  it('prices simulation, unknown and new models as the default model', () => {
    for (const name of ['simulation', 'unknown', 'openai:gpt-9-giant', 'constructor']) {
      expect(modelPriceOf(name)).toBe(MODEL_PRICES[DEFAULT_MODEL]);
    }
  });
});

describe('estimate', () => {
  it('prices a 60 s render at real time on a 4 vCPU slot, with a month of a 20 MB file', () => {
    expect(estimate(facts({ units: { processorSeconds: 240 } }), 'RENDER')).toBe(0.1733);
    expect(
      estimate(facts({ units: { processorSeconds: 240, storedGbMonths: 0.02 } }), 'RENDER'),
    ).toBe(0.2033);
  });

  it('works processor seconds out from the run time and the kind when they are left out', () => {
    expect(estimate(facts({ ranSeconds: 100 }), 'IMPORT')).toBe(0.1445);
    expect(estimate(facts({ ranSeconds: 100 }), 'AUTO_EDIT')).toBe(0);
    expect(
      estimate(facts({ ranSeconds: 100, provider: 'groq:whisper-large-v3-turbo' }), 'TRANSCRIBE'),
    ).toBe(0);
  });

  it('prices a hosted listener per audio hour, at least 10 seconds', () => {
    const groq = { provider: 'groq:whisper-large-v3-turbo' };
    expect(
      estimate(facts({ ...groq, units: { audioSeconds: 600, processorSeconds: 0 } }), 'TRANSCRIBE'),
    ).toBe(0.6667);
    expect(
      estimate(facts({ ...groq, units: { audioSeconds: 4, processorSeconds: 0 } }), 'TRANSCRIBE'),
    ).toBe(0.0111);
    expect(
      estimate(
        facts({
          provider: 'groq:whisper-large-v3',
          units: { audioSeconds: 3600, processorSeconds: 0 },
        }),
        'TRANSCRIBE',
      ),
    ).toBe(11.1);
  });

  it('never prices audio seconds for our own listener (its processor seconds are the cost)', () => {
    expect(
      estimate(
        facts({
          provider: 'faster-whisper:small',
          units: { audioSeconds: 600, processorSeconds: 0 },
        }),
        'TRANSCRIBE',
      ),
    ).toBe(0);
  });

  it('prices an hour read twice on gpt-4.1-mini at 2.08 cents, and 48 pictures at 0.96', () => {
    const read = facts({
      provider: 'openai:gpt-4.1-mini',
      units: { processorSeconds: 0, tokensIn: 32_000, tokensOut: 5_000 },
      estimated: true,
    });
    expect(estimate(read, 'HIGHLIGHTS')).toBe(2.08);
    expect(
      estimate(
        facts({ provider: 'simulation', units: { processorSeconds: 0, pictures: 48 } }),
        'HIGHLIGHTS',
      ),
    ).toBe(0.96);
  });

  it('prices tokens on the model that ran', () => {
    expect(
      estimate(
        facts({
          provider: 'openai:gpt-6-luna',
          units: { tokensIn: 1_000_000, tokensOut: 1_000_000 },
        }),
        'TRANSLATE',
      ),
    ).toBe(60);
  });

  it('ignores negative, missing and non-finite units', () => {
    expect(
      estimate(
        facts({
          ranSeconds: Number.NaN,
          units: { storedGbMonths: -1, tokensIn: Number.POSITIVE_INFINITY },
        }),
        'IMPORT',
      ),
    ).toBe(0);
  });

  it('rounds to a micro-dollar', () => {
    expect(roundCents(0.123456)).toBe(0.1235);
    expect(roundCents(0.00004)).toBe(0);
  });
});
