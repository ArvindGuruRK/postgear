/**
 * Deleting what AI made (Sprint 13, Module 15 section 6): proof that removing
 * a video leaves nothing AI made from it behind.
 *
 * Part one runs everywhere, on the shared fake database and an in-memory
 * private storage that keeps real keys (so "nothing left under the prefix" is
 * a real listing, and every key is checked against the private shapes):
 *
 * - A video with transcripts in two languages (word fixes made through the
 *   real fix route, kept in the rows' meta), a clip's own translation, a face
 *   file, its signals, the stills, motion, watch and heard files a run can
 *   leave behind, a Preview Export of an exported clip (under `proofs/`) and
 *   an emote (under `exports/`), removed through `removeVideo` for each
 *   reason: no object under its prefix, no row of it, no word fix, no proof,
 *   no emote file and no emote link. Another video and another workspace
 *   keep everything.
 * - Emote exports are swept by Sprint 12's orphan rule exactly as an
 *   export's leftovers are (kept for 24 hours or while their job is open,
 *   then gone), and the read route stops linking at 24 hours.
 * - Made voices and stickers that only removed clips used are swept by the
 *   unused-library rule; one a live clip uses stays. The fake answers that
 *   rule's SQL by its own conditions (it fails if the removed-clip condition
 *   is dropped); part two runs the real SQL.
 *
 * Part two runs the same removal and both sweep rules on the real Postgres,
 * only when CLIPS_DELETION_DB_TEST=1:
 *   CLIPS_DELETION_DB_TEST=1 npx dotenv -e .env -- npx jest --config apps/api/jest.config.js clip-ai-deletion
 * It makes a throwaway workspace and deletes it at the end. Its library rows
 * are dated in the year 2000 and the library rule is run "in" February 2000,
 * so that rule (which reads every workspace) can only reach this workspace's
 * rows. No real storage is touched: the files live in the in-memory storage.
 */
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { type ClipAsset, type ClipJob, type ClipVideo, type Prisma, prisma } from '@postgear/db';
import {
  assertValidClipKey,
  assertValidClipListPrefix,
  assertValidClipPrefix,
  clipKeys,
  type PrivateListPage,
  type PrivateObjectInfo,
  type PrivateObjectStream,
  type PrivateStorage,
  type SignedUrlOptions,
} from '@postgear/storage';
import {
  emptyTranscript,
  mergeTranscript,
  readTranscriptAssetMeta,
  type Transcript,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import type { UsageService } from '../../entitlements/usage.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { RedisService } from '../../redis/redis.service';
import { ClipEmotesService } from '../emotes/clip-emotes.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import type { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { MediaServiceProbe } from '../status/media-service.probe';
import {
  assetRow,
  clipRow,
  emptyTables,
  type FakeTables,
  fakeClipDb,
  matches,
} from '../testing/fake-clip-db';
import { jobRow, TEST_ORG, videoRow } from '../testing/rows';
import { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { DAY_MS } from './clip-retention.rules';
import { ClipRetentionService, type RemoveReason } from './clip-retention.service';
import { ClipSweepService, UNUSED_LIBRARY_MS } from './clip-sweep.service';

// ---- The database: the shared fake (part one) or the real Postgres (part two) ----------

let mockDb: Record<string | symbol, unknown> | null = null;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      {
        get: (_target, key) => {
          const target = (mockDb ?? actual.prisma) as Record<string | symbol, unknown>;
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      },
    ),
  };
});

// ---- A private storage that keeps real keys -------------------------------------------

class MemoryPrivateStorage implements PrivateStorage {
  readonly kind = 'local' as const;
  private readonly objects = new Map<string, { body: Buffer; modifiedAt: Date }>();
  /** The write time `put` stamps. */
  now: () => Date = () => new Date();

