/**
 * Saved layouts (Module 10 section 6) against an in-memory table: the
 * engine's schema refuses a bad layout, a name is cleaned and bounded, the
 * 50 a workspace limit, newest first with the shape filter, rename and
 * delete, and tenancy on every route.
 */
import { HttpException } from '@nestjs/common';
import { createClipDocument } from '@postgear/video-engine';
import { emptyTables, type FakeClipDb, type FakeTables, fakeClipDb } from '../testing/fake-clip-db';
import { TEST_ORG, TEST_USER } from '../testing/rows';
import { ClipLayoutsRepository } from './clip-layouts.repository';
import {
  createLayoutSchema,
  listLayoutsQuerySchema,
  MAX_SAVED_LAYOUTS,
  renameLayoutSchema,
} from './clip-layouts.schema';
import { ClipLayoutsService } from './clip-layouts.service';

let mockDb: FakeClipDb;
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: new Proxy(
      {},
      { get: (_target, key) => (mockDb as Record<string | symbol, unknown>)[key] },
    ),
  };
});

const OTHER_ORG = 'seed-second-org';
const LAYOUT = createClipDocument({
  videoId: '22222222-2222-4222-8222-222222222222',
  fromMs: 0,
  toMs: 10_000,
  ratio: '9:16',
}).layout;

function setup(tables: FakeTables = emptyTables()) {
  mockDb = fakeClipDb(tables);
  return { service: new ClipLayoutsService(new ClipLayoutsRepository()), tables };
}

const body = (name: string, ratio: '9:16' | '16:9' = '9:16') =>
  createLayoutSchema.parse({ name, ratio, layout: LAYOUT });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('saved layout schemas', () => {
  it("refuses a layout the engine's schema refuses", () => {
    expect(
      createLayoutSchema.safeParse({ name: 'Mine', ratio: '9:16', layout: LAYOUT }).success,
    ).toBe(true);
    expect(
      createLayoutSchema.safeParse({
        name: 'Mine',
        ratio: '9:16',
        layout: { ...LAYOUT, kind: 'spiral' },
      }).success,
    ).toBe(false);
    expect(
      createLayoutSchema.safeParse({
        name: 'Mine',
        ratio: '9:16',
        layout: { ...LAYOUT, areas: [] },
      }).success,
    ).toBe(false);
    expect(
      createLayoutSchema.safeParse({
        name: 'Mine',
        ratio: '9:16',
        layout: { ...LAYOUT, extra: true },
      }).success,
    ).toBe(false);
    expect(
      createLayoutSchema.safeParse({ name: 'Mine', ratio: '3:2', layout: LAYOUT }).success,
    ).toBe(false);
  });

  it('cleans a name and keeps it to 1 to 60 characters', () => {
    expect(body('  Two\u0007  Speakers ').name).toBe('Two Speakers');
    expect(renameLayoutSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(renameLayoutSchema.safeParse({ name: 'x'.repeat(61) }).success).toBe(false);
    expect(renameLayoutSchema.safeParse({ name: 'x'.repeat(60) }).success).toBe(true);
    expect(renameLayoutSchema.safeParse({ name: 'x', ratio: '9:16' }).success).toBe(false);
    expect(listLayoutsQuerySchema.safeParse({ ratio: '4:5' }).success).toBe(true);
    expect(listLayoutsQuerySchema.safeParse({ ratio: 'tall' }).success).toBe(false);
  });
});

describe('ClipLayoutsService', () => {
  it('saves and lists newest first, filtered by shape, with the layout read back', async () => {
    const { service } = setup();
    const first = await service.create(TEST_ORG, TEST_USER, body('First'));
    await service.create(TEST_ORG, TEST_USER, body('Wide', '16:9'));
    const third = await service.create(TEST_ORG, TEST_USER, body('Third'));
    expect(first.layout).toMatchObject({ name: 'First', ratio: '9:16', layout: LAYOUT });
    expect(Object.keys(first.layout).sort()).toEqual([
      'createdAt',
      'id',
      'layout',
      'name',
      'ratio',
      'updatedAt',
    ]);

    const tall = await service.list(TEST_ORG, { ratio: '9:16' });
    expect(tall.layouts.map((layout) => layout.id)).toEqual([third.layout.id, first.layout.id]);
    expect((await service.list(TEST_ORG, {})).layouts).toHaveLength(3);
  });

  it('refuses the 51st layout with 409 layout_limit, and counts per workspace', async () => {
    const { service, tables } = setup();
    for (let index = 0; index < MAX_SAVED_LAYOUTS; index++) {
      await service.create(TEST_ORG, TEST_USER, body(`Layout ${index}`));
    }
    const answer = await refusal(service.create(TEST_ORG, TEST_USER, body('One too many')));
    expect(answer).toEqual({
      status: 409,
      body: {
        code: 'layout_limit',
        message:
          'This workspace has 50 saved layouts, the most it can keep. Delete one to save another.',
      },
    });
    expect(tables.layouts).toHaveLength(MAX_SAVED_LAYOUTS);
    await expect(service.create(OTHER_ORG, TEST_USER, body('Theirs'))).resolves.toBeDefined();
  });

  it('renames and deletes', async () => {
    const { service } = setup();
    const { layout } = await service.create(TEST_ORG, TEST_USER, body('Old'));
    expect((await service.rename(TEST_ORG, layout.id, { name: 'New' })).layout.name).toBe('New');
    expect(await service.remove(TEST_ORG, layout.id)).toEqual({ message: 'Layout deleted.' });
    expect((await service.list(TEST_ORG, {})).layouts).toEqual([]);
  });

  it("answers 404 for another workspace's layout on every route, and changes nothing", async () => {
    const { service } = setup();
    const { layout } = await service.create(TEST_ORG, TEST_USER, body('Mine'));
    expect(await refusal(service.rename(OTHER_ORG, layout.id, { name: 'Taken' }))).toMatchObject({
      status: 404,
      body: { code: 'layout_not_found' },
    });
    expect(await refusal(service.remove(OTHER_ORG, layout.id))).toMatchObject({ status: 404 });
    expect((await service.list(OTHER_ORG, {})).layouts).toEqual([]);
    expect((await service.list(TEST_ORG, {})).layouts[0]?.name).toBe('Mine');
    expect(await refusal(service.remove(TEST_ORG, 'not-a-uuid'))).toMatchObject({ status: 404 });
  });

  it('leaves out a stored layout that no longer reads', async () => {
    const tables = emptyTables();
    const { service } = setup(tables);
    await service.create(TEST_ORG, TEST_USER, body('Good'));
    tables.layouts.push({
      ...tables.layouts[0],
      id: '00000000-0000-4000-8000-00000000beef',
      layout: { kind: 'spiral' },
    } as (typeof tables.layouts)[number]);
    const { layouts } = await service.list(TEST_ORG, {});
    expect(layouts.map((layout) => layout.name)).toEqual(['Good']);
  });
});
