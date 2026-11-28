/**
 * `GET /operator/clips/costs` (Sprint 13, Module 15 section 3): what Clips
 * cost us beside what workspaces were charged, for `[from, to)`, so the
 * owner can see whether the allowances cover the bills.
 *
 * - **By kind** and **by workspace**: finished jobs, how many were costed
 *   (and estimated), and the cost in US cents (to a micro-dollar).
 * - **By meter**: the cost of the kinds a meter pays for (`KIND_METERS`)
 *   against the units charged, reversed, adjusted and net, and the cost of
 *   one net unit (one AI minute, one import minute, one download).
 * - **Usage by workspace** and **by person**: the Clips ledger totals by
 *   meter, in display units (minutes, downloads), the person from
 *   `meta.by` (Module 14), null when an entry kept none.
 *
 * Platform operators only. Nothing here is ever shown to a workspace.
 */
import { Injectable } from '@nestjs/common';
import { isMeterKey, MILLI, type MeterKey, REGISTRY } from '@postgear/entitlements';
import type { ClipJobKind } from '@postgear/video-engine';
import { CLIP_PRICES_DATE, roundCents } from '../../clips/costs/clip-prices';
import { OperatorCostsRepository, type UsageRow } from './operator-costs.repository';
import { type CostsQuery, costsWindow } from './operator-costs.schema';

/** The meter each kind's work is charged to; null for work no meter charges (exports are a plan limit). */
export const KIND_METERS: Readonly<Record<ClipJobKind, MeterKey | null>> = {
  IMPORT: 'clips.import_minutes_per_month',
  SEGMENT: null,
  HIGHLIGHTS: 'clips.ai_minutes_per_month',
  RENDER: null,
  DOWNLOAD: 'clips.downloads_per_day',
  TRANSCRIBE: 'clips.ai_minutes_per_month',
  FACES: null,
  TRANSLATE: 'clips.ai_minutes_per_month',
  SPEECH: 'clips.ai_minutes_per_month',
  AUTO_EDIT: null,
  EMOTE: 'clips.downloads_per_day',
};

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

export interface UsageTotals {
  /** Display units (minutes, downloads), three decimals. */
  charged: number;
  reversed: number;
  adjusted: number;
  net: number;
}

export interface MeterCost extends UsageTotals {
  meter: string;
  label: string;
  /** The kinds whose cost this meter carries. */
  kinds: string[];
  cents: number;
  /** Cents one net unit cost us; null when nothing net was charged. */
  centsPerUnit: number | null;
}

export interface WorkspaceUsage extends UsageTotals {
  meter: string;
  label: string;
  organizationId: string;
  workspace: string | null;
}

export interface PersonUsage extends UsageTotals {
  /** `meta.by`; null for entries that kept no person (older ones, workflows, adjustments). */
  userId: string | null;
  person: string | null;
  organizationId: string;
  workspace: string | null;
  meter: string;
  label: string;
}

export interface CostsView {
  from: string;
  to: string;
  /** The price table's date (`CLIP_PRICES_DATE`). */
  prices: string;
  totals: { jobs: number; costed: number; missing: number; estimated: number; cents: number };
  byKind: KindCost[];
  byWorkspace: WorkspaceCost[];
  byMeter: MeterCost[];
  usageByWorkspace: WorkspaceUsage[];
  usageByPerson: PersonUsage[];
}

function units(milli: number): number {
  return Math.round(milli) / MILLI;
}

function labelOf(meter: string): string {
  return isMeterKey(meter) ? REGISTRY[meter].label : meter;
}

function emptyTotals(): UsageTotals {
  return { charged: 0, reversed: 0, adjusted: 0, net: 0 };
}

/** Adds one ledger group to running totals, in thousandths. */
function addUsage(totals: UsageTotals, row: UsageRow): void {
  if (row.kind === 'CHARGE') totals.charged += row.units;
  else if (row.kind === 'REVERSAL') totals.reversed += -row.units;
  else totals.adjusted += row.units;
  totals.net += row.units;
}

/** Thousandths to display units. */
function shown<T extends UsageTotals>(totals: T): T {
  return {
    ...totals,
    charged: units(totals.charged),
    reversed: units(totals.reversed),
    adjusted: units(totals.adjusted),
    net: units(totals.net),
  };
}

@Injectable()
export class OperatorCostsService {
  constructor(private readonly repository: OperatorCostsRepository) {}