  /** A file written at a chosen time (a run's leftover, an old emote). Answers its key. */
  seed(key: string, modifiedAt: Date = this.now()): string {
    assertValidClipKey(key);
    this.objects.set(key, { body: Buffer.from(`bytes of ${key}`), modifiedAt });
    return key;
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  keysUnder(prefix: string): string[] {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  allKeys(): string[] {
    return this.keysUnder('');
  }

  async put(key: string, body: Buffer | Readable): Promise<PrivateObjectInfo> {
    assertValidClipKey(key);
    let bytes: Buffer;
    if (Buffer.isBuffer(body)) {
      bytes = body;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
      bytes = Buffer.concat(chunks);
    }
    this.objects.set(key, { body: bytes, modifiedAt: this.now() });
    return { bytes: bytes.length };
  }

  async getStream(key: string): Promise<PrivateObjectStream | null> {
    assertValidClipKey(key);
    const object = this.objects.get(key);
    if (!object) return null;
    const bytes = object.body.length;
    return { body: Readable.from([object.body]), bytes, totalBytes: bytes, range: null };
  }

  async stat(key: string): Promise<PrivateObjectInfo | null> {
    assertValidClipKey(key);
    const object = this.objects.get(key);
    return object ? { bytes: object.body.length } : null;
  }

  async exists(key: string): Promise<boolean> {
    assertValidClipKey(key);
    return this.objects.has(key);
  }

  async delete(key: string): Promise<void> {
    assertValidClipKey(key);
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string): Promise<number> {
    assertValidClipPrefix(prefix);
    const keys = this.keysUnder(prefix);
    for (const key of keys) this.objects.delete(key);
    return keys.length;
  }

  async list(
    prefix: string,
    options: { after?: string | null; limit: number },
  ): Promise<PrivateListPage> {
    assertValidClipListPrefix(prefix);
    const after = options.after ?? null;
    const keys = this.keysUnder(prefix).filter((key) => after === null || key > after);
    const page = keys.slice(0, options.limit);
    return {
      objects: page.map((key) => {
        const object = this.objects.get(key) as { body: Buffer; modifiedAt: Date };
        return { key, bytes: object.body.length, modifiedAt: object.modifiedAt };
      }),
      next: keys.length > page.length ? (page[page.length - 1] ?? null) : null,
    };
  }

  /** Signs whatever it is asked, as S3 does: whether a link is answered is the route's rule. */
  async signedUrl(key: string, opts: SignedUrlOptions): Promise<string> {
    assertValidClipKey(key);
    return `https://private.test/${key}?seconds=${opts.expiresInSeconds}`;
  }

  async putFile(): Promise<PrivateObjectInfo> {
    throw new Error('memory storage: putFile is not used here');
  }

  async getToFile(): Promise<void> {
    throw new Error('memory storage: getToFile is not used here');
  }

  async createUpload(): Promise<{ uploadId: string }> {
    throw new Error('memory storage: uploads are not used here');
  }

  async signPart(): Promise<string> {
    throw new Error('memory storage: uploads are not used here');
  }

  async completeUpload(): Promise<PrivateObjectInfo> {
    throw new Error('memory storage: uploads are not used here');
  }

  async abortUpload(): Promise<void> {
    throw new Error('memory storage: uploads are not used here');
  }
}

// ---- The fake database, with the few things the shared one leaves out ------------------

/** The library assets a clip document's items point at (`tracks[*].items[*].ref.asset`). */
function assetRefsOf(document: unknown): string[] {
  const tracks = (document as { tracks?: Array<{ items?: Array<{ ref?: { asset?: unknown } }> }> })
    ?.tracks;
  if (!Array.isArray(tracks)) return [];
  return tracks.flatMap((track) =>
    (track.items ?? [])
      .map((item) => item.ref?.asset)
      .filter((id): id is string => typeof id === 'string'),
  );
}

/**
 * `fakeClipDb` plus: a real mark on the video row (the shared fake answers
 * one without writing), Postgres' `onDelete: SetNull` from a deleted clip to
 * its asset rows, the two asset filters it does not read (a key's prefix and
 * the orphan sweep's count), and the sweep's raw queries.
 */
function database(tables: FakeTables) {
  const base = fakeClipDb(tables);
  const videoOf = (asset: ClipAsset) => tables.videos.find((video) => video.id === asset.videoId);

  const answerRaw = (sql: string, values: unknown[]): unknown[] => {
    // The orphan sweep's known keys: a row's own key, or a sticker's preview.
    if (sql.includes(`meta->>'previewKey' = ANY`)) {
      const keys = new Set(values[0] as string[]);
      const known = new Set<string>();
      for (const asset of tables.assets) {
        if (keys.has(asset.key)) known.add(asset.key);
        const preview = (asset.meta as { previewKey?: unknown } | null)?.previewKey;
        if (typeof preview === 'string' && keys.has(preview)) known.add(preview);
      }
      return [...known].map((key) => ({ key }));
    }
    // The unused-library rule, answered by the conditions its SQL states.
    if (sql.includes('jsonb_path_exists')) {
      const cutoff = values[0] as Date;
      const ignoresRemovedClips = /c\."removedAt" IS NULL/.test(sql);
      return tables.assets
        .filter((asset) => {
          const meta = asset.meta as { purpose?: unknown; previewKey?: unknown } | null;
          const kindMatches =
            asset.kind === 'STICKER' || (asset.kind === 'AUDIO' && meta?.purpose === 'sound');
          if (asset.videoId !== null || asset.clipId !== null || !kindMatches) return false;
          if (!(asset.createdAt < cutoff)) return false;
          return !tables.clips.some(
            (clip) =>
              clip.organizationId === asset.organizationId &&
              (!ignoresRemovedClips || clip.removedAt === null) &&
              assetRefsOf(clip.document).includes(asset.id),
          );
        })
        .map((asset) => ({
          id: asset.id,
          organizationId: asset.organizationId,
          key: asset.key,
          previewKey: (asset.meta as { previewKey?: string } | null)?.previewKey ?? null,
        }));
    }
    throw new Error('clip-ai-deletion: a raw query this spec does not answer');
  };

  const self: { db?: unknown } = {};
  const db = {
    ...base,
    $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(self.db)),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) =>
      answerRaw(strings.join('?'), values),
    ),
    clip: {
      ...base.clip,
      deleteMany: jest.fn(async (args: { where: unknown }) => {
        const result = await base.clip.deleteMany(args);
        const live = new Set(tables.clips.map((clip) => clip.id));
        for (const asset of tables.assets) {
          if (asset.clipId !== null && !live.has(asset.clipId)) asset.clipId = null;
        }
        return result;
      }),
    },
    clipVideo: {
      ...base.clipVideo,
      updateMany: jest.fn(async ({ where, data }: { where: unknown; data: object }) => {
        const found = tables.videos.filter((video) =>
          matches(video as unknown as Record<string, unknown>, where),
        );
        for (const row of found) Object.assign(row, data);
        return { count: found.length };
      }),
    },
    clipAsset: {
      ...base.clipAsset,
      findMany: jest.fn(async (args: { where?: Record<string, unknown> } = {}) => {
        const where = args.where ?? {};
        const prefix = (where.NOT as { key?: { startsWith?: unknown } } | undefined)?.key
          ?.startsWith;
        if (typeof prefix === 'string') {
          const { NOT: _outside, ...rest } = where;
          const rows = (await base.clipAsset.findMany({ ...args, where: rest })) as ClipAsset[];
          return rows.filter((row) => !row.key.startsWith(prefix));
        }
        const before = (where.createdAt as { lt?: Date } | undefined)?.lt;
        if (before) {
          // The orphan sweep's count of rows whose file is gone (never an upload still coming in).
          return tables.assets.filter(
            (row) =>
              row.createdAt < before &&
              !(row.kind === 'ORIGINAL' && videoOf(row)?.status === 'IMPORTING'),
          );
        }
        return base.clipAsset.findMany(args);
      }),
    },
  };
  self.db = db;
  return db;
}

