/**
 * The Elements tab's library (Module 12 section 4) and the Audio tab's
 * (Module 14 section 4): search, the category chips, favourites, and the
 * public credits.
 *
 * - Every route but credits needs Clips in the plan (`clips.enabled`, through
 *   the resolver) and shares one throttle: 60 requests a minute a workspace.
 * - A search that finds nothing answers the nearest categories as `suggest`
 *   and counts the miss, so the catalogue can grow where people look.
 * - Favourites are per workspace; a sticker or sound that leaves the library
 *   (hidden or removed) drops off them, since only ACTIVE ones are listed.
 */
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  creditGroupFor,
  LIBRARY_CREDIT_GROUPS,
  type LibraryCategoryCount,
  type LibraryCreditSource,
  type LibraryCreditsView,
  type LibrarySearchPage,
  type LibrarySoundPage,
  SOUND_CATEGORIES,
  SOUND_CATEGORY_NAMES,
  type SoundCategory,
  type SoundCategoryCount,
  type SoundKind,
  STICKER_CATEGORIES,
  STICKER_CATEGORY_NAMES,
  type StickerCategory,
  type StickerKind,
  soundKindOfCategory,
} from '@postgear/video-engine';
import { RedisService } from '../../redis/redis.service';
import { ClipErrorException } from '../clip-error.exception';
import { ClipLimitsGuard } from '../limits/clip-limits.guard';
import { withinRate } from '../links/clip-rate-limit';
import { ClipLibraryRepository, missTerm, stickerTsQuery } from './clip-library.repository';
import type {
  CategoriesQuery,
  FavouriteBody,
  LibraryItemType,
  SearchSoundsQuery,
  SearchStickersQuery,
} from './clip-library.schemas';
import { SOUND_PROVIDER, type SoundProvider } from './sound-provider';
import { STICKER_PROVIDER, type StickerProvider } from './sticker-provider';

/** The library's throttle, per workspace (section 4). */
export const LIBRARY_REQUESTS_PER_MINUTE = 60;
/** How many categories a search with no result suggests. */
const SUGGESTIONS = 3;

@Injectable()
export class ClipLibraryService {
  constructor(
    private readonly repository: ClipLibraryRepository,
    @Inject(STICKER_PROVIDER) private readonly provider: StickerProvider,
    private readonly limits: ClipLimitsGuard,
    private readonly redis: RedisService,
    @Inject(SOUND_PROVIDER) private readonly sounds: SoundProvider,
  ) {}

  /** The plan check and the shared throttle every workspace route of the library goes through. */
  async admit(orgId: string): Promise<void> {
    if (
      !(await withinRate(
        this.redis,
        `clips:library:rate:${orgId}`,
        LIBRARY_REQUESTS_PER_MINUTE,
        60,
      ))
    ) {
      throw new ClipErrorException(HttpStatus.TOO_MANY_REQUESTS, 'library_throttled');
    }
    await this.limits.assertEnabled(orgId);
  }

  async search(orgId: string, query: SearchStickersQuery): Promise<LibrarySearchPage> {
    await this.admit(orgId);
    const { items, total } = await this.provider.search({
      q: query.q,
      kind: query.kind,
      category: query.category,
      favouritesOnly: query.favourites === 'true',
      page: query.page,
      pageSize: query.pageSize,
      orgId,
    });
    const page: LibrarySearchPage = {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    };
    // Only a real search that found nothing at all is a miss (not an empty Favourites tab).
    if (total === 0 && query.q && stickerTsQuery(query.q) && query.favourites !== 'true') {
      const term = missTerm(query.q);
      if (term) await this.repository.recordMiss(term);
      page.suggest = await this.suggest(query.q, query.kind);
    }
    return page;
  }

  /** The Audio tab's search (Module 14): ACTIVE sounds, a miss counted with its nearest categories. */
  async searchSounds(orgId: string, query: SearchSoundsQuery): Promise<LibrarySoundPage> {
    await this.admit(orgId);
    const { items, total } = await this.sounds.search({
      q: query.q,
      kind: query.kind,
      category: query.category,
      favouritesOnly: query.favourites === 'true',
      page: query.page,
      pageSize: query.pageSize,
      orgId,
    });
    const page: LibrarySoundPage = {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      hasMore: query.page * query.pageSize < total,
    };
    if (total === 0 && query.q && stickerTsQuery(query.q) && query.favourites !== 'true') {
      const term = missTerm(query.q);
      if (term) await this.repository.recordMiss(term, 'sound');
      page.suggest = await this.suggestSounds(query.q, query.kind ?? (query.category ? soundKindOfCategory(query.category) : undefined));
    }
    return page;
  }

