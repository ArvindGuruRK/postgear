/**
 * What the Clips library, sticker and sound upload routes say (Modules 12
 * and 14). The sentences a refusal shares with the worker and the web
 * (`sticker_unusable`, `sound_unusable`, `sound_upload_too_big`,
 * `library_throttled`) live in the engine's `CLIP_ERROR_MESSAGES`; this file
 * adds the ones with a number in them.
 */
export const CLIP_LIBRARY_MESSAGES = {
  /** "This sticker is in 2 clips. Take it out of them first, then delete it." */
  inUse(clips: number): string {
    return `This sticker is in ${clips} ${clips === 1 ? 'clip' : 'clips'}. Take it out of ${clips === 1 ? 'it' : 'them'} first, then delete it.`;
  },
  DELETED: 'Sticker deleted.',
  /** "This sound is in 2 clips. Take it out of them first, then delete it." (Module 14) */
  soundInUse(clips: number): string {
    return `This sound is in ${clips} ${clips === 1 ? 'clip' : 'clips'}. Take it out of ${clips === 1 ? 'it' : 'them'} first, then delete it.`;
  },
  SOUND_DELETED: 'Sound deleted.',
} as const;
