-- Sprint 9: Design Studio.
--
-- Entirely additive: four new tables and three new enums, no change to any
-- existing column, so every row written before this migration stays valid and
-- nothing needs a backfill.
--
-- Why the shapes are what they are:
--
--   BrandKit.colors        one JSON value, not five text columns. The design
--                          engine's Zod schema is the real contract, and five
--                          nullable columns would let half a palette exist.
--   Design.document        the slides. A design is edited and saved as one
--                          unit by an autosave that fires 1.5 s after the last
--                          keystroke; a row per slide would make that the
--                          slowest part of the editor for no gain.
--   Design.revision        the optimistic lock behind "This design changed in
--                          another tab." A stale revision is refused, never
--                          merged.
--   DesignShare.tokenHash  only the hash is stored, as for activation and
--                          password reset tokens. A database leak yields no
--                          working share link.
--   presetId columns       plain text. Templates are data in code, versioned
--                          with git, so there is no templates table to point at.

-- CreateEnum
CREATE TYPE "BrandKitSource" AS ENUM ('MANUAL', 'EXTRACTED');

-- CreateEnum
CREATE TYPE "DesignFormat" AS ENUM ('SQUARE', 'PORTRAIT', 'STORY', 'LANDSCAPE');

-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('DRAFT', 'EXPORTED', 'SENT');

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "websiteUrl" TEXT,
    "logoMediaId" TEXT,
    "colors" JSONB NOT NULL,
    "source" "BrandKitSource" NOT NULL DEFAULT 'MANUAL',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "format" "DesignFormat" NOT NULL,
    "presetId" TEXT NOT NULL,
    "brandKitId" TEXT,
    "document" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" "DesignStatus" NOT NULL DEFAULT 'DRAFT',
    "exportedMediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastExportedRevision" INTEGER,
    "lastSlideIndex" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignShare" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),

    CONSTRAINT "DesignShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignFavourite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "presetId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignFavourite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandKit_organizationId_deletedAt_updatedAt_idx" ON "BrandKit"("organizationId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Design_organizationId_deletedAt_updatedAt_idx" ON "Design"("organizationId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Design_organizationId_format_idx" ON "Design"("organizationId", "format");

-- CreateIndex
CREATE UNIQUE INDEX "DesignShare_tokenHash_key" ON "DesignShare"("tokenHash");

-- CreateIndex
CREATE INDEX "DesignShare_designId_revokedAt_idx" ON "DesignShare"("designId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DesignFavourite_organizationId_presetId_key" ON "DesignFavourite"("organizationId", "presetId");

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_brandKitId_fkey" FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignShare" ADD CONSTRAINT "DesignShare_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignShare" ADD CONSTRAINT "DesignShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignFavourite" ADD CONSTRAINT "DesignFavourite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignFavourite" ADD CONSTRAINT "DesignFavourite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
