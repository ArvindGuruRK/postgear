/**
 * Applying a recipe on the server (Sprint 13, Module 10): Auto-Edit Video
 * and the clips of a Find Clips run. The editor applies a recipe itself
 * (Apply A Recipe); these two have no editor open, so the API runs the very
 * same pure edits (`applyRecipe`, then `applyBrandKit`) and writes the
 * document once.
 *
 * The engine's `RecipeContext` is built here, from the workspace's rows:
 * - `videoSize`: the main video's picture size.
 * - `transcript`: the main video's spoken transcript over what the clip
 *   plays, only when every moment of it was listened to (else null: the
 *   word parts are skipped, and `needs` says `transcript`).
 * - `captionLook` and `layoutPreset`: built-in or the workspace's own caption
 *   styles, and its saved layouts for the shape the recipe ends on.
 * - `isLoud`: from the video's stored waveform when one is there and small
 *   (a loud pause, laughter or music, is kept by Remove Silences).
 * - `hookTitleText`: Auto-Edit asks the title writer once (free); a run's
 *   clip uses its own AI title. Any failure leaves it out (`needs` hookTitle).
 * - `bleepLists`: the transcript's language and the workspace's own words.
 *
 * Then the kit (the recipe's, or the run setup's) is applied, `recipeId` is
 * recorded on the document, and the document is read back through the
 * engine's schema before it is written.
 *
 * - `createAutoEditClip` makes one clip over the range (origin `AUTO_EDIT`,
 *   named like Edit Whole Video) through `ClipItemService.insertClip`, so
 *   its SEGMENT job is exactly a hand-made clip's. Idempotent on `clipId`:
 *   a clip already made is answered as it was (its outcome is kept in
 *   `Clip.meta.autoEdit`). Follow The Speaker marks `followOnOpen` and asks
 *   faces (free), as Module 08's run does; so does a layout with a Camera
 *   area (`cameraOnOpen`).
 * - `applyToRun` applies the run's setup on top of its recipe
 *   (`recipeFromSetup`) to each clip the run made, quietly: a clip that
 *   fails is logged by id and skipped, and only a clip still at its first
 *   revision is touched (one somebody saved keeps what they made; the write
 *   checks the revision again and bumps it, so an editor holding the old
 *   revision is told to reload, never overwrites).
 *
 * Never logs a word, a title or a prompt: ids and counts only.
 */
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type Clip, ClipJobKind, type ClipVideo, type Prisma, prisma } from '@postgear/db';
import { PRIVATE_STORAGE } from '../../media/storage/storage.interface';
import type { PrivateStorage } from '@postgear/storage';
import {
  applyBrandKit,
  applyRecipe,
  builtInCaptionStyle,
  type CaptionLook,
  CLIP_MAX_MS,
  CLIP_MIN_MS,
  type ClipBrandKit,
  type ClipDocument,
  ClipRangeError,
  clipSourceRanges,
  createClipDocument,
  languageName,
  layoutSchema,
  loudFromPeaks,
  type MsRange,
  renderedDuration,
  type RecipeContext,
  type RecipeMissing,
  type RecipeOutcome,
  type RecipeSettings,
  type RecipeSkip,
  type RecipeTranscript,
  recipeFromSetup,
  type SavedLayout,
  safeParseClipDocument,
  translationLines,
} from '@postgear/video-engine';
import { AI_ENGINE, type AiEngine } from '../../ai/engine/engine.types';
import { ClipBrandKitsService } from '../brand-kits/clip-brand-kits.service';
import { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import { ClipItemService, wholeTitle } from '../clip/clip-item.service';
import { withCameraOnOpen, withFollowOnOpen } from '../clip/clip-meta';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { ClipFacesService } from '../faces/clip-faces.service';
import { readSetupParams } from '../highlights/clip-moments.service';
import { hookTextFrom } from '../hook-titles/clip-hook-titles.service';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { waveformMetaOf, latestAsset } from '../videos/clip-video-view';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { ClipRecipesService } from './clip-recipes.service';

/** A new clip's shape when the recipe sets none (as `POST /clips` makes them). */
const DEFAULT_RATIO = '9:16' as const;
/** A waveform larger than this is not read (a day of video at 20 peaks a second is far under). */
const WAVEFORM_MAX_BYTES = 4 * 1024 * 1024;
/** When the picture size is unknown, layouts are fitted to a 16:9 video. */
const FALLBACK_SIZE = { width: 1920, height: 1080 } as const;

export interface AutoEditRequest {
  clipId: string;
  videoId: string;
  recipeId: string;
  range: MsRange;
}

export interface AutoEditOutcome {
  clipId: string;
  skipped: RecipeSkip[];
  noSpeech: boolean;
}

export interface ApplyToRunOutcome {
  applied: number;
  skipped: number;
}

/** What one apply made: the checked document and what the engine reported. */
interface Applied {
  doc: ClipDocument;
  outcome: RecipeOutcome;
  missing: RecipeMissing[];
  noSpeech: boolean;
  /** A Split or Gameplay layout with a Camera area: Detect Camera on first open. */
  camera: boolean;
}

/** A brand kit's own part (an intro or outro, from its own video). */
export function isBrandPart(segment: { role?: string }): boolean {
  return segment.role === 'intro' || segment.role === 'outro';
}

/** The source of the clip's first part that is not an intro or outro (the engine's rule). */
export function mainSourceOf(doc: Pick<ClipDocument, 'segments'>): string {
  const main = doc.segments.find((segment) => !isBrandPart(segment)) ?? doc.segments[0];
  return main?.source ?? '';
}

/** The stretches of the main video a clip plays (intro and outro parts left out). */
export function mainRanges(doc: ClipDocument): MsRange[] {
  const main = mainSourceOf(doc);
  return clipSourceRanges({ segments: doc.segments.filter((s) => !isBrandPart(s)) }, main);
}

/** The video id of the clip's main source. */
export function mainVideoId(doc: ClipDocument): string | null {
  const main = mainSourceOf(doc);
  return doc.sources.find((source) => source.id === main)?.videoId ?? null;
}

/** True when the words have one whose middle falls inside the ranges. */
export function hasWordsIn(
  words: readonly { start: number; end: number }[],
  ranges: readonly MsRange[],
): boolean {
  return words.some((word) => {
    const mid = (word.start + word.end) / 2;
    return ranges.some((range) => mid >= range.fromMs && mid < range.toMs);
  });
}

/** A layout that needs the camera box found: Split or Gameplay with an area named Camera. */
export function needsCamera(doc: ClipDocument): boolean {
  const { layout } = doc;
  return (
    (layout.kind === 'split' || layout.kind === 'gameplay') &&
    layout.areas.some((area) => area.name === 'Camera')
  );
}

@Injectable()
export class ClipRecipeApplierService {
  private readonly logger = new Logger(ClipRecipeApplierService.name);

  constructor(
    private readonly items: ClipItemService,
    private readonly faces: ClipFacesService,
    private readonly recipes: ClipRecipesService,
    private readonly kits: ClipBrandKitsService,
    private readonly transcripts: ClipTranscriptsService,
    private readonly styles: ClipCaptionStylesService,
    private readonly videos: ClipVideosRepository,
    @Inject(PRIVATE_STORAGE) private readonly storage: PrivateStorage,
    @Inject(AI_ENGINE) private readonly ai: AiEngine,
  ) {}

  /** Auto-Edit Video's clip: see the file comment. */
  async createAutoEditClip(
    orgId: string,
    userId: string | null,
    request: AutoEditRequest,
  ): Promise<AutoEditOutcome> {
    const existing = await prisma.clip.findFirst({
      where: { id: request.clipId, organizationId: orgId },
      select: { id: true, meta: true },
    });
    if (existing) return { clipId: existing.id, ...autoEditRecord(existing.meta) };

    const video = await this.items.readyVideo(orgId, request.videoId);
    const range = {
      fromMs: Math.max(0, request.range.fromMs),
      toMs: Math.min(video.durationMs, request.range.toMs),
    };
    if (range.toMs - range.fromMs > CLIP_MAX_MS) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'auto_edit_too_long');
    }
    if (range.toMs - range.fromMs < CLIP_MIN_MS) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
    }
    const recipe = await this.recipes.resolve(orgId, request.recipeId);

    let base: ClipDocument;
    try {
      base = createClipDocument({
        videoId: video.id,
        fromMs: range.fromMs,
        toMs: range.toMs,
        ratio: recipe.settings.ratio ?? DEFAULT_RATIO,
        fps: 30,
        ...(video.width && video.height ? { sourceAspect: video.width / video.height } : {}),
      });
    } catch (error) {
      if (error instanceof ClipRangeError) {
        throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_range_invalid');
      }
      throw error;
    }

    const kit = await this.kitFor(orgId, recipe.brandKitId);
    const applied = await this.apply(orgId, video, base, recipe.settings, recipe.view.id, kit, {
      hookTitle: 'ask',
    });
    if (!applied) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_document_invalid', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_INVALID,
      });
    }

    const skipped = applied.outcome.skipped;
    let meta = {
      autoEdit: { skipped, noSpeech: applied.noSpeech },
    } as unknown as Prisma.InputJsonValue;
    if (applied.outcome.follow) meta = withFollowOnOpen(meta);
    if (applied.camera) meta = withCameraOnOpen(meta);

    const { clip, created } = await this.items.insertClip(orgId, userId, {
      clipId: request.clipId,
      video,
      document: applied.doc,
      title: wholeTitle(video.title),
      origin: 'AUTO_EDIT',
      meta,
      // The main video's stretch before any cut: what the export reads sharp.
      segmentRange: range,
    });
    if (!created) return { clipId: clip.id, ...autoEditRecord(clip.meta) };

    let faces: 'asked' | 'off' | 'failed' | 'none' = 'none';
    if (applied.outcome.follow || applied.camera)
      faces = await this.askFaces(orgId, userId, clip.id);

    this.logger.log(
      JSON.stringify({
        event: 'clips.auto_edit.made',
        orgId,
        clipId: clip.id,
        videoId: video.id,
        recipeId: recipe.view.id,
        skipped: skipped.length,
        missing: applied.missing.length,
        needs: applied.outcome.needs.length,
        noSpeech: applied.noSpeech,
        kit: kit !== null,
        faces,
      }),
    );
    return { clipId: clip.id, skipped, noSpeech: applied.noSpeech };
  }

  /** A Find Clips run's recipe on its new clips: see the file comment. Never throws for one clip. */
  async applyToRun(orgId: string, jobId: string): Promise<ApplyToRunOutcome> {
    const job = await prisma.clipJob.findFirst({
      where: { id: jobId, organizationId: orgId, kind: ClipJobKind.HIGHLIGHTS },
      select: { id: true, highlightRunId: true },
    });
    if (!job?.highlightRunId) throw jobNotFound();
    const run = await prisma.clipHighlightRun.findFirst({
      where: { id: job.highlightRunId, organizationId: orgId },
      select: { id: true, params: true },
    });
    if (!run) throw jobNotFound();
    const setup = readSetupParams(run.params)?.setup;
    const answer: ApplyToRunOutcome = { applied: 0, skipped: 0 };
    if (!setup) return answer;
    if (!setup.recipeId && !setup.silences && !setup.hookTitle && !setup.brandKitId) return answer;

    let base: { settings: RecipeSettings; brandKitId: string | null; id: string } | null = null;
    if (setup.recipeId) {
      try {
        const resolved = await this.recipes.resolve(orgId, setup.recipeId);
        base = {
          settings: resolved.settings,
          brandKitId: resolved.brandKitId,
          id: resolved.view.id,
        };
      } catch {
        // Deleted since the run started: the setup's own controls still apply.
        this.logger.warn(
          JSON.stringify({ event: 'clips.recipe.run_recipe_gone', orgId, jobId, runId: run.id }),
        );
      }
    }
    const settings = recipeFromSetup(setup, base?.settings ?? null);
    const kit = await this.kitFor(orgId, setup.brandKitId ?? base?.brandKitId ?? null);

    const clips = await prisma.clip.findMany({
      where: { organizationId: orgId, highlightRunId: run.id },
      select: {
        id: true,
        videoId: true,
        document: true,
        title: true,
        origin: true,
        revision: true,
        meta: true,
      },
    });
    const videoCache = new Map<string, ClipVideo | null>();
    let camera = 0;
    for (const clip of clips) {
      try {
        if (clip.revision !== 1) {
          answer.skipped += 1;
          continue;
        }
        const parsed = safeParseClipDocument(clip.document);
        if (!parsed.ok) throw new RunClipError('document_unreadable');
        if (!videoCache.has(clip.videoId)) {
          videoCache.set(clip.videoId, await this.videos.findLive(orgId, clip.videoId));
        }
        const video = videoCache.get(clip.videoId);
        if (!video) throw new RunClipError('video_gone');

        const applied = await this.apply(
          orgId,
          video,
          parsed.doc,
          settings,
          base?.id ?? null,
          kit,
          {
            hookTitle: clip.origin === 'AI_TRANSCRIPT' ? clip.title : null,
          },
        );
        if (!applied) throw new RunClipError('document_invalid');
        const written = await this.writeRunClip(orgId, clip, applied);
        if (!written) {
          answer.skipped += 1;
          continue;
        }
        answer.applied += 1;
        if (applied.camera) {
          camera += 1;
          await this.askFaces(orgId, null, clip.id);
        }
      } catch (error) {
        answer.skipped += 1;
        this.logger.warn(
          JSON.stringify({
            event: 'clips.recipe.run_clip_failed',
            orgId,
            jobId,
            clipId: clip.id,
            reason: error instanceof HttpException ? error.getStatus() : errorName(error),
          }),
        );
      }
    }

    this.logger.log(
      JSON.stringify({
        event: 'clips.recipe.run',
        orgId,
        jobId,
        runId: run.id,
        clips: clips.length,
        applied: answer.applied,
        skipped: answer.skipped,
        camera,
        kit: kit !== null,
      }),
    );
    return answer;
  }

  /** The live kit in the engine's shape, or null (none named, or gone: logged). */
  private async kitFor(orgId: string, kitId: string | null): Promise<ClipBrandKit | null> {
    if (!kitId) return null;
    const row = await this.kits.findLive(orgId, kitId);
    if (!row) {
      this.logger.warn(JSON.stringify({ event: 'clips.recipe.kit_gone', orgId, kitId }));
      return null;
    }
    return this.kits.engineKit(orgId, row);
  }

  /**
   * Runs the recipe and the kit over `doc` with a context from the
   * workspace's rows; null when the result does not read as a document.
   */
  private async apply(
    orgId: string,
    video: ClipVideo,
    doc: ClipDocument,
    settings: RecipeSettings,
    recipeId: string | null,
    kit: ClipBrandKit | null,
    options: { hookTitle: 'ask' | string | null },
  ): Promise<Applied | null> {
    const ranges = mainRanges(doc);
    const transcript = await this.transcriptFor(orgId, video, ranges);
    const ratio = settings.ratio ?? doc.canvas.ratio;
    const [captionLook, layoutPreset, isLoud, workspaceWords] = await Promise.all([
      this.captionLooks(orgId),
      this.layoutPresets(orgId, ratio),
      settings.silences?.on ? this.loudness(orgId, video.id) : Promise.resolve(undefined),
      settings.bleep?.on ? this.workspaceWords(orgId) : Promise.resolve([] as string[]),
    ]);

    let hookTitleText: string | null = null;
    if (settings.hookTitle?.on) {
      hookTitleText =
        options.hookTitle === 'ask'
          ? await this.writeHookTitle(orgId, transcript, ranges)
          : options.hookTitle;
    }

    const ctx: RecipeContext = {
      videoSize:
        video.width && video.height ? { width: video.width, height: video.height } : FALLBACK_SIZE,
      transcript,
      captionLook,
      layoutPreset,
      ...(isLoud ? { isLoud } : {}),
      hookTitleText,
      ...(transcript
        ? { bleepLists: { language: transcript.language, workspace: workspaceWords } }
        : {}),
    };
    const outcome = applyRecipe(doc, settings, ctx);
    let next = outcome.doc;
    const missing = [...outcome.missing];
    if (kit) next = applyBrandKit(next, kit, {}, { captionLook });
    if (recipeId) next = { ...next, recipeId };

    const checked = safeParseClipDocument(next);
    if (!checked.ok) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.recipe.document_refused',
          orgId,
          videoId: video.id,
          issues: checked.issues.length,
        }),
      );
      return null;
    }
    return {
      doc: checked.doc,
      outcome,
      missing,
      noSpeech: transcript !== null && !hasWordsIn(transcript.words, ranges),
      camera: needsCamera(checked.doc),
    };
  }

  /** A run's clip with the recipe applied, if it is still at its first revision. */
  private async writeRunClip(
    orgId: string,
    clip: Pick<Clip, 'id' | 'meta'>,
    applied: Applied,
  ): Promise<boolean> {
    const { count } = await prisma.clip.updateMany({
      where: { id: clip.id, organizationId: orgId, revision: 1 },
      data: {
        document: applied.doc as unknown as Prisma.InputJsonValue,
        ratio: applied.doc.canvas.ratio,
        durationMs: renderedDuration(applied.doc),
        revision: { increment: 1 },
        ...(applied.camera ? { meta: withCameraOnOpen(clip.meta) } : {}),
      },
    });
    return count === 1;
  }

  /**
   * The main video's spoken words over `ranges`, only when every moment of
   * them was listened to; null otherwise (or when it cannot be read).
   */
  private async transcriptFor(
    orgId: string,
    video: ClipVideo,
    ranges: readonly MsRange[],
  ): Promise<RecipeTranscript | null> {
    if (ranges.length === 0 || video.status !== 'READY' || video.durationMs === null) return null;
    try {
      const read = await this.transcripts.read(orgId, video.id, { ranges });
      if (!read.transcript || !read.complete) return null;
      return {
        assetId: read.transcript.id,
        language: read.transcript.language,
        words: read.transcript.words,
        covered: read.transcript.covered,
      };
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.recipe.transcript_unread',
          orgId,
          videoId: video.id,
          reason: errorName(error),
        }),
      );
      return null;
    }
  }

  /** Built-in looks, then the workspace's own, by id. */
  private async captionLooks(orgId: string): Promise<(id: string) => CaptionLook | null> {
    const own = new Map((await this.styles.own(orgId)).map((style) => [style.id, style.look]));
    return (id) => builtInCaptionStyle(id)?.look ?? own.get(id) ?? null;
  }

  /** The workspace's saved layouts for `ratio`, as saved layouts (no follow). */
  private async layoutPresets(
    orgId: string,
    ratio: string,
  ): Promise<(id: string) => SavedLayout | null> {
    const rows = await prisma.clipLayoutPreset.findMany({
      where: { organizationId: orgId, ratio },
      select: { id: true, layout: true },
    });
    const byId = new Map<string, SavedLayout>();
    for (const row of rows) {
      const parsed = layoutSchema.safeParse(row.layout);
      if (!parsed.success) continue;
      const { follow: _follow, ...saved } = parsed.data;
      byId.set(row.id, saved);
    }
    return (id) => byId.get(id) ?? null;
  }

  /** Remove Silences' `isLoud` from the stored waveform, when it is there and small; else none. */
  private async loudness(
    orgId: string,
    videoId: string,
  ): Promise<((range: MsRange) => boolean) | undefined> {
    try {
      const assets = await this.videos.assetsOf(orgId, videoId);
      const wave = latestAsset(assets, 'WAVEFORM');
      const meta = wave ? waveformMetaOf(wave.meta) : null;
      if (!wave || !meta) return undefined;
      const opened = await this.storage.getStream(wave.key);
      if (!opened) return undefined;
      if (opened.totalBytes > WAVEFORM_MAX_BYTES) {
        opened.body.destroy();
        return undefined;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of opened.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return loudFromPeaks(peaksFromFile(Buffer.concat(chunks)), meta.perSecond);
    } catch {
      return undefined;
    }
  }

  private async workspaceWords(orgId: string): Promise<string[]> {
    const row = await prisma.clipWordList.findUnique({
      where: { organizationId: orgId },
      select: { words: true },
    });
    return row?.words ?? [];
  }

  /** Auto-Edit's hook line: the title writer's first title, once, free; null on any failure. */
  private async writeHookTitle(
    orgId: string,
    transcript: RecipeTranscript | null,
    ranges: readonly MsRange[],
  ): Promise<string | null> {
    if (!transcript) return null;
    const text = hookTextFrom(
      translationLines({ words: [...transcript.words] }, ranges).map((line) => line.text),
    );
    if (text.length === 0) return null;
    const writer = this.ai.createSnippetWriter({ orgId });
    if (!writer) return null;
    try {
      const { titles } = await writer.writeHookTitles({
        text,
        language: languageName(transcript.language),
        attempt: 0,
      });
      return titles[0]?.trim() || null;
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'clips.auto_edit.hook_title_failed',
          orgId,
          reason: errorName(error),
        }),
      );
      return null;
    }
  }

  /** Faces for a clip (free), as Module 08's run asks them; never throws. */
  private async askFaces(
    orgId: string,
    userId: string | null,
    clipId: string,
  ): Promise<'asked' | 'off' | 'failed'> {
    try {
      await this.faces.ensure(orgId, userId, clipId);
      return 'asked';
    } catch (error) {
      if (error instanceof ClipErrorException && error.clipCode === 'faces_off') return 'off';
      this.logger.warn(
        JSON.stringify({
          event: 'clips.recipe.faces_refused',
          orgId,
          clipId,
          status: error instanceof HttpException ? error.getStatus() : null,
        }),
      );
      return 'failed';
    }
  }
}

