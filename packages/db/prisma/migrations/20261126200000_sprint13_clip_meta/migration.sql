-- Sprint 13, Module 06 (Look For Action): a small JSON of facts about how AI
-- found a clip, kept apart from the short reason codes. Holds `{ seen }`, the
-- still checker's one sentence. Additive and nullable: existing rows stay as they are.

-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "meta" JSONB;
