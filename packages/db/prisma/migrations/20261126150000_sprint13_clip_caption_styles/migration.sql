-- Sprint 13 (Clips AI, Module 03): a workspace's own caption styles.
-- Additive: one new table, nothing existing is touched.

-- CreateTable
CREATE TABLE "ClipCaptionStyle" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "look" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipCaptionStyle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipCaptionStyle_organizationId_idx" ON "ClipCaptionStyle"("organizationId");

-- AddForeignKey
ALTER TABLE "ClipCaptionStyle" ADD CONSTRAINT "ClipCaptionStyle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
