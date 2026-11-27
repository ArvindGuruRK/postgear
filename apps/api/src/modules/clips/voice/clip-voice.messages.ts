/**
 * What the Text To Speech routes say (Sprint 13, Module 09). Sentence case,
 * plain words, each one ending with what to do next.
 */
export const CLIP_VOICE_MESSAGES = {
  /** 503 `voice_off`: `CLIPS_TTS` is off, or the media service is not running. */
  OFF: 'Making a voice is not available right now. Everything else still works.',
  /** 422 `voice_language`: the line's script is not one the voice reads. */
  LANGUAGE: 'This voice cannot read this language. Pick another voice.',
  /** 422 `voice_unknown`: the media service no longer offers this voice (its speaker changed). */
  UNKNOWN: 'This voice is no longer available. Pick another voice.',
  /** 409 `voice_running`: the same line and voice are being charged by another request. */
  RUNNING: 'This voice is already being made. Wait a moment and look again.',
} as const;
