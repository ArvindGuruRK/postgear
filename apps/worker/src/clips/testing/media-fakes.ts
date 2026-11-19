/**
 * An in-memory `prisma.media` for the Media video facts tests (Module 19):
 * `findFirst`, `findMany` and `updateMany` over plain rows, reading the same
 * `where` objects the real rows pass (equality, null, and `OR`), so a test
 * checks what the query selects, not only that it was called. Anything else
 * in a `where` throws, so the fake can never quietly match more than Prisma.
 */
import type { MediaBackfillDb } from '../../activities/media-facts.activities';
import type { MediaFactsDb } from '../media-facts/rows';

export interface FakeMediaRow {
  id: string;
  organizationId: string;
  type: string;
  path: string;
  thumbnail: string | null;
  fileSize: number;
  durationMs: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  factsCheckedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

export const MEDIA_ORG = 'seed-demo-org';
export const MEDIA_ID = '0b5f5a8e-1c0d-4f7e-9a62-5d2c7e1f3a4b';
export const MEDIA_PATH = '2026/11/0123456789abcdef0123456789abcdef.mp4';

export function mediaRow(overrides: Partial<FakeMediaRow> = {}): FakeMediaRow {
  return {
    id: MEDIA_ID,
    organizationId: MEDIA_ORG,
    type: 'video',
    path: MEDIA_PATH,
    thumbnail: null,
    fileSize: 1_234,
    durationMs: null,
    fps: null,
    width: null,
    height: null,
    factsCheckedAt: null,
    deletedAt: null,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    ...overrides,
  };
}

type Where = Record<string, unknown>;

function matches(row: FakeMediaRow, where: Where): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Where[]).some((part) => matches(row, part));
    if (key === 'AND') return (expected as Where[]).every((part) => matches(row, part));
    if (!(key in row)) throw new Error(`The fake media db does not know the field ${key}.`);
    if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
      throw new Error(`The fake media db only compares plain values (${key}).`);
    }
    const actual = row[key as keyof FakeMediaRow];
    if (expected instanceof Date) {
      return actual instanceof Date && actual.getTime() === expected.getTime();
    }
    return actual === expected;
  });
}

function pick(row: FakeMediaRow, select?: Record<string, boolean>): Record<string, unknown> {
  if (!select) return { ...row };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, on]) => on)
      .map(([key]) => [key, row[key as keyof FakeMediaRow]]),
  );
}

type OrderBy = Record<string, 'asc' | 'desc'>;

function compare(a: FakeMediaRow, b: FakeMediaRow, orderBy: OrderBy[]): number {
  for (const order of orderBy) {
    const [key, direction] = Object.entries(order)[0];
    const left = a[key as keyof FakeMediaRow];
    const right = b[key as keyof FakeMediaRow];
    const l = left instanceof Date ? left.getTime() : left;
    const r = right instanceof Date ? right.getTime() : right;
    if (l === r) continue;
    const less = (l as string | number) < (r as string | number);
    return (less ? -1 : 1) * (direction === 'desc' ? -1 : 1);
  }
  return 0;
}

export class FakeMediaDb {
  readonly updates: { where: Where; data: Record<string, unknown> }[] = [];
  readonly queries: { where: Where; take?: number }[] = [];

  constructor(public rows: FakeMediaRow[] = []) {}

  row(id: string): FakeMediaRow | undefined {
    return this.rows.find((row) => row.id === id);
  }

  readonly media = {
    findFirst: async (args: { where: Where; select?: Record<string, boolean> }) => {
      const found = this.rows.find((row) => matches(row, args.where));
      return found ? pick(found, args.select) : null;
    },
    findMany: async (args: {
      where: Where;
      select?: Record<string, boolean>;
      orderBy?: OrderBy | OrderBy[];
      take?: number;
    }) => {
      this.queries.push({ where: args.where, take: args.take });
      const order = args.orderBy ? [args.orderBy].flat() : [];
      return this.rows
        .filter((row) => matches(row, args.where))
        .sort((a, b) => compare(a, b, order))
        .slice(0, args.take ?? undefined)
        .map((row) => pick(row, args.select));
    },
    updateMany: async (args: { where: Where; data: Record<string, unknown> }) => {
      this.updates.push(args);
      let count = 0;
      for (const row of this.rows) {
        if (!matches(row, args.where)) continue;
        Object.assign(row, args.data);
        count += 1;
      }
      return { count };
    },
  };

  /** As the rows and the backfill take it. */
  asDb(): MediaFactsDb & MediaBackfillDb {
    return this as unknown as MediaFactsDb & MediaBackfillDb;
  }
}
