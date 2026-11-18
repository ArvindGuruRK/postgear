/**
 * The check a workspace's uploaded sound goes through (Module 14,
 * `clipSoundCheckWorkflow`):
 *
 * 1. Read the asset row (kind AUDIO, `meta.purpose: 'sound'`, `meta.status:
 *    'checking'`); any other state answers what the row already says, so a
 *    retry changes nothing.
 * 2. Fetch the original from the private space; sniff its real type (MP3,
 *    WAV, M4A or AAC, by its bytes).
 * 3. `convertUploadedSound`: ffprobe (a sound only, at most 10 minutes), the
 *    editor's AAC `.m4a` at 48 kHz in stereo with its level kept, and the
 *    100 peaks.
 * 4. Store it under a new random `clips/<org>/library/` key, then point the
 *    row at it with its facts (`ready`), conditional on it still being
 *    `checking`. The original is deleted afterwards.
 * 5. A file that is not a sound we use, or is too long, becomes `failed`
 *    with the reason: its file is deleted and it weighs nothing.
 *
 * Uploads never enter the shared library.
 */
import { open, rename } from 'node:fs/promises';
import * as path from 'node:path';
import {
  convertUploadedSound,
  type RunTool,
  SoundError,
  sniffSoundType,
  UPLOAD_SOUND_TYPES,
  withScratch,
} from '@postgear/media-tools';
import { clipKeys, type PrivateStorage, StorageNotFoundError } from '@postgear/storage';
import { readSoundAssetMeta, type SoundAssetMeta } from '@postgear/video-engine';

type ReadySoundMeta = Extract<SoundAssetMeta, { status: 'ready' }>;
type SoundCheckError = Extract<SoundAssetMeta, { status: 'failed' }>['error'];

/** What a check answers: the row's state after it. */
export type SoundCheckAnswer =
  | { status: 'ready'; meta: ReadySoundMeta }
  | { status: 'failed'; error: SoundCheckError }
  | { status: 'gone' };

export interface SoundAssetRow {
  id: string;
  organizationId: string;
  key: string;
  meta: unknown;
}

export interface SoundCheckRows {
  /** The workspace's AUDIO asset, or null. */
  soundAsset(organizationId: string, assetId: string): Promise<SoundAssetRow | null>;
  /** Points the row at the made file; false when it was no longer `checking` (deleted meanwhile). */
  markSoundReady(
    organizationId: string,
    assetId: string,
    made: { key: string; bytes: number; mimeType: string; meta: ReadySoundMeta },
  ): Promise<boolean>;
  markSoundFailed(
    organizationId: string,
    assetId: string,
    meta: Extract<SoundAssetMeta, { status: 'failed' }>,
  ): Promise<boolean>;
}

export interface SoundCheckDeps {
  rows: SoundCheckRows;
  privateStorage: Pick<PrivateStorage, 'getToFile' | 'putFile' | 'delete'>;
  runTool: RunTool;
  scratchRoot: string;
}

export interface SoundCheckInput {
  organizationId: string;
  assetId: string;
}

async function firstBytes(file: string, count: number): Promise<Uint8Array> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await handle.read(buffer, 0, count, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function answerFor(meta: SoundAssetMeta): SoundCheckAnswer | null {
  if (meta.status === 'ready') return { status: 'ready', meta };
  if (meta.status === 'failed') return { status: 'failed', error: meta.error };
  return null;
}

export async function checkSoundUpload(
  deps: SoundCheckDeps,
  input: SoundCheckInput,
  run: { signal: AbortSignal; attempt: number },
): Promise<SoundCheckAnswer> {
  const { organizationId, assetId } = input;
  const row = await deps.rows.soundAsset(organizationId, assetId);
  // Not there, or an AUDIO asset that is not an uploaded sound (a video's analysis audio).
  const meta = row ? readSoundAssetMeta(row.meta) : null;
  if (!row || !meta) return { status: 'gone' };
  const settled = answerFor(meta);
  if (settled) return settled;
  const name = meta.name;
  // Read once: the row is pointed at the made file below.
  const originalKey = row.key;

  const fail = async (error: SoundCheckError): Promise<SoundCheckAnswer> => {
    const changed = await deps.rows.markSoundFailed(organizationId, assetId, {
      status: 'failed',
      purpose: 'sound',
      name,
      error,
    });
    await deps.privateStorage.delete(originalKey);
    return changed ? { status: 'failed', error } : { status: 'gone' };
  };

  return withScratch(
    deps.scratchRoot,
    `sound-${assetId}_${Math.max(1, run.attempt)}`,
    async (dir) => {
      const original = 'upload.bin';
      try {
        await deps.privateStorage.getToFile(originalKey, path.join(dir, original), run.signal);
      } catch (error) {
        if (error instanceof StorageNotFoundError) return { status: 'gone' } as const;
        throw error;
      }
      const type = sniffSoundType(await firstBytes(path.join(dir, original), 16));
      if (!type || !UPLOAD_SOUND_TYPES.includes(type)) return fail('sound_unusable');
      const input = `upload.${type}`;
      await rename(path.join(dir, original), path.join(dir, input));

      let made: Awaited<ReturnType<typeof convertUploadedSound>>;
      try {
        made = await convertUploadedSound({
          runTool: deps.runTool,
          cwd: dir,
          input,
          output: 'sound.m4a',
          signal: run.signal,
        });
      } catch (error) {
        if (
          error instanceof SoundError &&
          (error.code === 'sound_unusable' || error.code === 'sound_too_long')
        ) {
          return fail(error.code);
        }
        // `cancelled` and `tool_failed` go to `clipFailure` (only the tool fault is retried).
        throw error;
      }
      if (!(made.durationMs > 0)) return fail('sound_unusable');

      const fileKey = clipKeys.libraryUpload(organizationId, 'm4a');
      const mimeType = 'audio/mp4';
      await deps.privateStorage.putFile(fileKey, path.join(dir, made.file), mimeType);
      const ready: ReadySoundMeta = {
        status: 'ready',
        purpose: 'sound',
        name,
        durationMs: Math.round(made.durationMs),
        peaks: made.peaks,
      };
      const changed = await deps.rows.markSoundReady(organizationId, assetId, {
        key: fileKey,
        bytes: made.bytes,
        mimeType,
        meta: ready,
      });
      if (!changed) {
        // Deleted while it was being checked: what was made goes too.
        await deps.privateStorage.delete(fileKey);
        return { status: 'gone' } as const;
      }
      await deps.privateStorage.delete(originalKey);
      return { status: 'ready', meta: ready } as const;
    },
  );
}
