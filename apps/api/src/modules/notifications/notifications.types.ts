/**
 * The notification catalogue (Sprint 8, contract §5.2).
 *
 * One table of every `Notifications.type` the system writes, who should be
 * emailed about it, and how that email reads. Plain text only: a channel
 * name and a provider's error message are interpolated as text, never as
 * markup, so nothing a platform returns can become HTML in someone's inbox;
 * `MailService.sendPlain` keeps it that way on the wire.
 *
 * The worker writes `post.*` and `channel.*` rows; the API's billing and
 * webhook modules write theirs through `NotificationsService.notify()`.
 * `info` is the inherited default for rows written before this sprint, which
 * have no title, no meta and no email.
 */
import type { NotificationEmailStatus } from '@postgear/db';

export const NOTIFICATION_TYPES = [
  'post.published',
  'post.failed',
  'channel.needs_reconnect',
  'billing.activated',
  'billing.payment_failed',
  'billing.canceled',
  'billing.trial_started',
  'webhook.failed',
  // Sprint 10: an In-App Notification step, and a Manual Review waiting for an answer.
  'automation',
  'automation.review',
  // Sprint 10, Module 09: a live run failed (grouped), and a workflow paused itself.
  'automation.failed',
  'automation.paused',
  'info',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: string): value is NotificationType {
  return (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

/**
 * Who an email about a row goes to.
 *
 * - `failure_emails` / `success_emails`: every live member whose
 *   `sendFailureEmails` / `sendSuccessEmails` is on.
 * - `admins`: every live `ADMIN` membership (`SUPERADMIN` counts as one).
 * - `none`: never emailed, whatever `emailStatus` says.
 */
export type EmailAudience = 'failure_emails' | 'success_emails' | 'admins' | 'none';

export const AUDIENCE_BY_TYPE: Record<NotificationType, EmailAudience> = {
  'post.published': 'success_emails',
  'post.failed': 'failure_emails',
  'channel.needs_reconnect': 'failure_emails',
  'billing.activated': 'admins',
  'billing.payment_failed': 'admins',
  'billing.canceled': 'admins',
  'billing.trial_started': 'admins',
  'webhook.failed': 'admins',
  // The existing opt-ins: a workflow's message is news, a review needs someone.
  automation: 'success_emails',
  'automation.review': 'failure_emails',
  // Both mean a workflow needs fixing.
  'automation.failed': 'failure_emails',
  'automation.paused': 'failure_emails',
  info: 'none',
};

/** The title a row gets when the writer gave none. */
export const DEFAULT_TITLES: Record<NotificationType, string> = {
  'post.published': 'Post published',
  'post.failed': 'Post failed',
  'channel.needs_reconnect': 'Channel needs reconnecting',
  'billing.activated': 'Subscription active',
  'billing.payment_failed': 'Payment failed',
  'billing.canceled': 'Subscription canceled',
  'billing.trial_started': 'Trial started',
  'webhook.failed': 'Webhook delivery failed',
  automation: 'Workflow message',
  'automation.review': 'Review needed',
  'automation.failed': 'Workflow failed',
  'automation.paused': 'Workflow paused',
  info: 'Notification',
};

/**
 * What a row's `meta` may carry: everything an email needs that the one-line
 * `content` does not say. Every key is optional: the worker fills what it has
 * at hand, and a row from before this sprint has none of it.
 */
export interface NotificationMeta {
  postId?: string;
  group?: string;
  channelId?: string;
  channelName?: string;
  provider?: string;
  reason?: string;
  message?: string;
  attempts?: number;
  releaseURL?: string | null;
  preview?: string;
  /** Billing: the plan tier the event concerns. */
  tier?: string;
  /** Billing: a cents amount, when the event has one. */
  amountCents?: number;
  /** Webhooks: the endpoint's name and the final status code or error. */
  webhookName?: string;
  statusCode?: number | null;
  error?: string | null;
  [key: string]: unknown;
}

/** The columns an email is built from. */
export interface EmailableNotification {
  id: string;
  organizationId: string;
  type: string;
  title: string | null;
  content: string;
  link: string | null;
  meta: unknown;
  emailStatus: NotificationEmailStatus;
  createdAt: Date;
}

export interface EmailContent {
  subject: string;
  lines: string[];
}

const SUBJECT_PREFIX = '[PostGear]';

/** `meta` as written by this codebase, or an empty object for anything else. */
export function readMeta(meta: unknown): NotificationMeta {
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta)
    ? (meta as NotificationMeta)
    : {};
}

/** Provider identifiers are lower-case slugs; the mail names the platform properly. */
const PROVIDER_NAMES: Record<string, string> = {
  linkedin: 'LinkedIn',
  'linkedin-page': 'LinkedIn',
  x: 'Twitter / X',
  facebook: 'Facebook',
  instagram: 'Instagram',
  threads: 'Threads',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  pinterest: 'Pinterest',
  reddit: 'Reddit',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
};

function providerName(provider: string | undefined): string | null {
  if (!provider) {
    return null;
  }
  return PROVIDER_NAMES[provider] ?? provider;
}

/** "Acme Marketing on LinkedIn", "Acme Marketing", or "a channel". */
function channelPhrase(meta: NotificationMeta): string {
  const platform = providerName(meta.provider);
  if (meta.channelName) {
    return platform ? `${meta.channelName} on ${platform}` : meta.channelName;
  }
  return platform ? `a ${platform} channel` : 'a channel';
}

/**
 * The subject and body for a row, as plain-text lines.
 *
 * `linkTo` turns an app path into an absolute URL; an absolute link (a
 * published post's URL on the platform) is passed through as it is.
 */
export function composeEmail(
  row: EmailableNotification,
  linkTo: (path: string) => string,
): EmailContent {
  const type: NotificationType = isNotificationType(row.type) ? row.type : 'info';
  const meta = readMeta(row.meta);
  const title = row.title ?? DEFAULT_TITLES[type];
  const link = row.link ? (isAbsoluteUrl(row.link) ? row.link : linkTo(row.link)) : null;

  const subject = subjectFor(type, title, meta);
  const lines: string[] = [title, '', row.content];

  const details = detailLines(type, meta);
  if (details.length > 0) {
    lines.push('', ...details);
  }

  if (link) {
    lines.push('', linkLabel(type), link);
  }

  lines.push(
    '',
    'You are receiving this because of your notification settings in PostGear.',
    `Change them: ${linkTo(`/${row.organizationId}/settings/notifications`)}`,
  );

  return { subject, lines };
}

function subjectFor(type: NotificationType, title: string, meta: NotificationMeta): string {
  switch (type) {
    case 'post.failed':
      return `${SUBJECT_PREFIX} Could not publish to ${channelPhrase(meta)}`;
    case 'post.published':
      return `${SUBJECT_PREFIX} Published to ${channelPhrase(meta)}`;
    case 'channel.needs_reconnect':
      return `${SUBJECT_PREFIX} ${meta.channelName ?? 'A channel'} needs reconnecting`;
    case 'billing.activated':
      return `${SUBJECT_PREFIX} Your ${meta.tier ? `${meta.tier} ` : ''}plan is active`;
    case 'billing.payment_failed':
      return `${SUBJECT_PREFIX} A payment failed`;
    case 'billing.canceled':
      return `${SUBJECT_PREFIX} Your subscription has been canceled`;
    case 'billing.trial_started':
      return `${SUBJECT_PREFIX} Your free trial has started`;
    case 'webhook.failed':
      return `${SUBJECT_PREFIX} Webhook ${meta.webhookName ? `"${meta.webhookName}" ` : ''}could not be delivered`;
    case 'automation':
    case 'automation.review':
    case 'automation.failed':
    case 'automation.paused':
    case 'info':
      return `${SUBJECT_PREFIX} ${title}`;
  }
}

function detailLines(type: NotificationType, meta: NotificationMeta): string[] {
  const lines: string[] = [];

  switch (type) {
    case 'post.failed':
    case 'post.published': {
      if (meta.preview) {
        lines.push(`Post:     ${meta.preview}`);
      }
      if (meta.channelName || meta.provider) {
        lines.push(`Channel:  ${channelPhrase(meta)}`);
      }
      if (type === 'post.failed') {
        if (meta.reason) {
          lines.push(`Reason:   ${describeReason(meta.reason)}`);
        }
        if (meta.message) {
          lines.push(`Details:  ${meta.message}`);
        }
        if (typeof meta.attempts === 'number') {
          lines.push(`Attempts: ${meta.attempts}`);
        }
      }
      return lines;
    }
    case 'channel.needs_reconnect':
      if (meta.channelName || meta.provider) {
        lines.push(`Channel: ${channelPhrase(meta)}`);
      }
      lines.push('Posts scheduled to this channel will fail until it is reconnected.');
      return lines;
    case 'webhook.failed':
      if (meta.webhookName) {
        lines.push(`Webhook: ${meta.webhookName}`);
      }
      if (typeof meta.statusCode === 'number') {
        lines.push(`Last status: ${meta.statusCode}`);
      }
      if (meta.error) {
        lines.push(`Error: ${meta.error}`);
      }
      return lines;
    case 'billing.activated':
    case 'billing.payment_failed':
    case 'billing.canceled':
    case 'billing.trial_started':
      if (meta.tier) {
        lines.push(`Plan: ${meta.tier}`);
      }
      return lines;
    case 'automation':
    case 'automation.review':
    case 'automation.failed':
    case 'automation.paused':
    case 'info':
      return lines;
  }
}

function linkLabel(type: NotificationType): string {
  switch (type) {
    case 'post.published':
      return 'See the post:';
    case 'post.failed':
      return 'Open the queue:';
    case 'channel.needs_reconnect':
      return 'Reconnect it here:';
    case 'billing.activated':
    case 'billing.payment_failed':
    case 'billing.canceled':
    case 'billing.trial_started':
      return 'Manage billing:';
    case 'webhook.failed':
      return 'Check the webhook:';
    case 'automation':
    case 'automation.failed':
      return 'Open the run:';
    case 'automation.review':
      return 'Review it here:';
    case 'automation.paused':
      return 'Open the workflow:';
    case 'info':
      return 'Open:';
  }
}

/** The worker's `PublishFailureReason` values (packages/scheduling), in words. */
function describeReason(reason: string): string {
  switch (reason) {
    case 'needs_reconnect':
      return 'The channel needs reconnecting';
    case 'needs_permissions':
      return 'The channel has not granted PostGear permission to post';
    case 'rejected':
      return 'The platform rejected the content';
    case 'retries_exhausted':
      return 'The platform kept failing and every retry was used';
    case 'channel_unavailable':
      return 'The channel was disabled or removed';
    case 'interrupted':
      return 'The publish was interrupted';
    default:
      return reason.replace(/_/g, ' ');
  }
}

export function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
