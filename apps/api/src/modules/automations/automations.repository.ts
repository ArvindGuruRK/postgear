/**
 * Persistence for workflows, and the only writer of the `Automation` table.
 *
 * - **Every `where` carries the workspace** and filters `deletedAt: null`, so
 *   another workspace's workflow, or a deleted one, reads as not there.
 * - **The revision check is part of the write.** `update` matches on
 *   `{ id, organizationId, draftRevision }` and reports whether a row
 *   changed, as Studio's design save does: reading the revision first and
 *   writing after would leave a window for the other tab's save.
 * - **Pinned data is written in SQL**, one key at a time with `jsonb_set`,
 *   so pinning one step never overwrites a pin another tab just made, and
 *   never touches the draft or its revision (pinning is not an edit).
 * - **Run counts are one grouped query** for the whole page, never one per
 *   row.
 * - **Versions are immutable** (Module 09): this file inserts them when a
 *   workflow is turned on and reads them; no method updates or deletes one
 *   (a spec checks). Versions are reached through their workflow, so the
 *   workspace check holds for them too.
 */
import { Injectable } from '@nestjs/common';
import {
  AutomationRunMode,
  AutomationRunStatus,
  AutomationStatus,
  AutomationStepStatus,
  Prisma,
  prisma,
} from '@postgear/db';

const LIST_SELECT = {
  id: true,
  name: true,
  status: true,
  triggerType: true,
  hasUnpublishedChanges: true,
  lastRunAt: true,
  lastRunStatus: true,
  lastRunError: true,
  templateId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DETAIL_SELECT = {
  ...LIST_SELECT,
  draftGraph: true,
  draftRevision: true,
  pinnedData: true,
  activeVersion: { select: { id: true, version: true } },
} as const;

/** A version as the Versions drawer lists it; `graph` only when one is opened. */
const VERSION_SELECT = {
  id: true,
  version: true,
  note: true,
  triggerType: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, lastName: true, email: true } },
} as const;

/** Newest versions the drawer lists. */
const VERSIONS_LISTED = 100;

/** Open runs a delete cancels in one go; a workflow never has more (10 live at once per workspace). */
const OPEN_RUNS_READ = 500;

const OPEN_RUN_STATUSES = [
  AutomationRunStatus.QUEUED,
  AutomationRunStatus.RUNNING,
  AutomationRunStatus.WAITING,
];

const OPEN_STEP_STATUSES = [
  AutomationStepStatus.QUEUED,
  AutomationStepStatus.RUNNING,
  AutomationStepStatus.WAITING,
];

export type VersionRow = Prisma.AutomationVersionGetPayload<{ select: typeof VERSION_SELECT }>;
export type VersionDetailRow = VersionRow & { graph: Prisma.JsonValue };

/** What activating a draft did. */
export type ActivateOutcome =
  | { outcome: 'activated'; version: VersionRow }
  | { outcome: 'conflict'; currentRevision: number }
  | { outcome: 'not_found' };

export type DiscardOutcome =
  | { outcome: 'discarded'; row: AutomationRow }
  | { outcome: 'no_active_version' }
  | { outcome: 'not_found' };

export interface ActivationWrite {
  /** The revision the admin saw; any other means the draft changed under them. */
  expectedRevision: number;
  graph: Prisma.InputJsonValue;
  triggerType: string;
  note: string | null;
  createdById: string | null;
}

export interface OpenRun {
  id: string;
  status: AutomationRunStatus;
  temporalWorkflowId: string | null;
}

/** Thrown inside the activation transaction to roll it back on a stale revision. */
class StaleActivation extends Error {}