  async costs(query: CostsQuery, now: Date = new Date()): Promise<CostsView> {
    const { from, to } = costsWindow(query, now);
    const [jobRows, usageRows] = await Promise.all([
      this.repository.jobCosts(from, to),
      this.repository.usage(from, to),
    ]);

    const orgIds = new Set<string>();
    const personIds = new Set<string>();
    for (const row of jobRows) orgIds.add(row.organizationId);
    for (const row of usageRows) {
      orgIds.add(row.organizationId);
      if (row.by) personIds.add(row.by);
    }
    const [workspaces, people] = await Promise.all([
      this.repository.workspaceNames([...orgIds]),
      this.repository.personNames([...personIds]),
    ]);

    // ---- Job costs ----------------------------------------------------------------
    const kinds = new Map<string, KindCost>();
    const orgs = new Map<string, WorkspaceCost>();
    const totals = { jobs: 0, costed: 0, missing: 0, estimated: 0, cents: 0 };
    for (const row of jobRows) {
      const kind = kinds.get(row.kind) ?? {
        kind: row.kind,
        jobs: 0,
        costed: 0,
        estimated: 0,
        cents: 0,
      };
      kind.jobs += row.jobs;
      kind.costed += row.costed;
      kind.estimated += row.estimated;
      kind.cents += row.cents;
      kinds.set(row.kind, kind);

      const org = orgs.get(row.organizationId) ?? {
        organizationId: row.organizationId,
        workspace: workspaces.get(row.organizationId) ?? null,
        jobs: 0,
        costed: 0,
        cents: 0,
      };
      org.jobs += row.jobs;
      org.costed += row.costed;
      org.cents += row.cents;
      orgs.set(row.organizationId, org);

      totals.jobs += row.jobs;
      totals.costed += row.costed;
      totals.estimated += row.estimated;
      totals.cents += row.cents;
    }
    totals.missing = totals.jobs - totals.costed;
    totals.cents = roundCents(totals.cents);

    // ---- Usage --------------------------------------------------------------------
    const meterTotals = new Map<string, UsageTotals>();
    const byWorkspace = new Map<string, WorkspaceUsage>();
    const byPerson = new Map<string, PersonUsage>();
    for (const row of usageRows) {
      const meter = meterTotals.get(row.meter) ?? emptyTotals();
      addUsage(meter, row);
      meterTotals.set(row.meter, meter);

      const orgKey = `${row.meter}|${row.organizationId}`;
      const org = byWorkspace.get(orgKey) ?? {
        meter: row.meter,
        label: labelOf(row.meter),
        organizationId: row.organizationId,
        workspace: workspaces.get(row.organizationId) ?? null,
        ...emptyTotals(),
      };
      addUsage(org, row);
      byWorkspace.set(orgKey, org);

      const personKey = `${row.by ?? ''}|${row.organizationId}|${row.meter}`;
      const person = byPerson.get(personKey) ?? {
        userId: row.by,
        person: row.by ? (people.get(row.by) ?? null) : null,
        organizationId: row.organizationId,
        workspace: workspaces.get(row.organizationId) ?? null,
        meter: row.meter,
        label: labelOf(row.meter),
        ...emptyTotals(),
      };
      addUsage(person, row);
      byPerson.set(personKey, person);
    }

    // ---- Cost against each meter -----------------------------------------------------
    const meterKeys = new Set<string>(meterTotals.keys());
    for (const meter of Object.values(KIND_METERS)) if (meter) meterKeys.add(meter);
    const byMeter: MeterCost[] = [...meterKeys].sort().map((meter) => {
      const paidBy = (Object.keys(KIND_METERS) as ClipJobKind[]).filter(
        (kind) => KIND_METERS[kind] === meter,
      );
      const cents = roundCents(
        paidBy.reduce((sum, kind) => sum + (kinds.get(kind)?.cents ?? 0), 0),
      );
      const usage = shown(meterTotals.get(meter) ?? emptyTotals());
      return {
        meter,
        label: labelOf(meter),
        kinds: paidBy,
        cents,
        ...usage,
        centsPerUnit: usage.net > 0 ? roundCents(cents / usage.net) : null,
      };
    });

    const byCents = (a: { cents: number }, b: { cents: number }) => b.cents - a.cents;
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      prices: CLIP_PRICES_DATE,
      totals,
      byKind: [...kinds.values()]
        .map((kind) => ({ ...kind, cents: roundCents(kind.cents) }))
        .sort((a, b) => byCents(a, b) || a.kind.localeCompare(b.kind)),
      byWorkspace: [...orgs.values()]
        .map((org) => ({ ...org, cents: roundCents(org.cents) }))
        .sort((a, b) => byCents(a, b) || a.organizationId.localeCompare(b.organizationId)),
      byMeter,
      usageByWorkspace: [...byWorkspace.values()]
        .map(shown)
        .sort((a, b) => a.label.localeCompare(b.label) || b.net - a.net),
      usageByPerson: [...byPerson.values()]
        .map(shown)
        .sort((a, b) => b.net - a.net || a.label.localeCompare(b.label)),
    };
  }
}
