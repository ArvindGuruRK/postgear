/**
 * Why a clip cannot be compiled into an FFmpeg command.
 *
 * The compiler never guesses (cookbook rule 20): when an input is missing, a
 * font is not in the manifest, or the document asks for something this
 * version of the compiler cannot draw yet, it stops with one of these codes
 * instead of rendering a different video. The worker maps the code to a job
 * error with `jobErrorCodeFor`; a person never reads the code or the
 * developer message here.
 */

export const RENDER_COMPILE_CODES = [
  /** The document does not pass `clipDocumentSchema`. */
  'invalid_document',
  /** The render context is not usable (a size of zero, a negative offset). */
  'invalid_context',
  /** A source, the mark or the fonts folder the plan needs was not handed in. */
  'input_missing',
  /** A part of the clip lies outside the stretch of video the input file holds. */
  'source_not_covered',
  /** A font family the text uses is not in the font manifest. */
  'font_missing',
  /** A layout with nothing to draw (every preset and Custom layout renders since Module 10). */
  'layout_unsupported',
  /** A crop that moves over time (Sprint 13's speaker tracking). */
  'crop_keyframes_unsupported',
  /** Zooms: no longer refused since Module 13 renders them; kept so older logs still read. */
  'zoom_unsupported',
  /** Colour looks and the vignette: no longer refused since Module 13; kept like the zoom code. */
  'looks_unsupported',
  /** Text items (Module 11). */
  'text_unsupported',
  /** A sticker file the clip uses was not handed in (removed from the library, or a deleted upload). */
  'sticker_missing',
  /** Kept for older logs: sounds render since Module 14. */
  'sounds_unsupported',
  /** A sound file the clip plays was not handed in (removed from the library, or a deleted upload). */
  'sound_missing',
  /** Captions (Sprint 13). */
  'captions_unsupported',
] as const;

export type RenderCompileCode = (typeof RENDER_COMPILE_CODES)[number];

/**
 * A typed refusal from `buildRenderPlan` or `compileFfmpeg`. `message` is for
 * the log only; `details` carries the ids or values that explain it.
 */
export class RenderCompileError extends Error {
  readonly code: RenderCompileCode;
  readonly details: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: RenderCompileCode,
    message: string,
    details: Record<string, string | number | boolean> = {},
  ) {
    super(message);
    this.name = 'RenderCompileError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Narrowing helper that also works across bundle copies of this class (checks the name and code). */
export function isRenderCompileError(error: unknown): error is RenderCompileError {
  if (error instanceof RenderCompileError) {
    return true;
  }
  if (!(error instanceof Error) || error.name !== 'RenderCompileError') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (RENDER_COMPILE_CODES as readonly string[]).includes(code);
}

/**
 * The job error a compile refusal becomes (a key of `CLIP_ERROR_MESSAGES`).
 * A missing font or sticker has its own code because a retry cannot fix it; everything
 * else reads as a failed export.
 */
export function jobErrorCodeFor(
  code: RenderCompileCode,
): 'font_missing' | 'sticker_missing' | 'sound_missing' | 'export_failed' {
  if (code === 'font_missing' || code === 'sticker_missing' || code === 'sound_missing') return code;
  return 'export_failed';
}
