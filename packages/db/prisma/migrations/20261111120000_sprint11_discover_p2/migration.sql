-- Sprint 11, Module 10 (Discover P2): saved items, each member's own place,
-- "new since you last looked" for competitors, Instagram competitors, topic
-- interests and the weekly digest. Additive only: new tables, and new columns
-- that are nullable or carry a default, so every existing row stays valid and
-- nothing needs a backfill. Nothing from a feed is stored here; an idea is a
-- snapshot a person chose to keep.

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "instagramUsername" TEXT;

-- AlterTable
ALTER TABLE "DiscoverSettings" ADD COLUMN     "digestSentAt" TIMESTAMP(3),
ADD COLUMN     "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "weeklyDigest" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sendDigestEmails" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "DiscoverUserPlace" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "countryCode" TEXT,
    "regionCode" TEXT,
    "regionName" TEXT,
    "city" TEXT,
    "timeZone" TEXT,
    "language" TEXT,
    "topic" TEXT,
    "locationSource" "DiscoverLocationSource" NOT NULL DEFAULT 'SEARCH',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverUserPlace_pkey" PRIMARY KEY ("userId","organizationId")
);

-- CreateTable
CREATE TABLE "DiscoverIdea" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "item" JSONB NOT NULL,
    "place" JSONB NOT NULL,
    "language" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorView" (
    "userId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorView_pkey" PRIMARY KEY ("userId","competitorId")
);

-- CreateIndex
CREATE INDEX "DiscoverUserPlace_organizationId_idx" ON "DiscoverUserPlace"("organizationId");

-- CreateIndex
CREATE INDEX "DiscoverIdea_organizationId_createdAt_idx" ON "DiscoverIdea"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverIdea_organizationId_itemId_key" ON "DiscoverIdea"("organizationId", "itemId");

-- CreateIndex
CREATE INDEX "CompetitorView_competitorId_idx" ON "CompetitorView"("competitorId");

-- CreateIndex
CREATE INDEX "Competitor_deletedAt_lastCheckedAt_idx" ON "Competitor"("deletedAt", "lastCheckedAt");

-- AddForeignKey
ALTER TABLE "DiscoverUserPlace" ADD CONSTRAINT "DiscoverUserPlace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverUserPlace" ADD CONSTRAINT "DiscoverUserPlace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverIdea" ADD CONSTRAINT "DiscoverIdea_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverIdea" ADD CONSTRAINT "DiscoverIdea_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorView" ADD CONSTRAINT "CompetitorView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorView" ADD CONSTRAINT "CompetitorView_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
