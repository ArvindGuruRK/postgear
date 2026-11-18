/**
 * Serializable transactions for Clips rules that depend on other rows (Sprint
 * 12, Module 04): one live video per link, one export at a time per clip, the
 * concurrent import cap, and the export hand-over to Media.
 *
 * The shape of `serializable()` in `discover/ideas.repository.ts`: Postgres
 * aborts one side of a conflicting pair (`P2034`), which is retried after a
 * short, growing wait, so the retry sees the winner's rows and answers from
 * them. When the retries run out the caller gets a 503 with our "busy"
 * sentence, never a raw database error.
 */
import { HttpStatus } from '@nestjs/common';
import { Prisma, type PrismaTransactionClient, prisma } from '@postgear/db';
import { ClipErrorException } from './clip-error.exception';

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 10_000,
} as const;
const ATTEMPTS = 4;
const RETRY_DELAY_MS = 40;

export type ClipsTx = PrismaTransactionClient;

/** Runs `work` in a serializable transaction, retrying a serialization failure. */
export async function serializable<T>(work: (tx: ClipsTx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, SERIALIZABLE);
    } catch (error) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt >= ATTEMPTS) {
        throw new ClipErrorException(HttpStatus.SERVICE_UNAVAILABLE, 'clips_busy');
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

export function isSerializationFailure(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}
