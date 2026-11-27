/**
 * Sprint 13, Module 10: the shapes the recipe, brand kit and Auto-Edit routes
 * answer. The API's answers match these exactly (the contract both sides
 * were built against).
 */
import type {
  ClipBrandKit,
  LogoPosition,
  RecipeMissing,
  RecipeSettings,
  RecipeSkip,
  RecipeView,
} from '@postgear/video-engine';
import type { ClipJobView } from './clips';

export type { ClipBrandKit, LogoPosition, RecipeMissing, RecipeSettings, RecipeSkip, RecipeView };

/** `GET /clips/recipes`: the five starters first (`builtIn`), then the workspace's own, newest first. */
export interface RecipesView {
  recipes: RecipeView[];
  /** The workspace's own count and the most it may keep. */
  own: number;
  max: number;
}

/**
 * `POST /clips/:clipId/apply-recipe`: what the editor needs to apply the
 * recipe itself. The server has checked the recipe belongs to the workspace,
 * started a free FACES job when the recipe follows the speaker, and quoted
 * listening when the recipe needs words the clip has not had listened to.
 */
export interface ApplyRecipeAnswer {
  recipe: RecipeView;
  /** The recipe's brand kit in the engine's shape (logo copied for clips), or null. */
  brandKit: ClipBrandKit | null;
  needs: {
    /** `covered`: every word the clip plays was listened to; `missing`: listen first (see `listenPrice`); `none`: the recipe needs no words. */
    transcript: 'covered' | 'missing' | 'none';
    /** AI minutes to listen to what the clip plays (0 when covered or not needed). */
    listenPrice: number;
    /** `ready`: a face file covers the clip; `started`: a FACES job is running; `off`: faces are off; `none`: not needed. */
    faces: 'ready' | 'started' | 'off' | 'none';
  };
  /** Parts the recipe names that are gone (a deleted caption style, layout or kit). */
  missing: RecipeMissing[];
}

/** One brand kit for the kit page: Studio's kit with its clip fields. */
export interface ClipBrandKitView {
  id: string;
  name: string;
  /** The Studio logo's address (signed or public), or null. */
  logoUrl: string | null;
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  clipLogoPosition: LogoPosition | null;
  clipCaptionStyleId: string | null;
  intro: BrandVideoView | null;
  outro: { kind: 'video'; video: BrandVideoView } | { kind: 'card'; text: string } | null;
}

export interface BrandVideoView {
  videoId: string;
  title: string;
  durationMs: number;
  /** The light copy to play in the kit page's small player (signed), or null while it is not ready. */
  url: string | null;
  posterUrl: string | null;
}

export interface ClipBrandKitsView {
  brandKits: ClipBrandKitView[];
}

/** `PATCH /clips/brand-kits/:id`: the clip fields only (Studio's own fields stay on Studio's routes). */
export interface ClipBrandKitPatch {
  clipLogoPosition?: LogoPosition | null;
  clipCaptionStyleId?: string | null;
  clipIntroVideoId?: string | null;
  /** A video outro; setting it clears nothing else. The outro is the video when set, else the card when `clipOutroText` is set. */
  clipOutroVideoId?: string | null;
  clipOutroText?: string | null;
}

/** `POST /clips/videos/:videoId/auto-edit/price`. */
export interface AutoEditPriceView {
  /** AI minutes to listen (0 when covered, or the recipe needs no words). */
  aiMinutes: number;
  /** The stretch that will be edited. */
  range: { fromMs: number; toMs: number };
  /** The video is longer than Auto-Edit takes at once: the dialog shows the range handles. */
  needsRange: boolean;
  remaining: number | null;
  limit: number | null;
  cycleEnd: string;
}

/**
 * `POST /clips/videos/:videoId/auto-edit`: 202 with the AUTO_EDIT job when
 * it must listen first (stages `listening`, then `applying`; its output
 * holds `clipId`, `skipped` and `noSpeech`), 200 with `job: null` when the
 * clip was made at once.
 */
export interface AutoEditStarted {
  clipId: string;
  job: ClipJobView | null;
  aiMinutes: number;
  /** Parts not applied (only when made at once; a job's are in its output). */
  skipped: RecipeSkip[];
  noSpeech: boolean;
}

/** An AUTO_EDIT job's output, once DONE. */
export interface AutoEditOutput {
  clipId: string;
  skipped: RecipeSkip[];
  noSpeech: boolean;
}
