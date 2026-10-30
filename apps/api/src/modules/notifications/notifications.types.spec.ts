/**
 * The email catalogue: one subject and one plain-text body per type, with
 * the channel, the reason and the link where the row has them, and never any
 * markup; a provider message is interpolated as the text it is.
 */
import { NotificationEmailStatus } from '@postgear/db';
import { AUTOMATION_NOTIFICATION_TYPES } from '@postgear/scheduling';
import {
  AUDIENCE_BY_TYPE,
  composeEmail,
  type EmailableNotification,
  isNotificationType,
  NOTIFICATION_TYPES,
  readMeta,
} from './notifications.types';

const linkTo = (path: string) => `http://localhost:3000${path}`;

function row(overrides: Partial<EmailableNotification>): EmailableNotification {
  return {
    id: 'n1',
    organizationId: 'org_1',
    type: 'post.failed',
    title: 'Post failed',
    content: 'Could not publish to Acme Marketing: LinkedIn rejected the post.',
    link: '/org_1/queue?state=ERROR',
    meta: null,
    emailStatus: NotificationEmailStatus.PENDING,
    createdAt: new Date('2026-10-16T12:00:00Z'),
    ...overrides,
  };
}

describe('composeEmail', () => {
  it('names the channel and platform in a failed post subject and lists the details', () => {
    const { subject, lines } = composeEmail(
      row({
        meta: {
          channelName: 'Acme Marketing',
          provider: 'linkedin',
          reason: 'rejected',
          message: 'LinkedIn rejected the post (simulated).',
          attempts: 1,
          preview: 'Our Q3 recap',
        },
      }),
      linkTo,
    );

    expect(subject).toBe('[PostGear] Could not publish to Acme Marketing on LinkedIn');
    expect(lines).toEqual([
      'Post failed',
      '',
      'Could not publish to Acme Marketing: LinkedIn rejected the post.',
      '',
      'Post:     Our Q3 recap',
      'Channel:  Acme Marketing on LinkedIn',
      'Reason:   The platform rejected the content',
      'Details:  LinkedIn rejected the post (simulated).',
      'Attempts: 1',
      '',
      'Open the queue:',
      'http://localhost:3000/org_1/queue?state=ERROR',
      '',
      'You are receiving this because of your notification settings in PostGear.',
      'Change them: http://localhost:3000/org_1/settings/notifications',
    ]);
  });

  it('passes an absolute link through and uses the published wording', () => {
    const { subject, lines } = composeEmail(
      row({
        type: 'post.published',
        title: 'Post published',
        content: 'Published to Acme Marketing: Our Q3 recap',
        link: 'https://www.linkedin.com/feed/update/123',
        meta: { channelName: 'Acme Marketing', preview: 'Our Q3 recap' },
      }),
      linkTo,
    );

    expect(subject).toBe('[PostGear] Published to Acme Marketing');
    expect(lines).toContain('See the post:');
    expect(lines).toContain('https://www.linkedin.com/feed/update/123');
    expect(lines).not.toContain('Attempts: 1');
  });

  it('interpolates a provider message as text, markup included', () => {
    const { lines } = composeEmail(
      row({ meta: { message: '<script>alert(1)</script> & "quotes"' } }),
      linkTo,
    );

    expect(lines).toContain('Details:  <script>alert(1)</script> & "quotes"');
  });

  it('falls back to the catalogue title and a generic subject for a row without one', () => {
    const { subject, lines } = composeEmail(
      row({ type: 'channel.needs_reconnect', title: null, link: '/org_1/channels', meta: {} }),
      linkTo,
    );

    expect(subject).toBe('[PostGear] A channel needs reconnecting');
    expect(lines[0]).toBe('Channel needs reconnecting');
    expect(lines).toContain('Reconnect it here:');
  });

  it('treats an unknown type as info', () => {
    const { subject } = composeEmail(
      row({ type: 'something.else', title: 'Hello', link: null }),
      linkTo,
    );

    expect(subject).toBe('[PostGear] Hello');
  });

  it('has a subject for every type in the catalogue', () => {
    for (const type of NOTIFICATION_TYPES) {
      const { subject, lines } = composeEmail(row({ type, title: null, meta: {} }), linkTo);
      expect(subject.startsWith('[PostGear] ')).toBe(true);
      expect(lines.length).toBeGreaterThan(2);
    }
  });
});

describe('the catalogue', () => {
  it('maps every type to an audience', () => {
    expect(Object.keys(AUDIENCE_BY_TYPE).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(AUDIENCE_BY_TYPE['post.failed']).toBe('failure_emails');
    expect(AUDIENCE_BY_TYPE['channel.needs_reconnect']).toBe('failure_emails');
    expect(AUDIENCE_BY_TYPE['post.published']).toBe('success_emails');
    expect(AUDIENCE_BY_TYPE['billing.payment_failed']).toBe('admins');
    expect(AUDIENCE_BY_TYPE['webhook.failed']).toBe('admins');
    expect(AUDIENCE_BY_TYPE.info).toBe('none');
  });

  it('lists every type workflows write, the Module 09 failure and pause alerts included', () => {
    for (const type of Object.values(AUTOMATION_NOTIFICATION_TYPES)) {
      expect(isNotificationType(type)).toBe(true);
    }
    expect(AUDIENCE_BY_TYPE['automation.failed']).toBe('failure_emails');
    expect(AUDIENCE_BY_TYPE['automation.paused']).toBe('failure_emails');
  });

  it('recognises its own types and nothing else', () => {
    expect(isNotificationType('post.failed')).toBe(true);
    expect(isNotificationType('post.deleted')).toBe(false);
  });

  it('reads meta defensively', () => {
    expect(readMeta(null)).toEqual({});
    expect(readMeta([1, 2])).toEqual({});
    expect(readMeta('x')).toEqual({});
    expect(readMeta({ channelId: 'c1' })).toEqual({ channelId: 'c1' });
  });
});
