/**
 * The operator screens' words and rules (Sprint 12, Module 19 Part B), kept
 * apart from the components so the tests read them directly. The copy is the
 * spec's own (module 19 section 8, "The exact copy"); names are Title Case,
 * sentences stay sentences.
 */
import {
  type EntitlementDef,
  type EnumEntitlementDef,
  enumRank,
  formatEntitlementValue,
  formatNumber,
  getDef,
  type Key,
  REASON_MAX_LENGTH,
  REASON_MIN_LENGTH,
  TIERS,
  type Tier,
  validateValue,
} from '@postgear/entitlements';
import { SOUND_CATEGORY_NAMES, STICKER_CATEGORY_NAMES } from '@postgear/video-engine';
import type {
  EntitlementCellValue,
  LibraryItemKind,
  LibraryItemType,
  LibraryStatus,
  OperatorTab,
  PlanCell,
  PlanCellWrite,
  PlansView,
} from '@/types/operator';

// ---- Copy -------------------------------------------------------------------------

export const OPERATOR_TABS: readonly OperatorTab[] = [
  'plans',
  'overrides',
  'usage',
  'costs',
  'changes',
  'library',
];

export const OPERATOR_TAB_NAMES: Readonly<Record<OperatorTab, string>> = {
  plans: 'Plans',
  overrides: 'Workspace Overrides',
  usage: 'Usage',
  costs: 'Costs',
  changes: 'Change Log',
  library: 'Library',
};

export const OPERATOR_COPY = {
  plansBanner:
    'These values apply to every workspace on a plan, within a few seconds of saving. Edits to a plan never delete anything a workspace already has.',
  conflict:
    'Someone else changed these values while you were editing. Reload to see them, then edit again.',
  reasonLabel: 'Reason for this change',
  reasonPlaceholder: 'Enter your reason',
  reasonHelp: 'At least 10 characters. It goes in the Change Log.',
  endsOnHelp: 'Required. At most 366 days from today.',
  removeOverride: 'This workspace goes back to the value of its plan, now.',
  searchPlaceholder: 'Enter your workspace name, id or admin email',
  noWorkspace: 'No workspace matches that.',
  noOverrides: 'This workspace has no overrides. It uses the values of its plan.',
  noUsage: 'No usage this cycle.',
  noChanges: 'Nothing has been changed yet.',
  pickWorkspace: 'Search for a workspace to see its overrides and usage.',
  adjustWarning:
    'This writes a permanent ledger entry and a Change Log entry. It cannot be edited, only reversed with another adjustment.',
  publishTick: 'I listened to a sample and checked the licences.',
  creditLineMissing: 'This source needs a credit line before its items are published.',
  bigScreen: 'The operator screens are made for a bigger screen. Open them on a laptop or desktop.',
  loadFailed: 'This could not be loaded. Check the API is running, then try again.',
  costsHelp:
    'What Clips jobs cost us, beside what workspaces were charged. Days run midnight to midnight UTC. Workspaces never see this.',
  costsEstimated:
    'Model tokens and pictures are estimated from the research figures, not read from a bill.',
  noCosts: 'No Clips job finished in these days.',
  noCostUsage: 'No Clips usage in these days.',
  costsToBeforeFrom: 'Pick a To day on or after the From day.',
} as const;

/** "Saved 3 changes. They are live now." */
export function savedSentence(count: number): string {
  return count === 1
    ? 'Saved 1 change. It is live now.'
    : `Saved ${formatNumber(count)} changes. They are live now.`;
}

/** "3 changes waiting". */
export function changesWaiting(count: number): string {
  return count === 1 ? '1 change waiting' : `${formatNumber(count)} changes waiting`;
}

/** "2 overrides end within 7 days." */
export function endingSoonSentence(count: number): string {
  return count === 1
    ? '1 override ends within 7 days.'
    : `${formatNumber(count)} overrides end within 7 days.`;
}

/** "Publish 120 items from this run? They become visible to every workspace." */
export function publishRunSentence(count: number): string {
  return count === 1
    ? 'Publish 1 item from this run? It becomes visible to every workspace.'
    : `Publish ${formatNumber(count)} items from this run? They become visible to every workspace.`;
}

