-- Sprint 13 (Clips AI, Module 09): a workspace's own words for Bleep Bad Words.
-- Additive: one new table, one row per workspace, nothing existing is touched.
-- (Prisma's diff also proposes dropping the defaults of the generated `search`
-- columns of ClipSound and ClipSticker; those are raw SQL it cannot read, so
-- that noise is left out, as in every migration since Sprint 12.)

-- CreateTable
CREATE TABLE "ClipWordList" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipWordList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClipWordList_organizationId_key" ON "ClipWordList"("organizationId");

-- AddForeignKey
ALTER TABLE "ClipWordList" ADD CONSTRAINT "ClipWordList_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
