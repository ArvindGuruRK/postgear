/** Request shape for `POST /clips/:clipId/voice` (Sprint 13, Module 09). Strict, like every Clips body. */
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';
import { voiceIdSchema } from './voices';

/** The longest line one voice is made from (the media contract's `SPEECH_MAX_CHARACTERS`). */
export const VOICE_TEXT_MAX = 500;

export const makeVoiceSchema = z
  .object({
    // Control characters out, the ends trimmed, then 1 to 500 characters.
    text: z
      .string()
      .max(VOICE_TEXT_MAX * 4)
      .transform((value) => stripControlChars(value).trim())
      .pipe(z.string().min(1).max(VOICE_TEXT_MAX)),
    // Which voices exist is the media service's answer, checked by the service.
    voiceId: voiceIdSchema,
    /** The clip's revision the line was typed at: part of the charge key. */
    revision: z.number().int().positive().max(1_000_000_000),
  })
  .strict();
export type MakeVoiceInput = z.infer<typeof makeVoiceSchema>;