/** "{N} clips use this item". */
export function usageSentence(count: number): string {
  if (count === 0) return 'No clips use this item.';
  return count === 1 ? '1 clip uses this item.' : `${formatNumber(count)} clips use this item.`;
}

/** "Pro", "Free". */
export function tierName(tier: string): string {
  return tier.charAt(0) + tier.slice(1).toLowerCase();
}

// ---- Plans: cells, drafts and the review -------------------------------------------

export function cellId(tier: Tier, key: Key): string {
  return `${tier}|${key}`;
}

/** An edit waiting to be saved: a new value, or back to the seed. */
export type Draft = { kind: 'set'; value: EntitlementCellValue | undefined } | { kind: 'reset' };

export type Drafts = Readonly<Record<string, Draft>>;

/** The value a cell would hold with its draft applied. */
export function draftValue(
  cell: PlanCell,
  draft: Draft | undefined,
): EntitlementCellValue | undefined {
  if (!draft) return cell.value;
  return draft.kind === 'reset' ? cell.seed : draft.value;
}

/**
 * Applies an edit to the drafts: a value equal to what is saved drops the
 * draft (nothing to save), so the count only ever counts real changes.
 */
export function withDraft(drafts: Drafts, cell: PlanCell, draft: Draft): Drafts {
  const id = cellId(cell.tier, cell.key);
  const next = { ...drafts };
  if (draftValue(cell, draft) === cell.value && cell.valid) delete next[id];
  else next[id] = draft;
  return next;
}

export function withoutDraft(drafts: Drafts, cell: PlanCell): Drafts {
  const next = { ...drafts };
  delete next[cellId(cell.tier, cell.key)];
  return next;
}

/** The inline error for a value, in the registry's own words; null when it may be saved. */
export function valueError(key: Key, value: unknown): string | null {
  const def = getDef(key);
  if (!def) return 'This value cannot be saved.';
  const checked = validateValue(def, value);
  return checked.ok ? null : (checked.issues[0]?.message ?? 'This value cannot be saved.');
}

/** What a number field's text means: empty is "no value", commas are allowed. */
export function parseNumberText(text: string): number | undefined {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isNaN(value) ? Number.NaN : value;
}

/** The short value in a cell: "50 GB", "Unlimited", "On", "1080p". */
export function shownValue(key: Key, value: unknown): string {
  return formatEntitlementValue(key, value);
}

/** The small hint beside a cell that differs from its seed: "Seed 180". Null when equal. */
export function seedHint(key: Key, value: unknown, seed: unknown): string | null {
  if (value === seed) return null;
  const def = getDef(key);
  if (!def) return null;
  if (seed === null) return 'Seed Unlimited';
  switch (def.type) {
    case 'boolean':
      return `Seed ${seed ? 'On' : 'Off'}`;
    case 'enum':
      return `Seed ${def.optionLabels[seed as string] ?? String(seed)}`;
    default:
      return `Seed ${formatNumber(seed as number)}`;
  }
}

/** A unit after a number field: "minutes", "GB", "days", or the noun of a count. */
export function unitLabel(def: EntitlementDef): string | null {
  if (def.type !== 'number' && def.type !== 'meter') return null;
  if (def.noun) return def.noun.other;
  switch (def.unit) {
    case 'minutes':
      return 'minutes';
    case 'gigabytes':
      return 'GB';
    case 'days':
      return 'days';
    case 'credits':
      return 'credits';
    default:
      return null;
  }
}

/** A used or left amount of a meter, fractions kept: "12.5 minutes", "1 download". */
export function meterAmount(key: Key, amount: number): string {
  const def = getDef(key);
  const text = formatNumber(amount);
  if (!def || (def.type !== 'number' && def.type !== 'meter')) return text;
  if (def.noun) return `${text} ${amount === 1 ? def.noun.one : def.noun.other}`;
  const unit = unitLabel(def);
  if (!unit) return text;
  return `${text} ${amount === 1 && unit.endsWith('s') ? unit.slice(0, -1) : unit}`;
}

export interface ReviewLine {
  id: string;
  text: string;
}

