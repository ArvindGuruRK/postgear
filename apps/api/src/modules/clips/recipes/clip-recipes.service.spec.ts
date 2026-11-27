/**
 * Recipes (Sprint 13, Module 10): the service over the real repository, with
 * prisma faked. Starters first, own newest first, the 50 limit counted in a
 * transaction, starters refused for writes, another workspace's id a 404.
 */
import { RECIPES_MAX, STARTER_RECIPES } from '@postgear/video-engine';
import type { ClipBrandKitsService } from '../brand-kits/clip-brand-kits.service';
import { ClipErrorException } from '../clip-error.exception';
import { createRecipeSchema, updateRecipeSchema } from './clip-recipes.schema';
import { ClipRecipesRepository } from './clip-recipes.repository';
import { ClipRecipesService } from './clip-recipes.service';

const tx = { clipRecipe: { count: jest.fn(), create: jest.fn() } };
const db = {
  $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
  clipRecipe: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: { findMany: jest.fn() },
  clipCaptionStyle: { findMany: jest.fn() },
  clipLayoutPreset: { findMany: jest.fn() },
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: new Proxy({}, { get: (_target, key: string) => (db as Record<string, unknown>)[key] }),
}));

const ORG = 'seed-demo-org';
const USER = 'user-1';
const RECIPE = '11111111-1111-4111-8111-111111111111';
const KIT = '22222222-2222-4222-8222-222222222222';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: RECIPE,
    organizationId: ORG,
    name: 'Weekly Podcast',
    settings: { version: 1, fillers: { on: true } },
    brandKitId: null,
    createdById: USER,
    createdAt: new Date('2026-11-20T00:00:00Z'),
    updatedAt: new Date('2026-11-21T00:00:00Z'),
    ...overrides,
  };
}

function build() {
  const kits = {
    findLive: jest.fn(async (_org: string, id: string) => (id === KIT ? { id } : null)),
  };
  const service = new ClipRecipesService(
    new ClipRecipesRepository(),
    kits as unknown as ClipBrandKitsService,
  );
  return { service, kits };
}

async function code(promise: Promise<unknown>): Promise<string | null> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  return error instanceof ClipErrorException ? error.clipCode : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  db.clipRecipe.findMany.mockResolvedValue([]);
  db.clipRecipe.findFirst.mockResolvedValue(null);
  db.user.findMany.mockResolvedValue([{ id: USER, name: 'Asha', lastName: 'Rao' }]);
  db.clipCaptionStyle.findMany.mockResolvedValue([]);
  db.clipLayoutPreset.findMany.mockResolvedValue([]);
  tx.clipRecipe.count.mockResolvedValue(0);
  tx.clipRecipe.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
    row({ ...data, id: RECIPE }),
  );
});

describe('the recipe schemas', () => {
  it('cleans a name to one line of 1 to 60 characters and refuses unknown keys', () => {
    expect(
      createRecipeSchema.parse({ name: '  My \t  Recipe\u0007 ', settings: { version: 1 } }).name,
    ).toBe('My Recipe');
    expect(createRecipeSchema.safeParse({ name: ' ', settings: { version: 1 } }).success).toBe(
      false,
    );
    expect(
      createRecipeSchema.safeParse({ name: 'x'.repeat(61), settings: { version: 1 } }).success,
    ).toBe(false);
    expect(
      createRecipeSchema.safeParse({ name: 'A', settings: { version: 1 }, organizationId: ORG })
        .success,
    ).toBe(false);
    expect(updateRecipeSchema.safeParse({}).success).toBe(false);
  });
});

