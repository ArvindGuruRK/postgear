-- Sprint 13, Module 10: recipes and the brand kit for clips.
-- Additive only: a new table, six nullable BrandKit columns Studio ignores,
-- and one new ClipJobKind value (Auto-Edit Video). The ClipSound and
-- ClipSticker `search` lines Prisma also prints are the generated columns of
-- the Sprint 12 library migration and are left out on purpose.

-- AlterEnum
ALTER TYPE "ClipJobKind" ADD VALUE 'AUTO_EDIT';

-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN     "clipCaptionStyleId" TEXT,
ADD COLUMN     "clipIntroVideoId" TEXT,
ADD COLUMN     "clipLogoAssetId" TEXT,
ADD COLUMN     "clipLogoPosition" TEXT,
ADD COLUMN     "clipOutroText" TEXT,
ADD COLUMN     "clipOutroVideoId" TEXT;

-- CreateTable
CREATE TABLE "ClipRecipe" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "brandKitId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipRecipe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipRecipe_organizationId_idx" ON "ClipRecipe"("organizationId");

-- AddForeignKey
ALTER TABLE "ClipRecipe" ADD CONSTRAINT "ClipRecipe_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