/** What an Auto-Edit clip recorded about its making (a replay answers the same). */
function autoEditRecord(meta: unknown): { skipped: RecipeSkip[]; noSpeech: boolean } {
  const record =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? ((meta as Record<string, unknown>).autoEdit as Record<string, unknown> | undefined)
      : undefined;
  const skipped = Array.isArray(record?.skipped)
    ? (record.skipped as unknown[]).filter(
        (item): item is RecipeSkip =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as RecipeSkip).part === 'string' &&
          typeof (item as RecipeSkip).reason === 'string',
      )
    : [];
  return { skipped, noSpeech: record?.noSpeech === true };
}

/** The waveform file's bytes: raw peaks, or (older files) a JSON array of numbers. */
function peaksFromFile(buffer: Buffer): Uint8Array {
  let first = 0;
  while (first < buffer.length && /\s/.test(String.fromCharCode(buffer[first] ?? 0))) first += 1;
  if (buffer[first] !== 0x5b) return new Uint8Array(buffer);
  try {
    const parsed: unknown = JSON.parse(buffer.toString('latin1'));
    if (!Array.isArray(parsed)) return new Uint8Array(buffer);
    return Uint8Array.from(parsed, (value) =>
      typeof value === 'number' && Number.isFinite(value) ? value : 0,
    );
  } catch {
    return new Uint8Array(buffer);
  }
}

/** Why one run clip was skipped, as a fixed code (never data from the clip). */
class RunClipError extends Error {}

/** A loggable reason: our own code, or only the error's class name (never its message). */
function errorName(error: unknown): string {
  if (error instanceof RunClipError) return error.message;
  return error instanceof Error ? error.name : 'unknown';
}

function jobNotFound(): NotFoundException {
  return new NotFoundException({ message: CLIPS_MESSAGES.JOB_NOT_FOUND, code: 'job_not_found' });
}
