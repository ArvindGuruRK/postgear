/**
 * Words and small rules for turning a workflow on and off (Module 09,
 * blueprint 8): what the activation dialog shows, the status badge, the
 * Manual trigger's fields for Run Now, the versions list, and what each
 * refusal from the API says. Pure, so the copy and the choices are unit
 * tested.
 */
import {
  type AutomationGraph,
  describeWorkflow,
  type GraphNode,
  isTriggerType,
  riskSummary,
  type SummaryContext,
  scheduleConfigSchema,
  type ValidationIssue,
} from '@postgear/automation';
import { ApiError } from '@/lib/api';
import type { AutomationStatus, VersionSummary, WorkspaceCatalog } from '@/types/workflows';
import { upcomingRuns } from '../fields/schedule-model';
import { ago, WORKFLOW_STATUS } from '../list/workflows-view-model';

type BadgeVariant = (typeof WORKFLOW_STATUS)[AutomationStatus]['variant'];

/* Copy */

export const ADMINS_ONLY = 'Only workspace admins can turn workflows on.';
export const ADMINS_ONLY_PAUSE = 'Only workspace admins can pause workflows.';
export const AUTOMATIC_POSTING_TICK = 'I understand posts will go out automatically.';
export const TURNED_ON = 'Workflow turned on.';
export const PAUSED = 'Workflow paused.';
export const CHANGES_DISCARDED = 'Changes discarded.';
export const STALE = 'This workflow changed. Reload and try again.';
export const NOT_SAVED = 'Your latest edits are not saved yet. Try again in a moment.';
export const PAUSE_RUNS_FINISH =
  'Runs in progress finish. No new runs start until you turn it back on.';
export const PAUSE_NO_CATCH_UP = 'Missed runs will not be caught up when you turn it back on.';
export const NO_VERSIONS = 'No versions yet. Turning the workflow on saves the first one.';
export const NOTE_MAX = 280;

/* The trigger */

export function triggerOf(graph: AutomationGraph): GraphNode | undefined {
  return graph.nodes.find((node) => isTriggerType(node.type));
}

export function isScheduleTrigger(triggerType: string | null | undefined): boolean {
  return triggerType === 'trigger.schedule';
}

/* The status badge */

/** "Draft", "Active v3", "Paused": the list's words, with the live version when there is one. */
export function statusBadge(
  status: AutomationStatus,
  activeVersion: number | null,
): { label: string; variant: BadgeVariant } {
  const base = WORKFLOW_STATUS[status];
  return status === 'ACTIVE' && activeVersion !== null
    ? { ...base, label: `Active v${activeVersion}` }
    : base;
}

/** Only a workflow that has a live version can have changes that are not live yet. */
export function showsUnpublishedChanges(automation: {
  status: AutomationStatus;
  hasUnpublishedChanges: boolean;
}): boolean {
  return automation.status !== 'DRAFT' && automation.hasUnpublishedChanges;
}

/** Run Now: a live run of an active workflow started by hand. */
export function canRunNow(status: AutomationStatus, graph: AutomationGraph): boolean {
  return status === 'ACTIVE' && triggerOf(graph)?.type === 'trigger.manual';
}

/* The activation dialog */

/**
 * The draft's issues plus the steps the worker cannot run yet: the browser
 * checks the draft without that list (the API has the last word), so the
 * catalog's `runnable: false` is added here rather than learnt from a 422.
 */
export function activationIssues(
  graph: AutomationGraph,
  issues: readonly ValidationIssue[],
  catalog: Pick<WorkspaceCatalog, 'steps'> | null,
): ValidationIssue[] {
  if (!catalog) return [...issues];
  const byType = new Map(catalog.steps.map((step) => [step.type, step]));
  const known = new Set(issues.map((issue) => `${issue.code}|${issue.nodeKey ?? ''}`));
  const extra: ValidationIssue[] = [];
  for (const node of graph.nodes) {
    if (node.disabled) continue;
    const step = byType.get(node.type);
    if (!step || step.runnable) continue;
    if (known.has(`node.not_runnable|${node.key}`) || known.has(`node.coming_soon|${node.key}`)) {
      continue;
    }
    extra.push({
      severity: 'error',
      code: 'node.not_runnable',
      message: step.reason ?? `${step.title} cannot run yet.`,
      nodeKey: node.key,
    });
  }
  return [...issues, ...extra];
}

