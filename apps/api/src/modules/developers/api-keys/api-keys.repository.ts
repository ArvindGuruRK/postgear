/**
 * Persistence for `ApiKey` rows.
 *
 * Two rules, in the spirit of `channels.repository.ts`:
 *
 * - **`keyHash` never leaves this file.** Every read selects an explicit
 *   column list that omits it, so a service cannot serialise a digest into a
 *   response by accident. The one method that reads by hash takes the digest
 *   as input and returns the row without it.
 * - **`orgId` in every signature and every `where`** on the session paths,
 *   so a key id from another workspace reads as "not found" at the query,
 *   not after a check someone forgot. `findByHash` is the exception on
 *   purpose: the guard has no workspace yet; the key is what names it.
 *
 * Revocation is a timestamp, never a delete: a revoked key keeps its row so
 * the list shows what was issued and when it stopped working.
 */
import { Injectable } from '@nestjs/common';
import { prisma } from '@postgear/db';

export interface ApiKeyRow {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  createdById: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** What the guard needs to accept or refuse a presented secret. */
export interface ApiKeyLookup {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  revokedAt: Date | null;
}

export interface CreateApiKeyRecord {
  orgId: string;
  name: string;
  prefix: string;
  keyHash: string;
  createdById: string | null;
}

export interface RotateApiKeyRecord extends CreateApiKeyRecord {
  /** The key being replaced. Must be live in `orgId`. */
  oldId: string;
  at: Date;
}

const ROW_SELECT = {
  id: true,
  organizationId: true,
  name: true,
  prefix: true,
  createdById: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysRepository {
  /** Every key the workspace has issued, newest first, revoked included. */
  listForOrg(orgId: string): Promise<ApiKeyRow[]> {
    return prisma.apiKey.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: ROW_SELECT,
    });
  }

  countLive(orgId: string): Promise<number> {
    return prisma.apiKey.count({ where: { organizationId: orgId, revokedAt: null } });
  }

  findById(orgId: string, id: string): Promise<ApiKeyRow | null> {
    return prisma.apiKey.findFirst({ where: { id, organizationId: orgId }, select: ROW_SELECT });
  }

  create(input: CreateApiKeyRecord): Promise<ApiKeyRow> {
    return prisma.apiKey.create({
      data: {
        organizationId: input.orgId,
        name: input.name,
        prefix: input.prefix,
        keyHash: input.keyHash,
        createdById: input.createdById,
      },
      select: ROW_SELECT,
    });
  }

  /**
   * Marks a live key revoked. Returns the row afterwards, or `null` when no
   * key with that id exists in the workspace. A key that was already revoked
   * is left as it was (its original `revokedAt` is the honest record) and
   * returned unchanged, so the caller can tell "revoked now" from "was
   * already" by comparing timestamps rather than by a second query.
   */
  async revoke(orgId: string, id: string, at: Date): Promise<ApiKeyRow | null> {
    await prisma.apiKey.updateMany({
      where: { id, organizationId: orgId, revokedAt: null },
      data: { revokedAt: at },
    });

    return this.findById(orgId, id);
  }

  /**
   * Revokes one key and issues another in a single transaction, so there is
   * no instant at which the workspace has both or neither. Returns `null`
   * when the old key is not live in this workspace, and nothing is written.
   */
  rotate(input: RotateApiKeyRecord): Promise<{ created: ApiKeyRow; revoked: ApiKeyRow } | null> {
    return prisma.$transaction(async (tx) => {
      const { count } = await tx.apiKey.updateMany({
        where: { id: input.oldId, organizationId: input.orgId, revokedAt: null },
        data: { revokedAt: input.at },
      });

      if (count === 0) {
        return null;
      }

      const revoked = await tx.apiKey.findFirstOrThrow({
        where: { id: input.oldId, organizationId: input.orgId },
        select: ROW_SELECT,
      });

      const created = await tx.apiKey.create({
        data: {
          organizationId: input.orgId,
          name: input.name,
          prefix: input.prefix,
          keyHash: input.keyHash,
          createdById: input.createdById,
        },
        select: ROW_SELECT,
      });

      return { created, revoked };
    });
  }

  /** The guard's lookup: by digest, across every workspace. */
  findByHash(keyHash: string): Promise<ApiKeyLookup | null> {
    return prisma.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, organizationId: true, name: true, prefix: true, revokedAt: true },
    });
  }

  /**
   * Records a use, but only when the stored time is older than `staleBefore`
   * (or unset). The condition lives in the `where`, so several API instances
   * hitting the same key inside one window produce one write between them
   * rather than one each.
   */
  async touchLastUsed(id: string, now: Date, staleBefore: Date): Promise<void> {
    await prisma.apiKey.updateMany({
      where: {
        id,
        OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: staleBefore } }],
      },
      data: { lastUsedAt: now },
    });
  }
}
