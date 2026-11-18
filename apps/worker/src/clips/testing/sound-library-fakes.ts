/** An in-memory sound store and bucket for the sound ingest tests (no database, no disk). */
import type { NewSoundRow, SoundRowRef, SoundStore } from '../library/store';

export interface FakeSoundLibrary {
  store: SoundStore;
  rows: Array<
    NewSoundRow & { id: string; status: SoundRowRef['status']; statusReason: string | null }
  >;
  runs: Array<{
    id: string;
    origin: string;
    args: Record<string, unknown>;
    finished: Record<string, unknown> | null;
  }>;
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

export function fakeSoundLibrary(): FakeSoundLibrary {
  const lib: Omit<FakeSoundLibrary, 'store' | 'storage' | 'privateStorage'> = {
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
  const store: SoundStore = {
    async upsertSource(meta) {
      if (!lib.sources.has(meta.code)) lib.sources.set(meta.code, id('source'));
      return lib.sources.get(meta.code) as string;
    },
    async createRun(origin, args) {
      const run = {
        id: `00000000-0000-4000-8000-${String(lib.runs.length + 1).padStart(12, '0')}`,
        origin,
        args,
        finished: null,
      };
      lib.runs.push(run);
      return run.id;
    },
    async finishRun(runId, result) {
      const run = lib.runs.find((r) => r.id === runId);
      if (run) run.finished = result;
    },
    async hasSoundOrigin(origin, originId) {
      return lib.rows.some((row) => row.origin === origin && row.originId === originId);
    },
    async hasSoundChecksum(sha256) {
      return lib.rows.some((row) => row.sourceChecksum === sha256);
    },
    async isDenied(origin, originId, sha256) {
      return lib.denied.some(
        (entry) =>
          (entry.origin === origin && entry.originId === originId) ||
          (sha256 !== null && entry.sourceChecksum === sha256),
      );
    },
    async createSound(row) {
      if (
        lib.rows.some(
          (existing) =>
            existing.sourceChecksum === row.sourceChecksum || existing.fileKey === row.fileKey,
        )
      )
        return null;
      const created = {
        ...row,
        id: id('sound'),
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
    async findSound(soundId) {
      const row = lib.rows.find((r) => r.id === soundId);
      return row
        ? {
            id: row.id,
            name: row.name,
            status: row.status,
            fileKey: row.fileKey,
            origin: row.origin,
            originId: row.originId,
            sourceChecksum: row.sourceChecksum,
          }
        : null;
    },
    async setSoundStatus(soundId, status, reason) {
      const row = lib.rows.find((r) => r.id === soundId);
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
