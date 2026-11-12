import { EMAIL_SAMPLES } from './samples';
import { multiLine, oneLine, safeUrl, truncate } from './safe';
import {
  accountLockedEmail,
  activationEmail,
  duration,
  messageEmail,
  notificationEmail,
  passwordResetEmail,
  workspaceInvitationEmail,
} from './templates';

const context = { webUrl: 'https://postgear-staging.rkay.in' };
const HOSTILE = '<script>alert(1)</script><img src=x onerror=alert(2)>';
/** The two characters the project never writes, built from their code points. */
const BANNED = [String.fromCharCode(0x2014), String.fromCharCode(0xb7)];

describe('every template', () => {
  it.each(EMAIL_SAMPLES.map((sample) => [sample.id, sample]))(
    '%s renders HTML and a text part',
    (_id, sample) => {
      const email = sample.render(context);

      expect(email.subject.length).toBeGreaterThan(0);
      expect(email.subject).not.toMatch(/[\r\n]/);
      expect(email.preview.length).toBeGreaterThan(0);
      expect(email.html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(email.html).toContain('<html lang="en"');
      expect(email.html).toContain('name="color-scheme"');
      expect(email.html).toContain('prefers-color-scheme: dark');
      expect(email.html).not.toContain('rel="preload"');
      expect(email.text.length).toBeGreaterThan(40);
      expect(email.text).not.toMatch(/<[a-z]/i);
      // Well under Gmail's 102 KB clipping point.
      expect(Buffer.byteLength(email.html, 'utf8')).toBeLessThan(60_000);
    },
  );

  it.each(EMAIL_SAMPLES.map((sample) => [sample.id, sample]))(
    '%s gives every image alt text and an absolute address',
    (_id, sample) => {
      const { html } = sample.render(context);
      const images = html.match(/<img [^>]*>/g) ?? [];

      expect(images.length).toBeGreaterThanOrEqual(2);
      for (const image of images) {
        expect(image).toMatch(/alt="[^"]+"/);
        expect(image).toMatch(/src="https:\/\/postgear-staging\.rkay\.in\/email\//);
      }
    },
  );

  it('never writes an em dash or a middle dot', () => {
    for (const sample of EMAIL_SAMPLES) {
      const { html, text, subject } = sample.render(context);
      for (const character of BANNED) {
        expect(`${html}${text}${subject}`.includes(character)).toBe(false);
      }
    }
  });
});

describe('links', () => {
  it('puts the link behind the button, under it, and in the text part', () => {
    const link = 'https://postgear-staging.rkay.in/verify?token=abc123';
    const email = activationEmail(context, { link });

    expect(email.html).toContain(`href="${link}"`);
    expect(email.html).toContain('Confirm Email');
    expect(email.html).toContain('v:rect');
    expect(email.text).toContain(`Confirm Email:\n${link}`);
    expect(email.text).toContain('expires in 24 hours');
  });

  it('drops a button whose link is not http(s)', () => {
    const email = notificationEmail(context, {
      subject: 'x',
      tone: 'brand',
      badge: 'Test',
      heading: 'Test',
      message: 'Hello',
      action: { label: 'Open', url: 'javascript:alert(1)' },
      reason: 'Because.',
    });

    expect(email.html).not.toContain('javascript:');
    expect(email.html).not.toContain('v:rect');
  });

  it('says how long a reset link and a lockout last', () => {
    expect(passwordResetEmail(context, { link: 'https://a.test/r' }).text).toContain(
      'expires in 1 hour and works once',
    );
    const locked = accountLockedEmail(context, { minutes: 15, resetLink: 'https://a.test/r' });
    expect(locked.text).toContain('locked for 15 minutes');
    expect(locked.html).toContain('Account Locked For 15 Minutes');
    expect(locked.html).toContain('Reset Password');
  });
});

describe('user text', () => {
  it('escapes names in the invitation and keeps the subject on one line', () => {
    const email = workspaceInvitationEmail(context, {
      workspaceName: `Acme\r\nBcc: victim@example.com ${HOSTILE}`,
      inviterName: '  Grace\n Hopper ',
      role: 'ADMIN',
      link: 'https://postgear-staging.rkay.in/invite/t',
      expiresAt: new Date('2026-10-26T12:00:00Z'),
    });

    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(
      email.subject.startsWith('Grace Hopper invited you to Acme Bcc: victim@example.com'),
    ).toBe(true);
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('Admin');
    expect(email.html).toContain('26 October 2026 (UTC)');
    expect(email.text).toContain('Invited By: Grace Hopper');
    expect(email.text).toContain('login or create an account');
  });

  it('caps a long workspace name', () => {
    const email = workspaceInvitationEmail(context, {
      workspaceName: 'W'.repeat(500),
      inviterName: 'Ada',
      role: 'USER',
      link: 'https://a.test/i',
      expiresAt: new Date(),
    });

    expect(email.html).not.toContain('W'.repeat(81));
    expect(email.text).toContain('a member');
  });

  it('escapes provider errors and caps them in a notification', () => {
    const email = notificationEmail(context, {
      subject: '[PostGear] Could not publish',
      tone: 'danger',
      badge: 'Post Failed',
      heading: 'Post Failed',
      message: HOSTILE,
      facts: [{ label: 'Details', value: `${HOSTILE}${'e'.repeat(1_000)}` }],
      reason: 'Because.',
    });

    expect(email.html).not.toMatch(/<script>|<img src=x/);
    expect(email.html).not.toContain('e'.repeat(301));
  });

  it('keeps a workflow message as paragraphs and links its links', () => {
    const email = messageEmail(context, {
      subject: '(Test) Weekly\nreport',
      lines: ['Hi,', '', HOSTILE, '', 'https://example.com/report'],
    });

    expect(email.subject).toBe('(Test) Weekly report');
    expect(email.html).not.toMatch(/<script>|<img src=x/);
    expect(email.html).toContain('href="https://example.com/report"');
    expect(email.text).toContain('https://example.com/report');
  });
});

describe('helpers', () => {
  it('cleans text', () => {
    expect(oneLine('a\r\n\tb\u0000c')).toBe('a bc');
    expect(multiLine('a\r\nb\u0007')).toBe('a\nb');
    expect(truncate('abcdef', 5)).toBe('ab...');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('https://a.test/x')).toBe('https://a.test/x');
    expect(duration(60)).toBe('1 hour');
    expect(duration(1_440)).toBe('24 hours');
    expect(duration(15)).toBe('15 minutes');
  });
});
