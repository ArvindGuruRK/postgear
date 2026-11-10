-- Sprint 11: Discover (Module 07). The competitors a workspace follows: a name,
-- and the public places that competitor publishes (a website, its feeds, a
-- YouTube channel, a Bluesky handle, a Mastodon account, a news search).
--
-- Entirely additive: one new table, no change to any existing column, so every
-- row written before this migration stays valid and nothing needs a backfill.
--
-- Why the shapes are what they are:
--
--   no items table             what a competitor publishes is read when someone
--                              looks, kept in Redis for a limited time, and
--                              never written here.
--   feedUrls as TEXT[]         at most 5 addresses, read and replaced as one
--                              value. The cap, like the 20 live competitors a
--                              workspace may follow, is enforced in the API.
--   newsQuery nullable         null means "search for the name", so renaming a
--                              competitor moves its news search with it.
--   lastError as TEXT          one sentence the API wrote ("YouTube could not
--                              be reached."), never a response body.
--   deletedAt                  removing is a soft delete, like webhooks and
--                              brand kits. Every read filters on it, which is
--                              why the index carries it.
--   createdById with no FK     who added it, as a note. Removing that person
--                              must not touch the competitor.

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "feedUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "youtubeChannelId" TEXT,
    "blueskyHandle" TEXT,
    "mastodonAcct" TEXT,
    "newsQuery" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competitor_organizationId_deletedAt_idx" ON "Competitor"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
