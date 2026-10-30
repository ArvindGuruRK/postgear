-- Sprint 10, Modules 08 and 09: additive only.
-- AutomationRun.temporalWorkflowId: runs started by a Temporal Schedule carry
-- their own workflow id, so Cancel can find them.
-- AutomationRunStep.ports: the output ports a step fired, for the run view's
-- lines and for Retry From Here seeds.
-- The finishedAt index serves the 30 day run prune.

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "temporalWorkflowId" TEXT;

-- AlterTable
ALTER TABLE "AutomationRunStep" ADD COLUMN     "ports" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "AutomationRun_finishedAt_idx" ON "AutomationRun"("finishedAt");
