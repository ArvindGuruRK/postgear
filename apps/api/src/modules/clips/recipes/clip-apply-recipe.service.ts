/**
 * Apply A Recipe in the editor (Sprint 13, Module 10):
 * `POST /clips/:clipId/apply-recipe`.
 *
 * The editor is the one writer of an open clip's document, so it applies
 * the recipe itself (one undo step) and autosaves. This route checks the
 * clip and the recipe are the workspace's (another workspace's is a 404),
 * and answers what the editor needs first:
 *
 * - `needs.transcript`: `none` when the recipe has no word part (captions,
 *   silences, filler words, bleeps); `covered` when every moment of the main
 *   video the clip plays was listened to; else `missing`, with `listenPrice`
 *   the AI minutes listening would cost (quoted over the stretches widened by
 *   the handles, as Add Captions listens; never charged here).
 * - `needs.faces`: a recipe that follows the speaker asks the clip's face
 *   file (free, Module 07's `ensure`: a covering file is reused, a covering
 *   job joined, else a FACES job started). `off` when faces are off.
 * - `missing`: what the recipe names that is gone (a caption style, a saved
 *   layout, the brand kit), read by running the engine's own apply, so the
 *   answer and the editor's apply can never disagree.
 * - `brandKit`: the recipe's live kit in the engine's shape (its logo copied
 *   for clips on first use), or null.
 *
 * Nothing here writes the clip. Logs carry ids and counts only.
 */
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { prisma } from '@postgear/db';
import {
  applyRecipe,
  builtInCaptionStyle,
  type ClipBrandKit,
  type ClipDocument,
  HANDLE_MS,
  layoutSchema,
  mergeRanges,
  type MsRange,
  type RecipeMissing,
  type RecipeSettings,
  RECIPE_FALLBACK_CAPTION_STYLE,
  type RecipeView,
  type SavedLayout,
  safeParseClipDocument,
} from '@postgear/video-engine';
import { ClipBrandKitsService } from '../brand-kits/clip-brand-kits.service';
import { ClipCaptionStylesService } from '../captions/clip-caption-styles.service';
import { ClipItemService } from '../clip/clip-item.service';
import { ClipErrorException } from '../clip-error.exception';
import { CLIPS_MESSAGES } from '../clips.messages';
import { ClipFacesService } from '../faces/clip-faces.service';
import { ClipTranscriptsService } from '../transcripts/clip-transcripts.service';
import { ClipVideosRepository } from '../videos/clip-videos.repository';
import { mainRanges, mainVideoId } from './clip-recipe-applier.service';
import { ClipRecipesService } from './clip-recipes.service';

export interface ApplyRecipeAnswer {
  recipe: RecipeView;
  brandKit: ClipBrandKit | null;
  needs: {
    transcript: 'covered' | 'missing' | 'none';
    listenPrice: number;
    faces: 'ready' | 'started' | 'off' | 'none';
  };
  missing: RecipeMissing[];
}

/** True when a part of the recipe works on the words: captions, silences, filler words or bleeps. */
export function recipeNeedsWords(settings: RecipeSettings): boolean {
  return Boolean(
    settings.captions?.on || settings.silences?.on || settings.fillers?.on || settings.bleep?.on,
  );
}

@Injectable()
export class ClipApplyRecipeService {
  private readonly logger = new Logger(ClipApplyRecipeService.name);

  constructor(
    private readonly items: ClipItemService,
    private readonly recipes: ClipRecipesService,
    private readonly kits: ClipBrandKitsService,
    private readonly transcripts: ClipTranscriptsService,
    private readonly faces: ClipFacesService,
    private readonly styles: ClipCaptionStylesService,
    private readonly videos: ClipVideosRepository,
  ) {}

