/**
 * The brand kit for clips (Sprint 13, Module 10): what a Studio brand kit
 * adds to a clip. Pure. CONTRACT: the API and the web hand the engine this
 * shape; `apply.ts` turns it into ordinary document edits.
 */

export const LOGO_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

/** The intro and an outro video can be at most this long. */
export const BRAND_VIDEO_MAX_MS = 5_000;
/** And at most this big when uploaded. */
export const BRAND_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** A brand kit's own short video (an upload in the clips library). */
export interface BrandVideo {
  videoId: string;
  durationMs: number;
  width: number;
  height: number;
}

export type BrandOutro =
  | { kind: 'video'; video: BrandVideo }
  /** A 2 second card drawn by the compiler: the kit's colours, its logo and one line. */
  | { kind: 'card'; text: string; background: string; colour: string };

export interface ClipBrandKit {
  id: string;
  name: string;
  /** The kit's logo as the workspace's own sticker asset (copied on first use), with its picture size. */
  logo: { assetId: string; width: number; height: number } | null;
  /** Null: no logo on clips. */
  logoPosition: LogoPosition | null;
  /** A built-in caption style id or a workspace style id; null keeps the clip's. */
  captionStyleId: string | null;
  intro: BrandVideo | null;
  outro: BrandOutro | null;
}

/** The parts a clip takes from its kit, each switchable per clip (the Layouts tab). */
export interface BrandParts {
  logo: boolean;
  intro: boolean;
  outro: boolean;
  /** The kit's caption style on the captions track (when the clip has captions). */
  captions: boolean;
}