export type ActivationContent =
  | { kind: 'issues'; issues: ValidationIssue[] }
  | {
      kind: 'confirm';
      /** "When a post is published, this workflow will send a Slack message." */
      sentence: string;
      /** "Uses about 12 AI credits per run.", or null without AI steps. */
      credits: string | null;
      /** A Schedule's next three runs in its own zone; empty otherwise. */
      scheduleRuns: string[];
      /** Posts can go out without a review: the extra tick. */
      needsTick: boolean;
    };

export function creditsText(credits: number): string | null {
  if (!(credits > 0)) return null;
  return credits === 1
    ? 'Uses about 1 AI credit per run.'
    : `Uses about ${credits} AI credits per run.`;
}

/** The next three runs of a Schedule trigger, or nothing for any other trigger. */
export function scheduleRunsOf(graph: AutomationGraph, nowIso: string, locale?: string): string[] {
  const trigger = triggerOf(graph);
  if (trigger?.type !== 'trigger.schedule') return [];
  const parsed = scheduleConfigSchema.safeParse(trigger.config);
  return parsed.success ? upcomingRuns(parsed.data, nowIso, locale) : [];
}

/**
 * What the dialog shows: the errors to fix first, if there are any (warnings
 * never block), else the sentence, the credits, the schedule and the tick.
 */
export function activationContent(
  graph: AutomationGraph,
  issues: readonly ValidationIssue[],
  options: { summary?: SummaryContext; nowIso: string; locale?: string },
): ActivationContent {
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) return { kind: 'issues', issues: errors };
  const risk = riskSummary(graph);
  return {
    kind: 'confirm',
    sentence: describeWorkflow(graph, options.summary ?? {}),
    credits: creditsText(risk.aiCreditsPerRun),
    scheduleRuns: scheduleRunsOf(graph, options.nowIso, options.locale),
    needsTick: risk.publishesWithoutReview,
  };
}

/** Turn On waits for the tick when posts go out on their own. */
export function canTurnOn(needsTick: boolean, ticked: boolean, busy: boolean): boolean {
  return !busy && (!needsTick || ticked);
}

/** The success toast: turning on says so; Activate Changes names the new live version. */
export function activatedToast(wasActive: boolean, version: number): string {
  return wasActive ? `Version ${version} is live.` : TURNED_ON;
}

/* Refusals */

function apiMessage(cause: ApiError, fallback: string): string {
  return cause.message.trim() ? cause.message : fallback;
}

export interface ActivateFailure {
  message: string;
  /** The API wants the automatic posting tick the dialog did not show. */
  needsTick: boolean;
}

/**
 * Activate's refusals in words: 403 for members, 409 when the draft moved
 * under the dialog, 422 `activation_blocked`, `confirm_automatic_posting`
 * and `schedule_too_frequent` with the API's own sentence.
 */
export function activateFailure(cause: unknown): ActivateFailure {
  const fallback = 'The workflow was not turned on. Try again.';
  if (!(cause instanceof ApiError) || cause.status === 0) {
    return { message: fallback, needsTick: false };
  }
  if (cause.status === 403) return { message: ADMINS_ONLY, needsTick: false };
  if (cause.status === 409) return { message: STALE, needsTick: false };
  if (cause.code === 'confirm_automatic_posting') {
    return {
      message: apiMessage(cause, 'Confirm that posts will go out automatically.'),
      needsTick: true,
    };
  }
  return { message: apiMessage(cause, fallback), needsTick: false };
}

/** Saving the latest edits before activating or restoring did not work. */
export function saveFirstFailure(cause: unknown): string {
  return cause instanceof ApiError && cause.status === 409 ? STALE : NOT_SAVED;
}

export function pauseFailure(cause: unknown): string {
  const fallback = 'The workflow was not paused. Try again.';
  if (!(cause instanceof ApiError) || cause.status === 0) return fallback;
  if (cause.status === 403) return ADMINS_ONLY_PAUSE;
  return apiMessage(cause, fallback);
}

