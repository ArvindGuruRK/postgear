/**
 * The notification catalogue (Sprint 8, contract §5.2).
 *
 * One table of every `Notifications.type` the system writes, who should be
 * emailed about it, and what that email says. The email itself is drawn by
 * `@postgear/email` as a summary card: a channel name and a provider's error
 * message go in as text, which the template escapes and caps, so nothing a
 * platform returns can become HTML in someone's inbox.
 *
 * The worker writes `post.*` and `channel.*` rows; the API's billing and
 * webhook modules write theirs through `NotificationsService.notify()`.
 * `info` is the inherited default for rows written before this sprint, which
 * have no title, no meta and no email.
 */
import type { NotificationEmailStatus } from '@postgear/db';
import type { Fact, NotificationEmailProps, Tone } from '@postgear/email';

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
  // Sprint 11 Module 10: Monday's Discover digest for the workspace's place.
  'discover.digest',
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
 * - `digest_emails`: every live member whose `sendDigestEmails` is on (Sprint 11).
 * - `none`: never emailed, whatever `emailStatus` says.
 */
export type EmailAudience =
  | 'failure_emails'
  | 'success_emails'
  | 'admins'
  | 'digest_emails'
  | 'none';

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
  'discover.digest': 'digest_emails',
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
  'discover.digest': 'Your Discover week',
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
  /** Discover digest: the place it is for, and one line per highlight. */
  place?: string;
  highlights?: string[];
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

/**
 * What an email about a row says: the `@postgear/email` notification card's
 * props. `MailService.sendNotification` renders it as HTML with a plain-text
 * part; every value here is text, which the template escapes and caps.
 */
export type EmailContent = NotificationEmailProps;

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
  'instagram-standalone': 'Instagram',
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

/** The band colour, the badge and the Title Case heading for each type. */
const LOOK: Record<NotificationType, { tone: Tone; badge: string; heading: string | null }> = {
  'post.published': { tone: 'success', badge: 'Published', heading: 'Post Published' },
  'post.failed': { tone: 'danger', badge: 'Post Failed', heading: 'Post Failed' },
  'channel.needs_reconnect': {
    tone: 'warning',
    badge: 'Channel',
    heading: 'Channel Needs Reconnecting',
  },
  'billing.activated': { tone: 'success', badge: 'Billing', heading: 'Subscription Active' },
  'billing.payment_failed': { tone: 'danger', badge: 'Billing', heading: 'Payment Failed' },
  'billing.canceled': { tone: 'warning', badge: 'Billing', heading: 'Subscription Canceled' },
  'billing.trial_started': { tone: 'brand', badge: 'Billing', heading: 'Your Trial Has Started' },
  'webhook.failed': { tone: 'danger', badge: 'Webhook', heading: 'Webhook Delivery Failed' },
  // A workflow's own title is whatever its author wrote, so it is kept as written.
  automation: { tone: 'brand', badge: 'Workflow', heading: null },
  'automation.review': { tone: 'warning', badge: 'Workflow', heading: 'Review Needed' },
  'automation.failed': { tone: 'danger', badge: 'Workflow', heading: 'Workflow Failed' },
  'automation.paused': { tone: 'warning', badge: 'Workflow', heading: 'Workflow Paused' },
  'discover.digest': { tone: 'brand', badge: 'Discover', heading: 'Your Discover Week' },
  info: { tone: 'brand', badge: 'Notification', heading: null },
};

/** Why each audience got the email, for the footer. */
const REASON: Record<EmailAudience, string> = {
  failure_emails: 'You got this email because failure emails are on in your notification settings.',
  success_emails: 'You got this email because success emails are on in your notification settings.',
  digest_emails:
    'You got this email because the weekly digest is on in your notification settings.',
  admins: 'You got this email because you are an admin of this PostGear workspace.',
  none: 'You got this email because of your notification settings in PostGear.',
};

