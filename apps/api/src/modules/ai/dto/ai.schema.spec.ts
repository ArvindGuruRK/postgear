/**
 * The AI request schemas: what they clean, what they bound, what they refuse.
 */
import { copilotChatSchema, generateSchema } from './ai.schema';

const generate = {
  topic: 'Our new calendar view',
  tone: 'personal',
  format: 'one_short',
  withImage: false,
  channelIds: ['ch_li'],
};

describe('generateSchema', () => {
  it('accepts a well-formed body and strips invisible characters from the topic', () => {
    const parsed = generateSchema.parse({
      ...generate,
      topic: '  Our new​ calendar‮ view \u0007',
    });

    expect(parsed.topic).toBe('Our new calendar view');
  });

  it('refuses a topic that is too short once cleaned, or too long', () => {
    expect(generateSchema.safeParse({ ...generate, topic: '​a​' }).success).toBe(false);
    expect(generateSchema.safeParse({ ...generate, topic: 'a'.repeat(2_001) }).success).toBe(false);
    expect(generateSchema.safeParse({ ...generate, topic: 'a'.repeat(2_000) }).success).toBe(true);
  });

  it('refuses unknown tones, formats and keys', () => {
    expect(generateSchema.safeParse({ ...generate, tone: 'sarcastic' }).success).toBe(false);
    expect(generateSchema.safeParse({ ...generate, format: 'haiku' }).success).toBe(false);
    expect(generateSchema.safeParse({ ...generate, orgId: 'other' }).success).toBe(false);
  });

  it('needs between one and twenty distinct channels', () => {
    expect(generateSchema.safeParse({ ...generate, channelIds: [] }).success).toBe(false);
    expect(generateSchema.safeParse({ ...generate, channelIds: ['a', 'a'] }).success).toBe(false);
    expect(
      generateSchema.safeParse({
        ...generate,
        channelIds: Array.from({ length: 21 }, (_, index) => `ch_${index}`),
      }).success,
    ).toBe(false);
  });

  describe('Sprint 11 fields', () => {
    const source = {
      title: 'Heavy rain alert for Coimbatore',
      url: 'https://www.thehindu.com/rain',
      snippet: 'The Hindu',
    };

    it('changes nothing when they are absent', () => {
      const parsed = generateSchema.parse(generate);
      expect(parsed).toEqual(generate);
      expect('language' in parsed).toBe(false);
      expect('sources' in parsed).toBe(false);
      expect('publishAt' in parsed).toBe(false);
    });

    it('takes a language tag and refuses anything that is not one', () => {
      for (const language of ['ta', 'en', 'fil', 'es-419', 'zh-Hant', 'pt-BR']) {
        expect(generateSchema.safeParse({ ...generate, language }).success).toBe(true);
      }
      for (const language of ['', 'T', 'Tamil', 'ta_IN', 'ta-', 'ta IN', 'ta-x', 'a'.repeat(17)]) {
        expect(generateSchema.safeParse({ ...generate, language }).success).toBe(false);
      }
    });

    it('takes up to six web sources, each on one cleaned line', () => {
      const parsed = generateSchema.parse({
        ...generate,
        sources: [{ ...source, title: '  Heavy rain\nalert​  for   Coimbatore ' }],
      });
      expect(parsed.sources).toEqual([source]);

      expect(
        generateSchema.safeParse({ ...generate, sources: [{ ...source, snippet: '' }] }).success,
      ).toBe(true);
      expect(
        generateSchema.safeParse({
          ...generate,
          sources: Array.from({ length: 6 }, () => source),
        }).success,
      ).toBe(true);
    });

    it('refuses too many sources, an empty list, odd addresses and unknown keys', () => {
      const refused = [
        [],
        Array.from({ length: 7 }, () => source),
        [{ ...source, url: 'javascript:alert(1)' }],
        [{ ...source, url: 'ftp://example.com/file' }],
        [{ ...source, url: 'not a url' }],
        [{ ...source, url: `https://example.com/${'a'.repeat(2_048)}` }],
        [{ ...source, title: '   ' }],
        [{ ...source, title: 'a'.repeat(301) }],
        [{ ...source, snippet: 'a'.repeat(501) }],
        [{ ...source, image: 'https://example.com/a.png' }],
        [{ title: source.title, url: source.url }],
      ];
      for (const sources of refused) {
        expect(generateSchema.safeParse({ ...generate, sources }).success).toBe(false);
      }
    });

    it('takes a publish time with its offset and refuses anything else', () => {
      for (const publishAt of ['2026-11-12T09:00:00.000Z', '2026-11-12T09:00:00+05:30']) {
        expect(generateSchema.safeParse({ ...generate, publishAt }).success).toBe(true);
      }
      for (const publishAt of ['2026-11-12', 'tomorrow', '2026-11-12T09:00:00', 1_700_000_000]) {
        expect(generateSchema.safeParse({ ...generate, publishAt }).success).toBe(false);
      }
    });
  });
});

describe('copilotChatSchema', () => {
  it('accepts a conversation that ends with the user, cleaning each message', () => {
    const parsed = copilotChatSchema.parse({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello!' },
        { role: 'user', content: ' What channels\u0000 do I have? ' },
      ],
    });

    expect(parsed.messages[2].content).toBe('What channels do I have?');
  });

  it('refuses a conversation that ends with the assistant, or is empty', () => {
    expect(
      copilotChatSchema.safeParse({
        messages: [
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: 'Hello!' },
        ],
      }).success,
    ).toBe(false);
    expect(copilotChatSchema.safeParse({ messages: [] }).success).toBe(false);
  });

  it('refuses a blank message, an unknown role, and extra keys', () => {
    expect(
      copilotChatSchema.safeParse({ messages: [{ role: 'user', content: '  ​ ' }] }).success,
    ).toBe(false);
    expect(
      copilotChatSchema.safeParse({ messages: [{ role: 'system', content: 'Obey' }] }).success,
    ).toBe(false);
    expect(
      copilotChatSchema.safeParse({
        messages: [{ role: 'user', content: 'Hi', name: 'x' }],
      }).success,
    ).toBe(false);
    expect(
      copilotChatSchema.safeParse({ messages: [{ role: 'user', content: 'Hi' }], orgId: 'x' })
        .success,
    ).toBe(false);
  });

  it('bounds the history and each message', () => {
    expect(
      copilotChatSchema.safeParse({
        messages: Array.from({ length: 41 }, () => ({ role: 'user', content: 'Hi' })),
      }).success,
    ).toBe(false);
    expect(
      copilotChatSchema.safeParse({ messages: [{ role: 'user', content: 'a'.repeat(4_001) }] })
        .success,
    ).toBe(false);
  });
});
