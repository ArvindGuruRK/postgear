/**
 * Writing in a language other than English (Sprint 11): the names the
 * prompts use, the rule and field both writing stages add, and that a
 * request without a language gets exactly the prompts it always got.
 */
import { buildContentPrompt } from './content';
import { readField } from './fields';
import { buildHookPrompt } from './hook';
import { languageField, languageName, languageRule } from './language';

describe('languageName', () => {
  it('names the languages Discover offers most from its own table', () => {
    expect(languageName('ta')).toBe('Tamil');
    expect(languageName('hi')).toBe('Hindi');
    expect(languageName('fr')).toBe('French');
    expect(languageName('es-419')).toBe('Latin American Spanish');
    expect(languageName('zh-Hant')).toBe('Traditional Chinese');
    expect(languageName('pt-150')).toBe('European Portuguese');
  });

  it('calls every regional English plain English', () => {
    expect(languageName('en-GB')).toBe('English');
    expect(languageName('en-IN')).toBe('English');
  });

  it('asks the runtime for anything else, and falls back to the tag', () => {
    expect(languageName('nds')).toBe('Low German');
    expect(languageName('qaa')).toBe('qaa');
  });
});

describe('the language rule and field', () => {
  it('names the language and keeps brand and product names', () => {
    expect(languageRule('ta')).toBe(
      '- Write in Tamil. Keep brand names and product names as they are. Do not translate the brand voice notes.',
    );
    expect(languageField('ta')).toBe('ta (Tamil)');
  });
});

describe('prompts with a language', () => {
  const content = {
    topic: 'Rising search in Tamil Nadu: "weather coimbatore".',
    tone: 'personal' as const,
    format: 'one_short' as const,
    category: 'News',
    hook: 'Coimbatore is checking the sky today.',
    withImage: false,
    maxCharacters: 280,
    platforms: ['linkedin'],
    sources: [{ title: 'Heavy rain alert', url: 'https://example.com/rain', snippet: 'The Hindu' }],
    workspaceName: 'Bloom Bakery',
  };

  const hook = {
    topic: content.topic,
    tone: content.tone,
    category: content.category,
    sources: content.sources,
    platforms: content.platforms,
    workspaceName: content.workspaceName,
  };

  it('adds the rule and the field to the content prompt', () => {
    const { system, user } = buildContentPrompt({ ...content, language: 'ta' });

    expect(system).toContain('- Write in Tamil.');
    expect(readField(user, 'Language')).toBe('ta (Tamil)');
    expect(system).not.toContain('imagePrompt" in English');
  });

  it('keeps image prompts in English when the post is not', () => {
    const { system } = buildContentPrompt({ ...content, withImage: true, language: 'ta' });
    expect(system).toContain('- Write "imagePrompt" in English whatever the post\'s language.');
  });

  it('adds the rule and the field to the hook prompt, and drops "English"', () => {
    const { system, user } = buildHookPrompt({ ...hook, language: 'fr' });

    expect(system).toContain('- Plain, concrete French. Specifics beat adjectives.');
    expect(system).toContain('- Write in French.');
    expect(system).not.toContain('concrete English');
    expect(readField(user, 'Language')).toBe('fr (French)');
  });

  it('leaves both prompts exactly as they were without a language', () => {
    const before = buildContentPrompt(content);
    const withUndefined = buildContentPrompt({ ...content, language: undefined });

    expect(withUndefined).toEqual(before);
    expect(before.user).not.toContain('Language:');
    expect(before.system).not.toContain('- Write in');

    const hookBefore = buildHookPrompt(hook);
    expect(hookBefore.system).toContain('- Plain, concrete English. Specifics beat adjectives.');
    const systemLines = hookBefore.system.split('\n');
    expect(systemLines[systemLines.length - 1]).toBe(
      '- Plain, concrete English. Specifics beat adjectives.',
    );
    expect(hookBefore.user).not.toContain('Language:');
    expect(hookBefore.user.split('\n')).toHaveLength(
      // Four fields, then the Brief and Research fences.
      4 + 3 + 3,
    );
  });
});
