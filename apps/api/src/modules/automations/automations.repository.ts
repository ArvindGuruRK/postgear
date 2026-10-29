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
 */
import { Injectable } from '@nestjs/common';
import {
  AutomationRunMode,
  type AutomationRunStatus,
  type AutomationStatus,
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
  activeVersion: { select: { version: true } },
} as const;

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
  activeVersion: { version: number } | null;
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
}
