-- Sprint 12, Module 01: the open sound and sticker library, and My Channels.
--
-- Additive: nine tables and three enums. Prisma cannot declare a generated
-- column, so the search columns of ClipSound and ClipSticker are written by
-- hand: a tsvector from name (A), tags (B) and category (C) with the 'simple'
-- configuration, so tags and non-English names are not stemmed away. Their
-- GIN indexes are declared in the schema, so later diffs keep them.
-- array_to_string is only STABLE, and a generated column needs an IMMUTABLE
-- expression, hence the one-line wrapper function. A CHECK makes a favourite
-- point at exactly one of a sound and a sticker.

-- An IMMUTABLE wrapper, so the generated search columns may use it.
CREATE OR REPLACE FUNCTION clip_library_tags_text(tags TEXT[]) RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(array_to_string(tags, ' '), '') $$;

-- CreateEnum
CREATE TYPE "ClipSoundKind" AS ENUM ('SFX', 'MUSIC');

-- CreateEnum
CREATE TYPE "ClipStickerKind" AS ENUM ('STATIC', 'ANIMATED');

-- CreateEnum
CREATE TYPE "ClipLibraryStatus" AS ENUM ('STAGED', 'ACTIVE', 'HIDDEN', 'REMOVED');

-- CreateTable
CREATE TABLE "ClipLibrarySource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "licenceUrl" TEXT NOT NULL,
    "creditLine" TEXT,
    "changeNote" TEXT,
    "noticeText" TEXT,
    "requiresCredit" BOOLEAN NOT NULL DEFAULT false,
    "creditPerItem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipLibrarySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipSound" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "ClipSoundKind" NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[],
    "category" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "bpm" INTEGER,
    "loudnessLufs" DOUBLE PRECISION NOT NULL,
    "truePeakDb" DOUBLE PRECISION NOT NULL,
    "peaks" JSONB NOT NULL,
    "fileKey" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "featured" INTEGER NOT NULL DEFAULT 0,
    "licence" TEXT NOT NULL,
    "licenceUrl" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorUrl" TEXT,
    "origin" TEXT NOT NULL,
    "originId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "originalWork" BOOLEAN NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "ClipLibraryStatus" NOT NULL DEFAULT 'STAGED',
    "statusReason" TEXT,
    "statusById" TEXT,
    "statusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, coalesce("name", '')), 'A') ||
        setweight(to_tsvector('simple'::regconfig, clip_library_tags_text("tags")), 'B') ||
        setweight(to_tsvector('simple'::regconfig, coalesce("category", '')), 'C')
    ) STORED,

    CONSTRAINT "ClipSound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipSticker" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "kind" "ClipStickerKind" NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[],
    "category" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "frames" INTEGER,
    "fps" INTEGER,
    "fileKey" TEXT NOT NULL,
    "previewKey" TEXT,
    "bytes" INTEGER NOT NULL,
    "featured" INTEGER NOT NULL DEFAULT 0,
    "licence" TEXT NOT NULL,
    "licenceUrl" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorUrl" TEXT,
    "origin" TEXT NOT NULL,
    "originId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "originalWork" BOOLEAN NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "sourceChecksum" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" "ClipLibraryStatus" NOT NULL DEFAULT 'STAGED',
    "statusReason" TEXT,
    "statusById" TEXT,
    "statusAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "search" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, coalesce("name", '')), 'A') ||
        setweight(to_tsvector('simple'::regconfig, clip_library_tags_text("tags")), 'B') ||
        setweight(to_tsvector('simple'::regconfig, coalesce("category", '')), 'C')
    ) STORED,

    CONSTRAINT "ClipSticker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipFavourite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "soundId" TEXT,
    "stickerId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipFavourite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipLibraryRun" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "rejectionsByReason" JSONB,
    "reportKey" TEXT,

    CONSTRAINT "ClipLibraryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipLibraryDeny" (
    "id" TEXT NOT NULL,
    "sourceChecksum" TEXT,
    "origin" TEXT,
    "originId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipLibraryDeny_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipLibraryMiss" (
    "term" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipLibraryMiss_pkey" PRIMARY KEY ("term","kind")
);

-- CreateTable
CREATE TABLE "ClipChannel" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" "ClipPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "uploadsListId" TEXT,
    "broadcasterType" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipChannelHidden" (
    "channelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipChannelHidden_pkey" PRIMARY KEY ("channelId","externalId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClipLibrarySource_code_key" ON "ClipLibrarySource"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ClipSound_fileKey_key" ON "ClipSound"("fileKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClipSound_sourceChecksum_key" ON "ClipSound"("sourceChecksum");

-- CreateIndex
CREATE INDEX "ClipSound_kind_category_status_idx" ON "ClipSound"("kind", "category", "status");

-- CreateIndex
CREATE INDEX "ClipSound_search_idx" ON "ClipSound" USING GIN ("search");

-- CreateIndex
CREATE UNIQUE INDEX "ClipSound_origin_originId_key" ON "ClipSound"("origin", "originId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipSticker_fileKey_key" ON "ClipSticker"("fileKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClipSticker_sourceChecksum_key" ON "ClipSticker"("sourceChecksum");

-- CreateIndex
CREATE INDEX "ClipSticker_kind_category_status_idx" ON "ClipSticker"("kind", "category", "status");

-- CreateIndex
CREATE INDEX "ClipSticker_search_idx" ON "ClipSticker" USING GIN ("search");

-- CreateIndex
CREATE UNIQUE INDEX "ClipSticker_origin_originId_key" ON "ClipSticker"("origin", "originId");

-- CreateIndex
CREATE INDEX "ClipFavourite_organizationId_createdAt_idx" ON "ClipFavourite"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipFavourite_organizationId_soundId_key" ON "ClipFavourite"("organizationId", "soundId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipFavourite_organizationId_stickerId_key" ON "ClipFavourite"("organizationId", "stickerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipLibraryDeny_sourceChecksum_key" ON "ClipLibraryDeny"("sourceChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "ClipLibraryDeny_origin_originId_key" ON "ClipLibraryDeny"("origin", "originId");

-- CreateIndex
CREATE UNIQUE INDEX "ClipChannel_organizationId_platform_externalId_key" ON "ClipChannel"("organizationId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "ClipSound" ADD CONSTRAINT "ClipSound_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ClipLibrarySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipSound" ADD CONSTRAINT "ClipSound_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ClipLibraryRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipSticker" ADD CONSTRAINT "ClipSticker_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ClipLibrarySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipSticker" ADD CONSTRAINT "ClipSticker_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ClipLibraryRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_soundId_fkey" FOREIGN KEY ("soundId") REFERENCES "ClipSound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "ClipSticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipChannel" ADD CONSTRAINT "ClipChannel_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipChannelHidden" ADD CONSTRAINT "ClipChannelHidden_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ClipChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A favourite is a sound or a sticker, never both and never neither.
ALTER TABLE "ClipFavourite" ADD CONSTRAINT "ClipFavourite_one_item_check"
    CHECK (("soundId" IS NULL) <> ("stickerId" IS NULL));
