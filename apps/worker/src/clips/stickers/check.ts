/**
 * The check a workspace's uploaded sticker goes through (Module 12,
 * `clipStickerCheckWorkflow`): the same `normaliseSticker` the library
 * ingest uses, so an upload is held to the same caps.
 *
 * 1. Read the asset row (kind STICKER, `meta.status: 'checking'`); any other
 *    state answers what the row already says, so a retry changes nothing.
 * 2. Fetch the original from the private space; sniff its real type.
 * 3. Make the PNG or APNG and the 128 px WebP preview.
 * 4. Store both under new random `clips/<org>/library/` keys, then point the
 *    row at the made file with its facts (`ready`), conditional on it still
 *    being `checking`. The original is deleted afterwards.
 * 5. A file that is not a picture we use, or is too big moving, becomes
 *    `failed` with the reason: its file is deleted and it weighs nothing.
 *
 * Uploads never enter the shared library.
 */
import { open, rename, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { normaliseSticker, type RunTool, StickerError, sniffStickerType, withScratch } from '@postgear/media-tools';
import { clipKeys, type PrivateStorage, StorageNotFoundError } from '@postgear/storage';
import { readStickerAssetMeta, type StickerAssetMeta } from '@postgear/video-engine';

/** What a check answers: the row's state after it. */
export type StickerCheckAnswer =
  | { status: 'ready'; meta: Extract<StickerAssetMeta, { status: 'ready' }> }
  | { status: 'failed'; error: 'sticker_unusable' | 'sticker_too_large' }
  | { status: 'gone' };

export interface StickerAssetRow {
  id: string;
  organizationId: string;
  key: string;
  meta: unknown;
}

export interface StickerCheckRows {
  /** The workspace's STICKER asset, or null. */
  stickerAsset(organizationId: string, assetId: string): Promise<StickerAssetRow | null>;
  /** Points the row at the made file; false when it was no longer `checking` (deleted meanwhile). */
  markStickerReady(
    organizationId: string,
    assetId: string,
    made: { key: string; bytes: number; mimeType: string; meta: StickerAssetMeta },
  ): Promise<boolean>;
  markStickerFailed(organizationId: string, assetId: string, meta: StickerAssetMeta): Promise<boolean>;
}

export interface StickerCheckDeps {
  rows: StickerCheckRows;
  privateStorage: Pick<PrivateStorage, 'getToFile' | 'putFile' | 'delete'>;
  runTool: RunTool;
  scratchRoot: string;
}

export interface StickerCheckInput {
  organizationId: string;
  assetId: string;
}

/** The longest side an uploaded sticker is made at (the library's ceiling). */
const UPLOAD_TARGET_PX = 512;

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

function answerFor(meta: StickerAssetMeta | null): StickerCheckAnswer | null {
  if (meta?.status === 'ready') return { status: 'ready', meta };
  if (meta?.status === 'failed') return { status: 'failed', error: meta.error };
  return null;
}

export async function checkStickerUpload(
  deps: StickerCheckDeps,
  input: StickerCheckInput,
  run: { signal: AbortSignal; attempt: number },
): Promise<StickerCheckAnswer> {
  const { organizationId, assetId } = input;
  const row = await deps.rows.stickerAsset(organizationId, assetId);
  if (!row) return { status: 'gone' };
  const meta = readStickerAssetMeta(row.meta);
  const settled = answerFor(meta);
  if (settled) return settled;
  const name = meta?.name ?? 'Sticker';
  // Read once: the row is pointed at the made file below.
  const originalKey = row.key;

  const fail = async (error: 'sticker_unusable' | 'sticker_too_large'): Promise<StickerCheckAnswer> => {
    const changed = await deps.rows.markStickerFailed(organizationId, assetId, { status: 'failed', name, error });
    await deps.privateStorage.delete(originalKey);
    return changed ? { status: 'failed', error } : { status: 'gone' };
  };

  return withScratch(deps.scratchRoot, `sticker-${assetId}_${Math.max(1, run.attempt)}`, async (dir) => {
    const original = 'upload.bin';
    try {
      await deps.privateStorage.getToFile(originalKey, path.join(dir, original), run.signal);
    } catch (error) {
      if (error instanceof StorageNotFoundError) return { status: 'gone' } as const;
      throw error;
    }
    const type = sniffStickerType(await firstBytes(path.join(dir, original), 16));
    if (!type) return fail('sticker_unusable');
    const input = `upload.${type}`;
    await rename(path.join(dir, original), path.join(dir, input));

    let made: Awaited<ReturnType<typeof normaliseSticker>>;
    try {
      made = await normaliseSticker({
        runTool: deps.runTool,
        cwd: dir,
        input,
        outputBase: 'sticker',
        targetPx: UPLOAD_TARGET_PX,
        signal: run.signal,
      });
    } catch (error) {
      if (error instanceof StickerError && (error.code === 'sticker_unusable' || error.code === 'sticker_too_large')) {
        return fail(error.code);
      }
      // `cancelled` and `tool_failed` go to `clipFailure` (only the tool fault is retried).
      throw error;
    }

    const ext = made.animated ? 'apng' : 'png';
    const fileKey = clipKeys.libraryUpload(organizationId, ext);
    const previewKey = clipKeys.libraryUpload(organizationId, 'webp');
    const mimeType = made.animated ? 'image/apng' : 'image/png';
    await deps.privateStorage.putFile(fileKey, path.join(dir, made.file), mimeType);
    await deps.privateStorage.putFile(previewKey, path.join(dir, made.preview), 'image/webp');
    const previewBytes = (await stat(path.join(dir, made.preview))).size;
    const ready: Extract<StickerAssetMeta, { status: 'ready' }> = {
      status: 'ready',
      name,
      animated: made.animated,
      width: made.width,
      height: made.height,
      fps: made.fps,
      frames: made.frames,
      durationMs: made.durationMs,
      previewKey,
    };
    const changed = await deps.rows.markStickerReady(organizationId, assetId, {
      key: fileKey,
      bytes: made.bytes + previewBytes,
      mimeType,
      meta: ready,
    });
    if (!changed) {
      // Deleted while it was being checked: what was made goes too.
      await deps.privateStorage.delete(fileKey);
      await deps.privateStorage.delete(previewKey);
      return { status: 'gone' } as const;
    }
    await deps.privateStorage.delete(originalKey);
    return { status: 'ready', meta: ready } as const;
  });
}
