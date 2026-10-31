/**
 * What the run routes and the live progress stream send, and how it is made
 * safe on the way out.
 *
 * The worker already redacts every step row before it writes it. The API
 * redacts again before anything leaves (defence in depth, README "Module
 * 02, Redaction"): with the workspace's own connection values, so a webhook
 * link or token that slipped into a step's data some other way still comes
 * back as "[hidden]". Those values are decrypted only for the comparison
 * and never returned or logged.
 *
 * The detail route and the `step` event share one step shape, so the web
 * app applies a live event exactly as it would a fresh fetch.
 */
import { formatDate, isValidTimeZone, PUBLISH_PLATFORMS, redact } from '@postgear/automation';
import {
  type AutomationRunMode,
  AutomationRunStatus,
  type AutomationStepStatus,
  decrypt,
  type Prisma,
} from '@postgear/db';
import type { AutomationRunOptions } from '@postgear/scheduling';
import { TRIGGER_SUMMARIES } from './automation-runs.messages';
import type {
  LatestStep,
  RunDetailRow,
  RunSummaryRow,
  TriggerFacts,
} from './automation-runs.repository';

/** A run that will not change again. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<AutomationRunStatus> = new Set([
  AutomationRunStatus.SUCCEEDED,
  AutomationRunStatus.FAILED,
  AutomationRunStatus.CANCELLED,
  AutomationRunStatus.REJECTED,
  AutomationRunStatus.EXPIRED,
]);

/** One row of the run list, and the head of the detail. */
export interface RunSummary {
  id: string;
  automationId: string;
  mode: AutomationRunMode;
  status: AutomationRunStatus;
  triggerType: string;
  /** Test runs and retries: what the run covered. Null for other live runs. */
  options: AutomationRunOptions | null;
  startedById: string | null;
  stepCount: number;
  creditsUsed: number;
  /** One sentence. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** The version number a live run executed ("v3"); null for a test run. */
  version: number | null;
  /** "Post published on Instagram"; null when there is nothing beyond the trigger's title. */
  triggerSummary: string | null;
}

/** One step of a run: its latest attempt. */
export interface RunStepView {
  id: string;
  nodeKey: string;
  nodeType: string;
  nodeName: string;
  status: AutomationStepStatus;
  /** The latest attempt's number, 1 based. */
  attempt: number;
  /** How many attempts the step took ("Succeeded after 2 attempts"). */
  attempts: number;
  input: unknown;
  output: unknown;
  truncated: boolean;
  /** `AutomationStepError`: `{ message, code, retryable, details? }`. */
  error: unknown;
  /** The output ports the step fired (`out`, `true`, `approved`, `error`, ...); empty until it finishes. */
  ports: string[];
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  updatedAt: string;
}

export interface RunDetail extends RunSummary {
  triggerPayload: unknown;
  /** The graph the run executed: the draft snapshot of a test run, the version of a live one. */
  graph: unknown;
  steps: RunStepView[];
}

