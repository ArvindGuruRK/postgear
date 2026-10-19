-- UI revamp: a stored channel order, so admins can drag channels into the
-- order they want. The backfill keeps today's order: creation time, then id
-- (compared with the "C" collation, the way the API breaks ties), per
-- workspace, 0 first.

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "position" INTEGER;

-- Backfill
UPDATE "Integration" AS integration
SET "position" = ranked.position
FROM (
  SELECT
    "id",
    (ROW_NUMBER() OVER (
      PARTITION BY "organizationId"
      ORDER BY "createdAt" ASC, "id" COLLATE "C" ASC
    )) - 1 AS position
  FROM "Integration"
) AS ranked
WHERE integration."id" = ranked."id";
