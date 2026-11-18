/** An in-memory library store and bucket for the ingest tests (no database, no disk). */
import type { LibraryStore, NewStickerRow, StickerRowRef } from '../library/store';

export interface FakeLibrary {
  store: LibraryStore;
  rows: Array<
    NewStickerRow & { id: string; status: StickerRowRef['status']; statusReason: string | null }
  >;
  runs: Array<{ id: string; origin: string; finished: Record<string, unknown> | null }>;
  sources: Map<string, string>;
  denied: Array<{
    sourceChecksum: string;
    origin: string;
    originId: string | null;
    reason: string;
  }>;
  publicFiles: Map<string, { bytes: number; contentType: string }>;
  privateFiles: Map<string, string>;
  storage: {
    put(
      key: string,
      body: Buffer | { filePath: string; size: number },
      contentType: string,
    ): Promise<void>;
    delete(key: string): Promise<void>;
  };
  privateStorage: {
    put(key: string, body: Buffer, contentType: string): Promise<{ bytes: number }>;
  };
}

export function fakeLibrary(): FakeLibrary {
  const lib: Omit<FakeLibrary, 'store' | 'storage' | 'privateStorage'> = {
    rows: [],
    runs: [],
    sources: new Map(),
    denied: [],
    publicFiles: new Map(),
    privateFiles: new Map(),
  };
  let next = 0;
  const id = (prefix: string) => {
    next += 1;
    return `${prefix}-${next}`;
  };
  const store: LibraryStore = {
    async upsertSource(meta) {
      if (!lib.sources.has(meta.code)) lib.sources.set(meta.code, id('source'));
      return lib.sources.get(meta.code) as string;
    },
    async createRun(origin) {
      const run = {
        id: `00000000-0000-4000-8000-${String(lib.runs.length + 1).padStart(12, '0')}`,
        origin,
        finished: null,
      };
      lib.runs.push(run);
      return run.id;
    },
    async finishRun(runId, result) {
      const run = lib.runs.find((r) => r.id === runId);
      if (run) run.finished = result;
    },
    async hasOrigin(origin, originId) {
      return lib.rows.some((row) => row.origin === origin && row.originId === originId);
    },
    async hasChecksum(sha256) {
      return lib.rows.some((row) => row.sourceChecksum === sha256);
    },
    async isDenied(origin, originId, sha256) {
      return lib.denied.some(
        (entry) =>
          (entry.origin === origin && entry.originId === originId) ||
          (sha256 !== null && entry.sourceChecksum === sha256),
      );
    },
    async createSticker(row) {
      if (lib.rows.some((existing) => existing.sourceChecksum === row.sourceChecksum)) return null;
      const created = {
        ...row,
        id: id('sticker'),
        status: row.publish ? ('ACTIVE' as const) : ('STAGED' as const),
        statusReason: null,
      };
      lib.rows.push(created);
      return created.id;
    },
    async publishRun(runId) {
      const staged = lib.rows.filter((row) => row.runId === runId && row.status === 'STAGED');
      for (const row of staged) row.status = 'ACTIVE';
      return staged.length;
    },
    async findSticker(stickerId) {
      const row = lib.rows.find((r) => r.id === stickerId);
      return row
        ? {
            id: row.id,
            name: row.name,
            status: row.status,
            fileKey: row.fileKey,
            previewKey: row.previewKey,
            origin: row.origin,
            originId: row.originId,
            sourceChecksum: row.sourceChecksum,
          }
        : null;
    },
    async setStickerStatus(stickerId, status, reason) {
      const row = lib.rows.find((r) => r.id === stickerId);
      if (row) {
        row.status = status;
        row.statusReason = reason;
      }
    },
    async deny(entry) {
      lib.denied.push(entry);
    },
  };
  return {
    ...lib,
    store,
    storage: {
      async put(key, body, contentType) {
        lib.publicFiles.set(key, {
          bytes: Buffer.isBuffer(body) ? body.length : body.size,
          contentType,
        });
      },
      async delete(key) {
        lib.publicFiles.delete(key);
      },
    },
    privateStorage: {
      async put(key, body) {
        lib.privateFiles.set(key, body.toString('utf8'));
        return { bytes: body.length };
      },
    },
  };
}
