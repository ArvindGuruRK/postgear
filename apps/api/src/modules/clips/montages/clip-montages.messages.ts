/**
 * What only the montage route says (Sprint 13, Module 11). The refusal
 * sentences (`montage_too_few` and the rest) are the engine's, in
 * `@postgear/video-engine`'s `CLIP_ERROR_MESSAGES`, so the web and the API
 * read the same words for the same code.
 */
export const MONTAGE_MESSAGES = {
  /**
   * A montage without a title card is named after its size, Title Case like
   * every name ("Montage Of 3 Clips"); with one it takes the card's line.
   */
  DEFAULT_TITLE: (count: number) => `Montage Of ${count} Clips`,
  /** 422 `montage_captions_fixed`: the captions routes read one video, a montage plays several. */
  CAPTIONS_FIXED:
    'A montage keeps the captions of its clips. Change them in a clip, then make the montage again.',
} as const;
