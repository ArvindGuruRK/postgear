/**
 * Words and small rules for the Workflows list and the template gallery
 * (Module 05, blueprint section 9). Pure, so the copy is unit tested.
 */
import { CONNECTION_KINDS, getDefinition, PUBLISH_PLATFORMS } from '@postgear/automation';
import type {
  AutomationListItem,
  AutomationRunStatus,
  AutomationStatus,
  TemplateSummary,
} from '@/types/workflows';

type BadgeVariant = 'primary' | 'secondary' | 'danger' | 'accent' | 'success' | 'outline' | 'ai';

export const STATUS_FILTERS: readonly { id: AutomationStatus | 'ALL'; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'ACTIVE', label: 'Active' },
  { id: 'PAUSED', label: 'Paused' },
  { id: 'DRAFT', label: 'Draft' },
];

export const WORKFLOW_STATUS: Record<AutomationStatus, { label: string; variant: BadgeVariant }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  ACTIVE: { label: 'Active', variant: 'success' },
  PAUSED: { label: 'Paused', variant: 'secondary' },
};

export const RUN_WORDS: Record<AutomationRunStatus, { label: string; variant: BadgeVariant }> = {
  QUEUED: { label: 'Waiting', variant: 'outline' },
  RUNNING: { label: 'Running', variant: 'primary' },
  WAITING: { label: 'Waiting For Review', variant: 'secondary' },
  SUCCEEDED: { label: 'Succeeded', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'danger' },
  CANCELLED: { label: 'Cancelled', variant: 'outline' },
  REJECTED: { label: 'Rejected', variant: 'outline' },
  EXPIRED: { label: 'Expired', variant: 'outline' },
};

export const NO_WORKFLOWS = 'No workflows yet. Start from a template or build your own.';
export const NO_MATCHES = 'No workflows match that filter.';

/** The trigger column: its title and icon, or a prompt when there is none yet. */
export function triggerText(triggerType: string | null): { title: string; icon: string | null } {
  if (!triggerType) return { title: 'No trigger yet', icon: null };
  const def = getDefinition(triggerType);
  return def ? { title: def.title, icon: def.icon } : { title: 'Unknown trigger', icon: null };
}

/** "Never run", or the run's words; the failure reason goes in a tooltip. */
export function lastRunText(item: Pick<AutomationListItem, 'lastRunStatus'>): {
  label: string;
  variant: BadgeVariant;
} | null {
  return item.lastRunStatus ? RUN_WORDS[item.lastRunStatus] : null;
}

export function runsText(count: number): string {
  if (count === 0) return 'No runs';
  return count === 1 ? '1 run' : `${count} runs`;
}

/** "Uses: Google Sheets, Slack" from what a template needs. */
export function usesText(template: Pick<TemplateSummary, 'needs'>): string | null {
  const names = template.needs.map((need) => {
    if (need === 'channel') return 'Channel';
    if (need === 'google') return 'Google Sheets';
    return CONNECTION_KINDS.find((kind) => kind.kind === need)?.title ?? need;
  });
  return names.length ? `Uses: ${names.join(', ')}` : null;
}

export type RowAction = 'open' | 'duplicate' | 'activate' | 'pause' | 'delete';

/**
 * A row's menu (blueprint 9): Open, Duplicate, then Activate or Pause for
 * workspace admins only (members cannot turn workflows on or off), then
 * Delete.
 */
export function rowActions(
  item: Pick<AutomationListItem, 'status'>,
  canManage: boolean,
): RowAction[] {
  const live: RowAction[] = canManage ? [item.status === 'ACTIVE' ? 'pause' : 'activate'] : [];
  return ['open', 'duplicate', ...live, 'delete'];
}

export const ROW_ACTION_LABELS: Record<RowAction, string> = {
  open: 'Open',
  duplicate: 'Duplicate',
  activate: 'Activate',
  pause: 'Pause',
  delete: 'Delete',
};

/** The delete confirm's sentence, warning when the workflow is on. */
export function deleteWorkflowWarning(item: Pick<AutomationListItem, 'status'>): string {
  return item.status === 'ACTIVE'
    ? 'It is on now: it stops at once and its runs are kept. This cannot be undone.'
    : 'Its runs are kept. This cannot be undone.';
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3_600_000],
  ['month', 30 * 24 * 3_600_000],
  ['week', 7 * 24 * 3_600_000],
  ['day', 24 * 3_600_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "5 minutes ago", "yesterday", "just now". */
export function ago(iso: string, now: number = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  if (!Number.isFinite(diff)) return '';
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return RELATIVE.format(Math.round(diff / size), unit);
  }
  return 'just now';
}

/** Publish platforms by icon key, so a template's app list can show the right logo. */
export const PLATFORM_ICONS = new Set<string>(PUBLISH_PLATFORMS.map((platform) => platform.icon));
