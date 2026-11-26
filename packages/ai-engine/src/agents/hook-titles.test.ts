import { createSimulatedModelClient } from '../model/simulated-model-client';
import {
  buildHookTitlePrompt,
  HOOK_TITLE_AGAIN_LINE,
  HOOK_TEXT_MAX_CHARS,
  HOOK_TITLE_MAX_WORDS,
  hookTitlesSchema,
} from '../prompts/hook-titles';
import { AiProviderError, type ModelClient } from '../types';
import { cleanHookTitle, distinctHookTitles, hookText, writeHookTitles } from './hook-titles';
import { createSnippetWriter } from './snippets';

const model = createSimulatedModelClient();

const SPEECH =
  'The tunnel jump is the hardest part of this level. I missed the tunnel jump nine times. ' +
  'Then I tried it backwards and it worked first time.';

/** A model that answers each structured call with the next of `answers`, recording the prompts. */
function answering(...answers: unknown[]): ModelClient & { prompts: string[] } {
  const prompts: string[] = [];
  let call = 0;
  return {
    name: 'fake',
    prompts,
    async structured<T>(params: { user: string }) {
      prompts.push(params.user);
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      return answer as T;
    },
    // biome-ignore lint/correctness/useYield: never called by the hook titles.
    async *chat() {
      throw new Error('not used');
    },
  } as ModelClient & { prompts: string[] };
}

describe('the hook title prompt', () => {
  it('asks for three short, plain titles held to the words (snapshot)', () => {
    expect(buildHookTitlePrompt({ text: SPEECH, language: 'English' })).toMatchSnapshot();
  });

  it('asks for new titles only on a Try Again', () => {
    const first = buildHookTitlePrompt({ text: SPEECH, language: 'English', attempt: 0 });
    expect(first).toEqual(buildHookTitlePrompt({ text: SPEECH, language: 'English' }));
    expect(first.system).not.toContain(HOOK_TITLE_AGAIN_LINE);
    expect(first.user).not.toContain('Attempt');
    const again = buildHookTitlePrompt({ text: SPEECH, language: 'English', attempt: 2 });
    expect(again.system).toContain('Write three new titles, different from earlier ones.');
    expect(again.user).toContain('Attempt: 2');
  });

  it('answers in its own key, apart from the moment titles', () => {
    expect(Object.keys(hookTitlesSchema.shape)).toEqual(['hookTitles']);
  });
});

describe('cleanHookTitle', () => {
  it('strips quotes, hashtags, emoji, list marks and a trailing full stop', () => {
    expect(cleanHookTitle('1. "Nobody saw this coming" #gaming 🔥.')).toBe(
      'Nobody saw this coming',
    );
    expect(cleanHookTitle('- “Wait for it”')).toBe('Wait for it');
    expect(cleanHookTitle("'Don't skip the tunnel'")).toBe("Don't skip the tunnel");
    expect(cleanHookTitle('#only #tags')).toBe('');
  });

  it('cuts to seven words and keeps a question mark', () => {
    const title = cleanHookTitle('Why does the tunnel jump fail every single time you try?');
    expect(title.split(' ')).toHaveLength(HOOK_TITLE_MAX_WORDS);
    expect(title).toBe('Why does the tunnel jump fail every');
    expect(cleanHookTitle('Can you beat this?')).toBe('Can you beat this?');
  });

  it('drops empties and repeats (case and punctuation aside), keeping the order', () => {
    expect(
      distinctHookTitles(['Wait for it', 'wait, for it!', '""', 'The tunnel jump', '#x']),
    ).toEqual(['Wait for it', 'The tunnel jump']);
  });
});

describe('hookText', () => {
  it('cuts at the last whole sentence that fits', () => {
    const long = Array.from({ length: 200 }, (_, n) => `Sentence number ${n} is here.`).join(' ');
    const cut = hookText(long);
    expect(cut.length).toBeLessThanOrEqual(HOOK_TEXT_MAX_CHARS);
    expect(cut.endsWith('is here.')).toBe(true);
    expect(hookText('  short\n text  ')).toBe('short text');
  });
});

