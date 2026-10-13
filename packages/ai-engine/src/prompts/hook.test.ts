import { buildClassifyPrompt, classifySchema } from './classify';
import { buildHookPrompt, hookSchema } from './hook';

describe('hook prompt', () => {
  const input = {
    topic: 'Launching our scheduling calendar',
    category: 'Announcement',
    sources: [{ title: 'Source', url: 'https://example.com', snippet: 'calendars help' }],
    platforms: ['linkedin'],
  };

  it('spells out the voice and forbids copying the brief', () => {
    const personal = buildHookPrompt({ ...input, tone: 'personal' });
    expect(personal.system).toContain('first person singular');
    expect(personal.system).toContain('Do not copy');
    expect(personal.user).toContain('Category: Announcement');
    expect(personal.user).toContain('<<<Brief\nLaunching our scheduling calendar\n>>>');
    expect(personal.user).toContain('Source | calendars help');

    const company = buildHookPrompt({ ...input, tone: 'company', workspaceName: 'Acme' });
    expect(company.system).toContain('first person plural');
    expect(company.system).toContain('as Acme');
  });

  it('schema rejects empty or giant hooks', () => {
    expect(hookSchema.safeParse({ hook: 'short' }).success).toBe(false);
    expect(hookSchema.safeParse({ hook: 'A real opening line.' }).success).toBe(true);
    expect(hookSchema.safeParse({ hook: 'x'.repeat(401) }).success).toBe(false);
  });
});

describe('classify prompt', () => {
  it('lists every category and only accepts one of them', () => {
    const { system, user } = buildClassifyPrompt({ topic: 'Tips for X', sources: [] });
    expect(system).toContain('Announcement, Educational, Tips');
    expect(user).toContain('Research sources: 0');
    expect(classifySchema.safeParse({ category: 'Tips' }).success).toBe(true);
    expect(classifySchema.safeParse({ category: 'Gossip' }).success).toBe(false);
  });
});
