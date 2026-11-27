/**
 * An in-memory stand-in for the part of Prisma the clip routes use (Sprint
 * 12, Modules 07 to 10), so the specs run the real services and the real
 * `where` objects they build against rows, with no database.
 *
 * `matches` evaluates the subset of Prisma's filter language those services
 * write: equality and `null`, `in`, `not`, `equals` (a value or a field
 * reference made by `fieldRef`), a JSON `path` with `equals` (a missing
 * path is SQL NULL: never equal), `AND`, `OR`, `NOT`, and on clips the
 * relations `video` (one) and `posts` (`some` and `none`); Module 17 adds
 * `gte`, `lte` and `contains` (case-insensitive), `ClipPost` writes, and a
 * post's channel (`integration`); Module 11 adds a JSON path's
 * `array_contains`. A filter it does not know throws, so a
 * spec can never pass by ignoring part of a query.
 *
 * Test-only: nothing outside a `*.spec.ts` imports this file.
 */
import type {
  Clip,
  ClipAsset,
  ClipHighlightRun,
  ClipJob,
  ClipCaptionStyle,
  ClipLayoutPreset,
  ClipPost,
  ClipVideo,
} from '@postgear/db';
import { TEST_ORG, TEST_USER, videoRow } from './rows';

export interface FakePost {
  id: string;
  organizationId: string;
  group: string;
  state: 'QUEUE' | 'PUBLISHED' | 'ERROR' | 'DRAFT';
  deletedAt: Date | null;
  /** Module 17: optional in a seed; a root post, published at the epoch, on `channel-1`, with no address. */
  parentPostId?: string | null;
  publishDate?: Date;
  releaseURL?: string | null;
  integrationId?: string;
}

/** Module 17: the channel a post goes to, as `post.integration` reads it. */
export interface FakeIntegration {
  id: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
}

/** The part of a Media row the export history reads (Module 15). */
export interface FakeMedia {
  id: string;
  organizationId: string;
  name: string;
  path: string;
  thumbnail: string | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  deletedAt: Date | null;
  /** Optional: when the file was made (Module 17's `exportedAt`). */
  createdAt?: Date;
}

export interface FakeTables {
  clips: Clip[];
  videos: ClipVideo[];
  clipPosts: ClipPost[];
  posts: FakePost[];
  assets: ClipAsset[];
  jobs: ClipJob[];
  layouts: ClipLayoutPreset[];
  /** Optional: Sprint 13's caption styles. */
  captionStyles?: ClipCaptionStyle[];
  /** Optional: only the export specs seed Media rows. */
  media?: FakeMedia[];
  /** Optional: Module 16's highlight runs. */
  runs?: ClipHighlightRun[];
  /** Optional: Module 17's channels for posts. */
  integrations?: FakeIntegration[];
}

const FIELD = Symbol('field');

/** What `prisma.clip.fields.revision` stands for here. */
export function fieldRef(name: string): { [FIELD]: string } {
  return { [FIELD]: name };
}

type Row = Record<string, unknown>;
type Relations = (row: Row, key: string) => unknown;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value)
  );
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function resolve(row: Row, value: unknown): unknown {
  return isPlainObject(value) && FIELD in value
    ? row[(value as { [FIELD]: string })[FIELD]]
    : value;
}

function matchesScalar(row: Row, actual: unknown, filter: unknown): boolean {
  if (isPlainObject(filter) && 'path' in filter) {
    const { path, ...rest } = filter as { path: string[] };
    let value: unknown = actual;
    for (const key of path) value = isPlainObject(value) ? value[key] : undefined;
    // A missing path reads as SQL NULL: no comparison with it is true.
    if (value === undefined || value === null) return false;
    return matchesScalar(row, value, rest);
  }
  if (!isPlainObject(filter) || FIELD in filter) {
    const expected = resolve(row, filter);
    // SQL: a comparison with NULL on either side is not true.
    if (isPlainObject(filter) && (actual === null || expected === null)) return false;
    return same(actual, expected);
  }
  for (const [op, operand] of Object.entries(filter)) {
    if (op === 'in') {
      if (!(operand as unknown[]).some((item) => same(actual, item))) return false;
    } else if (op === 'not') {
      if (operand === null ? actual === null : actual === null || same(actual, operand))
        return false;
    } else if (op === 'equals') {
      const expected = resolve(row, operand);
      if (actual === null || expected === null) {
        if (!(actual === null && operand === null)) return false;
      } else if (!same(actual, expected)) return false;
    } else if (op === 'mode') {
      // `contains` below is always case-insensitive, the only mode these services use.
    } else if (op === 'gte' || op === 'lte') {
      if (actual === null || actual === undefined) return false;
      const a = actual instanceof Date ? actual.getTime() : (actual as number);
      const b = operand instanceof Date ? operand.getTime() : (operand as number);
      if (op === 'gte' ? a < b : a > b) return false;
    } else if (op === 'array_contains') {
      // Module 11: a JSON list holds every value asked for (`meta.videoIds`).
      if (!Array.isArray(actual)) return false;
      const wanted = Array.isArray(operand) ? operand : [operand];
      if (!wanted.every((item) => actual.some((value) => same(value, item)))) return false;
    } else if (op === 'contains') {
      if (typeof actual !== 'string') return false;
      if (!actual.toLowerCase().includes(String(operand).toLowerCase())) return false;
    } else {
      throw new Error(`fake-clip-db: unknown operator ${op}`);
    }
  }
  return true;
}

