-- UI revamp: stored channel colours, and the home dashboard's weekly goal.
--
-- `Integration.color` is the avatar palette slot (0-based) a channel's
-- initials are drawn in. Until now the API computed it on every request: the
-- channel's position among every Integration row the workspace ever had,
-- soft-deleted rows included, ordered by `createdAt` then `id`, modulo the
-- seven palette colours. The backfill below writes exactly that value, so no
-- existing channel changes colour.
--
-- `id` is compared with the "C" collation because the old rule broke ties in
-- JavaScript, which orders strings by code unit; the database's default
-- collation may order punctuation differently (seed ids contain hyphens).

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "color" INTEGER;

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "weeklyPostGoal" INTEGER;

-- Backfill
UPDATE "Integration" AS integration
SET "color" = ranked.slot
FROM (
  SELECT
    "id",
    ((ROW_NUMBER() OVER (
      PARTITION BY "organizationId"
      ORDER BY "createdAt" ASC, "id" COLLATE "C" ASC
    )) - 1) % 7 AS slot
  FROM "Integration"
) AS ranked
WHERE integration."id" = ranked."id";
