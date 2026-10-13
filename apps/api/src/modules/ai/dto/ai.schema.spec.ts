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
