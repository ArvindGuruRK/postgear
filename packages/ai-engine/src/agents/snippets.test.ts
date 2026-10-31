import { createSimulatedModelClient } from '../model/simulated-model-client';
import { HASHTAG_COUNT_MAX, HASHTAG_COUNT_MIN, normaliseHashtags } from '../prompts/hashtags';
import { buildRewritePrompt } from '../prompts/rewrite';
import { toneRules } from '../prompts/tone';
import { AiProviderError, type ModelClient } from '../types';
import { createSnippetWriter, generateHashtags, hashtagCount, rewriteInVoice } from './snippets';

const model = createSimulatedModelClient();

const POST =
  'Fresh sourdough bread every morning at the bakery. Our sourdough starter is ten years old, and the bread sells out by nine.';

/** A model that answers every structured call with `value`. */
function answering(value: unknown): ModelClient {
  return {
    name: 'fake',
    async structured<T>() {
      return value as T;
    },
    // biome-ignore lint/correctness/useYield: never called by the snippets.
    async *chat() {
      throw new Error('not used');
    },
  };
}

describe('generateHashtags', () => {
  it('suggests the asked number of clean, distinct hashtags from the post', async () => {
    const result = await generateHashtags(model, { text: POST, platform: 'instagram', count: 5 });

    expect(result.hashtags).toHaveLength(5);
    expect(result.hashtags[0]).toBe('#sourdough');
    expect(result.hashtags).toContain('#bread');
    for (const tag of result.hashtags) expect(tag).toMatch(/^#[\p{L}\p{N}_]+$/u);
    expect(new Set(result.hashtags.map((tag) => tag.toLowerCase())).size).toBe(5);
    expect(result.line).toBe(result.hashtags.join(' '));
    expect(result.shortened).toBe(false);
  });

  it('holds the count to 3..15', async () => {
    expect(hashtagCount(1)).toBe(HASHTAG_COUNT_MIN);
    expect(hashtagCount(40)).toBe(HASHTAG_COUNT_MAX);
    expect(hashtagCount(7.4)).toBe(7);
    expect(hashtagCount(Number.NaN)).toBe(HASHTAG_COUNT_MIN);

    const few = await generateHashtags(model, { text: POST, platform: 'x', count: 1 });
    expect(few.hashtags).toHaveLength(3);
    const many = await generateHashtags(model, { text: 'Bread.', platform: 'x', count: 99 });
    expect(many.hashtags).toHaveLength(15);
  });

  it('drops hashtags from the end until the line fits the platform, and says so', async () => {
    const result = await generateHashtags(model, {
      text: POST,
      platform: 'x',
      count: 10,
      maxCharacters: 30,
    });

    expect(result.line.length).toBeLessThanOrEqual(30);
    expect(result.hashtags.length).toBeLessThan(10);
    expect(result.hashtags.length).toBeGreaterThan(0);
    expect(result.shortened).toBe(true);
  });

  it('cleans what a model returns and refuses an answer with nothing usable', async () => {
    expect(
      normaliseHashtags(['Small Business', '#small_business', '##Bread!', '#bread', '2026']),
    ).toEqual(['#SmallBusiness', '#small_business', '#Bread']);

    const messy = await generateHashtags(answering({ hashtags: ['#a b', 'A B', '#c', 'd', 'e'] }), {
      text: POST,
      platform: 'generic',
      count: 3,
    });
    expect(messy.hashtags).toEqual(['#ab', '#c', '#d']);

    await expect(
      generateHashtags(answering({ hashtags: ['###', '42'] }), {
        text: POST,
        platform: 'generic',
        count: 3,
      }),
    ).rejects.toMatchObject({ kind: 'bad_output' });
  });

  it('reports a cancelled call as aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateHashtags(
        model,
        { text: POST, platform: 'x', count: 3 },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe('rewriteInVoice', () => {
  it('rewrites a personal post in the company voice', async () => {
    const result = await rewriteInVoice(model, {
      text: 'I bake every morning. My starter is ten years old.',
      platform: 'linkedin',
      voice: 'company',
      workspaceName: 'Bloom Bakery',
    });

    expect(result).toEqual({
      text: 'We bake every morning. Our starter is ten years old.',
      shortened: false,
    });
  });

  it('rewrites a company post in the personal voice', async () => {
    const result = await rewriteInVoice(model, {
      text: 'We are opening a second shop. Come and see us.',
      platform: 'generic',
      voice: 'personal',
    });

    expect(result.text).toBe('I am opening a second shop. Come and see me.');
  });

  it('cuts the rewrite to the platform limit at a sentence end, and says so', async () => {
    const long = Array.from({ length: 30 }, (_, i) => `We baked loaf number ${i + 1}.`).join(' ');
    const result = await rewriteInVoice(model, {
      text: long,
      platform: 'x',
      voice: 'personal',
      maxCharacters: 280,
    });

    expect(result.shortened).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(280);
    expect(result.text.endsWith('.')).toBe(true);
  });

  it('shares the tone prompt and quotes the limit', () => {
    const prompt = buildRewritePrompt({
      text: 'Hello',
      platform: 'x',
      voice: 'company',
      maxCharacters: 280,
      workspaceName: 'Bloom Bakery',
    });
    expect(prompt.system).toContain(toneRules('company', 'Bloom Bakery'));
    expect(prompt.system).toContain('At most 280 characters');
  });

  it('refuses an empty rewrite', async () => {
    await expect(
      rewriteInVoice(answering({ rewrite: '   \n ' }), {
        text: 'Hello there',
        platform: 'x',
        voice: 'personal',
      }),
    ).rejects.toMatchObject({ kind: 'bad_output' });
  });
});

describe('createSnippetWriter', () => {
  it('binds both jobs to one model client', async () => {
    const writer = createSnippetWriter(model);
    await expect(writer.hashtags({ text: POST, platform: 'x', count: 3 })).resolves.toMatchObject({
      shortened: false,
    });
    await expect(
      writer.rewrite({ text: 'I bake.', platform: 'x', voice: 'company' }),
    ).resolves.toEqual({ text: 'We bake.', shortened: false });
  });
});
