import {
  buildContentPrompt,
  cleanPartText,
  contentSchema,
  ensureHookLeads,
  firstLine,
  partLimits,
  truncateAtSentence,
} from './content';

describe('partLimits', () => {
  it('follows the contract per format', () => {
    expect(partLimits('one_short', null)).toMatchObject({
      minParts: 1,
      maxParts: 1,
      maxChars: 280,
    });
    expect(partLimits('one_long', null)).toMatchObject({
      minParts: 1,
      maxParts: 1,
      maxChars: 1_500,
      minChars: 800,
    });
    expect(partLimits('thread_short', null)).toMatchObject({
      minParts: 3,
      maxParts: 5,
      maxChars: 280,
    });
    expect(partLimits('thread_long', null)).toMatchObject({
      minParts: 3,
      maxParts: 6,
      maxChars: 1_000,
    });
  });

  it('caps by the platform limit when it is lower, and scales the long floor', () => {
    expect(partLimits('one_short', 200).maxChars).toBe(200);
    expect(partLimits('one_short', 3_000).maxChars).toBe(280);
    expect(partLimits('one_long', 1_000)).toMatchObject({ maxChars: 1_000, minChars: 600 });
    expect(partLimits('thread_long', 500).maxChars).toBe(500);
    expect(partLimits('thread_long', 0).maxChars).toBe(1_000);
  });
});

describe('contentSchema', () => {
  it('accepts image prompts only when asked', () => {
    const withImage = contentSchema(true);
    expect(withImage.safeParse({ parts: [{ text: 'x', imagePrompt: 'p' }] }).success).toBe(true);
    const without = contentSchema(false);
    expect(without.safeParse({ parts: [{ text: 'x', imagePrompt: 'p' }] }).success).toBe(false);
    expect(without.safeParse({ parts: [{ text: 'x' }] }).success).toBe(true);
    expect(without.safeParse({ parts: [] }).success).toBe(false);
  });
});

describe('buildContentPrompt', () => {
  const base = {
    topic: 'Why consistency beats virality',
    format: 'thread_short' as const,
    category: 'Tips',
    hook: 'Nobody goes viral on purpose.',
    withImage: true,
    maxCharacters: 250,
    platforms: ['x'],
    sources: [{ title: 'A study', url: 'https://example.com', snippet: 'consistency wins' }],
  };

  it('states the voice, the shape and the limits', () => {
    const { system, user } = buildContentPrompt({ ...base, tone: 'personal' });
    expect(system).toContain('first person singular');
    expect(system).toContain('3 to 5 parts');
    expect(system).toContain('250 characters');
    expect(system).toContain('imagePrompt');
    expect(user).toContain('Voice: personal');
    expect(user).toContain('Max characters per part: 250');
    expect(user).toContain('Parts: 3-5');
    expect(user).toContain('Image prompts: yes');
    expect(user).toContain('<<<Hook\nNobody goes viral on purpose.\n>>>');
    expect(user).toContain('A study | https://example.com | consistency wins');
  });

  it('switches to company voice and includes a repair note when given', () => {
    const { system, user } = buildContentPrompt({
      ...base,
      tone: 'company',
      workspaceName: 'Acme',
      repairNote: 'Part 1 is 300 characters; the limit is 250.',
    });
    expect(system).toContain('first person plural');
    expect(system).toContain('as Acme');
    expect(user).toContain('<<<Repair');
    expect(user).toContain('Part 1 is 300 characters');
  });
});

describe('cleanPartText', () => {
  it('removes markdown, hashtags and bullets while keeping line structure', () => {
    expect(
      cleanPartText('# Title\n**bold** and *em*\n- item one\nTry it #growth #tips\r\n\n\n\nend  '),
    ).toBe('Title\nbold and em\nitem one\nTry it\n\nend');
  });

  it('keeps a hash that is not a hashtag', () => {
    expect(cleanPartText('Issue #1 is #2 on the list')).toBe('Issue #1 is #2 on the list');
  });
});

describe('truncateAtSentence', () => {
  it('leaves short text alone', () => {
    expect(truncateAtSentence('short', 10)).toBe('short');
  });

  it('cuts at the last sentence end inside the limit', () => {
    const text = 'First sentence here. Second sentence here. Third one that is long.';
    const cut = truncateAtSentence(text, 45);
    expect(cut).toBe('First sentence here. Second sentence here.');
    expect(cut.length).toBeLessThanOrEqual(45);
  });

  it('falls back to a line break, then a word boundary', () => {
    expect(truncateAtSentence('one line of words\nanother line of words', 30)).toBe(
      'one line of words',
    );
    const words = truncateAtSentence('a sentence with no punctuation at all in it anywhere', 24);
    expect(words.length).toBeLessThanOrEqual(24);
    expect(words.endsWith('…')).toBe(true);
  });
});

describe('ensureHookLeads / firstLine', () => {
  it('prepends the hook when absent and not when present', () => {
    expect(ensureHookLeads('Body text.', 'The hook.')).toBe('The hook.\nBody text.');
    expect(ensureHookLeads('The hook.\nBody text.', 'The hook.')).toBe('The hook.\nBody text.');
    expect(ensureHookLeads('the hook!\nBody', 'The hook.')).toBe('the hook!\nBody');
    expect(firstLine('a\nb')).toBe('a');
    expect(firstLine('only')).toBe('only');
  });
});