/** The `run` event of the live progress stream. */
export interface RunEvent {
  id: string;
  status: AutomationRunStatus;
  error: string | null;
  stepCount: number;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * A run summary. `facts` are the few trigger data fields its trigger phrase
 * needs (`AutomationRunsRepository.triggerFacts`); without them the phrase
 * is null. `connectionValues` hides a connection value in the run's error sentence
 * too; without them the sentence still goes through the secret patterns.
 */
export function toRunSummary(
  row: RunSummaryRow,
  facts?: TriggerFacts | null,
  connectionValues: readonly string[] = [],
): RunSummary {
  return {
    id: row.id,
    automationId: row.automationId,
    mode: row.mode,
    status: row.status,
    triggerType: row.triggerType,
    options: (row.options as AutomationRunOptions | null) ?? null,
    startedById: row.startedById,
    stepCount: row.stepCount,
    creditsUsed: row.creditsUsed,
    error: hideText(row.error, connectionValues),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    version: row.version?.version ?? null,
    triggerSummary: facts ? triggerSummaryOf(row.triggerType, facts) : null,
  };
}

export function toRunDetail(
  row: RunDetailRow,
  steps: LatestStep[],
  connectionValues: readonly string[],
): RunDetail {
  return {
    ...toRunSummary(row, triggerFactsOf(row.triggerPayload), connectionValues),
    triggerPayload: hide(row.triggerPayload, connectionValues),
    graph: row.graphSnapshot ?? row.version?.graph ?? null,
    steps: steps.map((entry) => toStepView(entry, connectionValues)),
  };
}

/** The trigger types whose runs have a phrase beyond the trigger's title. */
export const PHRASED_TRIGGER_TYPES: ReadonlySet<string> = new Set([
  'trigger.postPublished',
  'trigger.postFailed',
  'trigger.schedule',
]);

/** The trigger phrase fields of a run's full trigger data (the detail has it loaded). */
export function triggerFactsOf(payload: unknown): TriggerFacts {
  const data = isRecord(payload) ? payload : {};
  const post = isRecord(data.post) ? data.post : null;
  const channel = post && isRecord(post.channel) ? post.channel : null;
  return {
    provider: typeof channel?.provider === 'string' ? channel.provider : null,
    scheduledFor: typeof data.scheduledFor === 'string' ? data.scheduledFor : null,
    timeZone: typeof data.timeZone === 'string' ? data.timeZone : null,
  };
}

/**
 * The trigger phrase of a run: the platform a post event happened on, or
 * the time a schedule fired (in the schedule's own zone). Null when there
 * is nothing more than the trigger's title (a Manual run, a webhook, a post
 * with no known platform).
 */
export function triggerSummaryOf(triggerType: string, facts: TriggerFacts): string | null {
  switch (triggerType) {
    case 'trigger.postPublished':
    case 'trigger.postFailed': {
      const { provider } = facts;
      const platform = provider
        ? PUBLISH_PLATFORMS.find((entry) => entry.providers.includes(provider))
        : undefined;
      if (!platform) return null;
      return triggerType === 'trigger.postPublished'
        ? TRIGGER_SUMMARIES.postPublished(platform.title)
        : TRIGGER_SUMMARIES.postFailed(platform.title);
    }
    case 'trigger.schedule': {
      const at = facts.scheduledFor ? Date.parse(facts.scheduledFor) : Number.NaN;
      if (!Number.isFinite(at)) return null;
      const zone = facts.timeZone && isValidTimeZone(facts.timeZone) ? facts.timeZone : 'UTC';
      return TRIGGER_SUMMARIES.scheduledFor(formatDate(at, 'HH:mm', zone));
    }
    default:
      return null;
  }
}

export function toStepView(
  { step, attempts }: LatestStep,
  connectionValues: readonly string[],
): RunStepView {
  return {
    id: step.id,
    nodeKey: step.nodeKey,
    nodeType: step.nodeType,
    nodeName: step.nodeName,
    status: step.status,
    attempt: step.attempt,
    attempts,
    input: hide(step.input, connectionValues),
    output: hide(step.output, connectionValues),
    truncated: step.truncated,
    error: hide(step.error, connectionValues),
    ports: step.ports,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
    durationMs: step.durationMs,
    updatedAt: step.updatedAt.toISOString(),
  };
}

export function toRunEvent(row: RunSummaryRow, connectionValues: readonly string[] = []): RunEvent {
  return {
    id: row.id,
    status: row.status,
    error: hideText(row.error, connectionValues),
    stepCount: row.stepCount,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function hide(value: Prisma.JsonValue, connectionValues: readonly string[]): unknown {
  return value === null ? null : redact(value, { connectionValues }).value;
}

/** A run's one-sentence error, redacted like step data (Module 14). */
export function hideText(
  text: string | null,
  connectionValues: readonly string[] = [],
): string | null {
  if (text === null) return null;
  const value = redact(text, { connectionValues }).value;
  return typeof value === 'string' ? value : null;
}

/**
 * Every secret text inside the workspace's connection credentials (each is
 * `encrypt(JSON.stringify(credentials))`): webhook links, header values
 * (and the token of a "Bearer ..." value on its own), tokens. A row that cannot be decrypted
 * is counted, not thrown: its values cannot be in run data the worker wrote
 * either, since the worker could not have read them.
 */
export function connectionValuesOf(encrypted: readonly string[]): {
  values: string[];
  unreadable: number;
} {
  const values = new Set<string>();
  let unreadable = 0;
  for (const payload of encrypted) {
    let plain: string;
    try {
      plain = decrypt(payload);
    } catch {
      unreadable++;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(plain);
    } catch {
      parsed = plain;
    }
    for (const text of textsIn(parsed)) {
      if (text.length > 0) values.add(text);
      // "Bearer abc...": an app may echo the token alone (Module 14).
      const token = AUTH_SCHEME_VALUE.exec(text.trim())?.[1];
      if (token) values.add(token);
    }
  }
  return { values: [...values], unreadable };
}

/** A secret header value written with its scheme; the token after it is a secret on its own. */
const AUTH_SCHEME_VALUE = /^(?:Bearer|Basic|Token|Bot|Digest|ApiKey)\s+(\S{8,})$/i;

/**
 * Keys whose text is a label, not a secret: an HTTP header's `name` and
 * Google's granted `scope`. Matching "Authorization" inside every run's
 * text would hide far more than it protects.
 */
const NOT_SECRET_KEYS = new Set(['name', 'scope']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      NOT_SECRET_KEYS.has(key) ? [] : textsIn(item),
    );
  }
  return [];
}
