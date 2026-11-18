/**
 * Where stickers come from (Module 12): the swap point the sprint doc names.
 *
 * The one binding is PostGear's own catalogue (`CatalogueStickerProvider`,
 * reading `ClipSticker`). A commercial provider, if users ask for a bigger
 * library, implements the same interface and must copy the items it uses
 * into our storage first: that is Module 21's, with its own legal read.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { StorageBackend } from '@postgear/storage';
import {
  isStickerCategory,
  type LibraryStickerView,
  type StickerCategory,
  type StickerKind,
} from '@postgear/video-engine';
import { STORAGE_BACKEND } from '../../media/storage/storage.interface';
import { ClipLibraryRepository, type StickerRow, stickerTsQuery } from './clip-library.repository';

export interface StickerSearchRequest {
  q?: string;
  kind?: StickerKind;
  category?: StickerCategory;
  favouritesOnly: boolean;
  page: number;
  pageSize: number;
  orgId: string;
}

export interface StickerSearchResult {
  items: LibraryStickerView[];
  total: number;
}

/** A sticker a clip uses, as the editor draws it; `active` is false for a HIDDEN one (it keeps working). */
export type ResolvedSticker = LibraryStickerView & { active: boolean };

export interface StickerProvider {
  search(request: StickerSearchRequest, signal?: AbortSignal): Promise<StickerSearchResult>;
  /** The stickers of these ids that a clip may still draw (ACTIVE or HIDDEN). */
  resolve(orgId: string, ids: string[]): Promise<ResolvedSticker[]>;
}

export const STICKER_PROVIDER = Symbol('STICKER_PROVIDER');

@Injectable()
export class CatalogueStickerProvider implements StickerProvider {
  constructor(
    private readonly repository: ClipLibraryRepository,
    @Inject(STORAGE_BACKEND) private readonly storage: StorageBackend,
  ) {}

  async search(request: StickerSearchRequest): Promise<StickerSearchResult> {
    const { rows, total } = await this.repository.search(request.orgId, {
      tsQuery: stickerTsQuery(request.q),
      kind: request.kind,
      category: request.category,
      favouritesOnly: request.favouritesOnly,
      limit: request.pageSize,
      offset: (request.page - 1) * request.pageSize,
    });
    return { items: rows.flatMap((row) => this.view(row) ?? []), total };
  }

  async resolve(orgId: string, ids: string[]): Promise<ResolvedSticker[]> {
    const rows = await this.repository.stickersByIds(orgId, ids);
    return rows.flatMap((row) => {
      const view = this.view(row);
      return view ? [{ ...view, active: row.status === 'ACTIVE' }] : [];
    });
  }

  /** The answer for one row; a row whose category is not one of ours is left out. */
  private view(row: StickerRow): LibraryStickerView | null {
    if (!isStickerCategory(row.category)) return null;
    const animated = row.kind === 'ANIMATED';
    return {
      id: row.id,
      name: row.name,
      kind: animated ? 'animated' : 'static',
      category: row.category,
      tags: row.tags,
      width: row.width,
      height: row.height,
      durationMs: animated ? row.durationMs : null,
      fps: animated ? row.fps : null,
      frames: animated ? row.frames : null,
      previewUrl: row.previewKey ? this.storage.publicUrl(row.previewKey) : null,
      fileUrl: this.storage.publicUrl(row.fileKey),
      isFavourite: row.isFavourite,
      credit:
        row.requiresCredit && row.creditLine ? { line: row.creditLine, url: row.sourceUrl } : null,
    };
  }
}
