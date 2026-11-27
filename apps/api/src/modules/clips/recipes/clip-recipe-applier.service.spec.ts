/**
 * The server-side recipe applier (Sprint 13, Module 10): Auto-Edit's clip and
 * a Find Clips run's clips, through the real engine (`applyRecipe`,
 * `applyBrandKit`), with every database and service call faked.
 */
import type { Clip, ClipVideo } from '@postgear/db';
import {
  captionsTrackOf,
  createClipDocument,
  defaultClipSetup,
  type RecipeSettings,
  type TranscriptWord,
  starterRecipe,
} from '@postgear/video-engine';
import type { AiEngine } from '../../ai/engine/engine.types';
import type { ClipBrandKitsService } from '../brand-kits/clip-brand-kits.service';
import type { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import type { ClipItemService } from '../clip/clip-item.service';
import { ClipErrorException } from '../clip-error.exception';
import type { ClipFacesService } from '../faces/clip-faces.service';
import type { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import type { ClipVideosRepository } from '../videos/clip-videos.repository';
import type { PrivateStorage } from '@postgear/storage';
import { ClipRecipeApplierService, needsCamera } from './clip-recipe-applier.service';
import type { ClipRecipesService, ResolvedRecipe } from './clip-recipes.service';

const db = {
  clip: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  clipJob: { findFirst: jest.fn() },
  clipHighlightRun: { findFirst: jest.fn() },
  clipLayoutPreset: { findMany: jest.fn() },
  clipWordList: { findUnique: jest.fn() },
};

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: new Proxy(
    {},
    { get: (_target, table: string) => (db as Record<string, unknown>)[table] },
  ),
}));

const ORG = 'seed-demo-org';
const VIDEO = '22222222-2222-4222-8222-222222222222';
const CLIP = '33333333-3333-4333-8333-333333333333';
const JOB = '44444444-4444-4444-8444-444444444444';
const RUN = '55555555-5555-4555-8555-555555555555';
const TRANSCRIPT = '66666666-6666-4666-8666-666666666666';

function video(): ClipVideo & { durationMs: number } {
  return {
    id: VIDEO,
    organizationId: ORG,
    title: 'Team Talk',
    status: 'READY',
    durationMs: 120_000,
    width: 1920,
    height: 1080,
    deletedAt: null,
    hdAvailable: true,
  } as unknown as ClipVideo & { durationMs: number };
}

/** A word every 400 ms from `fromMs` to `toMs`. */
function speech(fromMs: number, toMs: number): TranscriptWord[] {
  const words: TranscriptWord[] = [];
  for (let at = fromMs, i = 0; at + 300 <= toMs; at += 400, i += 1) {
    words.push({ i, start: at, end: at + 300, text: i % 7 === 0 ? 'um' : `word${i}`, sure: 1 });
  }
  return words;
}

function starter(id: string): ResolvedRecipe {
  const found = starterRecipe(id);
  if (!found) throw new Error(`no starter ${id}`);
  return {
    view: { id, name: found.name } as ResolvedRecipe['view'],
    settings: found.settings,
    brandKitId: null,
  };
}

function own(settings: RecipeSettings, brandKitId: string | null = null): ResolvedRecipe {
  return {
    view: { id: '77777777-7777-4777-8777-777777777777', name: 'Mine' } as ResolvedRecipe['view'],
    settings,
    brandKitId,
  };
}

function build(options: { words?: TranscriptWord[] | null; recipe?: ResolvedRecipe } = {}) {
  const words = options.words === undefined ? speech(0, 120_000) : options.words;
  const items = {
    readyVideo: jest.fn(async () => video()),
    insertClip: jest.fn(
      async (_org: string, _user: string | null, input: { clipId: string; meta: unknown }) => ({
        clip: { id: input.clipId, meta: input.meta } as Clip,
        job: null,
        created: true,
      }),
    ),
  };
  const faces = { ensure: jest.fn(async () => ({ status: 'ready', reused: true })) };
  const recipes = {
    resolve: jest.fn(async () => options.recipe ?? starter('starter-auto-edit-talking-video')),
  };
  const kits = { findLive: jest.fn(async () => null), engineKit: jest.fn() };
  const transcripts = {
    read: jest.fn(async () =>
      words === null
        ? { transcript: null, complete: false, price: 4 }
        : {
            transcript: {
              id: TRANSCRIPT,
              language: 'en',
              model: 'sim',
              source: 'listened',
              words,
              covered: [{ fromMs: 0, toMs: 120_000 }],
              fixes: 0,
              fileName: null,
            },
            complete: true,
            price: 0,
          },
    ),
  };
  const styles = { own: jest.fn(async () => []) };
  const videos = {
    findLive: jest.fn(async () => video()),
    assetsOf: jest.fn(async () => []),
  };
  const writer = { writeHookTitles: jest.fn(async () => ({ titles: ['A Bold Line', 'B', 'C'] })) };
  const ai = { createSnippetWriter: jest.fn(() => writer) };
  const service = new ClipRecipeApplierService(
    items as unknown as ClipItemService,
    faces as unknown as ClipFacesService,
    recipes as unknown as ClipRecipesService,
    kits as unknown as ClipBrandKitsService,
    transcripts as unknown as ClipTranscriptsService,
    styles as unknown as ClipCaptionStylesService,
    videos as unknown as ClipVideosRepository,
    {} as PrivateStorage,
    ai as unknown as AiEngine,
  );
  return { service, items, faces, recipes, kits, transcripts, writer };
}

