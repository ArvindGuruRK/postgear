/**
 * The email catalogue: one subject and one summary card per type, with the
 * channel, the reason and the link where the row has them. A provider message
 * goes in as the text it is; the template escapes it (packages/email tests).
 */
import { NotificationEmailStatus } from '@postgear/db';
import { notificationEmail } from '@postgear/email';
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
    const email = composeEmail(
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

    expect(email).toEqual({
      subject: '[PostGear] Could not publish to Acme Marketing on LinkedIn',
      tone: 'danger',
      badge: 'Post Failed',
      heading: 'Post Failed',
      message: 'Could not publish to Acme Marketing: LinkedIn rejected the post.',
      facts: [
        { label: 'Post', value: 'Our Q3 recap' },
        { label: 'Channel', value: 'Acme Marketing on LinkedIn' },
        { label: 'Reason', value: 'The platform rejected the content' },
        { label: 'Details', value: 'LinkedIn rejected the post (simulated).' },
        { label: 'Attempts', value: '1' },
      ],
      bullets: undefined,
      action: { label: 'Open The Queue', url: 'http://localhost:3000/org_1/queue?state=ERROR' },
      reason: 'You got this email because failure emails are on in your notification settings.',
      settingsUrl: 'http://localhost:3000/org_1/settings/notifications',
    });
  });

  it('passes an absolute link through and uses the published wording', () => {
    const email = composeEmail(
      row({
        type: 'post.published',
        title: 'Post published',
        content: 'Published to Acme Marketing: Our Q3 recap',
        link: 'https://www.linkedin.com/feed/update/123',
        meta: { channelName: 'Acme Marketing', preview: 'Our Q3 recap' },
      }),
      linkTo,
    );

    expect(email.subject).toBe('[PostGear] Published to Acme Marketing');
    expect(email.tone).toBe('success');
    expect(email.action).toEqual({
      label: 'See The Post',
      url: 'https://www.linkedin.com/feed/update/123',
    });
    expect(email.facts?.map((fact) => fact.label)).not.toContain('Attempts');
  });

  it('keeps a provider message as text, and the rendered email escapes it', () => {
    const email = composeEmail(
      row({ meta: { message: '<script>alert(1)</script> & "quotes"' } }),
      linkTo,
    );

    expect(email.facts).toContainEqual({
      label: 'Details',
      value: '<script>alert(1)</script> & "quotes"',
    });
    const rendered = notificationEmail({ webUrl: 'http://localhost:3000' }, email);
    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.text).toContain('Details: <script>alert(1)</script> & "quotes"');
  });

  it('shows the plan, the amount and the date for billing', () => {
    const email = composeEmail(
      row({
        type: 'billing.activated',
        title: 'Pro plan is active',
        content: 'Your workspace is now on the Pro plan.',
        link: '/org_1/settings/billing',
        meta: { tier: 'Pro', amountCents: 2_900, currency: 'usd' },
      }),
      linkTo,
    );

    expect(email.subject).toBe('[PostGear] Your Pro plan is active');
    expect(email.facts).toEqual([
      { label: 'Plan', value: 'Pro', badge: true },
      { label: 'Amount', value: '29.00 USD' },
      { label: 'Date', value: '16 October 2026 (UTC)' },
    ]);
    expect(email.reason).toContain('admin of this PostGear workspace');
  });

  it('lists the Discover highlights as bullets', () => {
    const email = composeEmail(
      row({
        type: 'discover.digest',
        title: null,
        content: 'Here is your week.',
        link: '/org_1/discover',
        meta: { place: 'Chennai', highlights: ['One', '', 'Two', 3] },
      }),
      linkTo,
    );

    expect(email.subject).toBe('[PostGear] What is trending in Chennai this week');
    expect(email.bullets).toEqual(['One', 'Two']);
  });

  it('falls back to the catalogue heading and a generic subject for a row without one', () => {
    const email = composeEmail(
      row({ type: 'channel.needs_reconnect', title: null, link: '/org_1/channels', meta: {} }),
      linkTo,
    );

    expect(email.subject).toBe('[PostGear] A channel needs reconnecting');
    expect(email.heading).toBe('Channel Needs Reconnecting');
    expect(email.action?.label).toBe('Reconnect Channel');
  });

  it('treats an unknown type as info and keeps its own title as the heading', () => {
    const email = composeEmail(row({ type: 'something.else', title: 'Hello', link: null }), linkTo);

    expect(email.subject).toBe('[PostGear] Hello');
    expect(email.heading).toBe('Hello');
    expect(email.action).toBeUndefined();
  });

  it('has a subject, a heading and a reason for every type in the catalogue', () => {
    for (const type of NOTIFICATION_TYPES) {
      const email = composeEmail(row({ type, title: null, meta: {} }), linkTo);
      expect(email.subject.startsWith('[PostGear] ')).toBe(true);
      expect(email.heading.length).toBeGreaterThan(0);
      expect(email.reason.length).toBeGreaterThan(0);
      // Every one renders.
      expect(notificationEmail({ webUrl: 'http://localhost:3000' }, email).text).toContain(
        email.heading,
      );
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