  async prepare(
    orgId: string,
    userId: string,
    clipId: string,
    recipeId: string,
  ): Promise<ApplyRecipeAnswer> {
    const clip = await this.items.requireClip(orgId, clipId);
    const recipe = await this.recipes.resolve(orgId, recipeId);
    const parsed = safeParseClipDocument(clip.document);
    if (!parsed.ok) {
      throw new ClipErrorException(HttpStatus.UNPROCESSABLE_ENTITY, 'clip_document_invalid', {
        message: CLIPS_MESSAGES.CLIP_DOCUMENT_INVALID,
      });
    }
    const doc = parsed.doc;
    const videoId = mainVideoId(doc) ?? clip.videoId;
    const video = await this.videos.findLive(orgId, videoId);

    // The engine's own apply, without words, says which named parts are gone.
    const missing = await this.missingParts(orgId, doc, recipe.settings, video);

    let brandKit: ClipBrandKit | null = null;
    if (recipe.brandKitId) {
      const row = await this.kits.findLive(orgId, recipe.brandKitId);
      if (row) brandKit = await this.kits.engineKit(orgId, row);
      else missing.push({ part: 'brandKit', id: recipe.brandKitId, usedInstead: null });
    }

    const words = recipeNeedsWords(recipe.settings)
      ? await this.words(orgId, video, mainRanges(doc))
      : { transcript: 'none' as const, listenPrice: 0 };
    const faces = recipe.settings.follow?.on ? await this.askFaces(orgId, userId, clip.id) : 'none';

    this.logger.log(
      JSON.stringify({
        event: 'clips.recipe.apply_asked',
        orgId,
        clipId: clip.id,
        recipeId: recipe.view.id,
        transcript: words.transcript,
        faces,
        missing: missing.length,
      }),
    );
    return { recipe: recipe.view, brandKit, needs: { ...words, faces }, missing };
  }

  private async missingParts(
    orgId: string,
    doc: ClipDocument,
    settings: RecipeSettings,
    video: { width: number | null; height: number | null } | null,
  ): Promise<RecipeMissing[]> {
    const own = new Map((await this.styles.own(orgId)).map((style) => [style.id, style.look]));
    const ratio = settings.ratio ?? doc.canvas.ratio;
    const presets = settings.layout?.presetId
      ? await prisma.clipLayoutPreset.findMany({
          where: { organizationId: orgId, ratio, id: settings.layout.presetId },
          select: { id: true, layout: true },
        })
      : [];
    const saved = new Map<string, SavedLayout>();
    for (const row of presets) {
      const layout = layoutSchema.safeParse(row.layout);
      if (!layout.success) continue;
      const { follow: _follow, ...rest } = layout.data;
      saved.set(row.id, rest);
    }
    try {
      const outcome = applyRecipe(doc, settings, {
        videoSize:
          video?.width && video.height
            ? { width: video.width, height: video.height }
            : { width: 1920, height: 1080 },
        transcript: null,
        captionLook: (id) => builtInCaptionStyle(id)?.look ?? own.get(id) ?? null,
        layoutPreset: (id) => saved.get(id) ?? null,
      });
      const missing = [...outcome.missing];
      // Without words the engine skips captions before it looks the style up, so ask here.
      const captions = settings.captions;
      const look = (id: string) => builtInCaptionStyle(id)?.look ?? own.get(id) ?? null;
      if (
        captions?.on &&
        !look(captions.styleId) &&
        !missing.some((part) => part.part === 'captionStyle')
      ) {
        missing.push({
          part: 'captionStyle',
          id: captions.styleId,
          usedInstead: RECIPE_FALLBACK_CAPTION_STYLE,
        });
      }
      return missing;
    } catch {
      return [];
    }
  }

  /** Whether the main video's stretches the clip plays were listened to, and the price if not. */
  private async words(
    orgId: string,
    video: { id: string; durationMs: number | null; status: string } | null,
    ranges: MsRange[],
  ): Promise<{ transcript: 'covered' | 'missing'; listenPrice: number }> {
    if (video?.status !== 'READY' || video.durationMs === null || ranges.length === 0) {
      return { transcript: 'missing', listenPrice: 0 };
    }
    const duration = video.durationMs;
    try {
      const plain = await this.transcripts.quote(orgId, video.id, { ranges });
      if (plain.covered) return { transcript: 'covered', listenPrice: 0 };
      const wide = mergeRanges(
        ranges.map((range) => ({
          fromMs: Math.max(0, range.fromMs - HANDLE_MS),
          toMs: Math.min(duration, range.toMs + HANDLE_MS),
        })),
      );
      const quote = await this.transcripts.quote(orgId, video.id, { ranges: wide });
      return { transcript: 'missing', listenPrice: quote.price };
    } catch {
      return { transcript: 'missing', listenPrice: 0 };
    }
  }

  private async askFaces(
    orgId: string,
    userId: string,
    clipId: string,
  ): Promise<'ready' | 'started' | 'off'> {
    try {
      const outcome = await this.faces.ensure(orgId, userId, clipId);
      return outcome.status === 'ready' ? 'ready' : 'started';
    } catch (error) {
      if (error instanceof ClipErrorException && error.clipCode === 'faces_off') return 'off';
      throw error;
    }
  }
}
