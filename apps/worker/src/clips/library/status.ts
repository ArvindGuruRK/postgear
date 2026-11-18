/**
 * The operator's changes to a shared library item (Module 12 builds them,
 * Module 19's Library screen calls them):
 *
 * - **publish** a run: its `STAGED` items become `ACTIVE`, after the review;
 * - **hide** an item: it leaves search, but clips that use it keep working;
 * - **remove** an item: its files are deleted and it goes on the deny list,
 *   so no later run can bring it back; a clip that uses it shows a notice,
 *   and its export fails with `sticker_missing` (`sound_missing` for a
 *   sound, Module 14) until it is taken out.
 *
 * `hideLibraryItem` and `removeLibraryItem` take either kind's id, so the
 * operator's commands need not say which.
 */
import type { StorageBackend } from '@postgear/storage';
import type { LibraryStore, SoundStore } from './store';
import { LibraryError } from './types';

export async function publishLibraryRun(
  store: LibraryStore,
  runId: string,
  byId: string | null = null,
): Promise<number> {
  return store.publishRun(runId, byId);
}

export async function hideLibrarySticker(
  store: LibraryStore,
  id: string,
  reason: string,
  byId: string | null = null,
): Promise<void> {
  const row = await store.findSticker(id);
  if (!row) throw new LibraryError(`No sticker ${id}`);
  if (row.status === 'REMOVED') throw new LibraryError('A removed sticker cannot be hidden');
  await store.setStickerStatus(id, 'HIDDEN', reason, byId);
}

export async function removeLibrarySticker(
  store: LibraryStore,
  storage: Pick<StorageBackend, 'delete'>,
  id: string,
  reason: string,
  byId: string | null = null,
): Promise<void> {
  if (!reason.trim()) throw new LibraryError('A removal needs a reason');
  const row = await store.findSticker(id);
  if (!row) throw new LibraryError(`No sticker ${id}`);
  // The deny entry first: if a delete below fails, the item still cannot come back.
  await store.deny({
    sourceChecksum: row.sourceChecksum,
    origin: row.origin,
    originId: row.originId,
    reason,
  });
  await store.setStickerStatus(id, 'REMOVED', reason, byId);
  await storage.delete(row.fileKey);
  if (row.previewKey) await storage.delete(row.previewKey);
}

export async function hideLibrarySound(
  store: SoundStore,
  id: string,
  reason: string,
  byId: string | null = null,
): Promise<void> {
  const row = await store.findSound(id);
  if (!row) throw new LibraryError(`No sound ${id}`);
  if (row.status === 'REMOVED') throw new LibraryError('A removed sound cannot be hidden');
  await store.setSoundStatus(id, 'HIDDEN', reason, byId);
}

export async function removeLibrarySound(
  store: SoundStore,
  storage: Pick<StorageBackend, 'delete'>,
  id: string,
  reason: string,
  byId: string | null = null,
): Promise<void> {
  if (!reason.trim()) throw new LibraryError('A removal needs a reason');
  const row = await store.findSound(id);
  if (!row) throw new LibraryError(`No sound ${id}`);
  await store.deny({
    sourceChecksum: row.sourceChecksum,
    origin: row.origin,
    originId: row.originId,
    reason,
  });
  await store.setSoundStatus(id, 'REMOVED', reason, byId);
  await storage.delete(row.fileKey);
}

/** Hides a sticker or a sound by its id; returns which it was. */
export async function hideLibraryItem(
  store: LibraryStore & SoundStore,
  id: string,
  reason: string,
  byId: string | null = null,
): Promise<'sticker' | 'sound'> {
  if (await store.findSticker(id)) {
    await hideLibrarySticker(store, id, reason, byId);
    return 'sticker';
  }
  if (await store.findSound(id)) {
    await hideLibrarySound(store, id, reason, byId);
    return 'sound';
  }
  throw new LibraryError(`No sticker or sound ${id}`);
}

/** Removes a sticker or a sound by its id; returns which it was. */
export async function removeLibraryItem(
  store: LibraryStore & SoundStore,
  storage: Pick<StorageBackend, 'delete'>,
  id: string,
  reason: string,
  byId: string | null = null,
): Promise<'sticker' | 'sound'> {
  if (!reason.trim()) throw new LibraryError('A removal needs a reason');
  if (await store.findSticker(id)) {
    await removeLibrarySticker(store, storage, id, reason, byId);
    return 'sticker';
  }
  if (await store.findSound(id)) {
    await removeLibrarySound(store, storage, id, reason, byId);
    return 'sound';
  }
  throw new LibraryError(`No sticker or sound ${id}`);
}
