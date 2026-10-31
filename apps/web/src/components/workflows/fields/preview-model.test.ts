import type { RunScope } from '@postgear/automation';
import { buildPreview, DISCORD_LIMIT, discordCount, safeLink } from './preview-model';

const scope = {
  trigger: { post: { text: 'Spring menu is live', url: 'https://example.com/p/1' } },
  nodes: {},
} as unknown as RunScope;

describe('buildPreview', () => {
  it('fills the message with the panel data', () => {
    const preview = buildPreview(
      'slack',
      {
        message: 'New post: {{ trigger.post.text }}',
        includeLink: '{{ trigger.post.url }}',
        footer: true,
      },
      scope,
      { workflowName: 'Publishing Report' },
    );
    expect(preview.text).toBe('New post: Spring menu is live');
    expect(preview.link).toBe('https://example.com/p/1');
    expect(preview.footer).toBe('Sent by the workflow Publishing Report');
  });

  it('keeps markup as plain text and drops links that are not web addresses', () => {
    const preview = buildPreview(
      'teams',
      {
        title: '<b>Hi</b>',
        message: '<script>alert(1)</script>',
        includeLink: 'javascript:alert(1)',
      },
      scope,
    );
    expect(preview.title).toBe('<b>Hi</b>');
    expect(preview.text).toBe('<script>alert(1)</script>');
    expect(preview.link).toBeNull();
  });

  it('gives no button for Discord or email, and reads the email subject and addresses', () => {
    expect(
      buildPreview('discord', { message: 'x', includeLink: 'https://a.b' }, scope).link,
    ).toBeNull();
    const email = buildPreview(
      'email',
      { subject: 'About {{ trigger.post.text }}', to: ['a@example.com', ''], message: 'Hi' },
      scope,
    );
    expect(email.title).toBe('About Spring menu is live');
    expect(email.to).toEqual(['a@example.com']);
  });

  it('leaves the footer off unless it is turned on', () => {
    expect(buildPreview('slack', { message: 'x', footer: false }, scope).footer).toBeNull();
  });
});

describe('safeLink', () => {
  it('allows http and https only', () => {
    expect(safeLink(' https://example.com ')).toBe('https://example.com/');
    expect(safeLink('http://example.com/a')).toBe('http://example.com/a');
    expect(safeLink('data:text/html,hi')).toBeNull();
    expect(safeLink('not a link')).toBeNull();
  });
});

describe('discordCount', () => {
  it('counts against 2,000 and warns near the limit', () => {
    expect(discordCount('hello')).toEqual({ words: '5 / 2,000', warn: false, over: false });
    expect(discordCount('a'.repeat(1_900)).warn).toBe(true);
    expect(discordCount('a'.repeat(DISCORD_LIMIT + 1))).toMatchObject({ warn: true, over: true });
  });
});
