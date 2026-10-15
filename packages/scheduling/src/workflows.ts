/**
 * Names and ids every workflow is addressed by.
 *
 * ## One workflow per channel, keyed on the channel's root row
 *
 * A post as a person sees it spans several channels, but publishing is a
 * per-channel act with a per-channel outcome, so each channel's chain gets its
 * own workflow. Its id is derived from the chain's **root row id**, which the
 * posts repository keeps stable across every edit and reorder (see the header
 * of `apps/api/src/modules/posts/posts.repository.ts`). A deterministic id is
 * what makes "post now", "reschedule" and "cancel" one `signalWithStart` each,
 * with no search attribute and no listing step: the API knows the id without
 * asking Temporal anything.
 */

/** The task queue every PostGear worker polls. One queue; providers are not yet sharded. */
export const SCHEDULING_TASK_QUEUE = 'postgear-publishing';

export const POST_PUBLISH_WORKFLOW = 'postPublishWorkflow';
export const TOKEN_REFRESH_WORKFLOW = 'tokenRefreshWorkflow';
export const MAINTENANCE_WORKFLOW = 'maintenanceWorkflow';
/** Sprint 7: keeps one channel's metrics current — a daily pull, or on demand. */
export const ANALYTICS_SYNC_WORKFLOW = 'analyticsSyncWorkflow';

/** Wakes a waiting publish or refresh workflow so it re-reads the database. */
export const WAKE_SIGNAL = 'wake';
/** Publishes a queued post as soon as the worker picks it up. */
export const PUBLISH_NOW_SIGNAL = 'publishNow';
/** Ends a waiting publish workflow — the post left the queue. */
export const CANCEL_SIGNAL = 'cancel';
/** Sprint 7: tells a waiting analytics workflow to pull metrics now rather than at its next slot. */
export const SYNC_NOW_SIGNAL = 'syncNow';

export const MAINTENANCE_WORKFLOW_ID = 'maintenance';

export function publishWorkflowId(postId: string): string {
  return `post-publish:${postId}`;
}

export function tokenRefreshWorkflowId(integrationId: string): string {
  return `token-refresh:${integrationId}`;
}

/** Sprint 7: one analytics workflow per channel, keyed like the refresh loop. */
export function analyticsSyncWorkflowId(integrationId: string): string {
  return `analytics-sync:${integrationId}`;
}

export interface PostPublishInput {
  /** The root row of one channel's chain. */
  postId: string;
  organizationId: string;
}

export interface TokenRefreshInput {
  integrationId: string;
  organizationId: string;
}

/** Sprint 7: the analytics workflow's input — the same two ids as a refresh. */
export interface AnalyticsSyncInput {
  integrationId: string;
  organizationId: string;
}

/**
 * How many days of channel metrics a sync asks the platform for. 90 covers
 * the longest range the Analytics page offers; a daily sync re-reads the
 * whole window so a platform that revises recent days is reflected.
 */
export const ANALYTICS_SYNC_WINDOW_DAYS = 90;

/** How many published posts per channel a sync reads metrics for, newest first. */
export const ANALYTICS_SYNC_MAX_POSTS = 50;

/**
 * Why an analytics workflow ended without a sync. Mirrors the refresh
 * loop's reasons: the workflow exits and the maintenance reconcile starts a
 * new one once the channel is usable again.
 */
export type AnalyticsSyncSkipReason =
  | 'gone'
  | 'needs_reconnect'
  | 'not_set_up'
  | 'disabled'
  | 'unsupported';

/** Why a publish workflow ended without publishing. */
export type PublishSkipReason = 'deleted' | 'not_queued' | 'not_root' | 'channel_gone';

export type PostPublishOutcome =
  | { outcome: 'published'; releaseURL: string | null }
  | { outcome: 'skipped'; reason: PublishSkipReason }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; reason: PublishFailureReason };

/**
 * Why a publish failed for good.
 *
 * - `needs_reconnect` — the credentials are dead and could not be refreshed.
 * - `needs_permissions` — the account never granted a scope the post needs.
 * - `rejected` — the platform refused the content; it has to change.
 * - `retries_exhausted` — transient failures every time, for the whole policy.
 * - `channel_unavailable` — the channel was disabled or removed while waiting.
 * - `interrupted` — an earlier attempt died after it may have reached the
 *   platform, so a retry could post twice; a person has to check the account.
 * - `unexpected` — a bug or an unclassified error, after the retry policy.
 */
export type PublishFailureReason =
  | 'needs_reconnect'
  | 'needs_permissions'
  | 'rejected'
  | 'retries_exhausted'
  | 'channel_unavailable'
  | 'interrupted'
  | 'unexpected';

/**
 * `ApplicationFailure.type` values the publish activity throws, and the
 * workflow branches on. Listed as data so the retry policy can name the
 * non-retryable ones and the workflow can switch on them without a shared
 * class — Temporal only carries the type *string* across the activity boundary.
 */
export const PUBLISH_FAILURE_TYPES = {
  /** 429, 5xx, network: retried by the activity retry policy. */
  retryable: 'PublishRetryable',
  /** Dead credentials: the workflow tries a refresh, then fails as `needs_reconnect`. */
  refreshToken: 'PublishRefreshToken',
  /** Content the platform refuses. */
  badBody: 'PublishBadBody',
  /** A scope the account never granted. */
  notEnoughScopes: 'PublishNotEnoughScopes',
  /** The channel is disabled, half set up, or its platform is not configured here. */
  channelUnavailable: 'PublishChannelUnavailable',
  /** An earlier attempt was cut off after it may have reached the platform. */
  interrupted: 'PublishInterrupted',
  /** The post or channel is no longer publishable; not an error. */
  skipped: 'PublishSkipped',
} as const;

export const NON_RETRYABLE_PUBLISH_FAILURES: string[] = [
  PUBLISH_FAILURE_TYPES.refreshToken,
  PUBLISH_FAILURE_TYPES.badBody,
  PUBLISH_FAILURE_TYPES.notEnoughScopes,
  PUBLISH_FAILURE_TYPES.channelUnavailable,
  PUBLISH_FAILURE_TYPES.interrupted,
  PUBLISH_FAILURE_TYPES.skipped,
];
