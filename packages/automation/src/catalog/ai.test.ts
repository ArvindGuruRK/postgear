/**
 * The AI steps' panels and prices (Module 11). The forms' general rules
 * (paths the schema has, sentence-case labels, "Enter your ..." placeholders)
 * are in `form.test.ts`; this pins what the module doc asks for in words,
 * the cost estimate per config, and that Generate Video stays Coming Soon.
 */
import { AI_STEP_CREDITS } from './ai';
import { EXECUTABLE_TYPES } from './executable';
import { configErrors, type FieldSpec, fieldSpecFor } from './form';
import { getDefinition } from './index';
import type { NodeDefinition } from './types';

const AI_READY = [
  'ai.generateText',
  'ai.generateImage',
  'ai.generateHashtags',
  'ai.rewriteInBrandVoice',
] as const;

function def(type: string): NodeDefinition {
  const found = getDefinition(type);
  if (!found) throw new Error(`No definition for ${type}`);
  return found;
}

function field(type: string, path: string): FieldSpec {
  const found = fieldSpecFor(def(type), path);
  if (!found) throw new Error(`${type} has no field for ${path}`);
  expect(found.tab).toBe('configure');
  return found.spec;
}

describe('AI step forms', () => {
  it.each(AI_READY)('%s has a Configure panel that runs, internal and slow', (type) => {
    const definition = def(type);
    expect(definition.status).toBe('ready');
    expect(definition.form?.tabs.configure.length).toBeGreaterThan(0);
    expect(definition.form?.tabs.setup).toEqual([]);
    expect(definition.sideEffect).toBe('internal');
    expect(definition.timeoutClass).toBe('slow');
    expect(EXECUTABLE_TYPES).toContain(type);
  });

  it('Generate Text asks for the prompt, platform, voice, length, research and an image', () => {
    const prompt = field('ai.generateText', 'prompt');
    expect(prompt).toMatchObject({ kind: 'longText', acceptsData: true, required: true });
    expect(prompt.placeholder).toBe('Enter your prompt');

    expect(field('ai.generateText', 'voice').options).toEqual([
      { value: 'personal', label: 'Personal' },
      { value: 'company', label: 'Company' },
    ]);
    expect(field('ai.generateText', 'research')).toMatchObject({
      kind: 'toggle',
      help: 'Searches the web first. Takes longer.',
    });
    expect(field('ai.generateText', 'withImage').kind).toBe('toggle');
    expect(field('ai.generateText', 'format').kind).toBe('select');
    expect(field('ai.generateText', 'platform').options?.[0]).toEqual({
      value: 'generic',
      label: 'Any platform',
    });
  });

  it('Generate Image asks for a prompt and a style, and says the image goes to Media', () => {
    expect(field('ai.generateImage', 'prompt')).toMatchObject({
      kind: 'longText',
      acceptsData: true,
    });
    expect(field('ai.generateImage', 'style').options?.map((option) => option.value)).toEqual([
      'photo',
      'illustration',
      'flat',
    ]);
    expect(def('ai.generateImage').form?.notes).toEqual([
      'The image is saved to Media, so Create Draft can attach it.',
    ]);
  });

  it('Generate Hashtags takes text, a platform and 3 to 15 hashtags', () => {
    expect(field('ai.generateHashtags', 'text')).toMatchObject({
      kind: 'longText',
      acceptsData: true,
      placeholder: 'Enter your text',
    });
    expect(field('ai.generateHashtags', 'count')).toMatchObject({
      kind: 'number',
      min: 3,
      max: 15,
    });
    field('ai.generateHashtags', 'platform');

    const hashtags = def('ai.generateHashtags');
    const config = { ...hashtags.defaultConfig, text: 'Bread' };
    expect(configErrors(hashtags, { ...config, count: 3 })).toEqual({});
    expect(configErrors(hashtags, { ...config, count: 15 })).toEqual({});
    expect(Object.keys(configErrors(hashtags, { ...config, count: 2 }))).toEqual(['count']);
    expect(Object.keys(configErrors(hashtags, { ...config, count: 16 }))).toEqual(['count']);
  });

  it('Rewrite In Brand Voice takes text, a platform and the voice', () => {
    field('ai.rewriteInBrandVoice', 'text');
    field('ai.rewriteInBrandVoice', 'platform');
    expect(field('ai.rewriteInBrandVoice', 'voice').options?.map((option) => option.label)).toEqual(
      ['Personal', 'Company'],
    );
  });

  it('Hashtags and Rewrite say when they had to shorten', () => {
    for (const type of ['ai.generateHashtags', 'ai.rewriteInBrandVoice']) {
      const shape = def(type).outputShape;
      const fields = typeof shape === 'function' ? shape(def(type).defaultConfig) : shape;
      expect(fields.map((output) => output.path)).toContain('shortened');
    }
  });

  it('keeps Generate Video visible but Coming Soon, never runnable', () => {
    const video = def('ai.generateVideo');
    expect(video.status).toBe('comingSoon');
    expect(video.comingSoonReason).toBe('Video generation is coming soon.');
    expect(EXECUTABLE_TYPES).not.toContain('ai.generateVideo');
  });
});

describe('AI step prices', () => {
  const credits = (type: string, config: Record<string, unknown> = {}) => {
    const definition = def(type);
    return definition.credits?.({ ...definition.defaultConfig, ...config });
  };

  it('match the ledger: 5 for text, 15 with an image, 10 for an image, 2 for a snippet', () => {
    expect(AI_STEP_CREDITS).toEqual({ text: 5, image: 10, snippet: 2 });
    expect(credits('ai.generateText', { withImage: false })).toBe(5);
    expect(credits('ai.generateText', { withImage: true })).toBe(15);
    expect(credits('ai.generateImage')).toBe(10);
    expect(credits('ai.generateHashtags')).toBe(2);
    expect(credits('ai.rewriteInBrandVoice')).toBe(2);
    expect(def('ai.generateVideo').credits).toBeUndefined();
  });
});