// ---- Rows and keys -----------------------------------------------------------------------

const NOW = new Date('2026-11-28T10:00:00.000Z');
const HOUR_MS = 60 * 60_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

const ORG = TEST_ORG;
const OTHER_ORG = 'seed-second-org';
const VIDEO = videoRow().id;
const KEPT_VIDEO = '22222222-2222-4222-8222-000000000002';
const FOREIGN_VIDEO = '22222222-2222-4222-8222-000000000003';

const CLIP = '55555555-5555-4555-8555-000000000001';
const EXPORTED_CLIP = '55555555-5555-4555-8555-000000000002';
const KEPT_CLIP = '55555555-5555-4555-8555-000000000003';

const EN_TRANSCRIPT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ES_TRANSCRIPT = 'aaaaaaaa-0000-4000-8000-000000000002';
const FR_TRANSLATION = 'aaaaaaaa-0000-4000-8000-000000000003';

const LISTEN_EN = '88888888-8888-4888-8888-000000000001';
const LISTEN_ES = '88888888-8888-4888-8888-000000000002';
const FACES_JOB = '88888888-8888-4888-8888-000000000003';
const WATCH_JOB = '88888888-8888-4888-8888-000000000004';
const EMOTE_JOB = '99999999-9999-4999-8999-000000000001';
const KEPT_EMOTE_JOB = '99999999-9999-4999-8999-000000000002';
const PROOF_JOB = '99999999-9999-4999-8999-000000000003';

/** Made voices (a SPEECH job's asset id is its job id) and a sticker, in the workspace library. */
const VOICE_OF_DELETED_CLIP = '77777777-7777-4777-8777-000000000001';
const VOICE_OF_REMOVED_CLIP = '77777777-7777-4777-8777-000000000002';
const VOICE_OF_LIVE_CLIP = '77777777-7777-4777-8777-000000000003';
const STICKER_OF_REMOVED_CLIP = '77777777-7777-4777-8777-000000000004';

/** A job's own file of a video, as the worker and the Python service name it. */
function jobFile(orgId: string, videoId: string, kind: string, jobId: string, ext: string) {
  const key = `clips/${orgId}/${videoId}/${kind}-${jobId.replace(/-/g, '')}.${ext}`;
  assertValidClipKey(key);
  return key;
}

/** A made voice's `.m4a`, as `speechKeys` names it. */
function voiceKey(orgId: string, jobId: string): string {
  const key = `clips/${orgId}/library/${jobId.replace(/-/g, '')}.m4a`;
  assertValidClipKey(key);
  return key;
}

const MADE_VOICE_META = {
  status: 'ready',
  purpose: 'sound',
  name: 'AI Voice',
  durationMs: 2_000,
  peaks: [0.1, 0.4, 0.2],
  voice: 'af_heart',
  madeByAi: true,
};

/** A clip document whose sound row plays `assetIds` (as the editor adds a made voice). */
function documentUsing(...assetIds: string[]) {
  return {
    tracks: [{ kind: 'sound', items: assetIds.map((asset) => ({ ref: { asset } })) }],
  };
}

/** One word a second from 10 s, the fourth one heard as "Arvin,". */
function heard(language: string, first: string): Transcript {
  return mergeTranscript(emptyTranscript(language, 'simulation'), {
    ranges: [{ fromMs: 10_000, toMs: 30_000 }],
    words: Array.from({ length: 20 }, (_, index) => ({
      start: (10 + index) * 1000,
      end: (10 + index) * 1000 + 400,
      text: index === 0 ? first : index === 3 ? 'Arvin,' : `word${index}`,
      sure: 0.9,
    })),
  });
}

const EMOTE_FILE = {
  name: 'emote-twitch-112.gif',
  size: 112,
  format: 'gif',
  bytes: 77_415,
  maxBytes: 512_000,
  fits: true,
  rung: 1,
  frames: 60,
  fps: 20,
  extra: false,
};
const EMOTE_OUTPUT = {
  platform: 'twitch',
  files: [EMOTE_FILE],
  zip: { name: 'emote-twitch.zip', bytes: 78_000 },
  sharp: false,
};

/** An emote job's files where the worker puts them. Answers their keys. */
function seedEmoteFiles(storage: MemoryPrivateStorage, orgId: string, jobId: string, when?: Date) {
  return [
    storage.seed(clipKeys.exportFile(orgId, jobId, 'emote-twitch-112', 'gif'), when),
    storage.seed(clipKeys.exportFile(orgId, jobId, 'emote-twitch', 'zip'), when),
  ];
}

function emoteJob(overrides: Partial<ClipJob>): ClipJob {
  return jobRow({
    kind: 'EMOTE',
    status: 'DONE',
    progress: 100,
    output: EMOTE_OUTPUT,
    createdAt: at(-HOUR_MS),
    finishedAt: at(-HOUR_MS),
    expiresAt: at(23 * HOUR_MS),
    ...overrides,
  });
}

function emotesService(storage: PrivateStorage, now: () => number) {
  const service = new ClipEmotesService(
    new ClipVideosRepository(),
    {} as ClipJobsService,
    new ClipJobsRepository(),
    {} as ClipLimitsGuard,
    {} as UsageService,
    storage,
  );
  service.timing = { ...service.timing, now };
  return service;
}

function retentionService(storage: PrivateStorage) {
  return new ClipRetentionService(
    { get: jest.fn(async () => 7) } as unknown as EntitlementResolver,
    { cancel: jest.fn(async () => ({})) } as unknown as ClipJobsService,
    storage,
  );
}