/** "Clips Storage, Pro: 50 GB to 60 GB", one per waiting change, in table order. */
export function reviewLines(plans: PlansView, drafts: Drafts): ReviewLine[] {
  const lines: ReviewLine[] = [];
  for (const info of plans.keys) {
    for (const tier of plans.tiers) {
      const cell = findCell(plans, tier, info.key);
      const draft = drafts[cellId(tier, info.key)];
      if (!cell || !draft) continue;
      const next = draftValue(cell, draft);
      const suffix = draft.kind === 'reset' ? ' (seed)' : '';
      lines.push({
        id: cellId(tier, info.key),
        text: `${info.label}, ${tierName(tier)}: ${shownValue(info.key, cell.value)} to ${shownValue(info.key, next)}${suffix}`,
      });
    }
  }
  return lines;
}

/** The body of the save: each waiting cell with the `updatedAt` it was read with. */
export function planWrites(plans: PlansView, drafts: Drafts): PlanCellWrite[] {
  const writes: PlanCellWrite[] = [];
  for (const [id, draft] of Object.entries(drafts)) {
    const [tier, key] = id.split('|') as [Tier, Key];
    const cell = findCell(plans, tier, key);
    if (!cell) continue;
    if (draft.kind === 'reset') writes.push({ tier, key, reset: true, updatedAt: cell.updatedAt });
    else if (draft.value !== undefined)
      writes.push({ tier, key, value: draft.value, updatedAt: cell.updatedAt });
  }
  return writes;
}

/** Drafts that would not save, by cell id, with the sentence to show inline. */
export function draftErrors(plans: PlansView, drafts: Drafts): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [id, draft] of Object.entries(drafts)) {
    if (draft.kind === 'reset') continue;
    const [tier, key] = id.split('|') as [Tier, Key];
    if (!findCell(plans, tier, key)) {
      errors[id] = 'This value cannot be saved.';
      continue;
    }
    const error = valueError(key, draft.value);
    if (error) errors[id] = error;
  }
  return errors;
}

export function findCell(plans: PlansView, tier: Tier, key: Key): PlanCell | undefined {
  return plans.cells.find((cell) => cell.tier === tier && cell.key === key);
}

/** A number or enum value on one scale, so a tier can be told to have less: null (unlimited) is the most. */
function rank(def: EntitlementDef, value: unknown): number | null {
  if (def.type === 'number' || def.type === 'meter') {
    if (value === null) return Number.POSITIVE_INFINITY;
    return typeof value === 'number' ? value : null;
  }
  if (def.type === 'enum') {
    const position = enumRank(def as EnumEntitlementDef, value);
    return position < 0 ? null : position;
  }
  return null;
}

/**
 * "Pro now has less than Standard for Clips Storage. Check this is on
 * purpose." One sentence a pair of neighbouring tiers where the higher one
 * has less, with the drafts applied. Switches are left out: "less" has no
 * meaning for an export mark.
 */
export function lowerTierWarnings(plans: PlansView, drafts: Drafts): string[] {
  const warnings: string[] = [];
  const order = TIERS.filter((tier) => plans.tiers.includes(tier));
  for (const info of plans.keys) {
    const def = getDef(info.key);
    if (!def) continue;
    for (let index = 1; index < order.length; index += 1) {
      const lower = order[index - 1] as Tier;
      const higher = order[index] as Tier;
      const lowCell = findCell(plans, lower, info.key);
      const highCell = findCell(plans, higher, info.key);
      if (!lowCell || !highCell) continue;
      const lowValue = draftValue(lowCell, drafts[cellId(lower, info.key)]);
      const highValue = draftValue(highCell, drafts[cellId(higher, info.key)]);
      // A value that cannot be saved already says why in its cell.
      if (valueError(info.key, lowValue) || valueError(info.key, highValue)) continue;
      const low = rank(def, lowValue);
      const high = rank(def, highValue);
      if (low === null || high === null || high >= low) continue;
      warnings.push(
        `${tierName(higher)} now has less than ${tierName(lower)} for ${info.label}. Check this is on purpose.`,
      );
    }
  }
  return warnings;
}

// ---- Reasons and dates --------------------------------------------------------------

/** Null when the reason may be sent; the help sentence otherwise. */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length < REASON_MIN_LENGTH) return OPERATOR_COPY.reasonHelp;
  if (length > REASON_MAX_LENGTH) return 'Keep the reason under 500 characters.';
  return null;
}

