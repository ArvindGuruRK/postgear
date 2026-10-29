-- Sprint 10: Workflow Builder (Module 03). The UI says Workflow and Step; the
-- code and these tables say Automation and node.
--
-- Entirely additive: four new tables and four new enums, no change to any
-- existing column, so every row written before this migration stays valid and
-- nothing needs a backfill. The run tables are created now, before anything
-- runs, so the run engine only adds code.
--
-- Why the shapes are what they are:
--
--   Automation.draftGraph      one JSON value, validated on every write by the
--                              graph schema in @postgear/automation (the same
--                              reasoning as Design.document).
--   Automation.draftRevision   the optimistic lock; a stale save is a 409.
--   Automation.pinnedData      test data on the row, not in the graph, so
--                              versions never carry it and live runs never
--                              read it.
--   AutomationVersion.graph    an immutable snapshot made when a workflow is
--                              turned on; live runs only read versions.
--   AutomationRun.graphSnapshot  test runs only: the draft as it was.
--   AutomationRun.triggerEventId dedupes trigger events; many nulls may share
--                              the unique index.
--   AutomationRunStep.nodeName copied in, so renamed or deleted steps still
--                              read correctly in old runs.
--   REJECTED and EXPIRED       run outcomes, not failures.
--   user columns               nullable, ON DELETE SET NULL, as in Studio.

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "AutomationRunMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AutomationStepStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'DRY_RUN', 'HANDLED_ERROR', 'FAILED', 'SKIPPED', 'WAITING', 'CANCELLED');

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
    "draftGraph" JSONB NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 1,
    "pinnedData" JSONB NOT NULL DEFAULT '{}',
    "activeVersionId" TEXT,
    "hasUnpublishedChanges" BOOLEAN NOT NULL DEFAULT false,
    "triggerType" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "AutomationRunStatus",
    "lastRunError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationVersion" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "triggerType" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "versionId" TEXT,
    "organizationId" TEXT NOT NULL,
    "mode" "AutomationRunMode" NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'QUEUED',
    "triggerType" TEXT NOT NULL,
    "triggerEventId" TEXT,
    "triggerPayload" JSONB NOT NULL,
    "graphSnapshot" JSONB,
    "startedById" TEXT,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRunStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeKey" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "nodeName" TEXT NOT NULL,
    "status" "AutomationStepStatus" NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB,
    "output" JSONB,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRunStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Automation_activeVersionId_key" ON "Automation"("activeVersionId");

-- CreateIndex
CREATE INDEX "Automation_organizationId_deletedAt_updatedAt_idx" ON "Automation"("organizationId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Automation_organizationId_status_idx" ON "Automation"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationVersion_automationId_version_key" ON "AutomationVersion"("automationId", "version");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_organizationId_status_idx" ON "AutomationRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "AutomationRun_status_createdAt_idx" ON "AutomationRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_automationId_triggerEventId_key" ON "AutomationRun"("automationId", "triggerEventId");

-- CreateIndex
CREATE INDEX "AutomationRunStep_runId_updatedAt_idx" ON "AutomationRunStep"("runId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRunStep_runId_nodeKey_attempt_key" ON "AutomationRunStep"("runId", "nodeKey", "attempt");

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "AutomationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRunStep" ADD CONSTRAINT "AutomationRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AutomationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

