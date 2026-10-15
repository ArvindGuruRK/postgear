import { createWebhookSchema, updateWebhookSchema } from './webhooks.schema';

describe('webhook schemas', () => {
  it('accepts a well-formed hook and trims its text', () => {
    const parsed = createWebhookSchema.parse({
      name: '  Zapier ​',
      url: ' https://hooks.example.com/in ',
      events: ['post.published'],
      channelIds: ['ch-1'],
    });
    expect(parsed).toEqual({
      name: 'Zapier',
      url: 'https://hooks.example.com/in',
      events: ['post.published'],
      channelIds: ['ch-1'],
    });
  });

  it.each([
    ['an unknown key', { name: 'x', url: 'https://a.b/c', events: ['post.failed'], secret: 'mine' }],
    ['no events', { name: 'x', url: 'https://a.b/c', events: [] }],
    ['an unknown event', { name: 'x', url: 'https://a.b/c', events: ['post.deleted'] }],
    ['a duplicated event', { name: 'x', url: 'https://a.b/c', events: ['post.failed', 'post.failed'] }],
    ['a duplicated channel', { name: 'x', url: 'https://a.b/c', events: ['post.failed'], channelIds: ['a', 'a'] }],
    ['an empty name', { name: '   ', url: 'https://a.b/c', events: ['post.failed'] }],
    ['an over-long URL', { name: 'x', url: `https://a.b/${'c'.repeat(2_100)}`, events: ['post.failed'] }],
  ])('refuses %s', (_label, body) => {
    expect(createWebhookSchema.safeParse(body).success).toBe(false);
  });

  it('requires an update to change something', () => {
    expect(updateWebhookSchema.safeParse({}).success).toBe(false);
    expect(updateWebhookSchema.safeParse({ disabled: true }).success).toBe(true);
    expect(updateWebhookSchema.safeParse({ channelIds: [] }).success).toBe(true);
  });
});
