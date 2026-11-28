/**
 * The AI Minutes audit's bench (Sprint 13, Module 15 section 4).
 *
 * Every AI route is run as it is written, against Sprint 12's in-memory Clips
 * tables (`fakeClipDb`) and a ledger table, with the **real** `UsageService`
 * and `EntitlementsRepository` on top: the real key look-up, the real hard
 * limit and its sentence, the real `rev:<entryId>` reversals. So what a test
 * reads back from `ledger` is what the database would hold.
 *
 * The spec that uses it mocks `@postgear/db` with a proxy onto `bench.db`
 * (the shape every Clips spec uses), so the services, the repositories and
 * `serializable` all see the same rows.
 *
 * Test-only: nothing outside a `*.spec.ts` imports this file.
 */
import { Prisma, type ClipAsset, UsageKind } from '@postgear/db';
import { meterAmounts } from '@postgear/entitlements';
import {
  type ClipSetup,
  defaultClipSetup,
  emptyTranscript,
  mergeTranscript,
  type Transcript,
  transcriptAssetMeta,
} from '@postgear/video-engine';
import type { EntitlementResolver } from '../../entitlements/entitlement-resolver';
import { EntitlementsRepository } from '../../entitlements/entitlements.repository';
import { UsageService } from '../../entitlements/usage.service';
import type { MediaService } from '../../media/media.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { ClipHighlightsService } from '../highlights/clip-highlights.service';
import { ClipsInternalService } from '../internal/clips-internal.service';
import { ClipJobsRepository } from '../jobs/clip-jobs.repository';
import { ClipJobsService } from '../jobs/clip-jobs.service';
import type { ClipLimitsGuard } from '../limits/clip-limits.guard';
import type { MediaServiceProbe } from '../status/media-service.probe';
import {
  assetRow,
  emptyTables,
  type FakeTables,
  fakeClipDb,
  matches,
} from '../testing/fake-clip-db';
import { TEST_ORG, videoRow } from '../testing/rows';
import type { ClipTranscriptStore } from '../transcripts/clip-transcript-store';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';

export const AI_METER = 'clips.ai_minutes_per_month';
export const CYCLE_START = new Date('2026-11-01T00:00:00.000Z');
export const CYCLE_END = new Date('2026-12-01T00:00:00.000Z');
export const VIDEO = videoRow().id;
export const TEN_MINUTES = 600_000;
/** The video's own transcript row (a listened one). */
export const HEARD_ID = '77777777-7777-4777-8777-777777777777';
export const HEARD_KEY = `clips/${TEST_ORG}/${VIDEO}/transcript-${'c'.repeat(32)}.json.gz`;

/** One `UsageEntry` row, as Prisma would hand it back. */
export interface LedgerRow {
  id: string;
  organizationId: string;
  meter: string;
  units: number;
  kind: UsageKind;
  idempotencyKey: string;
  refId: string | null;
  reversesId: string | null;
  cycleStart: Date;
  meta: unknown;
  createdBy: string | null;
  createdAt: Date;
}

type Where = Record<string, unknown> | undefined;

/** The ledger's table: the queries `EntitlementsRepository` and the audit checks make. */
export function ledgerTable(rows: LedgerRow[]) {
  const found = (where: Where) =>
    rows.filter((row) => matches(row as unknown as Record<string, unknown>, where));
  return {
    findUnique: jest.fn(
      async ({
        where,
      }: {
        where: {
          organizationId_idempotencyKey: { organizationId: string; idempotencyKey: string };
        };
      }) => {
        const key = where.organizationId_idempotencyKey;
        return (
          rows.find(
            (row) =>
              row.organizationId === key.organizationId &&
              row.idempotencyKey === key.idempotencyKey,
          ) ?? null
        );
      },
    ),
    findFirst: jest.fn(async (args: { where?: Where } = {}) => found(args.where)[0] ?? null),
    findMany: jest.fn(async (args: { where?: Where } = {}) => found(args.where)),
    aggregate: jest.fn(async (args: { where?: Where }) => {
      const hits = found(args.where);
      return {
        _sum: { units: hits.length === 0 ? null : hits.reduce((sum, row) => sum + row.units, 0) },
      };
    }),
    create: jest.fn(async ({ data }: { data: Omit<LedgerRow, 'id' | 'createdAt'> }) => {
      if (
        rows.some(
          (row) =>
            row.organizationId === data.organizationId &&
            row.idempotencyKey === data.idempotencyKey,
        )
      ) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'audit',
        });
      }
      const row: LedgerRow = {
        ...data,
        meta: data.meta ?? null,
        id: `entry-${rows.length + 1}`,
        createdAt: new Date(CYCLE_START.getTime() + rows.length * 1000),
      };
      rows.push(row);
      return row;
    }),
  };
}

