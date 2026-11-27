/**
 * Apply A Recipe (Sprint 13, Module 10): what the editor needs before it
 * applies a recipe (words, faces) and what the recipe names that is gone.
 * Nothing here writes the clip.
 */
import { HttpStatus } from '@nestjs/common';
import { createClipDocument, type RecipeSettings } from '@postgear/video-engine';
import type { ClipBrandKitsService } from '../brand-kits/clip-brand-kits.service';
import type { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import type { ClipItemService } from '../clip/clip-item.service';
import { ClipErrorException } from '../clip-error.exception';
import type { ClipFacesService } from '../faces/clip-faces.service';
import type { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import type { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipApplyRecipeService, recipeNeedsWords } from './clip-apply-recipe.service';
import type { ClipRecipesService, ResolvedRecipe } from './clip-recipes.service';

const db = { clipLayoutPreset: { findMany: jest.fn(async () => []) } };

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: new Proxy({}, { get: (_target, key: string) => (db as Record<string, unknown>)[key] }),
}));

const ORG = 'seed-demo-org';
const VIDEO = '22222222-2222-4222-8222-222222222222';
const CLIP = '33333333-3333-4333-8333-333333333333';
const KIT = '44444444-4444-4444-8444-444444444444';
const PRESET = '55555555-5555-4555-8555-555555555555';

function recipe(settings: RecipeSettings, brandKitId: string | null = null): ResolvedRecipe {
  return {
    view: { id: 'r-1', name: 'Mine' } as ResolvedRecipe['view'],
    settings,
    brandKitId,
  };
}

function build(found: ResolvedRecipe) {
  const items = {
    requireClip: jest.fn(async () => ({
      id: CLIP,
      videoId: VIDEO,
      document: createClipDocument({
        videoId: VIDEO,
        fromMs: 10_000,
        toMs: 40_000,
        ratio: '9:16',
        fps: 30,
      }),
    })),
  };
  const recipes = { resolve: jest.fn(async () => found) };
  const kits = {
    findLive: jest.fn(async (): Promise<unknown> => null),
    engineKit: jest.fn(async () => ({ id: KIT, name: 'Acme' })),
  };
  const transcripts = {
    quote: jest.fn(async () => ({ price: 0, ms: 0, covered: true })),
  };
  const faces = { ensure: jest.fn(async () => ({ status: 'ready', reused: true })) };
  const styles = { own: jest.fn(async () => []) };
  const videos = {
    findLive: jest.fn(async () => ({
      id: VIDEO,
      status: 'READY',
      durationMs: 120_000,
      width: 1920,
      height: 1080,
    })),
  };
  const service = new ClipApplyRecipeService(
    items as unknown as ClipItemService,
    recipes as unknown as ClipRecipesService,
    kits as unknown as ClipBrandKitsService,
    transcripts as unknown as ClipTranscriptsService,
    faces as unknown as ClipFacesService,
    styles as unknown as ClipCaptionStylesService,
    videos as unknown as ClipVideosRepository,
  );
  return { service, items, kits, transcripts, faces };
}

beforeEach(() => jest.clearAllMocks());

describe('recipeNeedsWords', () => {
  it('is true only for captions, silences, filler words or bleeps that are on', () => {
    expect(recipeNeedsWords({ version: 1 })).toBe(false);
    expect(recipeNeedsWords({ version: 1, fillers: { on: false } })).toBe(false);
    expect(recipeNeedsWords({ version: 1, fillers: { on: true } })).toBe(true);
    expect(recipeNeedsWords({ version: 1, bleep: { on: true, mode: 'mute' } })).toBe(true);
  });
});

describe('ClipApplyRecipeService.prepare', () => {
  it('needs nothing for a recipe with no word part, and asks no faces', async () => {
    const { service, transcripts, faces } = build(recipe({ version: 1, ratio: '1:1' }));
    const answer = await service.prepare(ORG, 'user-1', CLIP, 'r-1');
    expect(answer.needs).toEqual({ transcript: 'none', listenPrice: 0, faces: 'none' });
    expect(answer.missing).toEqual([]);
    expect(answer.brandKit).toBeNull();
    expect(transcripts.quote).not.toHaveBeenCalled();
    expect(faces.ensure).not.toHaveBeenCalled();
  });

  it('says the words are covered when the clip was listened to', async () => {
    const { service } = build(recipe({ version: 1, fillers: { on: true } }));
    const answer = await service.prepare(ORG, 'user-1', CLIP, 'r-1');
    expect(answer.needs.transcript).toBe('covered');
  });

  it('prices the missing words over the stretches widened by the handles', async () => {
    const { service, transcripts } = build(recipe({ version: 1, fillers: { on: true } }));
    transcripts.quote
      .mockResolvedValueOnce({ price: 1, ms: 30_000, covered: false })
      .mockResolvedValueOnce({ price: 2, ms: 33_000, covered: false });

    const answer = await service.prepare(ORG, 'user-1', CLIP, 'r-1');

    expect(answer.needs).toMatchObject({ transcript: 'missing', listenPrice: 2 });
    expect(transcripts.quote).toHaveBeenNthCalledWith(1, ORG, VIDEO, {
      ranges: [{ fromMs: 10_000, toMs: 40_000 }],
    });
    const wide = (
      transcripts.quote.mock.calls[1] as unknown as [
        string,
        string,
        { ranges: { fromMs: number; toMs: number }[] },
      ]
    )[2].ranges;
    expect(wide[0]?.fromMs).toBeLessThan(10_000);
    expect(wide[0]?.toMs).toBeGreaterThan(40_000);
  });

  it('asks faces for a recipe that follows the speaker, and says off when faces are off', async () => {
    const following = recipe({ version: 1, follow: { on: true, mode: 'speaker' } });
    const ready = build(following);
    expect((await ready.service.prepare(ORG, 'user-1', CLIP, 'r-1')).needs.faces).toBe('ready');
    expect(ready.faces.ensure).toHaveBeenCalledWith(ORG, 'user-1', CLIP);

    const started = build(following);
    started.faces.ensure.mockResolvedValue({ status: 'running' } as never);
    expect((await started.service.prepare(ORG, 'user-1', CLIP, 'r-1')).needs.faces).toBe('started');

    const off = build(following);
    off.faces.ensure.mockRejectedValue(new ClipErrorException(HttpStatus.CONFLICT, 'faces_off'));
    expect((await off.service.prepare(ORG, 'user-1', CLIP, 'r-1')).needs.faces).toBe('off');
  });

  it('reports a gone caption style, saved layout and brand kit as missing', async () => {
    const { service } = build(
      recipe(
        {
          version: 1,
          captions: { on: true, styleId: 'not-a-style' },
          layout: { kind: 'split', presetId: PRESET },
        },
        KIT,
      ),
    );
    const answer = await service.prepare(ORG, 'user-1', CLIP, 'r-1');
    expect(answer.missing).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ part: 'captionStyle', id: 'not-a-style' }),
        expect.objectContaining({ part: 'layoutPreset', id: PRESET }),
        { part: 'brandKit', id: KIT, usedInstead: null },
      ]),
    );
    expect(db.clipLayoutPreset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG, id: PRESET }),
      }),
    );
  });

  it("answers the recipe's live kit in the engine's shape", async () => {
    const { service, kits } = build(recipe({ version: 1 }, KIT));
    kits.findLive.mockResolvedValue({ id: KIT });
    const answer = await service.prepare(ORG, 'user-1', CLIP, 'r-1');
    expect(answer.brandKit).toEqual({ id: KIT, name: 'Acme' });
    expect(answer.missing).toEqual([]);
  });
});