function sweepService(storage: PrivateStorage) {
  return new ClipSweepService(
    retentionService(storage),
    {} as EntitlementResolver,
    {} as UsageService,
    {} as NotificationsService,
    {} as RedisService,
    storage,
  );
}

// ---- Part one: on the fake database ------------------------------------------------------

/**
 * The workspace: the video to remove (everything AI made from it), a second
 * video of the same workspace and one of another workspace, each with files
 * that must stay.
 */
async function seedWorkspace() {
  const tables = emptyTables();
  const storage = new MemoryPrivateStorage();
  storage.now = () => NOW;
  mockDb = database(tables) as unknown as Record<string | symbol, unknown>;
  const store = new ClipTranscriptStore(storage);

  tables.videos.push(
    videoRow({ status: 'READY', expiresAt: at(5 * DAY_MS) }),
    videoRow({ id: KEPT_VIDEO, status: 'READY', title: 'A second stream' }),
    videoRow({ id: FOREIGN_VIDEO, organizationId: OTHER_ORG, status: 'READY' }),
  );

  // The import's files, so the video's own prefix is never only AI files.
  for (const [video, orgId] of [
    [VIDEO, ORG],
    [KEPT_VIDEO, ORG],
    [FOREIGN_VIDEO, OTHER_ORG],
  ] as const) {
    const proxyKey = storage.seed(clipKeys.videoFile(orgId, video, 'PROXY', 'mp4'));
    tables.assets.push(
      assetRow({ id: randomUUID(), organizationId: orgId, videoId: video, key: proxyKey }),
    );
  }

  // Transcripts in two languages (Module 02), stored by the real store.
  const transcripts = [
    { id: EN_TRANSCRIPT, jobId: LISTEN_EN, transcript: heard('en', 'Hello') },
    { id: ES_TRANSCRIPT, jobId: LISTEN_ES, transcript: heard('es', 'Hola') },
  ];
  for (const [index, { id, jobId, transcript }] of transcripts.entries()) {
    const key = jobFile(ORG, VIDEO, 'transcript', jobId, 'json.gz');
    const bytes = await store.write(key, transcript);
    tables.assets.push(
      assetRow({
        id,
        videoId: VIDEO,
        kind: 'TRANSCRIPT',
        key,
        bytes: BigInt(bytes),
        meta: transcriptAssetMeta(transcript) as unknown as ClipAsset['meta'],
        // English first: the video's "auto" transcript.
        createdAt: at(-2 * DAY_MS + index),
      }),
    );
  }
  // A clip's own translation (Module 03): a row of the clip AND of the video.
  const translated = { ...heard('fr', 'Bonjour'), source: 'translated' as const };
  const translationKey = clipKeys.videoFile(ORG, VIDEO, 'transcript', 'json.gz');
  await store.write(translationKey, translated);
  tables.assets.push(
    assetRow({
      id: FR_TRANSLATION,
      videoId: VIDEO,
      clipId: CLIP,
      kind: 'TRANSCRIPT',
      key: translationKey,
      meta: transcriptAssetMeta(translated) as unknown as ClipAsset['meta'],
    }),
  );
  // A face file (Module 07): positions only, kept where the job wrote it.
  const facesKey = storage.seed(jobFile(ORG, VIDEO, 'faces', FACES_JOB, 'json.gz'));
  tables.assets.push(
    assetRow({ id: FACES_JOB, videoId: VIDEO, kind: 'FACE_TRACKS', key: facesKey }),
  );
  // The signals file (Module 06 keeps the motion track in it).
  const signalsKey = storage.seed(jobFile(ORG, VIDEO, 'signals', WATCH_JOB, 'json.gz'));
  tables.assets.push(
    assetRow({ id: randomUUID(), videoId: VIDEO, kind: 'SIGNALS', key: signalsKey }),
  );
  // What a run that died between its steps can leave with no row: the motion file,
  // the watch state, the stills (Module 06) and the heard file (Module 02).
  storage.seed(jobFile(ORG, VIDEO, 'motion', WATCH_JOB, 'json.gz'));
  storage.seed(jobFile(ORG, VIDEO, 'watch-state', WATCH_JOB, 'json.gz'));
  for (let index = 0; index < 4; index += 1) {
    storage.seed(jobFile(ORG, VIDEO, `still-${index}`, WATCH_JOB, 'jpg'));
  }
  storage.seed(jobFile(ORG, VIDEO, 'heard', LISTEN_EN, 'json.gz'));

  // Clips: one never exported, one exported (kept, marked), one of the second video.
  tables.clips.push(
    clipRow({ id: CLIP, document: documentUsing(VOICE_OF_DELETED_CLIP) }),
    clipRow({
      id: EXPORTED_CLIP,
      lastExportedRevision: 1,
      exportedMediaId: 'media-1',
      document: documentUsing(VOICE_OF_REMOVED_CLIP, STICKER_OF_REMOVED_CLIP),
    }),
    clipRow({ id: KEPT_CLIP, videoId: KEPT_VIDEO, document: documentUsing(VOICE_OF_LIVE_CLIP) }),
  );

  // A Preview Export of the exported clip: its row is the video's, its file is under proofs/.
  const proofKey = storage.seed(clipKeys.proofFile(ORG, PROOF_JOB, 'proof', 'mp4'));
  tables.assets.push(
    assetRow({
      id: randomUUID(),
      videoId: VIDEO,
      clipId: EXPORTED_CLIP,
      kind: 'PROOF',
      key: proofKey,
      meta: { jobId: PROOF_JOB, expiresAt: at(20 * HOUR_MS).toISOString() },
    }),
  );

  // Emotes (Module 14): no row points at their files.
  tables.jobs.push(
    emoteJob({ id: EMOTE_JOB, videoId: VIDEO }),
    emoteJob({ id: KEPT_EMOTE_JOB, videoId: KEPT_VIDEO }),
  );
  const emoteKeys = seedEmoteFiles(storage, ORG, EMOTE_JOB);
  const keptEmoteKeys = seedEmoteFiles(storage, ORG, KEPT_EMOTE_JOB);

  // The workspace library: made voices (Module 09) and a sticker with its preview.
  const libraryCreated = at(-40 * DAY_MS);
  for (const id of [VOICE_OF_DELETED_CLIP, VOICE_OF_REMOVED_CLIP, VOICE_OF_LIVE_CLIP]) {
    tables.assets.push(
      assetRow({
        id,
        videoId: null,
        kind: 'AUDIO',
        key: storage.seed(voiceKey(ORG, id)),
        mimeType: 'audio/mp4',
        meta: MADE_VOICE_META,
        createdAt: libraryCreated,
      }),
    );
  }
  const stickerKey = storage.seed(clipKeys.libraryUpload(ORG, 'png'));
  const stickerPreview = storage.seed(clipKeys.libraryUpload(ORG, 'webp'));
  tables.assets.push(
    assetRow({
      id: STICKER_OF_REMOVED_CLIP,
      videoId: null,
      kind: 'STICKER',
      key: stickerKey,
      meta: { status: 'ready', name: 'Star', previewKey: stickerPreview },
      createdAt: libraryCreated,
    }),
  );

  // The other workspace's transcript, which nothing here may touch.
  const foreignKey = storage.seed(
    jobFile(OTHER_ORG, FOREIGN_VIDEO, 'transcript', LISTEN_EN, 'json.gz'),
  );
  tables.assets.push(
    assetRow({
      id: randomUUID(),
      organizationId: OTHER_ORG,
      videoId: FOREIGN_VIDEO,
      kind: 'TRANSCRIPT',
      key: foreignKey,
    }),
  );

  // Word fixes, through the real route: they live in the transcript rows' meta.
  const transcriptsService = new ClipTranscriptsService(
    new ClipVideosRepository(),
    {} as ClipJobsService,
    new ClipJobsRepository(),
    {} as ClipLimitsGuard,
    {} as UsageService,
    store,
    {} as MediaServiceProbe,
  );
  await transcriptsService.fix(ORG, VIDEO, { fixes: [{ index: 3, text: 'Arvind,' }] });
  await transcriptsService.fix(ORG, VIDEO, {
    language: 'es',
    replace: { from: 'arvin', to: 'Arvind' },
  });

  return {
    tables,
    storage,
    proofKey,
    emoteKeys,
    keptEmoteKeys,
    voiceKeys: {
      deleted: voiceKey(ORG, VOICE_OF_DELETED_CLIP),
      removed: voiceKey(ORG, VOICE_OF_REMOVED_CLIP),
      live: voiceKey(ORG, VOICE_OF_LIVE_CLIP),
    },
    stickerKeys: [stickerKey, stickerPreview],
  };
}

