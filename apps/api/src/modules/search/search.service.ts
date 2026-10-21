/**
 * Workspace search (2026-10-21): one request that looks through the posts,
 * channels and media library of the active workspace.
 *
 * It owns no table. Each kind is searched by the module that owns it
 * (`PostsService`, `ChannelsService`, `MediaService`), so a search can never
 * see a row, or hide a deleted one, differently from the page that lists
 * those rows. Every call carries the caller's `orgId`; nothing here reads a
 * workspace from the request.
 *
 * The three run side by side, and one failing does not blank the others: a
 * media-store hiccup should not hide the post a person is looking for. The
 * kinds that failed are named in `unavailable`, so the UI can say so instead
 * of showing "no results" for something that was never checked.
 */
import { Injectable, Logger } from '@nestjs/common';
import { searchTerms } from '../../common/search-terms';
import { type ChannelSearchHit, ChannelsService } from '../channels/channels.service';
import { type MediaSearchHit, MediaService } from '../media/media.service';
import { type PostSearchHit, PostsService } from '../posts/posts.service';

/** Results per kind. Enough to find the one wanted; the rest is `more`. */
export const SEARCH_LIMITS = { posts: 6, channels: 4, media: 4 } as const;

export type SearchKind = keyof typeof SEARCH_LIMITS;

export interface SearchResults {
  query: string;
  posts: PostSearchHit[];
  channels: ChannelSearchHit[];
  media: MediaSearchHit[];
  /** Kinds with more matches than were returned. */
  more: Record<SearchKind, boolean>;
  /** Kinds that could not be searched this time. */
  unavailable: SearchKind[];
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly posts: PostsService,
    private readonly channels: ChannelsService,
    private readonly media: MediaService,
  ) {}

  async search(orgId: string, query: string): Promise<SearchResults> {
    const terms = searchTerms(query);

    const [posts, channels, media] = await Promise.allSettled([
      this.posts.search(orgId, terms, SEARCH_LIMITS.posts),
      this.channels.search(orgId, terms, SEARCH_LIMITS.channels),
      this.media.search(orgId, terms, SEARCH_LIMITS.media),
    ]);

    const unavailable: SearchKind[] = [];

    const settle = <T>(kind: SearchKind, outcome: PromiseSettledResult<T>): T | null => {
      if (outcome.status === 'fulfilled') {
        return outcome.value;
      }

      // The reason can carry row data; log that it failed and why, never the query.
      this.logger.error(
        `Search of ${kind} failed: ${outcome.reason instanceof Error ? outcome.reason.message : 'unknown error'}`,
      );
      unavailable.push(kind);
      return null;
    };

    const foundPosts = settle('posts', posts);
    const foundChannels = settle('channels', channels);
    const foundMedia = settle('media', media);

    return {
      query,
      posts: foundPosts?.posts ?? [],
      channels: foundChannels?.channels ?? [],
      media: foundMedia?.media ?? [],
      more: {
        posts: foundPosts?.more ?? false,
        channels: foundChannels?.more ?? false,
        media: foundMedia?.more ?? false,
      },
      unavailable,
    };
  }
}