/**
 * The email for a row, as the notification card's props.
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
  const look = LOOK[type];

  return {
    subject: subjectFor(type, title, meta),
    tone: look.tone,
    badge: look.badge,
    heading: look.heading ?? title,
    message: row.content,
    facts: factsFor(type, meta, row.createdAt),
    bullets: type === 'discover.digest' ? highlightsOf(meta) : undefined,
    action: link ? { label: linkLabel(type), url: link } : undefined,
    reason: REASON[AUDIENCE_BY_TYPE[type]],
    settingsUrl: linkTo(`/${row.organizationId}/settings/notifications`),
  };
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
    case 'discover.digest':
      return `${SUBJECT_PREFIX} What is trending${meta.place ? ` in ${meta.place}` : ''} this week`;
    case 'automation':
    case 'automation.review':
    case 'automation.failed':
    case 'automation.paused':
    case 'info':
      return `${SUBJECT_PREFIX} ${title}`;
  }
}

/** The summary card's rows. Labels are Title Case, like table headers. */
function factsFor(type: NotificationType, meta: NotificationMeta, createdAt: Date): Fact[] {
  const facts: Fact[] = [];

  switch (type) {
    case 'post.failed':
    case 'post.published': {
      if (meta.preview) {
        facts.push({ label: 'Post', value: meta.preview });
      }
      if (meta.channelName || meta.provider) {
        facts.push({ label: 'Channel', value: channelPhrase(meta) });
      }
      if (type === 'post.failed') {
        if (meta.reason) {
          facts.push({ label: 'Reason', value: describeReason(meta.reason) });
        }
        if (meta.message) {
          facts.push({ label: 'Details', value: meta.message });
        }
        if (typeof meta.attempts === 'number') {
          facts.push({ label: 'Attempts', value: String(meta.attempts) });
        }
      }
      return facts;
    }
    case 'channel.needs_reconnect':
      if (meta.channelName || meta.provider) {
        facts.push({ label: 'Channel', value: channelPhrase(meta) });
      }
      facts.push({
        label: 'What Happens',
        value: 'Posts scheduled to this channel will fail until it is reconnected.',
      });
      return facts;
    case 'webhook.failed':
      if (meta.webhookName) {
        facts.push({ label: 'Webhook', value: meta.webhookName });
      }
      if (typeof meta.statusCode === 'number') {
        facts.push({ label: 'Last Status', value: String(meta.statusCode) });
      }
      if (meta.error) {
        facts.push({ label: 'Error', value: meta.error });
      }
      return facts;
    case 'billing.activated':
    case 'billing.payment_failed':
    case 'billing.canceled':
    case 'billing.trial_started':
      if (meta.tier) {
        facts.push({ label: 'Plan', value: meta.tier, badge: true });
      }
      if (typeof meta.amountCents === 'number' && Number.isFinite(meta.amountCents)) {
        const currency = typeof meta.currency === 'string' ? meta.currency.toUpperCase() : 'USD';
        facts.push({
          label: 'Amount',
          value: `${(meta.amountCents / 100).toFixed(2)} ${currency}`,
        });
      }
      facts.push({ label: 'Date', value: utcDate(createdAt) });
      return facts;
    case 'discover.digest':
      if (meta.place) {
        facts.push({ label: 'Place', value: meta.place });
      }
      return facts;
    case 'automation':
    case 'automation.review':
    case 'automation.failed':
    case 'automation.paused':
    case 'info':
      return facts;
  }
}

/** Each highlight was cleaned when the feed was read; at most 12. */
function highlightsOf(meta: NotificationMeta): string[] {
  return (Array.isArray(meta.highlights) ? meta.highlights.slice(0, 12) : []).filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
}

function utcDate(date: Date): string {
  return `${date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })} (UTC)`;
}

/** The button's label: Title Case, like every button. */
function linkLabel(type: NotificationType): string {
  switch (type) {
    case 'post.published':
      return 'See The Post';
    case 'post.failed':
      return 'Open The Queue';
    case 'channel.needs_reconnect':
      return 'Reconnect Channel';
    case 'billing.activated':
    case 'billing.payment_failed':
    case 'billing.canceled':
    case 'billing.trial_started':
      return 'Manage Billing';
    case 'webhook.failed':
      return 'Check The Webhook';
    case 'automation':
    case 'automation.failed':
      return 'Open The Run';
    case 'automation.review':
      return 'Review It';
    case 'automation.paused':
      return 'Open The Workflow';
    case 'discover.digest':
      return 'Open Discover';
    case 'info':
      return 'Open PostGear';
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
