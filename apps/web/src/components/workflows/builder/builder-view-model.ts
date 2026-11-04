/**
 * Words and small rules for the builder page (Module 05): the Setup dock's
 * groups, the Finish Setup list (blueprint section 9), what a refused test says
 * and the validation context the browser checks the draft against. Pure and
 * unit tested.
 */
import {
  fieldSpecFor,
  type AutomationGraph,
  type ChannelState,
  type ConnectionState,
  type GraphNode,
  getDefinition,
  type SummaryContext,
  type ValidationContext,
  type ValidationIssue,
} from '@postgear/automation';
import type { Channel } from '@/types/channel';
import type { Connection } from '@/types/workflows';
import type { SaveStatus } from './builder-autosave';

/**
 * What the browser checks against. No `availableTypes`: which steps the
 * worker can run is the API's word on Activate, and listing every step that
 * cannot run yet would bury the real setup items.
 */
export function validationContext(
  connections: readonly Connection[],
  channels: readonly Channel[],
): ValidationContext {
  return {
    connections: connections.map(
      (connection): ConnectionState => ({
        id: connection.id,
        kind: connection.provider,
        name: connection.name,
        status: connection.status,
      }),
    ),
    channels: channels.map(
      (channel): ChannelState => ({
        id: channel.id,
        provider: channel.providerIdentifier,
        name: channel.name,
        status: channel.disabled
          ? 'disabled'
          : channel.refreshNeeded || channel.inBetweenSteps
            ? 'needsReconnect'
            : 'active',
      }),
    ),
  };
}

export function summaryContext(
  connections: readonly Connection[],
  channels: readonly Channel[],
): SummaryContext {
  return {
    connections: connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      kind: connection.provider,
    })),
    channels: channels.map((channel) => ({
      id: channel.id,
      name: channel.name,
      provider: channel.providerIdentifier,
    })),
  };
}

export interface SetupItem {
  /** The step to open, or null for a workflow-wide item (no trigger yet). */
  nodeKey: string | null;
  stepName: string;
  icon: string | null;
  message: string;
  /** The issue behind the line, so choosing it lands on the field (focus-the-field). */
  issue: ValidationIssue;
}

/** What is left before the workflow can be tested: one line per step, its first error. */
export function setupItems(
  graph: AutomationGraph,
  issues: readonly ValidationIssue[],
): SetupItem[] {
  const items: SetupItem[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (issue.severity !== 'error' || issue.code === 'node.not_runnable') continue;
    const key = issue.nodeKey ?? null;
    const id = key ?? issue.code;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = key ? graph.nodes.find((candidate) => candidate.key === key) : undefined;
    items.push({
      nodeKey: node ? node.key : null,
      stepName: node?.name ?? 'Workflow',
      icon: node ? (getDefinition(node.type)?.icon ?? null) : null,
      message: issue.message,
      issue,
    });
  }
  return items;
}

export const SETUP_DONE = 'Ready to test.';

/** A step's issues for its warning sign's tooltip: each once, naming the field when it has one. */
export function issueLines(
  definition: Parameters<typeof fieldSpecFor>[0] | undefined,
  issues: readonly ValidationIssue[],
): string[] {
  const lines = issues.map((issue) => {
    const spec =
      definition && issue.field ? fieldSpecFor(definition, issue.field)?.spec : undefined;
    return spec ? `${spec.label}: ${issue.message}` : issue.message;
  });
  return [...new Set(lines)];
}

export function issueKey(issue: ValidationIssue): string {
  return [issue.code, issue.nodeKey, issue.field, issue.token, issue.edgeId, issue.message]
    .map((part) => part ?? '')
    .join('|');
}

export interface SetupRow {
  node: GraphNode;
  /** Every error on this step, unlike `setupItems`' first one. */
  errors: ValidationIssue[];
  done: boolean;
}

/**
 * What the Setup dock lists: a row for each step with an error or with setup
 * of its own (those that need something first), the warnings, and the errors
 * that belong to no step. A step that merely cannot run yet is not setup.
 */
