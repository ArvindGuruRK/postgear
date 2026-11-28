/**
 * What Clips costs us (Sprint 13, Module 15 section 3): the price table as
 * code, and `estimate`, which turns a finished job's facts into US cents.
 *
 * Every figure carries its `source` and the day it was `checked`. They come
 * only from research 07 (`docs/sprint-13/research/07-cost-deploy-and-risks.md`,
 * sections 1, 2 and 6) and the hosting guide
 * (`docs/launch-readiness/05-hosting-and-costs.md`): no code ever reads a
 * price page. When a figure changes, change it here with its new `checked`
 * day and move `CLIP_PRICES_DATE`, so a job priced by the old table can be
 * told apart by its `cost.prices`.
 *
 * ## How a job is priced
 *
 * - **Processor seconds**: a job on our own box holds a share of the media
 *   box for as long as it runs. `processorSeconds` is vCPU-seconds (seconds
 *   run times the vCPUs its kind holds, `KIND_VCPUS`), priced at the box's
 *   hourly price divided by its vCPUs and by 3,600.
 * - **Storage**: the first month of what a job keeps (an import's files, a
 *   sharp copy, an export); a download, a Preview Export and an emote live
 *   one day. Holding files longer is the storage row of the cost table, not
 *   a job's cost.
 * - **Hosted units**: audio seconds for a hosted listener, model tokens in
 *   and out, and pictures for the vision check (each picture is
 *   `pictureTokens` model tokens in). An AI engine name the table does not
 *   know (`simulation`, a model added later) is priced as `DEFAULT_MODEL`.
 *
 * Nothing here is shown to a workspace: only the operator's Costs tab reads it.
 */
import { CLIP_STILL_BURSTS_MAX, CLIP_STILLS_PER_BURST } from '@postgear/scheduling';
import type { ClipJobKind } from '@postgear/video-engine';

export interface PriceFigure {
  readonly value: number;
  readonly unit: string;
  readonly source: string;
  /** The day the figure was read, `YYYY-MM-DD`. */
  readonly checked: string;
}

export interface ModelPrice {
  readonly inPerMillion: number;
  readonly outPerMillion: number;
  readonly unit: string;
  readonly source: string;
  readonly checked: string;
}

/** The day this table's figures were read. A job's `cost.prices` names it. */
export const CLIP_PRICES_DATE = '2026-11-14';

const R07 = 'research 07';

export const CLIP_PRICES = {
  eurToUsd: {
    value: 1.1,
    unit: 'USD per EUR',
    source: `${R07}, header (assumption)`,
    checked: '2026-11-14',
  },
  /** The media box: research 07's separate media box (ladder step 1), Hetzner CCX33. */
  box: {
    value: 0.1891,
    unit: 'EUR an hour, Hetzner CCX33 (8 dedicated vCPU, 32 GB)',
    source: `hetzner.com/cloud/general-purpose, verified (${R07} section 1)`,
    checked: '2026-11-14',
  },
  boxVcpus: {
    value: 8,
    unit: 'vCPU in the media box',
    source: `hetzner.com/cloud/general-purpose, verified (${R07} section 1)`,
    checked: '2026-11-14',
  },
  /**
   * Not used to price (the box above is): Railway's usage price, for the cost
   * table's cross-check. About $0.027 a vCPU-hour against the box's $0.026.
   */
  railwayVcpuMonth: {
    value: 20,
    unit: 'USD per vCPU a month, billed by use (Railway)',
    source: 'docs/launch-readiness/05-hosting-and-costs.md section 1 (reported)',
    checked: '2026-11-12',
  },
  storage: {
    value: 0.015,
    unit: 'USD per GB a month (Cloudflare R2; egress free)',
    source: `developers.cloudflare.com/r2/pricing, verified (${R07} section 1)`,
    checked: '2026-11-14',
  },
  listenerMinSeconds: {
    value: 10,
    unit: 'seconds billed at least (Groq, per request; counted per job here)',
    source: `console.groq.com/docs/speech-to-text, verified (${R07} section 1)`,
    checked: '2026-11-14',
  },
} as const satisfies Record<string, PriceFigure>;

/** The hosted listeners, by the name a TRANSCRIBE job's output gives (`groq:<model>`). */
export const LISTENER_PRICES: Readonly<Record<string, PriceFigure>> = {
  'groq:whisper-large-v3-turbo': {
    value: 0.04,
    unit: 'USD an audio hour',
    source: `console.groq.com/docs/speech-to-text, verified (${R07} section 1)`,
    checked: '2026-11-14',
  },
  'groq:whisper-large-v3': {
    value: 0.111,
    unit: 'USD an audio hour',
    source: `console.groq.com/docs/speech-to-text, verified (${R07} section 1)`,
    checked: '2026-11-14',
  },
};

