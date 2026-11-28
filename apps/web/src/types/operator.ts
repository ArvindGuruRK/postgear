/**
 * The operator screens' API shapes (Sprint 12, Module 19 Part B), mirrored
 * from `apps/api/src/modules/admin/entitlements/operator-entitlements.service.ts`
 * and `apps/api/src/modules/admin/library/operator-library.service.ts`. Dates
 * arrive as ISO strings. Keep the two sides in step.
 */
import type { Key, MeterKey, Tier } from '@postgear/entitlements';

export type OperatorTab = 'plans' | 'overrides' | 'usage' | 'costs' | 'changes' | 'library';

/** A stored or registry value: boolean, number, enum member, or null for unlimited. */
export type EntitlementCellValue = boolean | number | string | null;

export interface PlanCell {
  tier: Tier;
  key: Key;
  /** The stored value, or the registry default when no row exists. */
  value: EntitlementCellValue;
  /** Sent back with an edit; null when no row exists yet. */
  updatedAt: string | null;
  seed: EntitlementCellValue;
  /** False when the stored value no longer validates (the resolver skips it). */
  valid: boolean;
}

export interface PlanKeyInfo {
  key: Key;
  label: string;
  group: string;
  description: string;
}

export interface EndingOverride {
  organizationId: string;
  organizationName: string;
  key: string;
  label: string;
  expiresAt: string;
}

export interface PlansView {
  tiers: Tier[];
  keys: PlanKeyInfo[];
  cells: PlanCell[];
  endingSoon: EndingOverride[];
}

/** One cell of `PUT /operator/entitlements/plans`. */
export type PlanCellWrite =
  | { tier: Tier; key: Key; value: EntitlementCellValue; updatedAt: string | null }
  | { tier: Tier; key: Key; reset: true; updatedAt: string | null };

export interface SavePlansResult {
  saved: number;
  plans: PlansView;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  tier: Tier;
  status: string;
  trialEndsAt: string | null;
  adminEmail: string | null;
  members: number;
  createdAt: string;
}

export type ResolveSource = 'override' | 'plan' | 'default';

export interface ResolvedValue {
  key: Key;
  label: string;
  value: EntitlementCellValue;
  source: ResolveSource;
  planValue: EntitlementCellValue;
}

export interface WorkspaceOverride {
  key: Key;
  label: string;
  value: EntitlementCellValue;
  expiresAt: string;
  reason: string;
  /** The operator's address, or their id when the account is gone. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

export interface WorkspaceEntitlements {
  workspace: WorkspaceSummary;
  values: ResolvedValue[];
  overrides: WorkspaceOverride[];
}

export interface MeterUsage {
  key: MeterKey;
  label: string;
  unit: string;
  used: number;
  limit: number | null;
  remaining: number | null;
  cycleStart: string;
  cycleEnd: string;
}

export interface UsageEntry {
  id: string;
  createdAt: string;
  meter: string;
  label: string;
  /** Display units, signed (a reversal is negative). */
  units: number;
  kind: 'CHARGE' | 'REVERSAL' | 'ADJUSTMENT' | string;
  reference: string | null;
  note: string | null;
}

export interface WorkspaceUsage {
  workspace: WorkspaceSummary;
  meters: MeterUsage[];
  entries: UsageEntry[];
}

export interface AdjustUsageResult {
  duplicate: boolean;
  usage: WorkspaceUsage;
}

export type ChangeScope = 'PLAN' | 'ORG' | 'USAGE';

export interface ChangeRow {
  id: string;
  createdAt: string;
  scope: ChangeScope;
  tier: Tier | null;
  organizationId: string | null;
  organizationName: string | null;
  key: string;
  label: string;
  action: string;
  /** Formatted ("50 GB", "Unlimited"); null when there was no value. */
  old: string | null;
  new: string | null;
  reason: string;
  actorEmail: string | null;
}