/** One word a second over `[fromSec, toSec)`, as a listen would store it; none when `silent`. */
export function listenedTranscript(fromSec: number, toSec: number, silent = false): Transcript {
  return mergeTranscript(emptyTranscript('en', 'simulation'), {
    ranges: [{ fromMs: fromSec * 1000, toMs: toSec * 1000 }],
    words: Array.from({ length: silent ? 0 : toSec - fromSec }, (_, index) => ({
      start: (fromSec + index) * 1000,
      end: (fromSec + index) * 1000 + 600,
      text: index % 5 === 4 ? `word${index}.` : `word${index}`,
      sure: 0.9,
    })),
  });
}

export interface BenchOptions {
  /** The month's AI minutes; null for no limit. */
  limit?: number | null;
  /** The video's own transcript: the seconds already listened to, or null for none. */
  heard?: [number, number] | null;
  /** The media service's answer (`ok` unless a test turns it off). */
  service?: 'ok' | 'off';
}

let idCount = 0;

/** A fresh bench: tables, ledger, the real usage service and the shared Clips services. */
export function aiBench(options: BenchOptions = {}) {
  const tables: FakeTables = emptyTables();
  tables.runs = [];
  tables.videos.push(videoRow({ status: 'READY', durationMs: TEN_MINUTES, hasAudio: true }));
  const ledger: LedgerRow[] = [];
  const files = new Map<string, Transcript>();

  const clipDb = fakeClipDb(tables);
  // Text To Speech takes back a row whose charge was refused.
  const clipJob = clipDb.clipJob as unknown as Record<string, unknown>;
  clipJob.deleteMany = jest.fn(async ({ where }: { where: Where }) => {
    const before = tables.jobs.length;
    tables.jobs = tables.jobs.filter(
      (row) => !matches(row as unknown as Record<string, unknown>, where),
    );
    return { count: before - tables.jobs.length };
  });
  // The same object `fakeClipDb`'s transactions hand out, so a transaction sees the ledger too.
  const db = Object.assign(clipDb, { usageEntry: ledgerTable(ledger) });

  const limit = { value: options.limit === undefined ? 300 : options.limit };
  const usedMilli = (orgId: string) =>
    ledger
      .filter(
        (row) =>
          row.organizationId === orgId &&
          row.meter === AI_METER &&
          row.cycleStart.getTime() === CYCLE_START.getTime(),
      )
      .reduce((sum, row) => sum + row.units, 0);
  const exact = (orgId: string) => {
    const used = usedMilli(orgId);
    return {
      ...meterAmounts(used, limit.value),
      cycleStart: CYCLE_START,
      cycleEnd: CYCLE_END,
      usedMilli: used,
      limitValue: limit.value,
    };
  };
  const resolver = {
    exactMeter: jest.fn(async (orgId: string) => exact(orgId)),
    meter: jest.fn(async (orgId: string) => {
      const { usedMilli: _used, limitValue: _limit, ...state } = exact(orgId);
      return state;
    }),
    windowFor: jest.fn(async () => ({ start: CYCLE_START, end: CYCLE_END })),
    get: jest.fn(async () => 'normal'),
  };

  const usage = new UsageService(
    new EntitlementsRepository(),
    resolver as unknown as EntitlementResolver,
  );
  const consume = jest.spyOn(usage, 'consume');
  const reverse = jest.spyOn(usage, 'reverse');

  const scheduling = {
    startClipJob: jest.fn(async () => true),
    cancelClipJob: jest.fn(async () => 'notFound' as const),
    describeClipJob: jest.fn(async () => 'notFound' as const),
  };
  const jobsRepository = new ClipJobsRepository();
  const jobs = new ClipJobsService(
    jobsRepository,
    scheduling as unknown as SchedulingService,
    resolver as unknown as EntitlementResolver,
    usage,
    { deletePrefix: jest.fn(async () => 0) } as never,
  );
  jest.spyOn(jobs, 'newJobId').mockImplementation(() => {
    idCount += 1;
    return `88888888-8888-4888-8888-${String(idCount).padStart(12, '0')}`;
  });

  const store = {
    read: jest.fn(async (key: string) => files.get(key) ?? null),
    write: jest.fn(async (key: string, transcript: Transcript) => {
      files.set(key, transcript);
      return 100;
    }),
    delete: jest.fn(async (key: string) => {
      files.delete(key);
    }),
  };
  const limits = {
    assertEnabled: jest.fn(async () => undefined),
    assertStorage: jest.fn(async () => undefined),
  };
  const transcripts = new ClipTranscriptsService(
    new ClipVideosRepository(),
    jobs,
    jobsRepository,
    limits as unknown as ClipLimitsGuard,
    usage,
    store as unknown as ClipTranscriptStore,
    { state: jest.fn(async () => options.service ?? 'ok') } as unknown as MediaServiceProbe,
  );
  // The worker's calls: only the ledger part is read here.
  const internal = new ClipsInternalService(
    jobs,
    jobsRepository,
    limits as unknown as ClipLimitsGuard,
    usage,
    {} as MediaService,
    { notify: jest.fn(async () => undefined) } as unknown as NotificationsService,
  );

  /** Stores the video's own transcript covering `[fromSec, toSec)` (heard as silence when `silent`). */
  const hear = (fromSec: number, toSec: number, silent = false) => {
    const transcript = listenedTranscript(fromSec, toSec, silent);
    files.set(HEARD_KEY, transcript);
    tables.assets = tables.assets.filter((asset) => asset.id !== HEARD_ID);
    tables.assets.push(
      assetRow({
        id: HEARD_ID,
        organizationId: TEST_ORG,
        videoId: VIDEO,
        clipId: null,
        kind: 'TRANSCRIPT',
        key: HEARD_KEY,
        meta: transcriptAssetMeta(transcript),
      } as Partial<ClipAsset>),
    );
  };
  if (options.heard) hear(options.heard[0], options.heard[1]);

  const aiRows = () => ledger.filter((row) => row.meter === AI_METER);
  return {
    /** The prisma stand-in a spec's `@postgear/db` mock points at. */
    db: db as unknown,
    tables,
    ledger,
    files,
    usage,
    consume,
    reverse,
    resolver,
    scheduling,
    jobs,
    jobsRepository,
    transcripts,
    internal,
    limits,
    store,
    hear,
    setLimit: (value: number | null) => {
      limit.value = value;
    },
    /** The AI minutes charges, in display units, oldest first. */
    charges: () =>
      aiRows()
        .filter((row) => row.kind === UsageKind.CHARGE)
        .map((row) => ({ key: row.idempotencyKey, units: row.units / 1000, refId: row.refId })),
    /** AI minutes still spent, charges less reversals (display units); for one job when named. */
    net: (refId?: string) =>
      aiRows()
        .filter((row) => refId === undefined || row.refId === refId)
        .reduce((sum, row) => sum + row.units, 0) / 1000,
    /** The reversal rows, oldest first. */
    reversals: () => aiRows().filter((row) => row.kind === UsageKind.REVERSAL),
    /** What the worker does when a job fails before any output: the job closes, the route gives back. */
    workerFails: async (jobId: string) => {
      const job = tables.jobs.find((row) => row.id === jobId);
      if (job) Object.assign(job, { status: 'FAILED' });
      return internal.reverseCharges(jobId, { organizationId: TEST_ORG });
    },
    /**
     * What the worker does when a listening job ends: the words are kept and
     * the job is DONE; a stretch heard as silence gives its minutes back.
     */
    workerListened: async (jobId: string, fromSec: number, toSec: number, silent = false) => {
      const job = tables.jobs.find((row) => row.id === jobId);
      if (job) Object.assign(job, { status: 'DONE' });
      hear(fromSec, toSec, silent);
      if (silent) await internal.reverseCharges(jobId, { organizationId: TEST_ORG });
    },
  };
}

export type AiBench = ReturnType<typeof aiBench>;

/** The status and body of an HTTP refusal; throws when the promise resolves. */
export async function refusal(
  promise: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    const http = error as { getStatus?: () => number; getResponse?: () => unknown };
    if (typeof http.getStatus === 'function' && typeof http.getResponse === 'function') {
      return { status: http.getStatus(), body: http.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

/** Find Clips on the bench; `vision` is `CLIPS_ACTION_VISION` (Look For Action's still check). */
export function highlightsOf(b: AiBench, vision = false): ClipHighlightsService {
  return new ClipHighlightsService(
    new ClipVideosRepository(),
    b.jobs,
    b.jobsRepository,
    b.limits as never,
    b.usage,
    b.resolver as never,
    b.transcripts,
    { get: () => (vision ? 'true' : 'false') } as never,
  );
}

/** A Clip Setup over the whole ten-minute video, with `overrides`. */
export function setupOf(overrides: Partial<ClipSetup> = {}): ClipSetup {
  return { ...defaultClipSetup(TEN_MINUTES), ...overrides };
}