const OPENAI_PRICING = `developers.openai.com/api/docs/pricing, verified (${R07} section 1)`;

/** Model tokens, by model id (the part after `openai:`, or after `openrouter:openai/`). */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  'gpt-4.1-mini': {
    inPerMillion: 0.4,
    outPerMillion: 1.6,
    unit: 'USD per million tokens',
    source: `${OPENAI_PRICING}; PostGear's model today`,
    checked: '2026-11-14',
  },
  'gpt-6-luna': {
    inPerMillion: 0.1,
    outPerMillion: 0.5,
    unit: 'USD per million tokens',
    source: `${OPENAI_PRICING}; the named replacement of gpt-4.1-mini`,
    checked: '2026-11-14',
  },
  'gpt-5-mini': {
    inPerMillion: 0.25,
    outPerMillion: 2,
    unit: 'USD per million tokens',
    source: OPENAI_PRICING,
    checked: '2026-11-14',
  },
};

/** What an AI engine name the table does not know is priced as. */
export const DEFAULT_MODEL = 'gpt-4.1-mini';

/**
 * The per-minute figures behind an estimate (`estimated: true`): the API
 * never sees the provider's token count (`structured` answers the parsed
 * value only), so tokens are worked out from the minutes read.
 */
export const CLIP_ESTIMATES = {
  readTokensInPerHour: {
    value: 16_000,
    unit: 'model tokens in per hour read, one pass, with the windows overlapping',
    source: `${R07} section 2, LLM highlight scoring (assumption)`,
    checked: '2026-11-14',
  },
  readTokensOutPerHour: {
    value: 2_500,
    unit: 'model tokens out per hour read, one pass',
    source: `${R07} section 2, LLM highlight scoring (assumption)`,
    checked: '2026-11-14',
  },
  readPasses: {
    value: 2,
    unit: 'passes: the moment pick, then the titles (counted the same size)',
    source: `${R07} section 2 ("a second pass for titles and reasons", assumption)`,
    checked: '2026-11-14',
  },
  transcriptTokensPerHour: {
    value: 12_000,
    unit: 'transcript tokens per hour of speech (150 words a minute); a translation is as long',
    source: `${R07} section 2 (assumption)`,
    checked: '2026-11-14',
  },
  pictureTokens: {
    value: 500,
    unit: 'model tokens in per picture',
    source: `${R07} section 2, vision checks (assumption)`,
    checked: '2026-11-14',
  },
  visionPictures: {
    value: CLIP_STILL_BURSTS_MAX * CLIP_STILLS_PER_BURST,
    unit: 'pictures one vision check sends at most (12 bursts of 4 stills)',
    source: 'CLIP_STILL_BURSTS_MAX and CLIP_STILLS_PER_BURST in @postgear/scheduling (the code)',
    checked: '2026-11-28',
  },
  ownListenRealTime: {
    value: 1,
    unit: 'seconds of the whole box per second of sound, large-v3-turbo on our own processors',
    source: `${R07} section 2 (assumption from research 04); Module 02 measured only small`,
    checked: '2026-11-14',
  },
} as const satisfies Record<string, PriceFigure>;

/**
 * The vCPUs a job of each kind holds on an 8 vCPU media box while it runs,
 * from research 07 section 6 (concurrency per worker): `postgear-media` runs
 * 4 at once (2 vCPU each), a render takes a 4 vCPU slot (an x264 encode uses
 * every core; research 07 section 3: a CCX33 offers two slots), listening on
 * our own processors takes every thread, faces and the voice run 2 at once
 * on the Python service. Translating and Auto-Edit's last step run in the
 * API (0: no box of their own).
 */
export const KIND_VCPUS: Readonly<Record<ClipJobKind, number>> = {
  IMPORT: 2,
  SEGMENT: 2,
  HIGHLIGHTS: 2,
  RENDER: 4,
  DOWNLOAD: 2,
  TRANSCRIBE: 8,
  FACES: 4,
  TRANSLATE: 0,
  SPEECH: 4,
  AUTO_EDIT: 0,
  EMOTE: 2,
};

/** Months of storage a job's files are counted for. */
export const STORAGE_MONTHS = { kept: 1, oneDay: 1 / 30 } as const;

/** Bytes in a GB, decimal (R2 bills decimal GB; the same as `clips.units`). */
export const BYTES_PER_GB = 1_000_000_000;

// ---- Facts and the estimate ----------------------------------------------------------

