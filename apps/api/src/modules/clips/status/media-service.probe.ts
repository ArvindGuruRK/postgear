/**
 * Whether the Python media service can take AI steps right now (Sprint 13,
 * Module 01): `ai.service` in `GET /clips/status`, read by every AI button.
 *
 * It asks the service's `GET /ready` (the worker is polling
 * `postgear-media-py` and its storage answers) with `MEDIA_INTERNAL_TOKEN`,
 * for at most 2.5 seconds. An answer is kept 10 seconds and a silence 5, and
 * concurrent pages share one request, so with the service stopped the page
 * reads `off` within about 10 seconds and nothing else waits on it.
 *
 * The address is our own configuration (`MEDIA_URL`), never a user's, and
 * nothing from the reply reaches the page but `ok` or `off`.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env';

export type AiServiceState = 'ok' | 'off';

export const MEDIA_READY_TIMEOUT_MS = 2_500;
const OK_CACHE_MS = 10_000;
const OFF_CACHE_MS = 5_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok'>>;

@Injectable()
export class MediaServiceProbe {
  private readonly logger = new Logger(MediaServiceProbe.name);
  private readonly readyUrl: string;
  private readonly token: string | undefined;
  private cached: { state: AiServiceState; until: number } | null = null;
  private inFlight: Promise<AiServiceState> | null = null;
  private lastLogged: AiServiceState | null = null;
  /** Swapped in tests. */
  fetcher: FetchLike = (url, init) => fetch(url, init);
  now: () => number = () => Date.now();

  constructor(config: ConfigService<Env, true>) {
    const base = config.get('MEDIA_URL', { infer: true }) ?? 'http://localhost:8100';
    this.readyUrl = new URL('/ready', base).toString();
    this.token = config.get('MEDIA_INTERNAL_TOKEN', { infer: true }) ?? undefined;
  }

  /** `ok` when the service says it is ready, `off` for anything else. */
  async state(): Promise<AiServiceState> {
    if (this.cached && this.now() < this.cached.until) return this.cached.state;
    this.inFlight ??= this.ask().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ask(): Promise<AiServiceState> {
    let state: AiServiceState = 'off';
    try {
      const response = await this.fetcher(this.readyUrl, {
        method: 'GET',
        headers: this.token ? { 'X-PostGear-Internal': this.token } : {},
        signal: AbortSignal.timeout(MEDIA_READY_TIMEOUT_MS),
        redirect: 'error',
      });
      state = response.ok ? 'ok' : 'off';
    } catch {
      state = 'off';
    }
    if (state !== this.lastLogged) {
      // Once per change, never the address or the token.
      this.logger.log(`media service is ${state}`);
      this.lastLogged = state;
    }
    this.cached = { state, until: this.now() + (state === 'ok' ? OK_CACHE_MS : OFF_CACHE_MS) };
    return state;
  }
}