export function discardFailure(cause: unknown): string {
  const fallback = 'The changes were not discarded. Try again.';
  if (!(cause instanceof ApiError) || cause.status === 0) return fallback;
  if (cause.code === 'no_active_version') {
    return apiMessage(cause, 'There is no live version to go back to.');
  }
  return apiMessage(cause, fallback);
}

export function runNowFailure(cause: unknown): string {
  const fallback = 'The run did not start. Try again.';
  if (!(cause instanceof ApiError) || cause.status === 0) return fallback;
  return apiMessage(cause, fallback);
}

export function restoreFailure(cause: unknown): string {
  const fallback = 'That version was not restored. Try again.';
  if (!(cause instanceof ApiError) || cause.status === 0) return fallback;
  if (cause.status === 409) return STALE;
  return apiMessage(cause, fallback);
}

/* Pause */

/** The pause dialog's sentences; a Schedule adds that missed runs are not caught up. */
export function pauseLines(triggerType: string | null | undefined): string[] {
  return isScheduleTrigger(triggerType)
    ? [PAUSE_RUNS_FINISH, PAUSE_NO_CATCH_UP]
    : [PAUSE_RUNS_FINISH];
}

/* Discard */

export function discardText(activeVersion: number | null): string {
  return activeVersion === null
    ? 'The draft goes back to the live version. Edits made since then are lost.'
    : `The draft goes back to version ${activeVersion}, the live one. Edits made since then are lost.`;
}

/* Versions */

export function versionTitle(version: number): string {
  return `Version ${version}`;
}

/** "Turned on by Priya, 2 hours ago". */
export function versionByline(
  summary: Pick<VersionSummary, 'createdAt' | 'createdBy'>,
  now: number = Date.now(),
): string {
  const when = ago(summary.createdAt, now);
  return summary.createdBy
    ? `Turned on by ${summary.createdBy.name}, ${when}`
    : `Turned on ${when}`;
}

export function previewBannerText(version: number): string {
  return `Viewing version ${version}.`;
}

export function restoredToast(version: number): string {
  return `Version ${version} copied into the draft.`;
}

/* Manual trigger fields (Run Now and the test of a Manual workflow) */

export interface ManualField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'choice';
  required: boolean;
  options: string[];
}

/** The `trigger.manual` step's `config.fields`, read defensively (a draft can be half set up). */
export function manualFields(
  trigger: Pick<GraphNode, 'type' | 'config'> | undefined,
): ManualField[] {
  if (trigger?.type !== 'trigger.manual') return [];
  const fields = Array.isArray(trigger.config.fields) ? trigger.config.fields : [];
  return fields.flatMap((raw): ManualField[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const field = raw as Record<string, unknown>;
    if (typeof field.key !== 'string' || !field.key) return [];
    const label = typeof field.label === 'string' && field.label.trim() ? field.label : field.key;
    const type = field.type === 'number' || field.type === 'choice' ? field.type : 'text';
    const options = Array.isArray(field.options)
      ? field.options.filter((option): option is string => typeof option === 'string')
      : [];
    return [{ key: field.key, label, type, required: field.required === true, options }];
  });
}

/** "Enter your topic". */
export function manualPlaceholder(field: Pick<ManualField, 'label'>): string {
  return `Enter your ${field.label.toLowerCase()}`;
}

/**
 * Checks the typed values: required fields filled, numbers that are numbers.
 * Returns the inputs to send (numbers as numbers, empty optional fields left
 * out) or the error per field key.
 */
export function readManualInputs(
  fields: readonly ManualField[],
  values: Readonly<Record<string, string>>,
): { ok: true; inputs: Record<string, unknown> } | { ok: false; errors: Record<string, string> } {
  const inputs: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = (values[field.key] ?? '').trim();
    if (!value) {
      if (field.required) errors[field.key] = `Fill in ${field.label.toLowerCase()}.`;
      continue;
    }
    if (field.type === 'number') {
      const number = Number(value);
      if (!Number.isFinite(number)) {
        errors[field.key] = 'Enter a number.';
        continue;
      }
      inputs[field.key] = number;
      continue;
    }
    inputs[field.key] = value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, inputs };
}