const fixesOf = (asset: ClipAsset | undefined) => readTranscriptAssetMeta(asset?.meta)?.fixes ?? [];

describe('removing a video takes everything AI made from it', () => {
  it.each<RemoveReason>(['deleted', 'expired', 'rights_request'])(
    'for %s: no object under its prefix, no row, no word fix, no proof, no emote file and no link',
    async (reason) => {
      const seeded = await seedWorkspace();
      const { tables, storage } = seeded;
      const prefix = clipKeys.videoPrefix(ORG, VIDEO);
      const keptPrefix = clipKeys.videoPrefix(ORG, KEPT_VIDEO);
      const emotes = emotesService(storage, () => NOW.getTime());

      // Before: the fixes are in both languages' rows, every file is there, the emote links.
      const en = tables.assets.find((asset) => asset.id === EN_TRANSCRIPT);
      const es = tables.assets.find((asset) => asset.id === ES_TRANSCRIPT);
      expect(fixesOf(en)).toEqual([{ at: 13_000, text: 'Arvind,' }]);
      expect(fixesOf(es)).toEqual([{ at: 13_000, text: 'Arvind,' }]);
      // The proxy, three transcripts, the face file, the signals, the motion and watch files,
      // four stills and the heard file.
      expect(storage.keysUnder(prefix)).toHaveLength(13);
      const before = await emotes.get(ORG, EMOTE_JOB);
      expect(before.emote?.expired).toBe(false);
      expect(before.emote?.files.every((file) => file.url !== null)).toBe(true);
      const keptBefore = storage.keysUnder(keptPrefix);
      const othersBefore = storage
        .allKeys()
        .filter(
          (key) =>
            !key.startsWith(prefix) && key !== seeded.proofKey && !seeded.emoteKeys.includes(key),
        );

      const removed = await retentionService(storage).removeVideo(ORG, VIDEO, reason, NOW);
      expect(removed).toMatchObject({ id: VIDEO });

      // No stored object under the video's prefix, and no row of it or pointing into it.
      expect(storage.keysUnder(prefix)).toEqual([]);
      expect(tables.assets.filter((asset) => asset.videoId === VIDEO)).toEqual([]);
      expect(tables.assets.filter((asset) => asset.key.startsWith(prefix))).toEqual([]);
      // The word fixes went with their rows: no transcript of the video is left to carry one.
      expect(
        tables.assets.filter((asset) => asset.kind === 'TRANSCRIPT' && fixesOf(asset).length > 0),
      ).toEqual([]);
      // The Preview Export sat outside the prefix: its file went with its row.
      expect(storage.has(seeded.proofKey)).toBe(false);
      // The emote's files are gone and the read route links nothing.
      expect(storage.keysUnder(clipKeys.exportPrefix(ORG, EMOTE_JOB))).toEqual([]);
      const after = await emotes.get(ORG, EMOTE_JOB);
      expect(after.emote?.expired).toBe(true);
      expect(after.emote?.files.map((file) => file.url)).toEqual([null]);
      expect(after.emote?.zip.url).toBeNull();
      // The job and the video row stay: they are the rights record.
      expect(tables.jobs.find((job) => job.id === EMOTE_JOB)?.status).toBe('DONE');
      expect(tables.videos.find((video) => video.id === VIDEO)).toMatchObject({
        deletedAt: NOW,
        removedReason: reason,
        status: reason === 'deleted' ? 'READY' : 'REMOVED',
      });
      // The clip never exported is gone; the exported one is kept and marked.
      expect(tables.clips.map((clip) => [clip.id, clip.removedAt])).toEqual([
        [EXPORTED_CLIP, NOW],
        [KEPT_CLIP, null],
      ]);

      // Everything else stays: the second video, its emote and its link, the library, the
      // other workspace.
      expect(storage.keysUnder(keptPrefix)).toEqual(keptBefore);
      for (const key of othersBefore) expect(storage.has(key)).toBe(true);
      const kept = await emotes.get(ORG, KEPT_EMOTE_JOB);
      expect(kept.emote?.expired).toBe(false);
      expect(kept.emote?.zip.url).toContain(clipKeys.exportPrefix(ORG, KEPT_EMOTE_JOB));
      expect(tables.assets.filter((asset) => asset.organizationId === OTHER_ORG)).toHaveLength(2);
    },
  );

  it('removes the emote files of every emote job of the video, whatever its status', async () => {
    const { tables, storage } = await seedWorkspace();
    const failed = '99999999-9999-4999-8999-000000000010';
    tables.jobs.push(emoteJob({ id: failed, videoId: VIDEO, status: 'FAILED', output: null }));
    // A failed job's bookkeeping removes its files; a crash in it can leave some.
    seedEmoteFiles(storage, ORG, failed);

    await retentionService(storage).removeVideo(ORG, VIDEO, 'expired', NOW);

    expect(storage.keysUnder(clipKeys.exportPrefix(ORG, failed))).toEqual([]);
    expect(storage.keysUnder(clipKeys.exportPrefix(ORG, EMOTE_JOB))).toEqual([]);
    expect(storage.keysUnder(clipKeys.exportPrefix(ORG, KEPT_EMOTE_JOB))).toHaveLength(2);
  });

  it('answers a removed video emote as expired even when its files were never reached', async () => {
    const { tables, storage } = await seedWorkspace();
    // A removal whose storage was away: the files wait for the orphan sweep, the link does not.
    const video = tables.videos.find((row) => row.id === VIDEO) as ClipVideo;
    video.deletedAt = NOW;

    const view = await emotesService(storage, () => NOW.getTime()).get(ORG, EMOTE_JOB);

    expect(storage.keysUnder(clipKeys.exportPrefix(ORG, EMOTE_JOB))).toHaveLength(2);
    expect(view.emote?.expired).toBe(true);
    expect(view.emote?.files.every((file) => file.url === null)).toBe(true);
    expect(view.emote?.zip.url).toBeNull();
  });
});