describe('writeHookTitles', () => {
  it('answers three cleaned, different titles from the model', async () => {
    const fake = answering({
      hookTitles: [
        '"The jump nobody can do"',
        '#gaming Tunnel jump backwards',
        'Nine misses, one trick.',
      ],
    });
    const result = await writeHookTitles(fake, { text: SPEECH, language: 'English' });
    expect(result.titles).toEqual([
      'The jump nobody can do',
      'Tunnel jump backwards',
      'Nine misses, one trick',
    ]);
    expect(fake.prompts[0]).toContain('Language: English');
  });

  it('asks once more when fewer than three survive, then fails with bad_output', async () => {
    const retried = answering(
      { hookTitles: ['Same title', 'same title', '#tag'] },
      { hookTitles: ['One', 'Two', 'Three', 'Four'] },
    );
    await expect(writeHookTitles(retried, { text: SPEECH, language: 'English' })).resolves.toEqual({
      titles: ['One', 'Two', 'Three'],
    });
    expect(retried.prompts).toHaveLength(2);

    const short = answering({ hookTitles: ['Only one'] });
    const failure = await writeHookTitles(short, { text: SPEECH, language: 'English' }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AiProviderError);
    expect((failure as AiProviderError).kind).toBe('bad_output');
    expect(short.prompts).toHaveLength(2);
  });

  it('refuses empty words without calling the model', async () => {
    const fake = answering({ hookTitles: ['A', 'B', 'C'] });
    await expect(writeHookTitles(fake, { text: '  ', language: 'English' })).rejects.toBeInstanceOf(
      AiProviderError,
    );
    expect(fake.prompts).toHaveLength(0);
  });

  it('sends at most the capped text', async () => {
    const fake = answering({ hookTitles: ['A b', 'C d', 'E f'] });
    await writeHookTitles(fake, { text: `${SPEECH} `.repeat(100), language: 'English' });
    const sent = /<<<Words\n([\s\S]*?)\n>>>/.exec(fake.prompts[0] ?? '')?.[1] ?? '';
    expect(sent.length).toBeLessThanOrEqual(HOOK_TEXT_MAX_CHARS);
  });
});

describe('simulated hook titles', () => {
  it('follow the words, and the same words give the same titles', async () => {
    const writer = createSnippetWriter(model);
    const once = await writer.writeHookTitles({ text: SPEECH, language: 'English' });
    const again = await writer.writeHookTitles({ text: SPEECH, language: 'English' });
    expect(again).toEqual(once);
    expect(once.titles[0]).toBe('The tunnel jump is the hardest');
    expect(once.titles.join(' ').toLowerCase()).toContain('tunnel');
    expect(new Set(once.titles.map((title) => title.toLowerCase())).size).toBe(3);
    for (const title of once.titles) {
      expect(title.split(' ').length).toBeLessThanOrEqual(HOOK_TITLE_MAX_WORDS);
      expect(title).not.toMatch(/["#]/);
    }

    const other = await writer.writeHookTitles({
      text: 'Sourdough bread needs a starter. The starter needs flour and water every day.',
      language: 'English',
    });
    expect(other.titles).not.toEqual(once.titles);
    expect(other.titles.join(' ').toLowerCase()).toContain('starter');
  });

  it('opens with the first spoken sentence, never running into the next', async () => {
    const result = await writeHookTitles(model, {
      text: 'Hardest decision I ever made. Two years later I still think about it every day.',
      language: 'English',
    });
    expect(result.titles[0]).toBe('Hardest decision I ever made');

    // A long first sentence is cut at a natural point, not on a small word.
    const long = await writeHookTitles(model, {
      text: 'I spent three years building this, and then it all fell apart. That was the lesson.',
      language: 'English',
    });
    expect(long.titles[0]).toBe('I spent three years building this');
    const noComma = await writeHookTitles(model, {
      text: 'Nobody told me the market was going to crash that week. So I lost it all.',
      language: 'English',
    });
    expect(noComma.titles[0]).toBe('Nobody told me the market');
  });

  it('gives a different set on each Try Again, the same set for the same attempt', async () => {
    const sets = [];
    for (const attempt of [0, 1, 2]) {
      const result = await writeHookTitles(model, { text: SPEECH, language: 'English', attempt });
      const repeat = await writeHookTitles(model, { text: SPEECH, language: 'English', attempt });
      expect(repeat).toEqual(result);
      sets.push(result.titles.join('|'));
    }
    expect(new Set(sets).size).toBe(3);

    const hindi = 'यह सबसे कठिन छलांग है। मैंने नौ बार कोशिश की। फिर उल्टा करके देखा और हो गया।';
    const zero = await writeHookTitles(model, { text: hindi, language: 'Hindi', attempt: 0 });
    const one = await writeHookTitles(model, { text: hindi, language: 'Hindi', attempt: 1 });
    expect(one.titles).not.toEqual(zero.titles);
  });

  it('uses the words themselves in another language', async () => {
    const result = await writeHookTitles(model, {
      text: 'यह सबसे कठिन छलांग है। मैंने नौ बार कोशिश की। फिर उल्टा करके देखा और हो गया।',
      language: 'Hindi',
    });
    expect(result.titles).toHaveLength(3);
    expect(result.titles[0]?.startsWith('यह सबसे कठिन छलांग है')).toBe(true);
  });
});
