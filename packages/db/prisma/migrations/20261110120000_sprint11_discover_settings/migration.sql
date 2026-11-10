-- Sprint 11: Discover (Module 06). What a workspace starts Discover from: a
-- default place, the languages to read and write in, the news topics it
-- follows and which groups it shows.
--
-- Entirely additive: one new table and one new enum, no change to any existing
-- column, so every row written before this migration stays valid and nothing
-- needs a backfill. A workspace with no row simply has no default yet.
--
-- Why the shapes are what they are:
--
--   organizationId as the key  one row per workspace at most, so the workspace's
--                              own id is the id and there is nothing to look up.
--   no latitude or longitude   a position is used once to find the city and is
--                              never kept. The row holds the city, the region,
--                              the country and the time zone.
--   locationSource NONE        a null country alone cannot tell "never saved"
--                              from a saved Worldwide. NONE is "never saved".
--   sources as JSONB           five on and off switches read as one value; a
--                              missing key means on, so a new group needs no
--                              migration.
--
-- Nothing from a feed is stored here or anywhere in Postgres: Discover's items
-- live in Redis for a limited time. Competitors get their own table and their
-- own migration in Module 07.

-- CreateEnum
CREATE TYPE "DiscoverLocationSource" AS ENUM ('NONE', 'BROWSER', 'SEARCH', 'TIMEZONE');

-- CreateTable
CREATE TABLE "DiscoverSettings" (
    "organizationId" TEXT NOT NULL,
    "countryCode" TEXT,
    "regionCode" TEXT,
    "regionName" TEXT,
    "city" TEXT,
    "timeZone" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sources" JSONB,
    "locationSource" "DiscoverLocationSource" NOT NULL DEFAULT 'NONE',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverSettings_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "DiscoverSettings" ADD CONSTRAINT "DiscoverSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoverSettings" ADD CONSTRAINT "DiscoverSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