export function setupGroups(
  graph: AutomationGraph,
  issues: readonly ValidationIssue[],
): { steps: SetupRow[]; warnings: ValidationIssue[]; workflow: ValidationIssue[] } {
  const known = new Set(graph.nodes.map((node) => node.key));
  const relevant = issues.filter((issue) => issue.code !== 'node.not_runnable');
  const errors = relevant.filter((issue) => issue.severity === 'error');
  const rows = graph.nodes.flatMap((node): SetupRow[] => {
    const own = errors.filter((issue) => issue.nodeKey === node.key);
    const def = getDefinition(node.type, node.typeVersion);
    const hasSetup = (def?.form?.tabs.setup.length ?? 0) > 0 || def?.connection !== undefined;
    return own.length > 0 || hasSetup ? [{ node, errors: own, done: own.length === 0 }] : [];
  });
  return {
    steps: [...rows.filter((row) => !row.done), ...rows.filter((row) => row.done)],
    warnings: relevant.filter((issue) => issue.severity !== 'error'),
    workflow: errors.filter((issue) => !issue.nodeKey || !known.has(issue.nodeKey)),
  };
}

export const TEST_REFUSED_TITLE = "This workflow can't be tested yet";
export const STEP_TEST_REFUSED_TITLE = "This step can't be tested yet";

/**
 * Which steps stopped a test, for the toast: the API sends only a count. One
 * step says what to do; several name the first three. Falls back to the API's
 * own sentence if the browser's check found nothing.
 */
export function refusedTestText(items: readonly SetupItem[], fallback: string): string {
  const [first] = items;
  if (!first) return fallback;
  if (items.length === 1) return `${first.stepName}: ${first.message}`;
  const names = items.slice(0, 3).map((item) => item.stepName);
  const more = items.length > 3 ? ` and ${items.length - 3} more` : '';
  return `${items.length} steps need attention: ${names.join(', ')}${more}.`;
}

/** The save state's words beside the name. Never a toast: the words say it. */
export const SAVE_STATE_WORDS: Record<SaveStatus, string> = {
  saved: 'Saved',
  pending: 'Saving',
  saving: 'Saving',
  retrying: 'Could not save. Retrying.',
  offline: 'Offline',
  conflict: 'Not saved',
  failed: 'Not saved',
};

export const CONFLICT_MESSAGE = 'This workflow changed somewhere else.';
export const LOOP_REFUSED = 'Workflows cannot loop back to an earlier step.';
export const WORKFLOW_MISSING_MESSAGE = 'This workflow is not here. It may have been deleted.';
export const WORKFLOW_LOAD_FAILED = 'The workflow could not be loaded.';

/* ---- Module 08: the builder's tabs and the painted test run ---- */

export type BuilderTab = 'editor' | 'runs';

/** Where the builder opens: `?tab=runs`, or a `?run=` link on its own, opens the Runs tab. */
export function initialTab(
  tab: string | null | undefined,
  run: string | null | undefined,
): BuilderTab {
  return tab === 'runs' || (typeof run === 'string' && run.length > 0) ? 'runs' : 'editor';
}

/**
 * The address for a tab: the builder's own params (`tab`, `run`, `review`)
 * written for it, everything else (`step`, `setup`) left as it was. The
 * Editor drops all three; the Runs tab keeps the chosen run and the review
 * flag of a notification link.
 */
export function builderSearch(
  current: string,
  view: { tab: BuilderTab; runId: string | null; review: boolean },
): string {
  const params = new URLSearchParams(current);
  params.delete('tab');
  params.delete('run');
  params.delete('review');
  if (view.tab === 'runs') {
    params.set('tab', 'runs');
    if (view.runId) params.set('run', view.runId);
    if (view.runId && view.review) params.set('review', '1');
  }
  const search = params.toString();
  return search ? `?${search}` : '';
}

/**
 * The shape of a graph: its steps and lines, not where they sit or how they
 * are set up. A painted test run stays on the canvas while this holds, so
 * moving a step keeps the paint and adding, removing or reconnecting one
 * clears it.
 */
export function structureKey(graph: AutomationGraph): string {
  const steps = graph.nodes.map((node) => node.key).sort();
  const lines = graph.edges.map((edge) => edge.id).sort();
  return `${steps.join(',')}|${lines.join(',')}`;
}

/** A flush that could not save: Activate, Restore and Run Now wait for the save. */
export const NOT_SAVED_YET =
  'Your latest changes are not saved yet. Wait a moment for the workflow to save, then try again.';
