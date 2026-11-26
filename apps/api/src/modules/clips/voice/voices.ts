/**
 * The voices Text To Speech offers (Sprint 13, Module 09).
 *
 * Made-up voices of the simulated speaker: the real one (Kokoro through
 * `kokoro-onnx`) is parked by the licence decision (D13-06). The Python
 * service has the same list (`providers/speech/simulated.py`), and both sides
 * test theirs against `packages/media-contract/fixtures/voices/simulated.json`,
 * so a voice on offer is always one that can speak.
 *
 * `languages` are the spoken-language codes the voice reads; the route
 * refuses a line written in a script none of them reads (`text-script.ts`).
 */

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
  /** A short sample to play; null while no sample is recorded (the simulated voices have none). */
  sampleUrl: string | null;
}

export const VOICES: readonly VoiceInfo[] = Object.freeze([
  Object.freeze({ id: 'sim-river', name: 'River', languages: Object.freeze(['en']) }),
  Object.freeze({ id: 'sim-meadow', name: 'Meadow', languages: Object.freeze(['en', 'hi']) }),
  Object.freeze({ id: 'sim-stone', name: 'Stone', languages: Object.freeze(['en']) }),
]);

export const VOICE_IDS = VOICES.map((voice) => voice.id) as [string, ...string[]];

export function findVoice(id: string): VoiceInfo | null {
  return VOICES.find((voice) => voice.id === id) ?? null;
}

export function voiceViews(): VoiceView[] {
  return VOICES.map((voice) => ({
    id: voice.id,
    name: voice.name,
    languages: [...voice.languages],
    sampleUrl: null,
  }));
}