export function matches(row: Row, where: unknown, relations: Relations = noRelations): boolean {
  if (where === undefined) return true;
  if (!isPlainObject(where)) throw new Error('fake-clip-db: a where must be an object');
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') {
      if (!(value as unknown[]).every((part) => matches(row, part, relations))) return false;
    } else if (key === 'OR') {
      if (!(value as unknown[]).some((part) => matches(row, part, relations))) return false;
    } else if (key === 'NOT') {
      const parts = Array.isArray(value) ? value : [value];
      if (parts.some((part) => matches(row, part, relations))) return false;
    } else if (key in row) {
      if (!matchesScalar(row, row[key], value)) return false;
    } else if (isPlainObject(value) && 'path' in value) {
      // A JSON column a seeded row leaves out (`clipRow` has no `meta`) is SQL NULL.
      if (!matchesScalar(row, null, value)) return false;
    } else {
      const related = relations(row, key);
      if (Array.isArray(related)) {
        const { some, none, ...rest } = value as { some?: unknown; none?: unknown };
        if (Object.keys(rest).length > 0) throw new Error(`fake-clip-db: ${key} filter`);
        if (some !== undefined && !related.some((item) => matches(item, some))) return false;
        if (none !== undefined && related.some((item) => matches(item, none))) return false;
      } else if (isPlainObject(related)) {
        if (!matches(related, value, relations)) return false;
      } else {
        throw new Error(`fake-clip-db: unknown field ${key}`);
      }
    }
  }
  return true;
}

function noRelations(_row: Row, key: string): unknown {
  throw new Error(`fake-clip-db: unknown field ${key}`);
}