/** The first and last day an override may end on: tomorrow, and 366 days from now. */
export function overrideDateBounds(now: Date): { min: Date; max: Date } {
  const min = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const max = new Date(now.getTime() + 366 * 24 * 60 * 60 * 1000);
  return { min, max: new Date(max.getFullYear(), max.getMonth(), max.getDate()) };
}

/**
 * An override ends at the start of the chosen day in the operator's own time
 * zone, and never later than 366 days from now (the API's cap, checked again
 * there).
 */
export function overrideEndsAt(day: Date, now: Date): string {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const cap = now.getTime() + 366 * 24 * 60 * 60 * 1000;
  return new Date(Math.min(start.getTime(), cap)).toISOString();
}

/** "19 Nov 2026". */
export function shortDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "19 Nov 2026, 10:42". */
export function dateTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** The key an adjustment carries: made once each time the dialog opens. */
export function adjustmentKey(): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
  return `adj:${uuid}`;
}

/**
 * Used never goes below zero (the API refuses it too, with usage_below_zero):
 * giving back more than this cycle used would work as credit above the plan,
 * which is an override's job.
 */
export function belowZeroProblem(amount: number, used: number | undefined): string | null {
  if (amount >= 0 || used === undefined || used + amount >= 0) return null;
  const most = Math.max(0, Math.floor(used));
  return most === 0
    ? 'Nothing is used this cycle, so there is nothing to give back. To give more, add an override.'
    : `This would take usage below zero. Give back at most ${formatNumber(most)}, or add an override to give more.`;
}

/** The Adjust Usage amount's label: minutes for a minute meter, the counted thing otherwise. */
export function adjustAmountLabel(key: Key): string {
  const def = getDef(key);
  const unit = def ? unitLabel(def) : null;
  if (!unit || unit === 'minutes') return 'Minutes to add or take back';
  return `${unit.charAt(0).toUpperCase()}${unit.slice(1)} to add or take back`;
}

// ---- The library --------------------------------------------------------------------

export type LibraryView = 'runs' | 'sounds' | 'stickers' | 'deny' | 'gaps' | 'credits';

export const LIBRARY_VIEWS: readonly LibraryView[] = [
  'runs',
  'sounds',
  'stickers',
  'deny',
  'gaps',
  'credits',
];

export const LIBRARY_VIEW_NAMES: Readonly<Record<LibraryView, string>> = {
  runs: 'Runs',
  sounds: 'Sounds',
  stickers: 'Stickers',
  deny: 'Deny List',
  gaps: 'Gaps',
  credits: 'Credits',
};

export const LIBRARY_STATUS_NAMES: Readonly<Record<LibraryStatus, string>> = {
  STAGED: 'Staged',
  ACTIVE: 'Active',
  HIDDEN: 'Hidden',
  REMOVED: 'Removed',
};

export const LIBRARY_KIND_NAMES: Readonly<Record<LibraryItemKind, string>> = {
  static: 'Static',
  animated: 'Animated',
  sfx: 'Sound Effect',
  music: 'Music',
};

/** A category's own name ("Arrows And Shapes"); the slug when the catalogue no longer lists it. */
export function categoryName(type: LibraryItemType, slug: string): string {
  const names: Readonly<Record<string, string>> =
    type === 'sound' ? SOUND_CATEGORY_NAMES : STICKER_CATEGORY_NAMES;
  return names[slug] ?? slug;
}

/** "licence not allowed 41, brand name 6". */
export function rejectionsSentence(rejections: Array<{ reason: string; count: number }>): string {
  return rejections
    .map((rejection) => `${rejection.reason.replace(/_/g, ' ')} ${formatNumber(rejection.count)}`)
    .join(', ');
}

/** "0:42", "12:05": a sound's length. */
export function durationLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '';
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** What an item's action buttons are, from its status. */
export function itemActions(
  status: LibraryStatus,
): Array<'publish' | 'hide' | 'restore' | 'remove'> {
  switch (status) {
    case 'STAGED':
      return ['publish', 'hide', 'remove'];
    case 'ACTIVE':
      return ['hide', 'remove'];
    case 'HIDDEN':
      return ['restore', 'remove'];
    default:
      return [];
  }
}

export const ITEM_ACTION_NAMES = {
  publish: 'Publish Item',
  hide: 'Hide Item',
  restore: 'Restore Item',
  remove: 'Remove Item',
} as const;

