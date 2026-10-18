/**
 * What `/v1` returns (Sprint 8, contract §5.3).
 *
 * A public shape, versioned by the path, deliberately simpler than the
 * internal one: a post is identified by its group, its content is plain
 * text per part, and a channel is named by its provider identifier. The
 * mappers in `public-posts.mapper.ts` and `public-channels.mapper.ts` are
 * the only places that translate between the two, and `openapi.document.ts`
 * documents exactly these.
 */
import type { State } from '@postgear/db';
import type { PlanTier } from '../../billing/plans';
import type { ChannelHealth } from '../../channels/channels.service';

export type PublicPostState = State;

export interface PublicPostChannel {
  channelId: string;
  name: string;
  /** The provider identifier: `linkedin`, `x`, `instagram`, … */
  provider: string;
  state: PublicPostState;
  /** The platform permalink once published. */
  url: string | null;
}

export interface PublicPostSummary {
  /** The post's group id: what every `/v1/posts/:id` route takes. */
  id: string;
  state: PublicPostState;
  publishAt: string;
  updatedAt: string;
  /** The first 160 characters of the first part. */
  preview: string;
  channels: PublicPostChannel[];
}

export interface PublicPostPart {
  /** The part as plain text: what a platform receives. */
  text: string;
  media: { id: string; url: string }[];
}

export interface PublicPost extends PublicPostSummary {
  /** The shared parts of the post, in order. A thread has several. */
  parts: PublicPostPart[];
}

export interface PublicPostPage {
  posts: PublicPostSummary[];
  page: number;
  pageCount: number;
  total: number;
}

export interface PublicChannel {
  id: string;
  provider: string;
  providerName: string;
  name: string;
  profile: string | null;
  picture: string | null;
  health: ChannelHealth;
  disabled: boolean;
}

export interface PublicMe {
  workspace: { id: string; name: string };
  key: { id: string; name: string; prefix: string };
  plan: { tier: PlanTier };
}