function sortRows<T extends Row>(rows: T[], orderBy: unknown): T[] {
  const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<
    Record<string, 'asc' | 'desc'>
  >;
  return [...rows].sort((a, b) => {
    for (const order of orders) {
      const [field, direction] = Object.entries(order)[0] ?? [];
      if (!field) continue;
      const x = a[field] as Date | string | number;
      const y = b[field] as Date | string | number;
      const cmp = x < y ? -1 : x > y ? 1 : 0;
      if (cmp !== 0) return direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function distinctBy<T extends Row>(rows: T[], distinct: unknown): T[] {
  if (!distinct) return rows;
  const [field] = distinct as string[];
  const seen = new Set<unknown>();
  return rows.filter((row) => {
    const value = row[field as string];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

interface FindArgs {
  where?: unknown;
  orderBy?: unknown;
  skip?: number;
  take?: number;
  distinct?: unknown;
  select?: Record<string, unknown>;
}

/** A Prisma-shaped client over `tables`. */
export function fakeClipDb(tables: FakeTables) {
  const clipRelations: Relations = (row, key) => {
    if (key === 'posts') return tables.clipPosts.filter((post) => post.clipId === row.id);
    if (key === 'video') return tables.videos.find((video) => video.id === row.videoId);
    throw new Error(`fake-clip-db: unknown clip field ${key}`);
  };

  const shapeClip = (clip: Clip, select?: Record<string, unknown>) => {
    const video = tables.videos.find((v) => v.id === clip.videoId);
    const postSelect = select?.posts as { where?: unknown; take?: number } | undefined;
    const posts = tables.clipPosts
      .filter((post) => post.clipId === clip.id)
      .filter((post) => matches(post as unknown as Row, postSelect?.where))
      .slice(0, postSelect?.take ?? Number.POSITIVE_INFINITY);
    return { ...clip, video, posts };
  };

  function table<T extends Row>(rows: () => T[], relations: Relations = noRelations) {
    return {
      findMany: jest.fn(async (args: FindArgs = {}) => {
        let found = rows().filter((row) => matches(row, args.where, relations));
        found = distinctBy(sortRows(found, args.orderBy), args.distinct);
        return found.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? found.length));
      }),
      findFirst: jest.fn(async (args: FindArgs = {}) => {
        return (
          sortRows(rows(), args.orderBy).find((row) => matches(row, args.where, relations)) ?? null
        );
      }),
      count: jest.fn(
        async (args: FindArgs = {}) =>
          rows().filter((row) => matches(row, args.where, relations)).length,
      ),
    };
  }

  const clips = table(() => tables.clips as unknown as Row[], clipRelations);
  const now = () => new Date();

  const self: { db?: unknown } = {};
  const db = {
    /** One at a time, as a serializable transaction would order them; an array runs as given. */
    $transaction: jest.fn(async (work: unknown) =>
      Array.isArray(work)
        ? Promise.all(work)
        : (work as (tx: unknown) => Promise<unknown>)(self.db),
    ),
    clip: {
      fields: { revision: fieldRef('revision') },
      findMany: jest.fn(async (args: FindArgs = {}) =>
        ((await clips.findMany(args)) as unknown as Clip[]).map((clip) =>
          shapeClip(clip, args.select),
        ),
      ),
      findFirst: clips.findFirst,
      count: clips.count,
      create: jest.fn(async ({ data }: { data: Partial<Clip> }) => {
        const row = clipRow({ ...data, createdAt: now(), updatedAt: now() });
        tables.clips.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Clip> }) => {
        const row = tables.clips.find((clip) => clip.id === where.id);
        if (!row) throw new Error('fake-clip-db: update of a missing clip');
        Object.assign(row, data, { updatedAt: now() });
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: unknown; data: Partial<Clip> }) => {
        const found = tables.clips.filter((clip) =>
          matches(clip as unknown as Row, where, clipRelations),
        );
        for (const row of found) Object.assign(row, data, { updatedAt: now() });
        return { count: found.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: unknown }) => {
        const before = tables.clips.length;
        tables.clips = tables.clips.filter(
          (clip) => !matches(clip as unknown as Row, where, clipRelations),
        );
        tables.clipPosts = tables.clipPosts.filter((post) =>
          tables.clips.some((clip) => clip.id === post.clipId),
        );
        return { count: before - tables.clips.length };
      }),
    },
    clipVideo: {
      ...table(() => tables.videos as unknown as Row[]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    clipPost: {
      ...table(() => tables.clipPosts as unknown as Row[]),
      createMany: jest.fn(async ({ data }: { data: Partial<ClipPost>[] }) => {
        for (const row of data) {
          tables.clipPosts.push({
            id: `cp-${tables.clipPosts.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: now(),
            ...row,
          } as ClipPost);
        }
        return { count: data.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: unknown }) => {
        const before = tables.clipPosts.length;
        tables.clipPosts = tables.clipPosts.filter((row) => !matches(row as unknown as Row, where));
        return { count: before - tables.clipPosts.length };
      }),
    },
    post: (() => {
      const posts = table(() => tables.posts.map(postRow) as unknown as Row[]);
      const withChannel = (row: Row) => {
        const id = row.integrationId as string;
        const integration = tables.integrations?.find((item) => item.id === id) ?? {
          id,
          name: 'Channel One',
          providerIdentifier: 'youtube',
          picture: null,
        };
        return { ...row, integration };
      };
      return {
        ...posts,
        findMany: jest.fn(async (args: FindArgs = {}) =>
          ((await posts.findMany(args)) as Row[]).map(withChannel),
        ),
      };
    })(),
    media: table(() => (tables.media ?? []) as unknown as Row[]),
    clipAsset: {
      ...table(() => tables.assets as unknown as Row[]),
      deleteMany: jest.fn(async ({ where }: { where: unknown }) => {
        const before = tables.assets.length;
        tables.assets = tables.assets.filter((asset) => !matches(asset as unknown as Row, where));
        return { count: before - tables.assets.length };
      }),
      // Sprint 13: a clip's own transcript (a supplied file, a translation) is written by the API.
      create: jest.fn(async ({ data }: { data: Partial<ClipAsset> }) => {
        const count = tables.assets.length + 1;
        const row = {
          id: `aaaaaaaa-0000-4000-8000-${String(count).padStart(12, '0')}`,
          clipId: null,
          mimeType: null,
          meta: null,
          createdAt: new Date(Date.UTC(2026, 10, 2, 0, 0, count)),
          ...data,
        } as ClipAsset;
        tables.assets.push(row);
        return row;
      }),
      // Sprint 13: a transcript row's meta is rewritten when a word is fixed.
      updateMany: jest.fn(async ({ where, data }: { where: unknown; data: object }) => {
        const found = tables.assets.filter((row) => matches(row as unknown as Row, where));
        for (const row of found) Object.assign(row, data);
        return { count: found.length };
      }),
    },
    clipJob: {
      ...table(() => tables.jobs as unknown as Row[]),
      create: jest.fn(async ({ data }: { data: Partial<ClipJob> }) => {
        const row = { ...data, createdAt: now(), updatedAt: now() } as ClipJob;
        tables.jobs.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: unknown; data: object }) => {
        const found = tables.jobs.filter((row) => matches(row as unknown as Row, where));
        for (const row of found) Object.assign(row, data, { updatedAt: now() });
        return { count: found.length };
      }),
    },
    clipHighlightRun: {
      ...table(() => (tables.runs ?? []) as unknown as Row[]),
      create: jest.fn(async ({ data }: { data: Partial<ClipHighlightRun> }) => {
        const row = {
          status: 'QUEUED',
          tracks: [],
          aiMinutesCharged: 0,
          usageEntryId: null,
          found: 0,
          createdById: null,
          finishedAt: null,
          createdAt: now(),
          ...data,
        } as ClipHighlightRun;
        tables.runs = [...(tables.runs ?? []), row];
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: unknown; data: object }) => {
        const found = (tables.runs ?? []).filter((row) => matches(row as unknown as Row, where));
        for (const row of found) Object.assign(row, data);
        return { count: found.length };
      }),
    },
    // Sprint 13: a workspace's own caption styles.
    clipCaptionStyle: (() => {
      const rows = () => {
        tables.captionStyles ??= [];
        return tables.captionStyles as unknown as Row[];
      };
      return {
        ...table(rows),
        create: jest.fn(async ({ data }: { data: Row }) => {
          const row = {
            id: `00000000-0000-4000-8000-${String(rows().length + 1).padStart(12, '0')}`,
            createdById: null,
            createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, rows().length)),
            updatedAt: now(),
            ...data,
          } as Row;
          rows().push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: { where: unknown; data: object }) => {
          const found = rows().filter((row) => matches(row, where));
          for (const row of found) Object.assign(row, data, { updatedAt: now() });
          return { count: found.length };
        }),
        deleteMany: jest.fn(async ({ where }: { where: unknown }) => {
          const before = rows().length;
          tables.captionStyles = rows().filter((row) => !matches(row, where)) as never;
          return { count: before - (tables.captionStyles as unknown[]).length };
        }),
      };
    })(),
    clipLayoutPreset: {
      ...table(() => tables.layouts as unknown as Row[]),
      create: jest.fn(async ({ data }: { data: Partial<ClipLayoutPreset> }) => {
        const row = {
          id: `00000000-0000-4000-8000-${String(tables.layouts.length + 1).padStart(12, '0')}`,
          createdById: null,
          createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, tables.layouts.length)),
          updatedAt: now(),
          ...data,
        } as ClipLayoutPreset;
        tables.layouts.push(row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: unknown; data: object }) => {
        const found = tables.layouts.filter((row) => matches(row as unknown as Row, where));
        for (const row of found) Object.assign(row, data, { updatedAt: now() });
        return { count: found.length };
      }),
      deleteMany: jest.fn(async ({ where }: { where: unknown }) => {
        const before = tables.layouts.length;
        tables.layouts = tables.layouts.filter((row) => !matches(row as unknown as Row, where));
        return { count: before - tables.layouts.length };
      }),
    },
  };
  self.db = db;
  return db;
}

export type FakeClipDb = ReturnType<typeof fakeClipDb>;

/** A seeded post with Module 17's fields filled in, so every filter can read them. */
function postRow(post: FakePost): FakePost & Row {
  return {
    parentPostId: null,
    publishDate: new Date('2026-11-01T10:00:00.000Z'),
    releaseURL: null,
    integrationId: 'channel-1',
    ...post,
  };
}

export function emptyTables(): FakeTables {
  return { clips: [], videos: [], clipPosts: [], posts: [], assets: [], jobs: [], layouts: [] };
}

const EPOCH = new Date('2026-11-01T10:00:00.000Z');

export function clipRow(
  overrides: Omit<Partial<Clip>, 'document'> & { document?: unknown } = {},
): Clip {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    organizationId: TEST_ORG,
    videoId: videoRow().id,
    title: 'A clip',
    status: 'DRAFT',
    origin: 'MANUAL',
    score: null,
    reasons: [],
    highlightRunId: null,
    document: {},
    revision: 1,
    ratio: '9:16',
    durationMs: 30_000,
    lastExportedRevision: null,
    removedAt: null,
    lastExportedFingerprint: null,
    exportedMediaId: null,
    brandKitId: null,
    presetId: null,
    createdById: TEST_USER,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  } as Clip;
}

export function assetRow(overrides: Partial<ClipAsset> = {}): ClipAsset {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    organizationId: TEST_ORG,
    videoId: videoRow().id,
    clipId: null,
    kind: 'PROXY',
    key: 'clips/seed-demo-org/videos/x/proxy.mp4',
    bytes: 1n,
    mimeType: null,
    meta: null,
    createdAt: EPOCH,
    ...overrides,
  };
}
