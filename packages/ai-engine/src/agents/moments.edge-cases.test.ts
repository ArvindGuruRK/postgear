/**
 * Sprint 13, Module 16 section 2: the forcing switch `[simulate:model-bad-rows]`.
 *
 * Typed into Clip Setup's "What should we look for?", it reaches the moment
 * picker as the request. Only the simulated model reads it: the first and
 * third pick of every window then name rows past the end of the transcript,
 * so the API's row check has something to drop (its half is
 * `apps/api/src/modules/clips/clips-ai.edge-cases.spec.ts`).
 * Any other model gets it as plain quoted words and nothing in this package
 * treats it specially. The production refusal of `AI_SIMULATION` is
 * `apps/api/src/config/env.security.spec.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import type { z } from 'zod';
import { createSimulatedModelClient, MODEL_BAD_ROWS_SWITCH } from '../model/simulated-model-client';
import { buildMomentPrompt } from '../prompts/moments';
import type { ModelClient, MomentPickRequest } from '../types';
import { pickMoments } from './moments';

const ROWS = [
  'Alright chat, welcome back to the stream, we are live.',
  'Tonight we are going for the speed run record again.',
  'Yesterday we lost it by two seconds, which still hurts.',
  'So let me set up the route real quick.',
  'You know the plan: skip the first bridge, take the tunnel.',
  'Okay, three, two, one, go.',
  'Clean start, we are already ahead of the ghost.',
  'Here comes the tunnel jump, that was so close.',
  'We cleared the whole gap, what a run.',
  'That is the new record, thank you all for watching.',
].map((text, index) => ({ n: index + 1, text }));

function request(overrides: Partial<MomentPickRequest> = {}): MomentPickRequest {
  return {
    windows: [ROWS],
    request: '',
    genre: 'Gaming',
    genreNote: '',
    lengthHint: '20 to 75 seconds',
    language: 'English',
    ...overrides,
  };
}

const exists = (n: number) => ROWS.some((row) => row.n === n);

describe('[simulate:model-bad-rows] under the simulated model', () => {
  it('is the switch name the testing guide lists', () => {
    expect(MODEL_BAD_ROWS_SWITCH).toBe('[simulate:model-bad-rows]');
  });

  it('makes the first and third pick name rows that do not exist, and keeps the second', async () => {
    const model = createSimulatedModelClient();
    const plain = await pickMoments(model, request());
    const forced = await pickMoments(model, request({ request: MODEL_BAD_ROWS_SWITCH }));

    expect(plain.picks).toHaveLength(3);
    expect(forced.picks).toHaveLength(3);
    for (const pick of plain.picks) expect(exists(pick.fromRow) && exists(pick.toRow)).toBe(true);

    const [first, second, third] = forced.picks;
    expect(exists(first?.fromRow ?? 1) || exists(first?.toRow ?? 1)).toBe(false);
    expect(exists(third?.fromRow ?? 1) || exists(third?.toRow ?? 1)).toBe(false);
    // The good one is exactly the pick an ordinary run makes in that place.
    expect(second).toEqual(plain.picks[1]);
  });

  it('is no word to look for: nothing is marked as matching the request', async () => {
    const model = createSimulatedModelClient();
    const forced = await pickMoments(
      model,
      request({ request: `${MODEL_BAD_ROWS_SWITCH} tunnel jump` }),
    );
    // The rest of the request still steers the picks as usual.
    const plain = await pickMoments(model, request({ request: 'tunnel jump' }));
    expect(forced.picks[1]).toEqual(plain.picks[1]);
    const matched = await pickMoments(model, request({ request: MODEL_BAD_ROWS_SWITCH }));
    expect(matched.picks.every((pick) => pick.matchesRequest === false)).toBe(true);
  });

  it('works in every window of a long transcript', async () => {
    const model = createSimulatedModelClient();
    const forced = await pickMoments(
      model,
      request({ windows: [ROWS.slice(0, 5), ROWS.slice(5)], request: MODEL_BAD_ROWS_SWITCH }),
    );
    expect(forced.windows).toBe(2);
    const plain = await pickMoments(model, request({ windows: [ROWS.slice(0, 5), ROWS.slice(5)] }));
    // Each window's first pick (and third, when it has one) is moved past the end.
    expect(forced.picks).toHaveLength(plain.picks.length);
    expect(forced.picks.filter((pick) => !exists(pick.fromRow)).length).toBeGreaterThanOrEqual(2);
    expect(plain.picks.filter((pick) => !exists(pick.fromRow))).toHaveLength(0);
  });
});

describe('[simulate:model-bad-rows] outside simulation', () => {
  it('reaches any other model as quoted words, and its answer is passed on untouched', async () => {
    const seen: string[] = [];
    const answer = {
      picks: [
        {
          fromRow: 2,
          toRow: 4,
          hook: 10,
          standsAlone: 10,
          payoff: 10,
          clarity: 10,
          shareable: 10,
          funny: false,
          matchesRequest: false,
        },
      ],
    };
    const model = {
      name: 'test',
      async structured<T>(params: { schema: z.ZodType<T>; user: string }): Promise<T> {
        seen.push(params.user);
        return params.schema.parse(answer);
      },
      // biome-ignore lint/correctness/useYield: never called here.
      async *chat() {
        throw new Error('not used');
      },
    } as unknown as ModelClient;
    const result = await pickMoments(model, request({ request: MODEL_BAD_ROWS_SWITCH }));
    expect(result.picks.map((pick) => [pick.fromRow, pick.toRow])).toEqual([[2, 4]]);
    expect(seen[0]).toContain(`Request: ${MODEL_BAD_ROWS_SWITCH}`);
    expect(seen[0]).toBe(
      buildMomentPrompt({
        rows: ROWS,
        request: MODEL_BAD_ROWS_SWITCH,
        genre: 'Gaming',
        genreNote: '',
        lengthHint: '20 to 75 seconds',
        language: 'English',
      }).user,
    );
  });

  it('is read by the simulated model client alone in this package', () => {
    const root = path.join(__dirname, '..');
    const readers: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) {
          if (readFileSync(full, 'utf8').includes('model-bad-rows')) {
            readers.push(path.relative(root, full));
          }
        }
      }
    };
    walk(root);
    expect(readers).toEqual([path.join('model', 'simulated-model-client.ts')]);
  });
});
