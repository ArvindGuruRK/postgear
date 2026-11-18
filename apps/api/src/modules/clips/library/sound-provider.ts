/**
 * Where sounds come from (Module 14): the same swap point as stickers. The
 * one binding is PostGear's own catalogue (`CatalogueSoundProvider`, reading
 * `ClipSound`); a paid music licence would implement the same interface and
 * copy what it uses into our storage first (Module 21, after a decision).
 *
 * Every catalogue sound is OWN, CC0 or the Public Domain Mark, so `credit` is
 * always null; its details line names the source, author and licence.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { StorageBackend } from '@postgear/storage';
import {
  isSoundCategory,
  type LibrarySoundView,
  SOUND_PEAKS,
  type SoundCategory,
  type SoundKind,
} from '@postgear/video-engine';
import { STORAGE_BACKEND } from '../../media/storage/storage.interface';
import { ClipLibraryRepository, type SoundRow, stickerTsQuery } from './clip-library.repository';

export interface SoundSearchRequest {
  q?: string;
  kind?: SoundKind;
  category?: SoundCategory;
  favouritesOnly: boolean;
  page: number;
  pageSize: number;
  orgId: string;
}

export interface SoundSearchResult {
  items: LibrarySoundView[];
  total: number;
}

/** A sound a clip uses; `active` is false for a HIDDEN one (it keeps playing). */
export type ResolvedSound = LibrarySoundView & { active: boolean };

export interface SoundProvider {
  search(request: SoundSearchRequest): Promise<SoundSearchResult>;
  /**
   * The sounds of these ids a clip may still play (ACTIVE or HIDDEN), and the
   * ids taken out of the library after a rights request (REMOVED).
   */
  resolve(orgId: string, ids: string[]): Promise<{ sounds: ResolvedSound[]; removed: string[] }>;
}

export const SOUND_PROVIDER = Symbol('SOUND_PROVIDER');

/** Peaks as the answer carries them: exactly `SOUND_PEAKS` whole numbers, 0 to 255. */
export function peaksOf(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length: SOUND_PEAKS }, (_, k) => {
    const peak = Number(list[k]);
    return Number.isFinite(peak) ? Math.min(255, Math.max(0, Math.round(peak))) : 0;
  });
}

@Injectable()
export class CatalogueSoundProvider implements SoundProvider {
  constructor(
    private readonly repository: ClipLibraryRepository,
    @Inject(STORAGE_BACKEND) private readonly storage: StorageBackend,
  ) {}

  async search(request: SoundSearchRequest): Promise<SoundSearchResult> {
    const { rows, total } = await this.repository.searchSounds(request.orgId, {
      tsQuery: stickerTsQuery(request.q),
      kind: request.kind,
      category: request.category,
      favouritesOnly: request.favouritesOnly,
      limit: request.pageSize,
      offset: (request.page - 1) * request.pageSize,
    });
    return { items: rows.flatMap((row) => this.view(row) ?? []), total };
  }

  async resolve(
    orgId: string,
    ids: string[],
  ): Promise<{ sounds: ResolvedSound[]; removed: string[] }> {
    const rows = await this.repository.soundsByIds(orgId, ids);
    const sounds: ResolvedSound[] = [];
    const removed: string[] = [];
    for (const row of rows) {
      if (row.status === 'REMOVED') {
        removed.push(row.id);
        continue;
      }
      const view = this.view(row);
      if (view) sounds.push({ ...view, active: row.status === 'ACTIVE' });
    }
    return { sounds, removed };
  }

  /** The answer for one row; a row whose category is not one of ours is left out. */
  private view(row: SoundRow): LibrarySoundView | null {
    if (!isSoundCategory(row.category)) return null;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === 'MUSIC' ? 'music' : 'sfx',
      category: row.category,
      tags: row.tags,
      durationMs: row.durationMs,
      bpm: row.bpm,
      previewUrl: this.storage.publicUrl(row.fileKey),
      peaks: peaksOf(row.peaks),
      isFavourite: row.isFavourite,
      credit: null,
      details: {
        source: row.sourceName,
        author: row.author,
        licence: row.licence,
        licenceUrl: row.licenceUrl,
        sourceUrl: row.sourceUrl,
      },
    };
  }
}
