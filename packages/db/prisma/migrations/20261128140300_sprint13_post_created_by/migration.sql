-- Sprint 13, Module 14: who first saved a post.
--
-- Additive: a nullable plain id (no foreign key, as on "Clip"), so work by an
-- Editor can be attributed. Existing rows stay null; nothing is backfilled.

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "createdById" TEXT;
