/**
 * The sound files an export needs (Module 14), fetched into the job's
 * scratch folder before `buildRenderPlan`, keyed by `soundRefKey`:
 *
 * - a library sound from the public media space (`library/sounds/...`,
 *   content-hash keys), when its row is ACTIVE or HIDDEN;
 * - a workspace upload from the private space, when its asset is `ready`.
 *
 * Each is written as `sound-<k>.m4a` with its own length. A sound that is not
 * there (removed from the library, a deleted or failed upload, a lost file)
 * is simply not handed in, so the compiler stops with `sound_missing` and
 * its sentence, and nothing is charged.
 */
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { type PrivateStorage, type StorageBackend, StorageNotFoundError } from '@postgear/storage';
import {
  type ClipDocument,
  type RenderSoundAsset,
  readSoundAssetMeta,
  soundFilesNeeded,
} from '@postgear/video-engine';
import type { SoundFileRows } from './rows';

export interface SoundFileDeps {
  rows: SoundFileRows;
  storage: Pick<StorageBackend, 'read'>;
  privateStorage: Pick<PrivateStorage, 'getToFile'>;
}

export async function fetchSoundFiles(
  deps: SoundFileDeps,
  organizationId: string,
  doc: Pick<ClipDocument, 'tracks'>,
  dir: string,
  signal: AbortSignal,
): Promise<Record<string, RenderSoundAsset>> {
  const assets: Record<string, RenderSoundAsset> = {};
  let index = 0;
  for (const ref of soundFilesNeeded(doc)) {
    signal.throwIfAborted();
    const file = `sound-${index}.m4a`;
    if ('library' in ref) {
      const row = await deps.rows.librarySound(ref.library);
      if (!row || !(row.durationMs > 0)) continue;
      const body = await deps.storage.read(row.fileKey);
      if (!body) continue;
      await writeFile(path.join(dir, file), body);
      assets[ref.key] = { file, durationMs: row.durationMs };
    } else {
      const row = await deps.rows.soundAsset(organizationId, ref.asset);
      const meta = readSoundAssetMeta(row?.meta);
      if (!row || meta?.status !== 'ready') continue;
      try {
        await deps.privateStorage.getToFile(row.key, path.join(dir, file), signal);
      } catch (error) {
        if (error instanceof StorageNotFoundError) continue;
        throw error;
      }
      assets[ref.key] = { file, durationMs: meta.durationMs };
    }
    index += 1;
  }
  return assets;
}