/** What a job used. Every unit is optional: a kind records the ones it has. */
export interface ClipCostUnits {
  /** vCPU-seconds on our own box. */
  processorSeconds?: number;
  /** GB kept, times the months counted. */
  storedGbMonths?: number;
  /** Seconds of sound sent to (or listened to by) the listener. */
  audioSeconds?: number;
  tokensIn?: number;
  tokensOut?: number;
  /** Pictures shown to the model by the vision check. */
  pictures?: number;
}

/** What `ClipJob.cost` holds (with `cents` added when it is written). */
export interface ClipCostFacts {
  /** Seconds of video the job worked on. */
  videoSeconds: number;
  /** From `startedAt` to `finishedAt`; 0 for a job that never started. */
  ranSeconds: number;
  /**
   * Who did it: `ffmpeg` (our box), `media-service` (the Python service on
   * our box), a listener (`faster-whisper:small`, `groq:whisper-large-v3-turbo`,
   * `simulation`), an AI engine (`openai:gpt-4.1-mini`, `simulation`), `api`.
   */
  provider: string;
  units: ClipCostUnits;
  /** True when any unit was worked out from research 07's figures rather than read. */
  estimated: boolean;
  /** `CLIP_PRICES_DATE` of the table that priced it. */
  prices: string;
}

/** A positive finite number, or 0. */
function amount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Cents to a micro-dollar (4 decimals): small jobs cost fractions of a cent. */
export function roundCents(cents: number): number {
  return Math.round(cents * 10_000) / 10_000;
}

/** US cents one vCPU-second on the media box costs. */
export function processorCentsPerSecond(): number {
  return (
    (CLIP_PRICES.box.value * CLIP_PRICES.eurToUsd.value * 100) / CLIP_PRICES.boxVcpus.value / 3600
  );
}

/** The hosted listener's price, or null when the provider is our own box or unknown. */
export function hostedListenerPrice(provider: string): PriceFigure | null {
  return Object.hasOwn(LISTENER_PRICES, provider) ? (LISTENER_PRICES[provider] ?? null) : null;
}

/** True for a provider that is a hosted listener (`groq:...`), priced per audio hour. */
export function isHostedListener(provider: string): boolean {
  return provider.startsWith('groq:');
}

/**
 * The token price of an AI engine name: `openai:gpt-4.1-mini`,
 * `openrouter:openai/gpt-5-mini`. Anything else (`simulation`, `unknown`, a
 * model added later) is `DEFAULT_MODEL`'s price.
 */
export function modelPriceOf(provider: string): ModelPrice {
  const afterPrefix = provider.includes(':') ? provider.slice(provider.indexOf(':') + 1) : provider;
  const id = afterPrefix.includes('/')
    ? afterPrefix.slice(afterPrefix.lastIndexOf('/') + 1)
    : afterPrefix;
  const found = Object.hasOwn(MODEL_PRICES, id) ? MODEL_PRICES[id] : undefined;
  return found ?? (MODEL_PRICES[DEFAULT_MODEL] as ModelPrice);
}

/** The vCPUs a job holds: a kind's share, none while a hosted listener does the work. */
export function vcpusFor(kind: ClipJobKind, provider: string): number {
  if (kind === 'TRANSCRIBE' && isHostedListener(provider)) return 0;
  return KIND_VCPUS[kind] ?? 0;
}

/**
 * The cost of a job in US cents, to a micro-dollar (4 decimals). Processor
 * seconds come from `units.processorSeconds`, or from the seconds run times
 * the kind's vCPUs when a caller left them out. Pinned by `clip-prices.spec.ts`.
 */
export function estimate(facts: ClipCostFacts, kind: ClipJobKind): number {
  const units = facts.units;
  const processorSeconds =
    units.processorSeconds !== undefined
      ? amount(units.processorSeconds)
      : amount(facts.ranSeconds) * vcpusFor(kind, facts.provider);
  let cents = processorSeconds * processorCentsPerSecond();

  cents += amount(units.storedGbMonths) * CLIP_PRICES.storage.value * 100;

  const listener = hostedListenerPrice(facts.provider);
  const audio = amount(units.audioSeconds);
  if (listener && audio > 0) {
    const billed = Math.max(audio, CLIP_PRICES.listenerMinSeconds.value);
    cents += (billed / 3600) * listener.value * 100;
  }

  const tokensIn = amount(units.tokensIn);
  const tokensOut = amount(units.tokensOut);
  const pictures = amount(units.pictures);
  if (tokensIn > 0 || tokensOut > 0 || pictures > 0) {
    const model = modelPriceOf(facts.provider);
    const pictureTokens = pictures * CLIP_ESTIMATES.pictureTokens.value;
    cents += ((tokensIn + pictureTokens) * model.inPerMillion * 100) / 1_000_000;
    cents += (tokensOut * model.outPerMillion * 100) / 1_000_000;
  }

  return roundCents(cents);
}
