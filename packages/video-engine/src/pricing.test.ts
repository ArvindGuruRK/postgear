import { AI_COST_KINDS, AI_COST_RATES, type AiCostKind, aiMinutesCost } from './pricing';

const MIN = 60_000;

describe('aiMinutesCost', () => {
  it.each<[AiCostKind, number, number]>([
    // signals: 0.25 per video minute, rounded up, at least 1.
    ['signals', 3 * MIN, 1],
    ['signals', 10 * MIN, 3],
    ['signals', 60 * MIN, 15],
    ['signals', 61 * MIN, 16],
    ['signals', 360 * MIN, 90],
    ['signals', 20_000, 1],
    ['signals', 0, 1],
    ['signals', 60 * MIN + 1, 16],
    // listen: 1 per minute, at least 2.
    ['listen', 30_000, 2],
    ['listen', MIN, 2],
    ['listen', 3 * MIN, 3],
    ['listen', 3 * MIN + 1, 4],
    ['listen', 0, 2],
    // read: 0.25 per minute.
    ['read', 10 * MIN, 3],
    // action: 0.5 per minute.
    ['action', 10 * MIN, 5],
    ['action', 11 * MIN, 6],
    // translate: 0.25 per clip minute.
    ['translate', 30_000, 1],
    ['translate', 8 * MIN, 2],
    // voice: 1 per 1,000 characters.
    ['voice', 1_000, 1],
    ['voice', 1_001, 2],
    ['voice', 2_500, 3],
    ['voice', 0, 1],
  ])('%s of %p costs %p', (kind, amount, expected) => {
    expect(aiMinutesCost(kind, amount)).toBe(expected);
  });

  it('has a rate for every kind', () => {
    expect(Object.keys(AI_COST_RATES).sort()).toEqual([...AI_COST_KINDS].sort());
    expect(AI_COST_RATES.voice.unit).toBe('characters');
    expect(AI_COST_RATES.translate.unit).toBe('clip_ms');
  });

  it('refuses amounts that cannot be priced and unknown kinds', () => {
    expect(() => aiMinutesCost('signals', -1)).toThrow(RangeError);
    expect(() => aiMinutesCost('signals', Number.NaN)).toThrow(RangeError);
    expect(() => aiMinutesCost('signals', Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => aiMinutesCost('free' as AiCostKind, MIN)).toThrow(RangeError);
    expect(() => aiMinutesCost('toString' as AiCostKind, MIN)).toThrow(RangeError);
  });
});