/** The sentence each item action's dialog opens with. */
export const ITEM_ACTION_SENTENCES = {
  publish: 'This item becomes visible to every workspace.',
  hide: 'This item leaves search at once. Clips that already use it keep working.',
  restore: 'This item comes back to search for every workspace.',
  remove:
    'This deletes its files from the library and adds it to the deny list, so no ingest can bring it back. Clips that use it show a notice. This cannot be undone.',
} as const;

/** The toast after an item action. */
export const ITEM_ACTION_DONE = {
  publish: 'The item is live.',
  hide: 'The item is hidden.',
  restore: 'The item is live again.',
  remove: 'The item was removed and added to the deny list.',
} as const;

export const CREDIT_GROUP_NAMES = {
  attribution: 'Attribution Required',
  notices: 'Notices',
  'public-domain': 'Public Domain And CC0',
  own: "PostGear's Own",
} as const;

// ---- Costs (Sprint 13, Module 15) ---------------------------------------------------

/** The most days one Costs window holds (the API's own cap). */
export const COSTS_MAX_DAYS = 92;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What each Clips job kind is called on the Costs tab. */
export const JOB_KIND_NAMES: Readonly<Record<string, string>> = {
  IMPORT: 'Import',
  SEGMENT: 'Sharp Video',
  HIGHLIGHTS: 'Find Clips',
  RENDER: 'Export',
  DOWNLOAD: 'Download',
  TRANSCRIBE: 'Listen',
  FACES: 'Find Faces',
  TRANSLATE: 'Translate',
  SPEECH: 'Make The Voice',
  AUTO_EDIT: 'Auto-Edit Video',
  EMOTE: 'Emote',
};

export function jobKindName(kind: string): string {
  return Object.hasOwn(JOB_KIND_NAMES, kind) ? (JOB_KIND_NAMES[kind] ?? kind) : kind;
}

/**
 * US cents as dollars: "$1.23", "$1,204.50"; under a dollar up to six
 * decimals, so a job of a fraction of a cent still reads ("$0.0017"); "$0"
 * for nothing. By hand, like `formatNumber`, so every runtime prints the same.
 */
export function usd(cents: number): string {
  if (!Number.isFinite(cents) || cents === 0) return '$0';
  const sign = cents < 0 ? '-' : '';
  const dollars = Math.abs(cents) / 100;
  if (dollars >= 1) {
    const [whole = '0', fraction = '00'] = dollars.toFixed(2).split('.');
    return `${sign}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
  }
  const [, fraction = ''] = dollars.toFixed(6).split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${sign}$0.${trimmed.length < 2 ? trimmed.padEnd(2, '0') : trimmed}`;
}

/** `2026-11-28`, from the picked day's own calendar date. */
function dayValue(day: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Whole days from one picked day to another (the same day is 0). */
function daysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / DAY_MS);
}

/** The day after a picked day. */
export function nextDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
}

/** The last To day a From day allows: 92 days in all. */
export function lastCostsDay(from: Date): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + COSTS_MAX_DAYS - 1);
}

/** Null when From and To (both counted) make a window the API takes; the sentence otherwise. */
export function costsRangeProblem(from: Date, to: Date): string | null {
  const days = daysBetween(from, to);
  if (days < 0) return OPERATOR_COPY.costsToBeforeFrom;
  if (days + 1 > COSTS_MAX_DAYS) return `Pick at most ${COSTS_MAX_DAYS} days.`;
  return null;
}

/** The query of `GET /operator/clips/costs`: From and To both counted, so `to` is the day after. */
export function costsQuery(from: Date, to: Date): string {
  return new URLSearchParams({ from: dayValue(from), to: dayValue(nextDay(to)) }).toString();
}

/** "11 jobs finished, costing $0.06." */
export function costsTotalSentence(jobs: number, cents: number): string {
  return jobs === 1
    ? `1 job finished, costing ${usd(cents)}.`
    : `${formatNumber(jobs)} jobs finished, costing ${usd(cents)}.`;
}

/** "2 jobs have no cost yet. The maintenance pass adds it." */
export function costsMissingSentence(missing: number): string {
  return missing === 1
    ? '1 job has no cost yet. The maintenance pass adds it.'
    : `${formatNumber(missing)} jobs have no cost yet. The maintenance pass adds it.`;
}
