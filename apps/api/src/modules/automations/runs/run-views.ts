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
import { redact } from '@postgear/automation';
import {
  type AutomationRunMode,
  AutomationRunStatus,
  type AutomationStepStatus,
  decrypt,
  type Prisma,
} from '@postgear/db';
import type { AutomationRunOptions } from '@postgear/scheduling';
import type { LatestStep, RunDetailRow, RunSummaryRow } from './automation-runs.repository';

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
  /** Test runs: what the test covered. Null for live runs. */
  options: AutomationRunOptions | null;
  startedById: string | null;
  stepCount: number;
  creditsUsed: number;
  /** One sentence. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
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
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  updatedAt: string;
}

export interface RunDetail extends RunSummary {
  triggerPayload: unknown;
  /** The graph the run executed: the draft snapshot of a test run, the version of a live one. */
  graph: unknown;
  /** The version number of a live run; null for a test run. */
  version: number | null;
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

export function toRunSummary(row: RunSummaryRow): RunSummary {
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
    error: row.error,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toRunDetail(
  row: RunDetailRow,
  steps: LatestStep[],
  connectionValues: readonly string[],
): RunDetail {
  return {
    ...toRunSummary(row),
    triggerPayload: hide(row.triggerPayload, connectionValues),
    graph: row.graphSnapshot ?? row.version?.graph ?? null,
    version: row.version?.version ?? null,
    steps: steps.map((entry) => toStepView(entry, connectionValues)),
  };
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
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
    durationMs: step.durationMs,
    updatedAt: step.updatedAt.toISOString(),
  };
}

export function toRunEvent(row: RunSummaryRow): RunEvent {
  return {
    id: row.id,
    status: row.status,
    error: row.error,
    stepCount: row.stepCount,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function hide(value: Prisma.JsonValue, connectionValues: readonly string[]): unknown {
  return value === null ? null : redact(value, { connectionValues }).value;
}

/**
 * Every secret text inside the workspace's connection credentials (each is
 * `encrypt(JSON.stringify(credentials))`): webhook links, header values,
 * tokens. A row that cannot be decrypted
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
    }
  }
  return { values: [...values], unreadable };
}

/**
 * Keys whose text is a label, not a secret: an HTTP header's `name` and
 * Google's granted `scope`. Matching "Authorization" inside every run's
 * text would hide far more than it protects.
 */
const NOT_SECRET_KEYS = new Set(['name', 'scope']);

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
