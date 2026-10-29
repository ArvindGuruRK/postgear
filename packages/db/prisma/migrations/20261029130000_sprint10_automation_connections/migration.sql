-- Sprint 10: Workflow Builder (Module 04). The outside apps a workspace links
-- once (Slack, Microsoft Teams, Discord, secret HTTP headers, Google) and any
-- workflow picks.
--
-- Entirely additive: one new table and one new enum, nothing existing changes,
-- so no backfill.
--
--   credentials    the provider's validated credentials as one JSON value,
--                  encrypted with encrypt() from @postgear/db. The only secret
--                  column: the API never selects it into a response.
--   maskedHint     computed once at save ("hooks.slack.com/...a9F2"), so the
--                  list never decrypts anything.
--   usage          not stored: the API scans the workspace's graphs, which
--                  cannot drift the way a join table rewritten on every
--                  autosave would.

-- CreateEnum
CREATE TYPE "AutomationConnectionStatus" AS ENUM ('CONNECTED', 'NEEDS_RECONNECT', 'ERROR');

-- CreateTable
CREATE TABLE "AutomationConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "maskedHint" TEXT NOT NULL,
    "status" "AutomationConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "meta" JSONB,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationConnection_organizationId_provider_deletedAt_idx" ON "AutomationConnection"("organizationId", "provider", "deletedAt");

-- AddForeignKey
ALTER TABLE "AutomationConnection" ADD CONSTRAINT "AutomationConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationConnection" ADD CONSTRAINT "AutomationConnection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationConnection" ADD CONSTRAINT "AutomationConnection_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
