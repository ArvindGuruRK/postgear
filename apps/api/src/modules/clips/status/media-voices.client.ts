/**
 * The voices the Python media service can speak right now (Sprint 13,
 * Module 09): its `GET /voices` (`VoiceList`), read by Text To Speech and by
 * `ai.voice` in `GET /clips/status`.
 *
 * Asked with `MEDIA_INTERNAL_TOKEN`, for at most 2.5 seconds. An answer is
 * kept 30 seconds and a silence 5, and concurrent pages share one request.
 * Anything but a valid list (the service down, an old service, a speaker that
 * is `off`) is no voices, so the voice row says it is not available instead
 * of offering a voice that cannot speak.
 *
 * The address is our own configuration (`MEDIA_URL`); only the voices' ids,
 * names and languages reach the page.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';
import { type VoiceInfo, voiceListSchema } from '../voice/voices';
import { MEDIA_READY_TIMEOUT_MS } from './media-service.probe';

const OK_CACHE_MS = 30_000;
const OFF_CACHE_MS = 5_000;

export type VoicesFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok'> & { json(): Promise<unknown> }>;

export interface SpeakerVoices {
  /** What speaks, such as `kokoro` or `simulation`; null when the service did not answer. */
  speaker: string | null;
  voices: readonly VoiceInfo[];
}

const NONE: SpeakerVoices = Object.freeze({ speaker: null, voices: Object.freeze([]) });

@Injectable()
export class MediaVoices {
  private readonly logger = new Logger(MediaVoices.name);
  private readonly voicesUrl: string;
  private readonly token: string | undefined;
  private cached: { value: SpeakerVoices; until: number } | null = null;
  private inFlight: Promise<SpeakerVoices> | null = null;
  private lastLogged: string | null = null;
  /** Swapped in tests. */
  fetcher: VoicesFetch = (url, init) => fetch(url, init);
  now: () => number = () => Date.now();

  constructor(config: ConfigService<Env, true>) {
    const base = config.get('MEDIA_URL', { infer: true }) ?? 'http://localhost:8100';
    this.voicesUrl = new URL('/voices', base).toString();
    this.token = config.get('MEDIA_INTERNAL_TOKEN', { infer: true }) ?? undefined;
  }

  /** The speaker and its voices; no voices when the service cannot speak. */
  async list(): Promise<SpeakerVoices> {
    if (this.cached && this.now() < this.cached.until) return this.cached.value;
    this.inFlight ??= this.ask().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ask(): Promise<SpeakerVoices> {
    let value: SpeakerVoices = NONE;
    try {
      const response = await this.fetcher(this.voicesUrl, {
        method: 'GET',
        headers: this.token ? { 'X-PostGear-Internal': this.token } : {},
        signal: AbortSignal.timeout(MEDIA_READY_TIMEOUT_MS),
        redirect: 'error',
      });
      if (response.ok) {
        const parsed = voiceListSchema.safeParse(await response.json());
        if (parsed.success) {
          value = {
            speaker: parsed.data.speaker.name,
            voices: parsed.data.speaker.state === 'off' ? [] : parsed.data.voices,
          };
        }
      }
    } catch {
      value = NONE;
    }
    const summary = `${value.speaker ?? 'none'}:${value.voices.length}`;
    if (summary !== this.lastLogged) {
      // Once per change: the speaker's name and a count, never the address or the token.
      this.logger.log(`media voices: ${value.speaker ?? 'none'}, ${value.voices.length} voices`);
      this.lastLogged = summary;
    }
    this.cached = { value, until: this.now() + (value.voices.length ? OK_CACHE_MS : OFF_CACHE_MS) };
    return value;
  }
}