beforeEach(() => {
  jest.clearAllMocks();
  db.clip.findFirst.mockResolvedValue(null);
  db.clipLayoutPreset.findMany.mockResolvedValue([]);
  db.clipWordList.findUnique.mockResolvedValue(null);
  db.clip.updateMany.mockResolvedValue({ count: 1 });
});

const REQUEST = {
  clipId: CLIP,
  videoId: VIDEO,
  recipeId: 'starter-auto-edit-talking-video',
  range: { fromMs: 0, toMs: 120_000 },
};

describe('ClipRecipeApplierService.createAutoEditClip', () => {
  it('makes one AUTO_EDIT clip over the range with the recipe applied and its sharp range', async () => {
    const { service, items } = build();

    const outcome = await service.createAutoEditClip(ORG, 'user-1', REQUEST);

    expect(outcome).toMatchObject({ clipId: CLIP, noSpeech: false });
    const [org, user, input] = items.insertClip.mock.calls[0] as unknown as [
      string,
      string,
      {
        document: Parameters<typeof captionsTrackOf>[0] & { recipeId?: string };
        origin: string;
        title: string;
        segmentRange: unknown;
      },
    ];
    expect([org, user]).toEqual([ORG, 'user-1']);
    expect(input.origin).toBe('AUTO_EDIT');
    expect(input.title).toBe('Team Talk');
    expect(input.segmentRange).toEqual({ fromMs: 0, toMs: 120_000 });
    expect(input.document.recipeId).toBe('starter-auto-edit-talking-video');
    expect(captionsTrackOf(input.document)?.transcriptAssetId).toBe(TRANSCRIPT);
  });

  it('still makes the clip without words, skipping the word parts', async () => {
    const { service, items } = build({ words: null });

    const outcome = await service.createAutoEditClip(ORG, null, REQUEST);

    expect(outcome.noSpeech).toBe(false);
    expect(outcome.skipped).toEqual(
      expect.arrayContaining([{ part: 'captions', reason: 'no_transcript' }]),
    );
    expect(items.insertClip).toHaveBeenCalledTimes(1);
  });

  it('says no speech when the range was listened to and nobody talks', async () => {
    const { service } = build({ words: [] });
    const outcome = await service.createAutoEditClip(ORG, null, REQUEST);
    expect(outcome.noSpeech).toBe(true);
  });

  it('answers a clip already made as it was, making nothing (idempotent on the clip id)', async () => {
    db.clip.findFirst.mockResolvedValue({
      id: CLIP,
      meta: { autoEdit: { skipped: [{ part: 'bleep', reason: 'nothing_found' }], noSpeech: true } },
    });
    const { service, items, recipes } = build();

    const outcome = await service.createAutoEditClip(ORG, null, REQUEST);

    expect(outcome).toEqual({
      clipId: CLIP,
      skipped: [{ part: 'bleep', reason: 'nothing_found' }],
      noSpeech: true,
    });
    expect(items.insertClip).not.toHaveBeenCalled();
    expect(recipes.resolve).not.toHaveBeenCalled();
    expect(db.clip.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CLIP, organizationId: ORG } }),
    );
  });

  it('marks Follow The Speaker for the first open and asks faces (free)', async () => {
    const { service, items, faces } = build({ recipe: starter('starter-reframe') });

    await service.createAutoEditClip(ORG, 'user-1', { ...REQUEST, recipeId: 'starter-reframe' });

    const input = (
      items.insertClip.mock.calls[0] as unknown as [
        string,
        string,
        { meta: Record<string, unknown> },
      ]
    )[2];
    expect(input.meta).toMatchObject({ followOnOpen: 'speaker' });
    expect(faces.ensure).toHaveBeenCalledWith(ORG, 'user-1', CLIP);
  });

  it('asks the title writer once for a hook title, and goes on without one when it fails', async () => {
    const { service, writer, items } = build({ recipe: starter('starter-social-edit') });
    await service.createAutoEditClip(ORG, null, { ...REQUEST, recipeId: 'starter-social-edit' });
    expect(writer.writeHookTitles).toHaveBeenCalledTimes(1);

    const failing = build({ recipe: starter('starter-social-edit') });
    failing.writer.writeHookTitles.mockRejectedValue(new Error('down'));
    await failing.service.createAutoEditClip(ORG, null, {
      ...REQUEST,
      recipeId: 'starter-social-edit',
    });
    expect(failing.items.insertClip).toHaveBeenCalledTimes(1);
    expect(items.insertClip).toHaveBeenCalledTimes(1);
  });

  it('refuses a range over 30 minutes with auto_edit_too_long', async () => {
    const { service, items } = build();
    items.readyVideo.mockResolvedValue({ ...video(), durationMs: 40 * 60_000 });
    const refused = await service
      .createAutoEditClip(ORG, null, { ...REQUEST, range: { fromMs: 0, toMs: 31 * 60_000 } })
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ClipErrorException);
    expect((refused as ClipErrorException).clipCode).toBe('auto_edit_too_long');
  });
});

