/**
 * The shapes the PostGear public API (`/v1`) sends and accepts, as the SDK
 * types them. They mirror docs/sprint-documents/sprint-08-contract.md §5.3
 * and the live OpenAPI document at `<API_URL>/api/docs-json`; the SDK carries
 * its own copies because it is published without the rest of the monorepo.
 */

export type PostState = 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR';

export type ChannelHealth = 'connected' | 'needs_reconnect' | 'needs_setup' | 'expiring' | 'disabled';

export interface Workspace {
  id: string;
  name: string;
}

export interface Me {
  workspace: Workspace;
  key: { id: string; name: string; prefix: string };
  plan: { tier: 'FREE' | 'STANDARD' | 'PRO' | 'TEAM' | 'ULTIMATE' };
}

export interface Channel {
  id: string;
  provider: string;
  providerName: string;
  name: string;
  profile: string | null;
  picture: string | null;
  health: ChannelHealth;
  disabled: boolean;
}

export interface PostChannelSummary {
  channelId: string;
  name: string;
  provider: string;
  state: PostState;
  /** The platform permalink once published. */
  url: string | null;
}

export interface PostSummary {
  /** The post as a person sees it, across every channel. */
  id: string;
  state: PostState;
  publishAt: string;
  updatedAt: string;
  preview: string;
  channels: PostChannelSummary[];
}

export interface PostPart {
  text: string;
  media: { id: string; url: string }[];
}

export interface Post extends PostSummary {
  parts: PostPart[];
}

export interface PostPage {
  posts: PostSummary[];
  page: number;
  pageCount: number;
  total: number;
}

export interface CreatePostInput {
  /** Plain text. A blank line starts a new paragraph; a newline is a line break. */
  text: string;
  channelIds: string[];
  /** ISO 8601. Defaults to five minutes from now for a queued post. */
  publishAt?: string;
  /** `'queue'` (default) publishes at `publishAt`; `'draft'` only saves. */
  state?: 'draft' | 'queue';
  /** Ids of media already in the workspace's library. */
  mediaIds?: string[];
}

export interface ListPostsQuery {
  page?: number;
  state?: PostState;
}

export type AnalyticsRange = 7 | 30 | 90;

/**
 * The analytics overview, as `GET /analytics/overview` in the app returns it.
 * Typed loosely here: the full shape is in the OpenAPI document, and it grows
 * with the product faster than this package is released.
 */
export type AnalyticsOverview = Record<string, unknown>;

/** The envelope of every outbound webhook delivery. */
export interface WebhookEvent<TData = WebhookPostEventData> {
  id: string;
  event: 'post.published' | 'post.failed' | 'webhook.test';
  createdAt: string;
  workspaceId: string;
  data: TData;
}

export interface WebhookPostEventData {
  post: {
    id: string;
    rootId: string;
    state: PostState;
    publishAt: string;
    url: string | null;
    preview: string;
    channel: { id: string; name: string; provider: string };
  };
  error?: { reason: string; message: string; attempts: number };
}
