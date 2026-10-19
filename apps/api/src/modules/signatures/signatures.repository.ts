/**
 * Persistence for signatures, and the only writer of the `Signatures` table.
 *
 * Every read filters `deletedAt: null`; every `where` carries the workspace.
 *
 * ## At most one default, by construction
 *
 * The signature marked `autoAdd` starts every new post, so two of them would
 * leave the composer guessing. Marking one clears the mark on every other
 * live signature of the workspace in the same transaction, and that
 * transaction is serializable: under read committed, two admins marking two
 * different signatures at once could each clear "the others" as they were
 * before the other's write, and both marks would stick. Postgres aborts one
 * instead, and the retry sees the winner's mark and clears it.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma } from '@postgear/db';

export interface SignatureRow {
  id: string;
  content: string;
  autoAdd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type CreateSignatureOutcome =
  | { outcome: 'created'; signature: SignatureRow }
  | { outcome: 'too_many' };

const SIGNATURE_SELECT = {
  id: true,
  content: true,
  autoAdd: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable } as const;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 50;

@Injectable()
export class SignaturesRepository {
  /** The workspace's live signatures, newest first. */
  async list(orgId: string): Promise<SignatureRow[]> {
    return prisma.signatures.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: SIGNATURE_SELECT,
    });
  }

  /**
   * The workspace's default. Ordered so that, should two marks ever coexist
   * (a row written before this module existed), the answer is still stable.
   */
  async findDefault(orgId: string): Promise<SignatureRow | null> {
    return prisma.signatures.findFirst({
      where: { organizationId: orgId, deletedAt: null, autoAdd: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: SIGNATURE_SELECT,
    });
  }

  async create(
    orgId: string,
    input: { content: string; autoAdd: boolean },
    maxSignatures: number,
  ): Promise<CreateSignatureOutcome> {
    return serializable(async (tx) => {
      const live = await tx.signatures.count({ where: { organizationId: orgId, deletedAt: null } });

      if (live >= maxSignatures) {
        return { outcome: 'too_many' };
      }

      if (input.autoAdd) {
        await clearDefault(tx, orgId);
      }

      const signature = await tx.signatures.create({
        data: { organizationId: orgId, content: input.content, autoAdd: input.autoAdd },
        select: SIGNATURE_SELECT,
      });

      return { outcome: 'created', signature };
    });
  }

  /** Updates the fields given; null when the signature is not a live one of this workspace. */
  async update(
    orgId: string,
    id: string,
    input: { content?: string; autoAdd?: boolean },
  ): Promise<SignatureRow | null> {
    return serializable(async (tx) => {
      const current = await tx.signatures.findFirst({
        where: { id, organizationId: orgId, deletedAt: null },
        select: { id: true },
      });

      if (!current) {
        return null;
      }

      if (input.autoAdd === true) {
        await clearDefault(tx, orgId, id);
      }

      return tx.signatures.update({
        where: { id },
        data: {
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.autoAdd !== undefined ? { autoAdd: input.autoAdd } : {}),
        },
        select: SIGNATURE_SELECT,
      });
    });
  }

  /**
   * Soft delete. The mark goes with it, so a deleted default can never come
   * back as one if the row is ever restored by hand.
   */
  async softDelete(orgId: string, id: string): Promise<boolean> {
    const result = await prisma.signatures.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date(), autoAdd: false },
    });

    return result.count > 0;
  }
}

/** Clears the default mark on every live signature of the workspace except `keepId`. */
async function clearDefault(
  tx: PrismaTransactionClient,
  orgId: string,
  keepId?: string,
): Promise<void> {
  await tx.signatures.updateMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      autoAdd: true,
      ...(keepId ? { id: { not: keepId } } : {}),
    },
    data: { autoAdd: false },
  });
}

/** Runs `work` serializably, retrying a transaction Postgres aborted for it (P2034). */
async function serializable<T>(work: (tx: PrismaTransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(work, SERIALIZABLE);
    } catch (error) {
      const aborted =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';

      if (!aborted || attempt >= ATTEMPTS) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}
