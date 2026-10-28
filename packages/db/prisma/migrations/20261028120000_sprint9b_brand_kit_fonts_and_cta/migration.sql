-- Sprint 9b (Studio Premium Pack): a brand kit gains its own heading and body
-- fonts, a Lock Brand Look switch, and the call to action a new design's
-- closing slide starts with. Additive: every column is nullable or has a
-- default, so existing kits keep working unchanged.

-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN     "bodyFont" TEXT,
ADD COLUMN     "ctaText" TEXT,
ADD COLUMN     "ctaUrl" TEXT,
ADD COLUMN     "headingFont" TEXT,
ADD COLUMN     "lockLook" BOOLEAN NOT NULL DEFAULT false;
