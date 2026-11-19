-- Sprint 12, Module 19: retention, rights requests and the storage notice.
-- Additive only: four nullable columns and two new tables.
--   ClipVideo.expiryNoticeAt: the "removed in 3 days" notice goes out once.
--   Clip.removedAt: the clip's video was removed; its exported Media row stays.
--   Media.factsCheckedAt: the poster and length step does not retry a broken file forever.
--   ClipBlockedVideo: a video removed after its owner asked; probe and import refuse it.
--   ClipStorageNotice: a workspace over its video space, notified once.
-- The ClipSound and ClipSticker "search" columns are generated in SQL (Module 12),
-- which Prisma cannot describe, so its diff wants to drop their default: left out on purpose.

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "removedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ClipVideo" ADD COLUMN     "expiryNoticeAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "factsCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ClipBlockedVideo" (
    "id" TEXT NOT NULL,
    "platform" "ClipPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipBlockedVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipStorageNotice" (
    "organizationId" TEXT NOT NULL,
    "overSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "ClipStorageNotice_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClipBlockedVideo_platform_externalId_key" ON "ClipBlockedVideo"("platform", "externalId");

-- AddForeignKey
ALTER TABLE "ClipStorageNotice" ADD CONSTRAINT "ClipStorageNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
