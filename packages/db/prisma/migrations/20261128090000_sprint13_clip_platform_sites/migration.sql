-- Sprint 13, Module 12: more sites a link can come from (D13-08).
-- Additive only: new ClipPlatform values, no column and no row changes.
-- The enum is kept (rather than turned into a string) because only three
-- API files map the lower-case site id to it, with toUpperCase.

-- AlterEnum
ALTER TYPE "ClipPlatform" ADD VALUE 'VIMEO';
ALTER TYPE "ClipPlatform" ADD VALUE 'RUMBLE';
ALTER TYPE "ClipPlatform" ADD VALUE 'DAILYMOTION';
ALTER TYPE "ClipPlatform" ADD VALUE 'LOOM';
ALTER TYPE "ClipPlatform" ADD VALUE 'X';
ALTER TYPE "ClipPlatform" ADD VALUE 'FACEBOOK';
ALTER TYPE "ClipPlatform" ADD VALUE 'LINKEDIN';
ALTER TYPE "ClipPlatform" ADD VALUE 'REDDIT';
ALTER TYPE "ClipPlatform" ADD VALUE 'PINTEREST';
ALTER TYPE "ClipPlatform" ADD VALUE 'THREADS';
ALTER TYPE "ClipPlatform" ADD VALUE 'ZOOM';
ALTER TYPE "ClipPlatform" ADD VALUE 'TIKTOK';
ALTER TYPE "ClipPlatform" ADD VALUE 'INSTAGRAM';
ALTER TYPE "ClipPlatform" ADD VALUE 'DROPBOX';