describe('emote exports and the retention rule (Sprint 12, Module 19)', () => {
  it('the orphan sweep removes them after 24 hours exactly as an export leftover, never an open job', async () => {
    const tables = emptyTables();
    const storage = new MemoryPrivateStorage();
    mockDb = database(tables) as unknown as Record<string | symbol, unknown>;
    tables.videos.push(videoRow({ status: 'READY' }));
    const job = (id: string, kind: ClipJob['kind'], status: ClipJob['status']) =>
      jobRow({ id, kind, status, videoId: VIDEO, createdAt: at(-25 * HOUR_MS) });

    const oldEmote = '99999999-9999-4999-8999-000000000101';
    const youngEmote = '99999999-9999-4999-8999-000000000102';
    const openEmote = '99999999-9999-4999-8999-000000000103';
    const oldExport = '99999999-9999-4999-8999-000000000104';
    const openExport = '99999999-9999-4999-8999-000000000105';
    tables.jobs.push(
      emoteJob({ id: oldEmote, videoId: VIDEO, expiresAt: at(-HOUR_MS) }),
      emoteJob({ id: youngEmote, videoId: VIDEO, expiresAt: at(22 * HOUR_MS) }),
      job(openEmote, 'EMOTE', 'RUNNING'),
      job(oldExport, 'RENDER', 'DONE'),
      job(openExport, 'RENDER', 'RUNNING'),
    );
    const old = at(-25 * HOUR_MS);
    const oldEmoteKeys = seedEmoteFiles(storage, ORG, oldEmote, old);
    const youngEmoteKeys = seedEmoteFiles(storage, ORG, youngEmote, at(-2 * HOUR_MS));
    const openEmoteKeys = seedEmoteFiles(storage, ORG, openEmote, old);
    const oldExportKey = storage.seed(clipKeys.exportFile(ORG, oldExport, 'render', 'mp4'), old);
    const openExportKey = storage.seed(clipKeys.exportFile(ORG, openExport, 'render', 'mp4'), old);
    // A file a row points at is never an orphan, however old.
    const proxyKey = storage.seed(clipKeys.videoFile(ORG, VIDEO, 'PROXY', 'mp4'), old);
    tables.assets.push(assetRow({ id: randomUUID(), key: proxyKey, createdAt: old }));

    const swept = await sweepService(storage).orphanFiles(NOW);

    expect(swept).toEqual({ objects: 9, deleted: 3, missing: 0 });
    for (const key of [...oldEmoteKeys, oldExportKey]) expect(storage.has(key)).toBe(false);
    for (const key of [...youngEmoteKeys, ...openEmoteKeys, openExportKey, proxyKey]) {
      expect(storage.has(key)).toBe(true);
    }

    // The read route stops linking at 24 hours, so a link never outlives the rule.
    const emotes = emotesService(storage, () => NOW.getTime());
    const gone = await emotes.get(ORG, oldEmote);
    expect(gone.emote?.expired).toBe(true);
    expect(gone.emote?.zip.url).toBeNull();
    const young = await emotes.get(ORG, youngEmote);
    expect(young.emote?.zip.url).toContain(clipKeys.exportPrefix(ORG, youngEmote));
  });
});

