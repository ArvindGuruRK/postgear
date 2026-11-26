/**
 * The still-picture checker (Sprint 13 Clips AI, Module 06).
 */
import type { z } from 'zod';
import { createSimulatedModelClient } from '../model/simulated-model-client';
import { buildStillPrompt, stillVerdictSchema } from '../prompts/stills';
import type { ModelClient, ModelImage, StillCheckBurst } from '../types';
import { checkStills, cleanStillLine, judgeStillAnswer } from './still-checker';

const IMAGE: ModelImage = { mimeType: 'image/jpeg', base64: '/9j/4AAQ' };

function burst(overrides: Partial<StillCheckBurst> = {}): StillCheckBurst {
  return {
    images: [IMAGE, IMAGE, IMAGE, IMAGE],
    momentSec: 63,
    spanSec: 6,
    withSound: true,
    ...overrides,
  };
}

/** A model that answers what it is told and remembers what it was sent. */
function scripted(
  answers: Array<unknown | Error>,
): ModelClient & { sent: Array<{ user: string; images: number }> } {
  const sent: Array<{ user: string; images: number }> = [];
  let call = 0;
  return {
    name: 'scripted',
    sent,
    async structured<T>(params: {
      schema: z.ZodType<T>;
      user: string;
      images?: readonly ModelImage[];
    }) {
      sent.push({ user: params.user, images: params.images?.length ?? 0 });
      const answer = answers[call++];
      if (answer instanceof Error) throw answer;
      return params.schema.parse(answer);
    },
    async *chat() {},
  };
}

describe('the prompt', () => {
  it('asks closed questions and keeps to what is visible (snapshot)', () => {
    expect(buildStillPrompt({ momentSec: 63.4, spanSec: 5.5, withSound: true })).toMatchSnapshot();
  });

  it('is answered in a closed shape', () => {
    expect(
      stillVerdictSchema.safeParse({ isMoment: true, kind: 'boom', sure: 1, line: 'x' }).success,
    ).toBe(false);
  });
});

describe('judging an answer', () => {
  it('drops "nothing notable" and an unsure answer', () => {
    expect(
      judgeStillAnswer({ isMoment: false, kind: 'nothing', sure: 0.9, line: 'A menu.' }).notable,
    ).toBe(false);
    expect(
      judgeStillAnswer({ isMoment: true, kind: 'nothing', sure: 0.9, line: 'A menu.' }).notable,
    ).toBe(false);
    expect(
      judgeStillAnswer({ isMoment: true, kind: 'surprise', sure: 0.4, line: 'A flash.' }).notable,
    ).toBe(false);
  });

  it('keeps a sure event with one clean sentence', () => {
    const verdict = judgeStillAnswer({
      isMoment: true,
      kind: 'crash_or_fall',
      sure: 0.85,
      line: 'a car flips over the ramp and lands on its roof in front of a huge crowd of people',
    });
    expect(verdict.notable).toBe(true);
    expect(verdict.line.split(' ')).toHaveLength(15);
    expect(verdict.line.startsWith('A car')).toBe(true);
    expect(verdict.line.endsWith('.')).toBe(true);
  });

  it('cleans a sentence to one plain line', () => {
    expect(cleanStillLine('  "Boom"\n<b>goes</b> it ')).toBe('Boom bgoes/b it.');
    expect(cleanStillLine('')).toBe('');
  });
});

describe('checkStills', () => {
  it('sends four stills a burst and answers in order', async () => {
    const model = scripted([
      { isMoment: true, kind: 'surprise', sure: 0.9, line: 'The picture bursts.' },
      { isMoment: false, kind: 'nothing', sure: 0.8, line: '' },
    ]);
    const out = await checkStills(model, {
      bursts: [burst(), burst({ momentSec: 120 })],
      concurrency: 1,
    });
    expect(model.sent.map((s) => s.images)).toEqual([4, 4]);
    expect(out.map((v) => v?.notable)).toEqual([true, false]);
  });

  it('answers null for a burst whose call failed, and keeps going', async () => {
    const model = scripted([
      new Error('provider down'),
      { isMoment: true, kind: 'win_or_score', sure: 0.7, line: 'A flash.' },
    ]);
    const out = await checkStills(model, { bursts: [burst(), burst()], concurrency: 1 });
    expect(out[0]).toBeNull();
    expect(out[1]?.notable).toBe(true);
  });

  it('is simulated from the facts: a burst with sound is notable, a silent one is not', async () => {
    const model = createSimulatedModelClient();
    const out = await checkStills(model, { bursts: [burst(), burst({ withSound: false })] });
    expect(out[0]?.notable).toBe(true);
    expect(out[0]?.line.length).toBeGreaterThan(0);
    expect(out[1]?.notable).toBe(false);
    // The same moment always gets the same sentence.
    const again = await checkStills(model, { bursts: [burst()] });
    expect(again[0]).toEqual(out[0]);
  });
});
