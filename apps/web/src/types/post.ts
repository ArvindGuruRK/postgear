/**
 * Post shapes, mirroring what `/posts` returns.
 *
 * A "post" here is what a person means by one: a group spanning every channel
 * and every part of a thread. The rows behind it never reach the browser.
 */
import type { PostDocument } from '@postgear/social-core/composer';
import type { MediaItem } from './media';

export type PostState = 'DRAFT' | 'QUEUE' | 'PUBLISHED' | 'ERROR';

export interface PostPart {
  content: PostDocument;
  media: MediaItem[];
  /** Attachments deleted from the library after the post was saved. */
  removedMedia: number;
}

export interface PostChannel {
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

export interface PostSummary {
  group: string;
  state: PostState;
  publishDate: string;
  updatedAt: string;
  preview: string;
  parts: number;
  channels: Pick<
    PostChannel,
    'channelId' | 'name' | 'providerIdentifier' | 'picture' | 'disconnected'
  >[];
}
