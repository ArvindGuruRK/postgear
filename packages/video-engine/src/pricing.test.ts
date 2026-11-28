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

/**
 * The AI Minutes audit (Sprint 13, Module 15 section 4): the rate table of
 * the brief, pinned whole. A drive-by edit of a rate, a unit, a minimum or
 * the rounding fails here by name; a new paid step must be added here first.
 * The API charges and the web labels both call `aiMinutesCost`, so this one
 * table is what every button shows and every charge takes.
 */
describe('the AI Minutes rate table (Module 15 audit)', () => {
  it('has exactly the six paid steps, in this order', () => {
    expect([...AI_COST_KINDS]).toEqual([
      'signals',
      'listen',
      'read',
      'action',
      'translate',
      'voice',
    ]);
  });

  it('pins every rate, unit and minimum', () => {
    expect(AI_COST_RATES).toEqual({
      signals: { rate: 0.25, unit: 'video_ms', minimum: 1 },
      listen: { rate: 1, unit: 'video_ms', minimum: 2 },
      read: { rate: 0.25, unit: 'video_ms', minimum: 1 },
      action: { rate: 0.5, unit: 'video_ms', minimum: 1 },
      translate: { rate: 0.25, unit: 'clip_ms', minimum: 1 },
      voice: { rate: 1, unit: 'characters', minimum: 1 },
    });
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(AI_COST_RATES)).toBe(true);
    for (const kind of AI_COST_KINDS) expect(Object.isFrozen(AI_COST_RATES[kind])).toBe(true);
    expect(Reflect.set(AI_COST_RATES.listen, 'rate', 0)).toBe(false);
    expect(Reflect.set(AI_COST_RATES, 'faces', { rate: 0, unit: 'video_ms', minimum: 0 })).toBe(
      false,
    );
    expect(aiMinutesCost('listen', 10 * MIN)).toBe(10);
  });

  // Each block is exactly one AI minute at its kind's rate.
  it.each<[AiCostKind, number]>([
    ['signals', 4 * MIN],
    ['listen', MIN],
    ['read', 4 * MIN],
    ['action', 2 * MIN],
    ['translate', 4 * MIN],
    ['voice', 1_000],
  ])('%s: ten blocks of %p cost 10, one unit past them 11', (kind, block) => {
    expect(aiMinutesCost(kind, block)).toBe(Math.max(AI_COST_RATES[kind].minimum, 1));
    expect(aiMinutesCost(kind, block * 10)).toBe(10);
    // One millisecond (or one character) more is the next whole AI minute.
    expect(aiMinutesCost(kind, block * 10 + 1)).toBe(11);
    expect(aiMinutesCost(kind, block * 10 - 1)).toBe(10);
  });

  it('rounds up, never down, and floating point dust never adds a minute', () => {
    // 0.25 x 60 is 15 exactly.
    expect(aiMinutesCost('signals', 60 * MIN)).toBe(15);
    expect(aiMinutesCost('read', 60 * MIN)).toBe(15);
    expect(aiMinutesCost('action', 30 * MIN)).toBe(15);
    // (0.1 + 0.2) x 10,000 is 3000.0000000000005 characters: 3, not 4.
    expect(aiMinutesCost('voice', (0.1 + 0.2) * 10_000)).toBe(3);
    expect(aiMinutesCost('listen', 7 * MIN + 0.4)).toBe(8);
    // 59 seconds of listening is 0.98 minutes: one minute, raised to the minimum of 2.
    expect(aiMinutesCost('listen', 59_000)).toBe(2);
    expect(aiMinutesCost('listen', 2 * MIN + 1)).toBe(3);
  });

  it.each<[AiCostKind, number]>([
    ['signals', 1],
    ['listen', 2],
    ['read', 1],
    ['action', 1],
    ['translate', 1],
    ['voice', 1],
  ])('%s never costs less than %p, even for nothing', (kind, minimum) => {
    expect(AI_COST_RATES[kind].minimum).toBe(minimum);
    expect(aiMinutesCost(kind, 0)).toBe(minimum);
    expect(aiMinutesCost(kind, 1)).toBe(minimum);
  });

  it('prices what the brief says for the blueprint examples', () => {
    // "Find Clips (15 AI Minutes)" for an hour of Sprint 12's Find Clips.
    expect(aiMinutesCost('signals', 60 * MIN)).toBe(15);
    // A 58 minute episode listened to and read: 58 + 15 = 73 ("Find Clips (73 AI Minutes)").
    expect(aiMinutesCost('listen', 58 * MIN) + aiMinutesCost('read', 58 * MIN)).toBe(73);
    // Look For Action on the same 58 minutes: "+29 AI Minutes".
    expect(aiMinutesCost('action', 58 * MIN)).toBe(29);
    // A 45 second clip translated, and a 500 character line spoken: 1 each.
    expect(aiMinutesCost('translate', 45_000)).toBe(1);
    expect(aiMinutesCost('voice', 500)).toBe(1);
  });

  it.each([
    'follow',
    'followSpeaker',
    'faces',
    'detectCamera',
    'camera',
    'srt',
    'uploadSrt',
    'hookTitle',
    'hookTitles',
    'emote',
    'emotes',
    'schedule',
    'schedulePicture',
  ])('the free step %p has no rate and cannot be priced', (step) => {
    expect(AI_COST_KINDS as readonly string[]).not.toContain(step);
    expect(Object.hasOwn(AI_COST_RATES, step)).toBe(false);
    expect(() => aiMinutesCost(step as AiCostKind, MIN)).toThrow(RangeError);
  });
});
