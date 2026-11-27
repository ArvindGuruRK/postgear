/**
 * The voices Text To Speech offers (Sprint 13, Module 09).
 *
 * The API keeps no list of its own: the Python media service answers
 * `GET /voices` with the speaker it runs (the simulated one, or Kokoro run as
 * its own program) and that speaker's voices (`MediaVoices`,
 * `status/media-voices.client.ts`). So a voice on offer is always one that
 * can speak there. `voiceListSchema` is the media contract's `VoiceList`,
 * tested against the same fixtures (`packages/media-contract/fixtures/voices`).
 *
 * `languages` are the spoken-language codes the voice reads; the route
 * refuses a line written in a script none of them reads (`text-script.ts`).
 */
import { z } from 'zod';

/** A voice's id, as the media contract's `VoiceId`: short, lowercase, dashes. Never a path. */
export const VOICE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+){0,3}$/;
export const voiceIdSchema = z.string().max(32).regex(VOICE_ID_PATTERN);

export const voiceListSchema = z
  .object({
    speaker: z
      .object({
        state: z.enum(['simulation', 'live', 'off']),
        name: z.string().min(1).max(64),
      })
      .strict(),
    voices: z
      .array(
        z
          .object({
            id: voiceIdSchema,
            name: z.string().min(1).max(40),
            languages: z
              .array(z.enum(['en', 'hi', 'ta']))
              .min(1)
              .max(3),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();
export type VoiceList = z.infer<typeof voiceListSchema>;

export interface VoiceInfo {
  id: string;
  name: string;
  languages: readonly string[];
}

/** One voice as `GET /clips/voices` answers it. */
export interface VoiceView {
  id: string;
  name: string;
  languages: string[];
  /** A short sample to play (a path on the web app), or null when the voice has none. */
  sampleUrl: string | null;
}

export function findVoice(voices: readonly VoiceInfo[], id: string): VoiceInfo | null {
  return voices.find((voice) => voice.id === id) ?? null;
}

/**
 * Where a voice's sample plays from. The Kokoro voices' samples ship with the
 * web app (`apps/web/public/clips/voice-samples`, made once by
 * `npm run voice:samples --workspace=@postgear/media`), so the path is the web
 * app's own; the simulated voices have none.
 */
export function sampleUrlOf(voiceId: string): string | null {
  return voiceId.startsWith('kokoro-') ? `/clips/voice-samples/${voiceId}.m4a` : null;
}

export function voiceViews(voices: readonly VoiceInfo[]): VoiceView[] {
  return voices.map((voice) => ({
    id: voice.id,
    name: voice.name,
    languages: [...voice.languages],
    sampleUrl: sampleUrlOf(voice.id),
  }));
}
