/**
 * Words and small rules for the builder page (Module 05): the issues chip,
 * the Finish Setup checklist (blueprint section 9) and the validation
 * context the browser checks the draft against. Pure and unit tested.
 */
import {
  type AutomationGraph,
  type ChannelState,
  type ConnectionState,
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

export const NO_ISSUES = 'No issues found';

/**
 * The issues chip (blueprint 3 and 6): "No issues found", else the errors
 * ("2 Issues", red, they block a test and turning on) and the warnings
 * ("1 Warning", amber, they do not) side by side.
 */
export function issuesChip(issues: readonly ValidationIssue[]): {
  label: string;
  errors: number;
  warnings: number;
  errorLabel: string | null;
  warningLabel: string | null;
} {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.length - errors;
  const errorLabel = errors === 0 ? null : errors === 1 ? '1 Issue' : `${errors} Issues`;
  const warningLabel =
    warnings === 0 ? null : warnings === 1 ? '1 Warning' : `${warnings} Warnings`;
  const label =
    issues.length === 0
      ? NO_ISSUES
      : [errorLabel, warningLabel].filter((part): part is string => part !== null).join(', ');
  return { label, errors, warnings, errorLabel, warningLabel };
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
export const SMALL_SCREEN_MESSAGE = 'The builder works best on a wider screen.';
export const LOOP_REFUSED = 'Workflows cannot loop back to an earlier step.';
export const WORKFLOW_MISSING_MESSAGE = 'This workflow is not here. It may have been deleted.';
export const WORKFLOW_LOAD_FAILED = 'The workflow could not be loaded.';