describe('ClipRecipesService', () => {
  it('lists the starters first, then the own recipes newest first, with their makers', async () => {
    db.clipRecipe.findMany.mockResolvedValue([row(), row({ id: 'r-2', createdById: null })]);
    const { service } = build();

    const listed = await service.list(ORG);

    expect(listed.max).toBe(RECIPES_MAX);
    expect(listed.own).toBe(2);
    expect(listed.recipes.slice(0, STARTER_RECIPES.length).every((recipe) => recipe.builtIn)).toBe(
      true,
    );
    expect(listed.recipes[STARTER_RECIPES.length]).toMatchObject({
      id: RECIPE,
      builtIn: false,
      createdByName: 'Asha Rao',
    });
    expect(listed.recipes[STARTER_RECIPES.length]?.description.length).toBeGreaterThan(0);
    expect(db.clipRecipe.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('saves a recipe for the workspace, and refuses the 51st with recipe_limit', async () => {
    const { service } = build();
    const saved = await service.create(ORG, USER, { name: 'Mine', settings: { version: 1 } });
    expect(saved.recipe).toMatchObject({ id: RECIPE, name: 'Mine', builtIn: false });
    expect(tx.clipRecipe.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG, createdById: USER, brandKitId: null }),
    });
    expect(tx.clipRecipe.count).toHaveBeenCalledWith({ where: { organizationId: ORG } });

    tx.clipRecipe.count.mockResolvedValue(RECIPES_MAX);
    expect(
      await code(service.create(ORG, USER, { name: 'One More', settings: { version: 1 } })),
    ).toBe('recipe_limit');
  });

  it('refuses a kit the workspace does not have', async () => {
    const { service } = build();
    expect(
      await code(
        service.create(ORG, USER, {
          name: 'Mine',
          settings: { version: 1 },
          brandKitId: '33333333-3333-4333-8333-333333333333',
        }),
      ),
    ).toBe('brand_kit_not_found');
    expect(tx.clipRecipe.create).not.toHaveBeenCalled();
  });

  it('refuses to change or delete a starter with recipe_built_in', async () => {
    const { service } = build();
    const starter = STARTER_RECIPES[0]?.id ?? '';
    expect(await code(service.update(ORG, starter, { name: 'Changed' }))).toBe('recipe_built_in');
    expect(await code(service.remove(ORG, starter))).toBe('recipe_built_in');
    expect(db.clipRecipe.updateMany).not.toHaveBeenCalled();
    expect(db.clipRecipe.deleteMany).not.toHaveBeenCalled();
  });

  it("answers another workspace's recipe, or a word, with recipe_not_found and writes nothing", async () => {
    const { service } = build();
    expect(await code(service.update(ORG, RECIPE, { name: 'Mine' }))).toBe('recipe_not_found');
    expect(db.clipRecipe.findFirst).toHaveBeenCalledWith({
      where: { id: RECIPE, organizationId: ORG },
    });
    db.clipRecipe.deleteMany.mockResolvedValue({ count: 0 });
    expect(await code(service.remove(ORG, RECIPE))).toBe('recipe_not_found');
    expect(db.clipRecipe.deleteMany).toHaveBeenCalledWith({
      where: { id: RECIPE, organizationId: ORG },
    });
    expect(await code(service.remove(ORG, 'drop table'))).toBe('recipe_not_found');
    expect(await code(service.resolve(ORG, 'drop table'))).toBe('recipe_not_found');
    expect(db.clipRecipe.updateMany).not.toHaveBeenCalled();
  });

  it('updates an own recipe inside the workspace', async () => {
    db.clipRecipe.findFirst.mockResolvedValue(row());
    db.clipRecipe.updateMany.mockResolvedValue({ count: 1 });
    const { service } = build();

    await service.update(ORG, RECIPE, { name: 'Renamed', brandKitId: KIT });

    expect(db.clipRecipe.updateMany).toHaveBeenCalledWith({
      where: { id: RECIPE, organizationId: ORG },
      data: { name: 'Renamed', brandKitId: KIT },
    });
  });

  it('duplicates a starter as an own recipe named as a copy', async () => {
    const { service } = build();
    const starter = STARTER_RECIPES[0];
    const copy = await service.duplicate(ORG, USER, starter?.id ?? '');
    expect(tx.clipRecipe.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: `${starter?.name} Copy`,
        settings: starter?.settings,
        brandKitId: null,
      }),
    });
    expect(copy.recipe.builtIn).toBe(false);
  });

  it('duplicates an own recipe without a kit that is gone', async () => {
    db.clipRecipe.findFirst.mockResolvedValue(
      row({ brandKitId: '33333333-3333-4333-8333-333333333333' }),
    );
    const { service } = build();
    await service.duplicate(ORG, USER, RECIPE);
    expect(tx.clipRecipe.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Weekly Podcast Copy', brandKitId: null }),
    });
  });

  it('resolves a starter without touching the database rows', async () => {
    const { service } = build();
    const starter = STARTER_RECIPES[1];
    const resolved = await service.resolve(ORG, starter?.id ?? '');
    expect(resolved).toMatchObject({ settings: starter?.settings, brandKitId: null });
    expect(db.clipRecipe.findFirst).not.toHaveBeenCalled();
  });
});
