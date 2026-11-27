-- Sprint 13, Module 11: a clip stitched from 2 to 15 other clips (a montage).
-- Additive only: one new ClipOrigin value, no column and no row changes.
-- The other videos a montage plays live in Clip.meta (videoIds), which is
-- already nullable JSON.

-- AlterEnum
ALTER TYPE "ClipOrigin" ADD VALUE 'MONTAGE';