describe('made voices and library items of removed clips (the unused-library rule)', () => {
  it('sweeps a voice or sticker only removed clips used, and keeps one a live clip uses', async () => {
    const seeded = await seedWorkspace();
    const { tables, storage } = seeded;
    await retentionService(storage).removeVideo(ORG, VIDEO, 'rights_request', NOW);
    // The removal leaves the library alone: those files are the workspace's.
    expect(storage.has(seeded.voiceKeys.deleted)).toBe(true);
    expect(storage.has(seeded.voiceKeys.removed)).toBe(true);

    const sweep = sweepService(storage);
    const removed = await sweep.unusedLibraryFiles(NOW);

    expect(removed).toBe(3);
    const libraryIds = tables.assets
      .filter((asset) => asset.videoId === null && asset.organizationId === ORG)
      .map((asset) => asset.id);
    expect(libraryIds).toEqual([VOICE_OF_LIVE_CLIP]);
    expect(storage.has(seeded.voiceKeys.deleted)).toBe(false);
    expect(storage.has(seeded.voiceKeys.removed)).toBe(false);
    for (const key of seeded.stickerKeys) expect(storage.has(key)).toBe(false);
    expect(storage.has(seeded.voiceKeys.live)).toBe(true);
    // The rule reads every clip of the workspace but the ones marked removed.
    const raw = (mockDb as { $queryRaw: jest.Mock }).$queryRaw.mock.calls;
    expect(raw).toHaveLength(1);
    const sql = (raw[0] as [string[]])[0].join('?');
    expect(sql).toMatch(/NOT EXISTS \([\s\S]*c\."removedAt" IS NULL[\s\S]*jsonb_path_exists/);
  });

  it('keeps a voice younger than the rule, even when no clip uses it any more', async () => {
    const seeded = await seedWorkspace();
    const { storage } = seeded;
    await retentionService(storage).removeVideo(ORG, VIDEO, 'deleted', NOW);

    // A day short of the rule's thirty days after the voices were made.
    const removed = await sweepService(storage).unusedLibraryFiles(
      new Date(at(-40 * DAY_MS).getTime() + UNUSED_LIBRARY_MS - DAY_MS),
    );

    expect(removed).toBe(0);
    expect(storage.has(seeded.voiceKeys.removed)).toBe(true);
  });
});

// ---- Part two: on the real Postgres ---------------------------------------------------------

const RUN_DB = process.env.CLIPS_DELETION_DB_TEST === '1';

(RUN_DB ? describe : describe.skip)('the same proof on the real Postgres', () => {
  const stamp = Date.now().toString(36);
  const org = `ai-deletion-${stamp}`;
  const video = randomUUID();
  const keptVideo = randomUUID();
  const clip = randomUUID();
  const exportedClip = randomUUID();
  const keptClip = randomUUID();
  const emote = randomUUID();
  const keptEmote = randomUUID();
  const oldEmote = randomUUID();
  const proofJob = randomUUID();
  const listen = randomUUID();
  const faces = randomUUID();
  const voices = { deleted: randomUUID(), removed: randomUUID(), live: randomUUID() };
  const sticker = randomUUID();
  const storage = new MemoryPrivateStorage();
  const libraryCreated = new Date('2000-01-01T00:00:00.000Z');
  const libraryNow = new Date('2000-02-15T00:00:00.000Z');
  // The mocked `prisma` forwards to the real client once no fake is set.
  const db = prisma;
  let proofKey = '';

  beforeAll(async () => {
    mockDb = null;
    await db.organization.create({ data: { id: org, name: 'AI Deletion Test' } });
    for (const id of [video, keptVideo]) {
      await db.clipVideo.create({
        data: {
          id,
          organizationId: org,
          platform: 'TWITCH',
          kind: 'PAST_STREAM',
          title: 'A deletion test stream',
          durationMs: 600_000,
          status: 'READY',
        },
      });
    }
    const row = (data: Omit<Prisma.ClipAssetUncheckedCreateInput, 'organizationId' | 'bytes'>) =>
      db.clipAsset.create({ data: { organizationId: org, bytes: 1n, ...data } });

    await row({
      videoId: video,
      kind: 'PROXY',
      key: storage.seed(clipKeys.videoFile(org, video, 'PROXY', 'mp4')),
    });
    await row({
      videoId: keptVideo,
      kind: 'PROXY',
      key: storage.seed(clipKeys.videoFile(org, keptVideo, 'PROXY', 'mp4')),
    });
    const fixed = transcriptAssetMeta(heard('en', 'Hello'), [{ at: 13_000, text: 'Arvind,' }]);
    await row({
      videoId: video,
      kind: 'TRANSCRIPT',
      key: storage.seed(jobFile(org, video, 'transcript', listen, 'json.gz')),
      meta: fixed as unknown as Prisma.InputJsonValue,
    });
    await row({
      videoId: video,
      kind: 'TRANSCRIPT',
      key: storage.seed(clipKeys.videoFile(org, video, 'transcript', 'json.gz')),
      meta: transcriptAssetMeta(heard('es', 'Hola'), [
        { at: 13_000, text: 'Arvind,' },
      ]) as unknown as Prisma.InputJsonValue,
    });
    await row({
      videoId: video,
      kind: 'FACE_TRACKS',
      key: storage.seed(jobFile(org, video, 'faces', faces, 'json.gz')),
    });
    storage.seed(jobFile(org, video, 'motion', faces, 'json.gz'));
    storage.seed(jobFile(org, video, 'still-0', faces, 'jpg'));
    storage.seed(jobFile(org, video, 'heard', listen, 'json.gz'));

    await db.clip.createMany({
      data: [
        { id: clip, videoId: video, document: documentUsing(voices.deleted) },
        {
          id: exportedClip,
          videoId: video,
          lastExportedRevision: 1,
          document: documentUsing(voices.removed, sticker),
        },
        { id: keptClip, videoId: keptVideo, document: documentUsing(voices.live) },
      ].map((data) => ({
        organizationId: org,
        title: 'A deletion test clip',
        ratio: '9:16',
        durationMs: 30_000,
        ...data,
      })),
    });
    await row({
      videoId: video,
      clipId: clip,
      kind: 'TRANSCRIPT',
      key: storage.seed(clipKeys.videoFile(org, video, 'transcript', 'json.gz')),
      meta: transcriptAssetMeta({
        ...heard('fr', 'Bonjour'),
        source: 'translated',
      }) as unknown as Prisma.InputJsonValue,
    });
    proofKey = storage.seed(clipKeys.proofFile(org, proofJob, 'proof', 'mp4'));
    await row({ videoId: video, clipId: exportedClip, kind: 'PROOF', key: proofKey });

    for (const id of [voices.deleted, voices.removed, voices.live]) {
      await row({
        id,
        kind: 'AUDIO',
        key: storage.seed(voiceKey(org, id)),
        meta: MADE_VOICE_META,
        createdAt: libraryCreated,
      });
    }
    const previewKey = storage.seed(clipKeys.libraryUpload(org, 'webp'));
    await row({
      id: sticker,
      kind: 'STICKER',
      key: storage.seed(clipKeys.libraryUpload(org, 'png')),
      meta: { status: 'ready', name: 'Star', previewKey },
      createdAt: libraryCreated,
    });

    const now = Date.now();
    await db.clipJob.createMany({
      data: [
        { id: emote, videoId: video, expiresAt: new Date(now + 20 * HOUR_MS) },
        { id: keptEmote, videoId: keptVideo, expiresAt: new Date(now + 20 * HOUR_MS) },
        { id: oldEmote, videoId: keptVideo, expiresAt: new Date(now - HOUR_MS) },
      ].map((data) => ({
        organizationId: org,
        kind: 'EMOTE' as const,
        status: 'DONE' as const,
        progress: 100,
        input: {},
        output: EMOTE_OUTPUT,
        createdById: null,
        ...data,
      })),
    });
    seedEmoteFiles(storage, org, emote);
    seedEmoteFiles(storage, org, keptEmote);
    seedEmoteFiles(storage, org, oldEmote, new Date(now - 25 * HOUR_MS));
  });

  afterAll(async () => {
    await db.clipAsset.deleteMany({ where: { organizationId: org } });
    await db.clipJob.deleteMany({ where: { organizationId: org } });
    await db.clip.deleteMany({ where: { organizationId: org } });
    await db.clipVideo.deleteMany({ where: { organizationId: org } });
    await db.organization.delete({ where: { id: org } }).catch(() => undefined);
    await db.$disconnect();
  });

  it('removes every row and file of the video, its proof and its emote files, and the emote links', async () => {
    const emotes = emotesService(storage, () => Date.now());
    expect((await emotes.get(org, emote)).emote?.zip.url).not.toBeNull();
    const prefix = clipKeys.videoPrefix(org, video);
    expect(storage.keysUnder(prefix).length).toBeGreaterThanOrEqual(8);

    await retentionService(storage).removeVideo(org, video, 'rights_request');

    expect(storage.keysUnder(prefix)).toEqual([]);
    expect(await db.clipAsset.count({ where: { organizationId: org, videoId: video } })).toBe(0);
    expect(
      await db.clipAsset.count({ where: { organizationId: org, key: { startsWith: prefix } } }),
    ).toBe(0);
    expect(storage.has(proofKey)).toBe(false);
    expect(storage.keysUnder(clipKeys.exportPrefix(org, emote))).toEqual([]);
    const after = await emotes.get(org, emote);
    expect(after.emote?.expired).toBe(true);
    expect(after.emote?.files.every((file) => file.url === null)).toBe(true);
    expect(after.emote?.zip.url).toBeNull();
    expect((await emotes.get(org, keptEmote)).emote?.zip.url).not.toBeNull();
    const clips = await db.clip.findMany({
      where: { organizationId: org },
      select: { id: true, removedAt: true },
    });
    expect(clips.map((row) => row.id).sort()).toEqual([exportedClip, keptClip].sort());
    expect(clips.find((row) => row.id === exportedClip)?.removedAt).not.toBeNull();
    expect(storage.keysUnder(clipKeys.videoPrefix(org, keptVideo))).toHaveLength(1);
  });

  it('the real unused-library rule sweeps what only removed clips used', async () => {
    const removed = await sweepService(storage).unusedLibraryFiles(libraryNow);

    expect(removed).toBe(3);
    const left = await db.clipAsset.findMany({
      where: { organizationId: org, videoId: null },
      select: { id: true },
    });
    expect(left.map((row) => row.id)).toEqual([voices.live]);
    expect(storage.keysUnder(clipKeys.libraryPrefix(org))).toEqual([voiceKey(org, voices.live)]);
  });

  it('the real orphan rule sweeps an emote 24 hours old, and keeps a young one', async () => {
    const swept = await sweepService(storage).orphanFiles(new Date());

    expect(swept.deleted).toBe(2);
    expect(storage.keysUnder(clipKeys.exportPrefix(org, oldEmote))).toEqual([]);
    expect(storage.keysUnder(clipKeys.exportPrefix(org, keptEmote))).toHaveLength(2);
    expect(storage.keysUnder(clipKeys.videoPrefix(org, keptVideo))).toHaveLength(1);
  });
});
