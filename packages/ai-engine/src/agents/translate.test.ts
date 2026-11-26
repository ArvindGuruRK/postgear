/**
 * Translate Captions (Sprint 13 Clips AI, Module 03): one line back for each
 * line in, in order, or a typed refusal. Never a line out of step.
 */
import { z } from 'zod';
import { createSimulatedModelClient } from '../model/simulated-model-client';
import type { ModelClient } from '../types';
import { translateLines } from './snippets';

const request = (lines: string[], toCode = 'ta', to = 'Tamil') => ({
  from: 'English',
  to,
  toCode,
  lines,
});

function modelAnswering(answers: string[][]): ModelClient & { asks: number } {
  const client = {
    name: 'test',
    asks: 0,
    async structured<T>(params: { schema: z.ZodType<T> }): Promise<T> {
      const answer = answers[Math.min(client.asks, answers.length - 1)] as string[];
      client.asks += 1;
      return params.schema.parse({ translations: answer });
    },
    // biome-ignore lint/correctness/useYield: never called here.
    async *chat() {
      throw new Error('not used');
    },
  };
  return client as unknown as ModelClient & { asks: number };
}

describe('translateLines', () => {
  it('answers one simulated line for each line, in the script of the language', async () => {
    const model = createSimulatedModelClient();
    const lines = ['So today we cleared the whole gap.', 'Follow @postgear for 3 more'];
    const tamil = await translateLines(model, request(lines));
    expect(tamil.lines).toHaveLength(2);
    expect(tamil.lines[0]).toMatch(/[஀-௿]/);
    expect(tamil.lines[0]?.split(' ')).toHaveLength(7);
    // Mentions and numbers stay as they are.
    expect(tamil.lines[1]).toContain('@postgear');
    expect(tamil.lines[1]).toContain('3');

    const hindi = await translateLines(model, request(lines, 'hi', 'Hindi'));
    expect(hindi.lines[0]).toMatch(/[ऀ-ॿ]/);
    expect(hindi.lines[0]?.endsWith('।')).toBe(true);
  });

  it('is the same answer for the same line every time', async () => {
    const model = createSimulatedModelClient();
    const first = await translateLines(model, request(['Hello there friends']));
    const second = await translateLines(model, request(['Hello there friends']));
    expect(second).toEqual(first);
  });

  it('asks nothing for no lines', async () => {
    const model = modelAnswering([[]]);
    await expect(translateLines(model, request([]))).resolves.toEqual({ lines: [] });
    expect(model.asks).toBe(0);
  });

  it('asks once more when the count is wrong, and takes a right second answer', async () => {
    const model = modelAnswering([['uno'], ['1. uno', '2) dos']]);
    const result = await translateLines(model, request(['one', 'two'], 'es', 'Spanish'));
    // Numbering a model added anyway is taken off.
    expect(result.lines).toEqual(['uno', 'dos']);
    expect(model.asks).toBe(2);
  });

  it('refuses with bad_output when the count is wrong twice, or a line comes back empty', async () => {
    const short = modelAnswering([['uno']]);
    await expect(
      translateLines(short, request(['one', 'two'], 'es', 'Spanish')),
    ).rejects.toMatchObject({ kind: 'bad_output' });
    expect(short.asks).toBe(2);

    const empty = modelAnswering([['uno', '  ']]);
    await expect(
      translateLines(empty, request(['one', 'two'], 'es', 'Spanish')),
    ).rejects.toMatchObject({ kind: 'bad_output' });

    const simulated = createSimulatedModelClient();
    await expect(
      translateLines(simulated, request(['one [simulate:translate-short]', 'two'])),
    ).rejects.toMatchObject({ kind: 'bad_output' });
  });

  it('refuses more lines than one call takes', async () => {
    const model = modelAnswering([[]]);
    const many = Array.from({ length: 401 }, (_, index) => `line ${index}`);
    await expect(translateLines(model, request(many))).rejects.toMatchObject({
      kind: 'bad_output',
    });
    expect(model.asks).toBe(0);
  });
});
