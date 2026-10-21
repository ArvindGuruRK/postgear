/**
 * Search result shapes, mirroring what `GET /search` returns (2026-10-21).
 *
 * Each result is the same shape the rest of the app already shows for that
 * kind: a post is a `PostSummary` plus the words around the match, a channel
 * carries what its row draws, a media item its name and thumbnail.
 */
import type { ChannelHealth } from './channel';
import type { MediaKind } from './media';
import type { PostSummary } from './post';

export type SearchKind = 'posts' | 'channels' | 'media';

export interface PostSearchResult extends PostSummary {
  /** The words around the match, already cut to a line or two. */
  snippet: string;
}

export interface ChannelSearchResult {
  id: string;
  name: string;
  profile: string | null;
  picture: string | null;
  providerIdentifier: string;
  providerName: string;
  /** The avatar palette slot: see `Channel.color`. */
  color: number;
  health: ChannelHealth;
}

export interface MediaSearchResult {
  id: string;
  name: string;
  type: MediaKind;
  url: string;
  thumbnailUrl: string | null;
}

export interface SearchResponse {
  /** The search as the API cleaned it; compare with what was typed to drop a stale answer. */
  query: string;
  posts: PostSearchResult[];
  channels: ChannelSearchResult[];
  media: MediaSearchResult[];
  /** Kinds with more matches than were returned. */
  more: Record<SearchKind, boolean>;
  /** Kinds that could not be searched this time. */
  unavailable: SearchKind[];
}
