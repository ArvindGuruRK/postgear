/**
 * Persistence for connections, and the only reader of the `credentials`
 * column.
 *
 * - **Every `where` carries the workspace** and `deletedAt: null`, so another
 *   workspace's connection, or a deleted one, reads as not there.
 * - **`SAFE_SELECT` never includes `credentials`.** Only `findWithCredentials`
 *   selects it, for Check Connection; nothing it returns goes into a
 *   response.
 * - **`markConnectionBroken`** is keyed on the id alone, because the steps
 *   that call it (Modules 12 and 13) already hold a row of this workspace;
 *   the worker reproduces it with the same Prisma call.
 */
import { Injectable } from '@nestjs/common';
import { type AutomationConnectionStatus, Prisma, prisma, type Role } from '@postgear/db';

const SAFE_SELECT = {
  id: true,
  provider: true,
  name: true,
  maskedHint: true,
  status: true,
  lastCheckedAt: true,
  lastError: true,
  meta: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type ConnectionRow = Prisma.AutomationConnectionGetPayload<{ select: typeof SAFE_SELECT }>;
export type ConnectionWithCredentials = ConnectionRow & { credentials: string };

const MAX_ERROR_LENGTH = 300;

export interface ConnectionWrite {
  name?: string;
  credentials?: string;
  maskedHint?: string;
  meta?: Record<string, unknown> | null;
  status?: AutomationConnectionStatus;
  lastError?: string | null;
  lastCheckedAt?: Date | null;
}

function jsonOrNull(value: Record<string, unknown> | null | undefined) {
  if (value === undefined) return undefined;
  return value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}

@Injectable()
export class ConnectionsRepository {
  list(orgId: string): Promise<ConnectionRow[]> {
    return prisma.automationConnection.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: SAFE_SELECT,
      orderBy: [{ provider: 'asc' }, { name: 'asc' }],
    });
  }

  find(orgId: string, id: string): Promise<ConnectionRow | null> {
    return prisma.automationConnection.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: SAFE_SELECT,
    });
  }

  findWithCredentials(orgId: string, id: string): Promise<ConnectionWithCredentials | null> {
    return prisma.automationConnection.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { ...SAFE_SELECT, credentials: true },
    });
  }

  count(orgId: string): Promise<number> {
    return prisma.automationConnection.count({ where: { organizationId: orgId, deletedAt: null } });
  }

  async nameTaken(orgId: string, provider: string, name: string, exceptId?: string) {
    const row = await prisma.automationConnection.findFirst({
      where: {
        organizationId: orgId,
        provider,
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    return row !== null;
  }

  create(data: {
    organizationId: string;
    provider: string;
    name: string;
    credentials: string;
    maskedHint: string;
    meta: Record<string, unknown> | null;
    createdById: string;
  }): Promise<ConnectionRow> {
    return prisma.automationConnection.create({
      data: {
        ...data,
        meta: jsonOrNull(data.meta),
        updatedById: data.createdById,
      },
      select: SAFE_SELECT,
    });
  }

  /** Null when the row is not in this workspace (or was deleted). */
  async update(
    orgId: string,
    id: string,
    userId: string | null,
    data: ConnectionWrite,
  ): Promise<ConnectionRow | null> {
    const { meta, ...rest } = data;
    const result = await prisma.automationConnection.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: {
        ...rest,
        ...(meta !== undefined ? { meta: jsonOrNull(meta) } : {}),
        ...(userId ? { updatedById: userId } : {}),
      },
    });
    return result.count === 0 ? null : this.find(orgId, id);
  }

  async softDelete(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.automationConnection.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return result.count > 0;
  }

  /** The app refused the stored credentials during a run; every step using it is flagged. */
  async markConnectionBroken(id: string, reason: string): Promise<void> {
    await prisma.automationConnection.updateMany({
      where: { id, deletedAt: null },
      data: {
        status: 'NEEDS_RECONNECT',
        lastError: reason.slice(0, MAX_ERROR_LENGTH),
        lastCheckedAt: new Date(),
      },
    });
  }

  /** The caller's live role in a workspace, for the OAuth callback's admin re-check. */
  async membershipRole(userId: string, orgId: string): Promise<Role | null> {
    const membership = await prisma.userOrganization.findFirst({
      where: { userId, organizationId: orgId, disabled: false },
      select: { role: true },
    });
    return membership?.role ?? null;
  }
}
