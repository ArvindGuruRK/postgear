/**
 * The sticker files an export needs (Module 12), fetched into the job's
 * scratch folder before `buildRenderPlan`:
 *
 * - a library sticker from the public media space (`library/stickers/...`,
 *   content-hash keys), when its row is ACTIVE or HIDDEN;
 * - a workspace upload from the private space, when its asset is `ready`.
 *
 * A sticker that is not there (removed from the library, a deleted or failed
 * upload, a lost file) is simply not handed in, so the compiler stops with
 * `sticker_missing` and its sentence, and nothing is charged.
 */
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { type PrivateStorage, type StorageBackend, StorageNotFoundError } from '@postgear/storage';
import {
  type ClipDocument,
  type RenderStickerAsset,
  readStickerAssetMeta,
  stickerFilesNeeded,
} from '@postgear/video-engine';
import type { StickerFileRows } from './rows';

export interface StickerFileDeps {
  rows: StickerFileRows;
  storage: Pick<StorageBackend, 'read'>;
  privateStorage: Pick<PrivateStorage, 'getToFile'>;
}

export async function fetchStickerFiles(
  deps: StickerFileDeps,
  organizationId: string,
  doc: Pick<ClipDocument, 'tracks'>,
  dir: string,
  signal: AbortSignal,
): Promise<Record<string, RenderStickerAsset>> {
  const assets: Record<string, RenderStickerAsset> = {};
  let index = 0;
  for (const ref of stickerFilesNeeded(doc)) {
    signal.throwIfAborted();
    if ('library' in ref) {
      const row = await deps.rows.librarySticker(ref.library);
      if (!row) continue;
      const body = await deps.storage.read(row.fileKey);
      if (!body) continue;
      const file = `sticker-${index}.${row.animated ? 'apng' : 'png'}`;
      await writeFile(path.join(dir, file), body);
      assets[ref.key] = {
        file,
        animated: row.animated,
        width: row.width,
        height: row.height,
        fps: row.animated ? row.fps : null,
        frames: row.animated ? row.frames : null,
      };
    } else {
      const row = await deps.rows.stickerAsset(organizationId, ref.asset);
      const meta = readStickerAssetMeta(row?.meta);
      if (!row || meta?.status !== 'ready') continue;
      const file = `sticker-${index}.${meta.animated ? 'apng' : 'png'}`;
      try {
        await deps.privateStorage.getToFile(row.key, path.join(dir, file), signal);
      } catch (error) {
        if (error instanceof StorageNotFoundError) continue;
        throw error;
      }
      assets[ref.key] = {
        file,
        animated: meta.animated,
        width: meta.width,
        height: meta.height,
        fps: meta.animated ? meta.fps : null,
        frames: meta.animated ? meta.frames : null,
      };
    }
    index += 1;
  }
  return assets;
}
