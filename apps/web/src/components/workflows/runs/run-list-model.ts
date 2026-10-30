/**
 * Words and small rules for the Runs tab's run list (Module 08, blueprint
 * 7.3): the filters and the query each one sends, how one row reads, and
 * how pages of runs join. Pure, so the copy is unit tested.
 */
import { getDefinition } from '@postgear/automation';
import type { RunListQuery } from '@/lib/workflows-api';
import type { AutomationRunStatus, RunSummary, WorkspaceCatalog } from '@/types/workflows';
import { ago } from '../list/workflows-view-model';
import { isTerminalRun } from './run-model';
import { formatDuration, RUN_STATUS, type RunTone } from './run-words';

export type BadgeVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'success' | 'outline';

/** A run's tone as a sticker. Neutral outcomes (Rejected, Review Expired) are never red. */
export const TONE_BADGE: Record<RunTone, BadgeVariant> = {
  neutral: 'outline',
  running: 'primary',
  waiting: 'secondary',
  success: 'success',
  danger: 'danger',
};

export type RunFilter = 'all' | 'succeeded' | 'failed' | 'waiting' | 'test';

export const RUN_FILTERS: readonly { value: RunFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'test', label: 'Test' },
];

/** What each filter asks `GET /automations/:id/runs` for. */
export function filterQuery(filter: RunFilter): Omit<RunListQuery, 'cursor'> {
  switch (filter) {
    case 'succeeded':
      return { status: 'SUCCEEDED' };
    case 'failed':
      return { status: 'FAILED' };
    case 'waiting':
      return { status: 'WAITING' };
    case 'test':
      return { mode: 'TEST' };
    default:
      return {};
  }
}

export const NO_RUNS = 'No runs yet. Test the workflow and its runs show up here.';
export const NO_MATCHING_RUNS = 'No runs match this filter.';
export const RUNS_NOT_LOADED = 'The runs could not be loaded.';

/** The trigger phrase: what the API wrote, else the trigger's own title. */
export function triggerPhrase(
  run: Pick<RunSummary, 'triggerSummary' | 'triggerType'>,
  catalog: WorkspaceCatalog | null,
): string {
  if (run.triggerSummary) return run.triggerSummary;
  const entry = catalog?.steps.find((step) => step.type === run.triggerType);
  return entry?.title ?? getDefinition(run.triggerType)?.title ?? 'Trigger';
}

/** The exact time, for a hover: "29 Oct 2026, 14:02:11". */
export function exactTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

/** How long a finished run took; nothing while it is still going. */
export function runDuration(run: Pick<RunSummary, 'startedAt' | 'finishedAt'>): string {
  if (!run.startedAt || !run.finishedAt) return '';
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  return Number.isFinite(ms) ? formatDuration(ms) : '';
}

export function creditsText(credits: number): string | null {
  if (!(credits > 0)) return null;
  return credits === 1 ? '1 Credit' : `${credits} Credits`;
}

export interface RunRowView {
  status: { label: string; variant: BadgeVariant };
  mode: 'Test' | 'Live';
  trigger: string;
  /** "5 minutes ago". */
  started: string;
  /** The exact time, shown on hover. */
  startedExact: string;
  startedIso: string | null;
  duration: string;
  /** "v3", live runs only. */
  version: string | null;
  credits: string | null;
}

export function runRowView(
  run: RunSummary,
  catalog: WorkspaceCatalog | null,
  now: number = Date.now(),
): RunRowView {
  const words = RUN_STATUS[run.status];
  const startedIso = run.startedAt ?? run.createdAt;
  return {
    status: { label: words.label, variant: TONE_BADGE[words.tone] },
    mode: run.mode === 'TEST' ? 'Test' : 'Live',
    trigger: triggerPhrase(run, catalog),
    started: startedIso ? ago(startedIso, now) : '',
    startedExact: exactTime(startedIso),
    startedIso,
    duration: runDuration(run),
    version: run.mode === 'LIVE' && run.version !== null ? `v${run.version}` : null,
    credits: creditsText(run.creditsUsed),
  };
}

/** The next page joined onto the list: a run never shows twice. */
export function appendPage(
  current: readonly RunSummary[],
  page: readonly RunSummary[],
): RunSummary[] {
  const seen = new Set(current.map((run) => run.id));
  return [...current, ...page.filter((run) => !seen.has(run.id))];
}

/** What the open run's live stream says about its row. */
export interface RunPatch {
  id: string;
  status: AutomationRunStatus;
  startedAt: string | null;
  finishedAt: string | null;
}

/** The row with the open run's latest state, so the list never lags the detail. */
export function patchRuns(runs: readonly RunSummary[], patch: RunPatch | null): RunSummary[] {
  if (!patch) return runs as RunSummary[];
  return runs.map((run) => {
    if (run.id !== patch.id) return run;
    if (isTerminalRun(run.status) && !isTerminalRun(patch.status)) return run;
    if (
      run.status === patch.status &&
      run.startedAt === patch.startedAt &&
      run.finishedAt === patch.finishedAt
    ) {
      return run;
    }
    return {
      ...run,
      status: patch.status,
      startedAt: patch.startedAt,
      finishedAt: patch.finishedAt,
    };
  });
}
