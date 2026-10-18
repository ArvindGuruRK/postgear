/**
 * How a post's scheduling state is shown, in one place.
 *
 * The data model has four states; a person sees more than four situations. A
 * queued post whose time has passed is *publishing*, not merely queued; one
 * the worker is backing off on is *retrying*; one that reached two of three
 * channels is *partly published*. The calendar card, the queue row and the
 * detail dialog all read this so they can never disagree about a post.
 *
 * Tones map to the system's action colors: scheduled is primary (the ordinary,
 * expected state), live motion is accent, success is success, failure is
 * danger, and a draft is the outline sticker; see design-system-rules.md §7.
 */
import type { BadgeProps } from '@postgear/ui';
import type {
  PostState,
  PostSummaryChannel,
  PublishFailureReason,
  PublishStatus,
} from '@/types/post';

export type PostTone = 'draft' | 'scheduled' | 'publishing' | 'retrying' | 'published' | 'failed';

export interface PostPresentation {
  tone: PostTone;
  label: string;
  variant: NonNullable<BadgeProps['variant']>;
  /** One line under the label: the next attempt, the failure, the partial outcome. */
  detail: string | null;
  /** True while the worker is expected to change this post without anyone acting. */
  live: boolean;
}

export const FAILURE_LABELS: Record<PublishFailureReason, string> = {
  needs_reconnect: 'Channel needs reconnecting',
  needs_permissions: 'Missing permission on the account',
  rejected: 'Rejected by the platform',
  retries_exhausted: 'Gave up after repeated failures',
  channel_unavailable: 'Channel unavailable',
  interrupted: 'Interrupted mid-publish: check the account before retrying',
  unexpected: 'Unexpected error',
};

/** A channel's own standing, for per-channel rows. */
export function describeChannel(
  channel: Pick<PostSummaryChannel, 'state' | 'publishStatus'>,
  publishDate: string,
  now: Date,
): PostPresentation {
  return describe(channel.state, [channel], publishDate, now);
}

/** A whole post's standing, from its state and every channel's status. */
export function describePost(
  post: {
    state: PostState;
    publishDate: string;
    channels: Pick<PostSummaryChannel, 'state' | 'publishStatus'>[];
  },
  now: Date,
): PostPresentation {
  return describe(post.state, post.channels, post.publishDate, now);
}

function describe(
  state: PostState,
  channels: Pick<PostSummaryChannel, 'state' | 'publishStatus'>[],
  publishDate: string,
  now: Date,
): PostPresentation {
  switch (state) {
    case 'DRAFT':
      return { tone: 'draft', label: 'Draft', variant: 'outline', detail: null, live: false };

    case 'PUBLISHED':
      return {
        tone: 'published',
        label: 'Published',
        variant: 'success',
        detail: null,
        live: false,
      };

    case 'ERROR': {
      const failed = channels.filter((channel) => channel.state === 'ERROR');
      const published = channels.filter((channel) => channel.state === 'PUBLISHED');
      const status = failed.map((channel) => channel.publishStatus).find(isFailure);

      return {
        tone: 'failed',
        label: 'Failed',
        variant: 'danger',
        detail:
          published.length > 0
            ? `Published to ${published.length} of ${channels.length} channels`
            : status
              ? FAILURE_LABELS[status.reason]
              : 'Could not be published',
        live: false,
      };
    }

    case 'QUEUE': {
      const retrying = channels.map((channel) => channel.publishStatus).find(isRetrying);
      const inFlight = channels.some((channel) => channel.publishStatus?.kind === 'in_flight');

      if (inFlight) {
        return {
          tone: 'publishing',
          label: 'Publishing',
          variant: 'accent',
          detail: 'Talking to the platform now',
          live: true,
        };
      }

      if (retrying) {
        return {
          tone: 'retrying',
          label: 'Retrying',
          variant: 'accent',
          detail: `Attempt ${retrying.attempt} of ${retrying.maxAttempts} failed · next try ${formatClock(
            new Date(retrying.nextAttemptAt),
          )}`,
          live: true,
        };
      }

      if (new Date(publishDate).getTime() <= now.getTime()) {
        return {
          tone: 'publishing',
          label: 'Publishing',
          variant: 'accent',
          detail: 'The worker is sending it now',
          live: true,
        };
      }

      return {
        tone: 'scheduled',
        label: 'Scheduled',
        variant: 'primary',
        detail: null,
        live: false,
      };
    }
  }
}

/**
 * True when any channel has already gone out. The API refuses to edit or
 * delete such a post (the platform has it), while the channels still pending
 * can be moved or retried on their own.
 */
export function hasPublishedChannel(post: {
  channels: Pick<PostSummaryChannel, 'state'>[];
}): boolean {
  return post.channels.some((channel) => channel.state === 'PUBLISHED');
}

export function isRetrying(
  status: PublishStatus | null | undefined,
): status is Extract<PublishStatus, { kind: 'retrying' }> {
  return status?.kind === 'retrying';
}

export function isFailure(
  status: PublishStatus | null | undefined,
): status is Extract<PublishStatus, { kind: 'failed' }> {
  return status?.kind === 'failed';
}

/** "10:32" in the viewer's locale. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "Sat 11 Oct, 10:32": the medium form every list and card uses. */
export function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 3 hours", "2 days ago": for the detail dialog's headline. */
export function formatRelative(date: Date, now: Date): string {
  const diffMs = date.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  const span =
    minutes < 1
      ? 'less than a minute'
      : minutes < 60
        ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
        : hours < 48
          ? `${hours} ${hours === 1 ? 'hour' : 'hours'}`
          : `${days} ${days === 1 ? 'day' : 'days'}`;

  return diffMs >= 0 ? `in ${span}` : `${span} ago`;
}
