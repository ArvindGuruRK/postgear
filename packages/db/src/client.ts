/**
 * The single Prisma client for the whole monorepo.
 *
 * Exported as a singleton cached on `globalThis` because Next.js dev mode and
 * ts-node-dev both re-evaluate modules on every hot reload; without the cache
 * each reload opens a fresh connection pool and Postgres runs out of
 * connections within a few minutes of editing. In production the module is
 * evaluated once and the cache is simply never hit twice.
 */
import { PrismaClient } from '@prisma/client';

/**
 * Query logging is on in development only — it is genuinely useful while
 * building repositories, and genuinely a way to leak secrets into logs in
 * production, since query params include `Integration.token` values.
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as {
  postgearPrisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.postgearPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.postgearPrisma = prisma;
}

/**
 * Explicit disconnect, for scripts and tests that need the process to exit.
 * Long-running servers should not call this — Prisma manages the pool itself.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}

export { PrismaClient };