describe('ClipRecipeApplierService.applyToRun', () => {
  function runClip(id: string, overrides: Partial<Clip> = {}) {
    return {
      id,
      videoId: VIDEO,
      title: 'An AI Title',
      origin: 'AI_TRANSCRIPT',
      revision: 1,
      meta: null,
      document: createClipDocument({
        videoId: VIDEO,
        fromMs: 10_000,
        toMs: 40_000,
        ratio: '9:16',
        fps: 30,
      }),
      ...overrides,
    };
  }

  beforeEach(() => {
    db.clipJob.findFirst.mockResolvedValue({ id: JOB, highlightRunId: RUN });
  });

  function runWith(setup: Record<string, unknown>) {
    db.clipHighlightRun.findFirst.mockResolvedValue({
      id: RUN,
      params: { setup: { ...defaultClipSetup(120_000), ...setup } },
    });
  }

  it('applies the run setup to every clip and skips one that fails, quietly', async () => {
    runWith({ silences: true });
    db.clip.findMany.mockResolvedValue([
      runClip('c1'),
      runClip('c2', { document: { not: 'a document' } as never }),
      runClip('c3'),
    ]);
    const { service } = build();

    expect(await service.applyToRun(ORG, JOB)).toEqual({ applied: 2, skipped: 1 });
    expect(db.clip.updateMany).toHaveBeenCalledTimes(2);
    expect(db.clip.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1', organizationId: ORG, revision: 1 },
        data: expect.objectContaining({ revision: { increment: 1 } }),
      }),
    );
  });

  it('leaves a clip somebody already saved alone', async () => {
    runWith({ silences: true });
    db.clip.findMany.mockResolvedValue([runClip('c1', { revision: 3 })]);
    const { service } = build();
    expect(await service.applyToRun(ORG, JOB)).toEqual({ applied: 0, skipped: 1 });
    expect(db.clip.updateMany).not.toHaveBeenCalled();
  });

  it('marks a Split layout with a Camera area to find the camera on open, and asks faces', async () => {
    runWith({ recipeId: '77777777-7777-4777-8777-777777777777' });
    db.clip.findMany.mockResolvedValue([runClip('c1')]);
    const { service, faces } = build({ recipe: own({ version: 1, layout: { kind: 'split' } }) });

    expect(await service.applyToRun(ORG, JOB)).toEqual({ applied: 1, skipped: 0 });
    const write = db.clip.updateMany.mock.calls[0]?.[0] as {
      data: { meta: unknown; document: never };
    };
    expect(write.data.meta).toMatchObject({ cameraOnOpen: true });
    expect(needsCamera(write.data.document)).toBe(true);
    expect(faces.ensure).toHaveBeenCalledWith(ORG, null, 'c1');
  });

  it('does nothing for a run without a recipe, silences, a hook title or a kit', async () => {
    runWith({});
    const { service } = build();
    expect(await service.applyToRun(ORG, JOB)).toEqual({ applied: 0, skipped: 0 });
    expect(db.clip.findMany).not.toHaveBeenCalled();
  });

  it("is a 404 for a job that is not this workspace's Find Clips run", async () => {
    db.clipJob.findFirst.mockResolvedValue(null);
    const { service } = build();
    await expect(service.applyToRun(ORG, JOB)).rejects.toMatchObject({ status: 404 });
    expect(db.clipJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: JOB, organizationId: ORG, kind: 'HIGHLIGHTS' } }),
    );
  });
});