export interface AutomationListRow {
  id: string;
  name: string;
  status: AutomationStatus;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  lastRunAt: Date | null;
  lastRunStatus: AutomationRunStatus | null;
  lastRunError: string | null;
  templateId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutomationRow extends AutomationListRow {
  draftGraph: Prisma.JsonValue;
  draftRevision: number;
  pinnedData: Prisma.JsonValue;
  activeVersion: { id: string; version: number } | null;
}

/** What a save needs to know before it writes. */
export interface AutomationSaveState {
  status: AutomationStatus;
  draftRevision: number;
  activeVersion: { graph: Prisma.JsonValue } | null;
}

export interface AutomationCreate {
  name: string;
  draftGraph: Prisma.InputJsonValue;
  triggerType: string | null;
  templateId: string | null;
  createdById: string | null;
}

export interface AutomationWrite {
  name?: string;
  draftGraph?: Prisma.InputJsonValue;
  triggerType?: string | null;
  hasUnpublishedChanges?: boolean;
  updatedById?: string | null;
}

/** A workspace channel as the validation context needs it. */
export interface ChannelRow {
  id: string;
  name: string;
  providerIdentifier: string;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
}

export interface UsageGraphRow {
  id: string;
  name: string;
  status: AutomationStatus;
  draftGraph: Prisma.JsonValue;
  activeVersion: { graph: Prisma.JsonValue } | null;
}

@Injectable()
export class AutomationsRepository {
  /** One page of the list, newest edit first. Asks for one extra row to know whether there is a next page. */
  async list(
    orgId: string,
    filter: { status?: AutomationStatus; cursor?: string; take: number },
  ): Promise<AutomationListRow[]> {
    return prisma.automation.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
      take: filter.take + 1,
      select: LIST_SELECT,
    });
  }

  /**
   * The newest workflows whose name contains `term`, for a search. The
   * service checks every word, the way the other searches do
   * (`search-terms.ts`), so a `%` or `_` cannot act as a wildcard.
   */
  async search(
    orgId: string,
    term: string,
    filter: { status?: AutomationStatus; limit: number },
  ): Promise<AutomationListRow[]> {
    return prisma.automation.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        name: { contains: term, mode: 'insensitive' },
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: filter.limit,
      select: LIST_SELECT,
    });
  }

  /** Live runs per workflow since `since`, in one grouped query. Workflows with none are absent. */
  async liveRunCounts(orgId: string, ids: string[], since: Date): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();

    const groups = await prisma.automationRun.groupBy({
      by: ['automationId'],
      where: {
        organizationId: orgId,
        automationId: { in: ids },
        mode: AutomationRunMode.LIVE,
        createdAt: { gte: since },
      },
      _count: { _all: true },
    });

    return new Map(groups.map((group) => [group.automationId, group._count._all]));
  }

  async find(orgId: string, id: string): Promise<AutomationRow | null> {
    return prisma.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: DETAIL_SELECT,
    });
  }

  async findSaveState(orgId: string, id: string): Promise<AutomationSaveState | null> {
    return prisma.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { status: true, draftRevision: true, activeVersion: { select: { graph: true } } },
    });
  }

  async create(orgId: string, data: AutomationCreate): Promise<AutomationRow> {
    return prisma.automation.create({
      data: { organizationId: orgId, ...data, updatedById: data.createdById },
      select: DETAIL_SELECT,
    });
  }

  /**
   * Saves the draft, but only against the revision the editor loaded.
   *
   * Returns the new row, or null when nothing matched. Null means one of two
   * things and the service tells them apart with one more read: the
   * workflow is gone, or somebody else saved first.
   */
  async update(
    orgId: string,
    id: string,
    expectedRevision: number,
    data: AutomationWrite,
  ): Promise<AutomationRow | null> {
    const result = await prisma.automation.updateMany({
      where: { id, organizationId: orgId, deletedAt: null, draftRevision: expectedRevision },
      data: { ...data, draftRevision: { increment: 1 } },
    });

    if (result.count === 0) return null;

    return this.find(orgId, id);
  }

  /** Soft delete. Runs and versions stay until the 30-day prune hard deletes the row. */
  async softDelete(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.automation.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    return result.count > 0;
  }

  /**
   * Turns a workflow on (Module 09): one transaction inserts version n + 1
   * from the draft and points the workflow at it, ACTIVE, with no
   * unpublished changes and its failure count reset.
   *
   * The draft must still be at `expectedRevision`, checked again in the
   * final write, so an autosave between the admin's look and this write is
   * a conflict, never a version of something they did not see. Two
   * activations at once both try the same version number; the unique index
   * refuses the second, which is a conflict too. Nothing here ever updates
   * or deletes a version row.
   */
  async activate(orgId: string, id: string, write: ActivationWrite): Promise<ActivateOutcome> {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.automation.findFirst({
          where: { id, organizationId: orgId, deletedAt: null },
          select: { draftRevision: true },
        });
        if (!current) return { outcome: 'not_found' as const };
        if (current.draftRevision !== write.expectedRevision) {
          return { outcome: 'conflict' as const, currentRevision: current.draftRevision };
        }

        const last = await tx.automationVersion.findFirst({
          where: { automationId: id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const version = await tx.automationVersion.create({
          data: {
            automationId: id,
            version: (last?.version ?? 0) + 1,
            graph: write.graph,
            triggerType: write.triggerType,
            note: write.note,
            createdById: write.createdById,
          },
          select: VERSION_SELECT,
        });

        const updated = await tx.automation.updateMany({
          where: {
            id,
            organizationId: orgId,
            deletedAt: null,
            draftRevision: write.expectedRevision,
          },
          data: {
            activeVersionId: version.id,
            status: AutomationStatus.ACTIVE,
            hasUnpublishedChanges: false,
            consecutiveFailures: 0,
          },
        });
        if (updated.count === 0) throw new StaleActivation();

        return { outcome: 'activated' as const, version };
      });
    } catch (error) {
      const raced =
        error instanceof StaleActivation ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002');
      if (!raced) throw error;
      const now = await this.findSaveState(orgId, id);
      return now
        ? { outcome: 'conflict', currentRevision: now.draftRevision }
        : { outcome: 'not_found' };
    }
  }

  /** ACTIVE to PAUSED. False when the workflow is not there or not on. */
  async pause(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.automation.updateMany({
      where: { id, organizationId: orgId, deletedAt: null, status: AutomationStatus.ACTIVE },
      data: { status: AutomationStatus.PAUSED },
    });
    return result.count > 0;
  }

  /**
   * Discard Changes: the draft becomes the live version's graph again, its
   * revision bumped (an open editor's next save is a conflict, so it
   * reloads), with no unpublished changes.
   */
  async discard(orgId: string, id: string, updatedById: string | null): Promise<DiscardOutcome> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.automation.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
        select: { activeVersion: { select: { graph: true, triggerType: true } } },
      });
      if (!current) return { outcome: 'not_found' as const };
      if (!current.activeVersion) return { outcome: 'no_active_version' as const };

      const updated = await tx.automation.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: {
          draftGraph: current.activeVersion.graph as Prisma.InputJsonValue,
          triggerType: current.activeVersion.triggerType,
          hasUnpublishedChanges: false,
          updatedById,
          draftRevision: { increment: 1 },
        },
      });
      if (updated.count === 0) return { outcome: 'not_found' as const };

      const row = await tx.automation.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
        select: DETAIL_SELECT,
      });
      return row ? { outcome: 'discarded' as const, row } : { outcome: 'not_found' as const };
    });
  }

  /** A workflow's versions, newest first. Reached through the workflow, so tenancy holds. */
  async listVersions(orgId: string, id: string): Promise<VersionRow[]> {
    return prisma.automationVersion.findMany({
      where: { automationId: id, automation: { organizationId: orgId, deletedAt: null } },
      orderBy: { version: 'desc' },
      take: VERSIONS_LISTED,
      select: VERSION_SELECT,
    });
  }

  async findVersion(orgId: string, id: string, version: number): Promise<VersionDetailRow | null> {
    return prisma.automationVersion.findFirst({
      where: {
        automationId: id,
        version,
        automation: { organizationId: orgId, deletedAt: null },
      },
      select: { ...VERSION_SELECT, graph: true },
    });
  }

  /** A workflow's runs that may still be going: what a delete cancels. */
  async openRuns(orgId: string, automationId: string): Promise<OpenRun[]> {
    return prisma.automationRun.findMany({
      where: { organizationId: orgId, automationId, status: { in: OPEN_RUN_STATUSES } },
      orderBy: { createdAt: 'asc' },
      take: OPEN_RUNS_READ,
      select: { id: true, status: true, temporalWorkflowId: true },
    });
  }

  /**
   * Closes a run as CANCELLED, with its open steps, for a run whose workflow
   * cannot be told: only while its status is one of `statuses`. The same
   * write as the run Cancel route's (`AutomationRunsRepository.cancelRun`).
   */
  async closeRun(
    orgId: string,
    runId: string,
    statuses: readonly AutomationRunStatus[],
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const finishedAt = new Date();
      const run = await tx.automationRun.updateMany({
        where: { id: runId, organizationId: orgId, status: { in: [...statuses] } },
        data: { status: AutomationRunStatus.CANCELLED, finishedAt },
      });
      if (run.count === 0) return false;

      await tx.automationRunStep.updateMany({
        where: { runId, status: { in: OPEN_STEP_STATUSES } },
        data: { status: AutomationStepStatus.CANCELLED, finishedAt },
      });
      return true;
    });
  }

  /** Pins one step's test data. False when the workflow is not there. */
  async setPinned(orgId: string, id: string, nodeKey: string, entry: unknown): Promise<boolean> {
    const count = await prisma.$executeRaw`
      UPDATE "Automation"
      SET "pinnedData" = jsonb_set("pinnedData", ARRAY[${nodeKey}]::text[], ${JSON.stringify(entry)}::jsonb, true)
      WHERE "id" = ${id} AND "organizationId" = ${orgId} AND "deletedAt" IS NULL`;

    return count > 0;
  }

  /** Unpins one step. False when the workflow is not there; unpinning a step with no pin is fine. */
  async removePinned(orgId: string, id: string, nodeKey: string): Promise<boolean> {
    const count = await prisma.$executeRaw`
      UPDATE "Automation"
      SET "pinnedData" = "pinnedData" - ${nodeKey}::text
      WHERE "id" = ${id} AND "organizationId" = ${orgId} AND "deletedAt" IS NULL`;

    return count > 0;
  }

  /** The workspace's channels that are not deleted, turned off ones included (validation explains those). */
  async channels(orgId: string): Promise<ChannelRow[]> {
    return prisma.integration.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        providerIdentifier: true,
        disabled: true,
        refreshNeeded: true,
        inBetweenSteps: true,
      },
    });
  }

  /** Every workflow's draft and running graph, for the connections' Used By scan. */
  async usageGraphs(orgId: string): Promise<UsageGraphRow[]> {
    return prisma.automation.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        status: true,
        draftGraph: true,
        activeVersion: { select: { graph: true } },
      },
    });
  }
}
