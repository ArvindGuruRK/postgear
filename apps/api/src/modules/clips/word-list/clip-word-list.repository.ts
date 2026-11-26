/**
 * The only file that touches `ClipWordList` (Sprint 13, Module 09). One row
 * per workspace, made on the first save; every query is keyed by the
 * workspace id, never by a row id from a request.
 */
import { Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@postgear/db';

@Injectable()
export class ClipWordListRepository {
  /** The workspace's words, or null when it never saved a list. */
  async read(orgId: string): Promise<string[] | null> {
    const row = await prisma.clipWordList.findUnique({
      where: { organizationId: orgId },
      select: { words: true },
    });
    return row?.words ?? null;
  }

  /** Replaces the workspace's list. Two first saves at once: the loser retries as an update. */
  async save(orgId: string, userId: string, words: readonly string[]): Promise<string[]> {
    const write = () =>
      prisma.clipWordList.upsert({
        where: { organizationId: orgId },
        create: { organizationId: orgId, words: [...words], updatedById: userId },
        update: { words: [...words], updatedById: userId },
        select: { words: true },
      });
    try {
      return (await write()).words;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return (await write()).words;
      }
      throw error;
    }
  }
}