export interface ChangesPage {
  changes: ChangeRow[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ---- The library ------------------------------------------------------------------

export type LibraryItemType = 'sticker' | 'sound';
export type LibraryStatus = 'STAGED' | 'ACTIVE' | 'HIDDEN' | 'REMOVED';
export type LibraryItemKind = 'static' | 'animated' | 'sfx' | 'music';

export interface LibraryStatusCounts {
  staged: number;
  active: number;
  hidden: number;
  removed: number;
}

export interface LibraryRun {
  id: string;
  origin: string;
  type: LibraryItemType;
  startedAt: string;
  finishedAt: string | null;
  accepted: number;
  rejected: number;
  rejections: Array<{ reason: string; count: number }>;
  counts: LibraryStatusCounts;
  needsReview: boolean;
  hasReport: boolean;
}

export interface HeldBackItem {
  id: string;
  type: LibraryItemType;
  name: string;
  reason: string;
}

export interface LibraryRunDetail extends LibraryRun {
  args: unknown;
  reportUrl: string | null;
  publishable: number;
  heldBack: HeldBackItem[];
}

export interface PublishRunResult {
  published: number;
  heldBack: HeldBackItem[];
  run: LibraryRunDetail;
}

export interface LibraryItem {
  id: string;
  type: LibraryItemType;
  name: string;
  kind: LibraryItemKind;
  category: string;
  status: LibraryStatus;
  licence: string;
  author: string;
  authorUrl: string | null;
  sourceUrl: string;
  origin: string;
  runId: string;
  sourceId: string;
  sourceName: string;
  previewUrl: string | null;
  audioUrl: string | null;
  durationMs: number | null;
  createdAt: string;
  statusAt: string | null;
  statusReason: string | null;
}

export interface LibraryItemsPage {
  items: LibraryItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface LibraryItemDetail extends LibraryItem {
  tags: string[];
  licenceUrl: string;
  originId: string | null;
  originalWork: boolean;
  retrievedAt: string;
  sourceChecksum: string;
  bytes: number;
  width: number | null;
  height: number | null;
  statusByEmail: string | null;
  usage: number;
  source: { id: string; name: string; requiresCredit: boolean; creditLine: string | null };
  publishRefusal: string | null;
}

export type LibraryItemAction = 'publish' | 'hide' | 'restore' | 'remove';

export interface LibraryDenyRow {
  id: string;
  sourceChecksum: string | null;
  origin: string | null;
  originId: string | null;
  reason: string;
  createdAt: string;
}

export interface LibraryMiss {
  term: string;
  kind: string;
  count: number;
  lastAt: string;
}

export type LibraryCreditGroup = 'attribution' | 'notices' | 'public-domain' | 'own';

export interface LibrarySource {
  id: string;
  code: string;
  name: string;
  author: string;
  url: string;
  licence: string;
  licenceUrl: string;
  creditLine: string | null;
  changeNote: string | null;
  noticeText: string | null;
  requiresCredit: boolean;
  creditPerItem: boolean;
  group: LibraryCreditGroup;
  stickers: LibraryStatusCounts;
  sounds: LibraryStatusCounts;
  needsCreditLine: boolean;
}

// ---- Costs (Sprint 13, Module 15): `GET /operator/clips/costs` ---------------------

/** What finished jobs of one kind cost us. Cents to a micro-dollar (4 decimals). */
export interface KindCost {
  kind: string;
  jobs: number;
  costed: number;
  estimated: number;
  cents: number;
}

export interface WorkspaceCost {
  organizationId: string;
  workspace: string | null;
  jobs: number;
  costed: number;
  cents: number;
}

/** Ledger totals in display units (minutes, downloads). */
export interface UsageTotals {
  charged: number;
  reversed: number;
  adjusted: number;
  net: number;
}

export interface MeterCost extends UsageTotals {
  meter: string;
  label: string;
  kinds: string[];
  cents: number;
  /** Cents one net unit cost us; null when nothing net was charged. */
  centsPerUnit: number | null;
}

export interface WorkspaceMeterUsage extends UsageTotals {
  meter: string;
  label: string;
  organizationId: string;
  workspace: string | null;
}

export interface PersonMeterUsage extends UsageTotals {
  /** `meta.by`; null for entries that kept no person. */
  userId: string | null;
  person: string | null;
  organizationId: string;
  workspace: string | null;
  meter: string;
  label: string;
}

export interface CostsView {
  /** ISO, inclusive. */
  from: string;
  /** ISO, exclusive. */
  to: string;
  /** The price table's date. */
  prices: string;
  totals: { jobs: number; costed: number; missing: number; estimated: number; cents: number };
  byKind: KindCost[];
  byWorkspace: WorkspaceCost[];
  byMeter: MeterCost[];
  usageByWorkspace: WorkspaceMeterUsage[];
  usageByPerson: PersonMeterUsage[];
}
