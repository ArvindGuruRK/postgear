-- Sprint 13, Module 15: what each Clips job cost us, recorded when it ends.
-- Additive: two nullable columns (old rows stay null) and an index for the
-- operator's date-range sums. Never shown to users.

-- AlterTable
ALTER TABLE "ClipJob" ADD COLUMN     "cost" JSONB,
ADD COLUMN     "costCents" INTEGER;

-- CreateIndex
CREATE INDEX "ClipJob_finishedAt_idx" ON "ClipJob"("finishedAt");
