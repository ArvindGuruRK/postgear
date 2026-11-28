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
 * Module 15: the same answer's `hostedLane` says where long speech goes
 * when the service sends it to a hosted listener (`TRANSCRIBER=auto` or
 * `groq` with its key): the provider's id and the threshold in minutes, or
 * null. `hostedLane()` reads it from the same cached request, so the privacy
 * text names the provider only while sound can leave our servers. A missing
 * or unreadable field (an older service) is no hosted lane.
 *
 * The address is our own configuration (`MEDIA_URL`), never a user's, and
 * nothing from the reply reaches the page but `ok` or `off` and the lane's
 * provider and threshold.
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { Env } from '../../../config/env';

export type AiServiceState = 'ok' | 'off';

/** `ai.hostedLane` in `GET /clips/status` (Module 15). */
export interface HostedLaneState {
  /** Long speech is sent to a hosted listener to be turned into text. */
  on: boolean;
  /** Its id, such as `groq`; null when off. */
  provider: string | null;
  /** Its name for a sentence, such as `Groq`; null when off. */
  providerName: string | null;
  /** Jobs asking for more minutes of sound than this go there (0: every job); null when off. */
  aboveMinutes: number | null;
}

export const NO_HOSTED_LANE: HostedLaneState = Object.freeze({
  on: false,
  provider: null,
  providerName: null,
  aboveMinutes: null,
});

/** The hosted listeners the media service can name, and how a sentence says them. */
const PROVIDER_NAMES: Record<string, string> = { groq: 'Groq' };

const readyBodySchema = z.object({
  hostedLane: z
    .object({
      provider: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
      aboveMinutes: z.number().int().min(0).max(1440),
    })
    .strict()
    .nullable(),
});

/** The `/ready` answer's `hostedLane`, or no lane for anything else. */
export function hostedLaneFrom(body: unknown): HostedLaneState {
  const parsed = readyBodySchema.safeParse(body);
  const lane = parsed.success ? parsed.data.hostedLane : null;
  if (!lane) return NO_HOSTED_LANE;
  return {
    on: true,
    provider: lane.provider,
    providerName: PROVIDER_NAMES[lane.provider] ?? lane.provider,
    aboveMinutes: lane.aboveMinutes,
  };
}

interface ProbeAnswer {
  state: AiServiceState;
  lane: HostedLaneState;
}

/** A body that cannot be read is no hosted lane, never a service that is off. */
async function bodyOf(response: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export const MEDIA_READY_TIMEOUT_MS = 2_500;
const OK_CACHE_MS = 10_000;
const OFF_CACHE_MS = 5_000;

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok'> & { json(): Promise<unknown> }>;

@Injectable()
export class MediaServiceProbe {
  private readonly logger = new Logger(MediaServiceProbe.name);
  private readonly readyUrl: string;
  private readonly token: string | undefined;
  private cached: { answer: ProbeAnswer; until: number } | null = null;
  private inFlight: Promise<ProbeAnswer> | null = null;
  private lastLogged: string | null = null;
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
    return (await this.read()).state;
  }

  /** Module 15: where long speech goes, from the same answer; no lane while the service is off. */
  async hostedLane(): Promise<HostedLaneState> {
    return (await this.read()).lane;
  }

  private read(): Promise<ProbeAnswer> {
    if (this.cached && this.now() < this.cached.until) return Promise.resolve(this.cached.answer);
    this.inFlight ??= this.ask().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async ask(): Promise<ProbeAnswer> {
    let answer: ProbeAnswer = { state: 'off', lane: NO_HOSTED_LANE };
    try {
      const response = await this.fetcher(this.readyUrl, {
        method: 'GET',
        headers: this.token ? { 'X-PostGear-Internal': this.token } : {},
        signal: AbortSignal.timeout(MEDIA_READY_TIMEOUT_MS),
        redirect: 'error',
      });
      if (response.ok) answer = { state: 'ok', lane: hostedLaneFrom(await bodyOf(response)) };
    } catch {
      answer = { state: 'off', lane: NO_HOSTED_LANE };
    }
    const { state, lane } = answer;
    const summary = lane.on
      ? `${state}, hosted lane ${lane.provider} above ${lane.aboveMinutes} min`
      : state;
    if (summary !== this.lastLogged) {
      // Once per change, never the address or the token.
      this.logger.log(`media service is ${summary}`);
      this.lastLogged = summary;
    }
    this.cached = { answer, until: this.now() + (state === 'ok' ? OK_CACHE_MS : OFF_CACHE_MS) };
    return answer;
  }
}
