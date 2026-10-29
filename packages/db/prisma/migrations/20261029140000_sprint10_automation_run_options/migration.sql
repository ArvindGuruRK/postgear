-- Sprint 10, Module 07: the run engine.
--
-- Test runs remember what they cover (`options`: the whole workflow or one
-- step, the steps sent for real, where the trigger data came from), and step
-- tests store the upstream data the tested step reads (`seedOutputs`).
-- Additive only: two nullable columns, live runs leave both null.

-- AlterTable
ALTER TABLE "AutomationRun" ADD COLUMN     "options" JSONB,
ADD COLUMN     "seedOutputs" JSONB;
