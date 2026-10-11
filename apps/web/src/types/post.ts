/**
 * Post shapes, mirroring what `/posts` returns.
 *
 * A "post" here is what a person means by one: a group spanning every channel
 * and every part of a thread. The rows behind it never reach the browser.
 */
import type { PostDocument } from '@postgear/social-core/composer';
import type { MediaItem } from './media';

export type PostState = 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR';

/**
 * Why a publish failed for good (Sprint 5). Mirrors `PublishFailureReason` in
 * `@postgear/scheduling`, declared here for the reason `channel.ts` gives: the
 * browser bundle imports no server package.
 */
export type PublishFailureReason =
  | 'needs_reconnect'
  | 'needs_permissions'
  | 'rejected'
  | 'retries_exhausted'
  | 'channel_unavailable'
  | 'interrupted'
  | 'unexpected';

/** What the worker last recorded about a channel's publish. */
export type PublishStatus =
  | {
      /** The platform is being called right now (or an earlier attempt was cut off). */
      kind: 'in_flight';
      attempt: number;
      startedAt: string;
    }
  | {
      kind: 'retrying';
      attempt: number;
      maxAttempts: number;
      nextAttemptAt: string;
      message: string;
      updatedAt: string;
    }
  | {
      kind: 'failed';
      reason: PublishFailureReason;
      message: string;
      attempts: number;
      failedAt: string;
    };

/** Where one channel's publish stands. */
export interface ChannelPublish {
  /** This channel's own state; the post's state is the worst of its channels. */
  state: PostState;
  /** The platform permalink, once published. */
  releaseURL: string | null;
  publishStatus: PublishStatus | null;
}

export interface PostPart {
  content: PostDocument;
  media: MediaItem[];
  /** Attachments deleted from the library after the post was saved. */
  removedMedia: number;
}

export interface PostChannel extends ChannelPublish {
  channelId: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
  profile: string | null;
  customized: boolean;
  /** The channel was disconnected after the post was saved. */
  disconnected: boolean;
  parts: PostPart[];
}

export interface PostDetail {
  group: string;
  state: PostState;
  publishDate: string;
  /** Sent back as `expectedUpdatedAt`, so a stale save is refused. */
  updatedAt: string;
  shared: PostPart[];
  channels: PostChannel[];
}

export interface PostSummaryChannel extends ChannelPublish {
  channelId: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
  disconnected: boolean;
}

export interface PostSummary {
  group: string;
  state: PostState;
  publishDate: string;
  updatedAt: string;
  preview: string;
  parts: number;
  channels: PostSummaryChannel[];
}

/** One page of `GET /posts/queue`. */
export interface QueuePage {
  posts: PostSummary[];
  page: number;
  pageCount: number;
  total: number;
}

/** `GET /scheduling/status` — whether anything would actually publish. */
export interface SchedulerStatus {
  reachable: boolean;
  /** Null when the scheduler itself is unreachable. */
  workerOnline: boolean | null;
  taskQueue: string;
  retryPolicy: {
    initialIntervalMs: number;
    backoffCoefficient: number;
    maximumIntervalMs: number;
    maximumAttempts: number;
  };
}