  /** The chips: categories with ACTIVE stickers (or sounds) of this kind, in the taxonomy's order. */
  async categories(
    orgId: string,
    query: CategoriesQuery,
  ): Promise<{ categories: LibraryCategoryCount[] | SoundCategoryCount[] }> {
    await this.admit(orgId);
    if (query.type === 'sound') return { categories: await this.countedSounds(query.kind) };
    return { categories: await this.counted(query.kind) };
  }

  async favourite(
    orgId: string,
    userId: string,
    body: FavouriteBody,
  ): Promise<{ favourite: true }> {
    await this.admit(orgId);
    if (body.type === 'sound') {
      if (!(await this.repository.isSoundActive(body.itemId))) {
        throw new ClipErrorException(HttpStatus.NOT_FOUND, 'sound_not_found');
      }
      await this.repository.addSoundFavourite(orgId, userId, body.itemId);
      return { favourite: true };
    }
    if (!(await this.repository.isActive(body.itemId))) {
      throw new ClipErrorException(HttpStatus.NOT_FOUND, 'sticker_not_found');
    }
    await this.repository.addFavourite(orgId, userId, body.itemId);
    return { favourite: true };
  }

  async unfavourite(orgId: string, itemId: string, type: LibraryItemType = 'sticker'): Promise<void> {
    await this.admit(orgId);
    if (type === 'sound') await this.repository.removeSoundFavourite(orgId, itemId);
    else await this.repository.removeFavourite(orgId, itemId);
  }

  /** The public credits page: each source with stickers or sounds in use, in its group. */
  async credits(): Promise<LibraryCreditsView> {
    const sources = await this.repository.creditSources();
    const grouped = new Map<string, LibraryCreditSource[]>();
    for (const source of sources) {
      const group = creditGroupFor(source);
      const list = grouped.get(group) ?? [];
      list.push({
        name: source.name,
        author: source.author,
        url: source.url,
        licence: source.licence,
        licenceUrl: source.licenceUrl,
        creditLine: source.creditLine,
        changeNote: source.changeNote,
        noticeText: source.noticeText,
        stickers: source.stickers,
        sounds: source.sounds ?? 0,
      });
      grouped.set(group, list);
    }
    return {
      groups: LIBRARY_CREDIT_GROUPS.filter((group) => grouped.has(group)).map((group) => ({
        group,
        sources: grouped.get(group) ?? [],
      })),
    };
  }

  private async counted(kind?: StickerKind): Promise<LibraryCategoryCount[]> {
    const counts = new Map(
      (await this.repository.categoryCounts(kind)).map((row) => [row.category, row.count]),
    );
    return STICKER_CATEGORIES.filter((slug) => (counts.get(slug) ?? 0) > 0).map((slug) => ({
      slug,
      name: STICKER_CATEGORY_NAMES[slug],
      count: counts.get(slug) ?? 0,
    }));
  }

  private async countedSounds(kind?: SoundKind): Promise<SoundCategoryCount[]> {
    const counts = new Map(
      (await this.repository.soundCategoryCounts(kind)).map((row) => [row.category, row.count]),
    );
    return SOUND_CATEGORIES.filter(
      (slug) => (counts.get(slug) ?? 0) > 0 && (!kind || soundKindOfCategory(slug) === kind),
    ).map((slug) => ({
      slug,
      name: SOUND_CATEGORY_NAMES[slug],
      count: counts.get(slug) ?? 0,
    }));
  }

  /** The nearest sound categories for a search that found nothing, the same way as stickers. */
  private async suggestSounds(q: string, kind?: SoundKind): Promise<SoundCategoryCount[]> {
    const words = missTerm(q)
      .split(' ')
      .filter((word) => word.length >= 2);
    const named = (slug: SoundCategory) =>
      [slug, ...SOUND_CATEGORY_NAMES[slug].toLowerCase().split(/[^a-z]+/)]
        .filter((part) => part.length > 3)
        .some((part) => words.some((word) => part.startsWith(word)));
    const counted = await this.countedSounds(kind);
    const ranked = [...counted].sort(
      (a, b) => Number(named(b.slug)) - Number(named(a.slug)) || b.count - a.count,
    );
    return ranked.slice(0, SUGGESTIONS);
  }

  /**
   * The nearest categories for a search that found nothing: any with a name
   * word that a searched word begins ("shape" for Arrows And Shapes) first,
   * then the fullest.
   */
  private async suggest(q: string, kind?: StickerKind): Promise<LibraryCategoryCount[]> {
    const words = missTerm(q)
      .split(' ')
      .filter((word) => word.length >= 2);
    const named = (slug: StickerCategory) =>
      STICKER_CATEGORY_NAMES[slug]
        .toLowerCase()
        .split(' ')
        .filter((part) => part.length > 3)
        .some((part) => words.some((word) => part.startsWith(word)));
    const counted = await this.counted(kind);
    const ranked = [...counted].sort(
      (a, b) => Number(named(b.slug)) - Number(named(a.slug)) || b.count - a.count,
    );
    return ranked.slice(0, SUGGESTIONS);
  }
}
