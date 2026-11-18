-- Sprint 12, Module 01: Clips.
--
-- Additive: seven tables, eight enums and three nullable columns on Media
-- (durationMs, fps, origin). ClipJob carries its priority from the start
-- (the module plan added it in Module 02; folded in here before any of it
-- was applied anywhere). No backfill: nothing exists yet.

-- CreateEnum
CREATE TYPE "ClipPlatform" AS ENUM ('YOUTUBE', 'TWITCH', 'KICK', 'UPLOAD');

-- CreateEnum
CREATE TYPE "ClipVideoKind" AS ENUM ('VIDEO', 'PAST_STREAM', 'CLIP', 'SHORT', 'UPLOAD');

-- CreateEnum
CREATE TYPE "ClipVideoStatus" AS ENUM ('IMPORTING', 'READY', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('NEW', 'DRAFT', 'HIDDEN');

-- CreateEnum
CREATE TYPE "ClipOrigin" AS ENUM ('MANUAL', 'AI_SIGNALS');

-- CreateEnum
CREATE TYPE "ClipAssetKind" AS ENUM ('ORIGINAL', 'PROXY', 'ANALYSIS_AUDIO', 'FILMSTRIP', 'WAVEFORM', 'POSTER', 'SIGNALS', 'SEGMENT', 'STICKER', 'AUDIO', 'DOWNLOAD', 'PROOF');

-- CreateEnum
CREATE TYPE "ClipJobKind" AS ENUM ('IMPORT', 'SEGMENT', 'HIGHLIGHTS', 'RENDER', 'DOWNLOAD');

-- CreateEnum
CREATE TYPE "ClipJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Media" ADD COLUMN     "durationMs" INTEGER,
ADD COLUMN     "fps" DOUBLE PRECISION,
ADD COLUMN     "origin" TEXT;

-- CreateTable
CREATE TABLE "ClipVideo" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "platform" "ClipPlatform" NOT NULL,
    "kind" "ClipVideoKind" NOT NULL,
    "externalId" TEXT,
    "canonicalUrl" TEXT,
    "title" TEXT NOT NULL,
    "channelName" TEXT,
    "durationMs" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "hasAudio" BOOLEAN NOT NULL DEFAULT true,
    "status" "ClipVideoStatus" NOT NULL DEFAULT 'IMPORTING',
    "error" JSONB,
    "hdAvailable" BOOLEAN NOT NULL DEFAULT true,
    "rightsConfirmedAt" TIMESTAMP(3),
    "rightsConfirmedById" TEXT,
    "rightsTextVersion" INTEGER,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "removedReason" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "videoId" TEXT,
    "clipId" TEXT,
    "kind" "ClipAssetKind" NOT NULL,
    "key" TEXT NOT NULL,
    "bytes" BIGINT NOT NULL,
    "mimeType" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ClipStatus" NOT NULL DEFAULT 'DRAFT',
    "origin" "ClipOrigin" NOT NULL DEFAULT 'MANUAL',
    "score" INTEGER,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "highlightRunId" TEXT,
    "document" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "ratio" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "lastExportedRevision" INTEGER,
    "lastExportedFingerprint" TEXT,
    "exportedMediaId" TEXT,
    "brandKitId" TEXT,
    "presetId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipHighlightRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "status" "ClipJobStatus" NOT NULL DEFAULT 'QUEUED',
    "engineVersion" INTEGER NOT NULL,
    "tracks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "params" JSONB NOT NULL,
    "aiMinutesCharged" INTEGER NOT NULL DEFAULT 0,
    "usageEntryId" TEXT,
    "found" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ClipHighlightRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ClipJobKind" NOT NULL,
    "status" "ClipJobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "videoId" TEXT,
    "clipId" TEXT,
    "highlightRunId" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ClipJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipPost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "postGroup" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipLayoutPreset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ratio" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipLayoutPreset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClipVideo_organizationId_deletedAt_idx" ON "ClipVideo"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "ClipVideo_organizationId_platform_externalId_idx" ON "ClipVideo"("organizationId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "ClipVideo_expiresAt_idx" ON "ClipVideo"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClipAsset_key_key" ON "ClipAsset"("key");

-- CreateIndex
CREATE INDEX "ClipAsset_organizationId_idx" ON "ClipAsset"("organizationId");

-- CreateIndex
CREATE INDEX "ClipAsset_videoId_kind_idx" ON "ClipAsset"("videoId", "kind");

-- CreateIndex
CREATE INDEX "ClipAsset_clipId_kind_idx" ON "ClipAsset"("clipId", "kind");

-- CreateIndex
CREATE INDEX "Clip_organizationId_status_idx" ON "Clip"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Clip_videoId_idx" ON "Clip"("videoId");

-- CreateIndex
CREATE INDEX "ClipHighlightRun_videoId_createdAt_idx" ON "ClipHighlightRun"("videoId", "createdAt");

-- CreateIndex
CREATE INDEX "ClipJob_organizationId_kind_status_idx" ON "ClipJob"("organizationId", "kind", "status");

-- CreateIndex
CREATE INDEX "ClipJob_status_createdAt_idx" ON "ClipJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ClipJob_videoId_kind_idx" ON "ClipJob"("videoId", "kind");

-- CreateIndex
CREATE INDEX "ClipJob_clipId_kind_idx" ON "ClipJob"("clipId", "kind");

-- CreateIndex
CREATE INDEX "ClipPost_clipId_idx" ON "ClipPost"("clipId");

-- CreateIndex
CREATE INDEX "ClipPost_postGroup_idx" ON "ClipPost"("postGroup");

-- CreateIndex
CREATE INDEX "ClipPost_organizationId_idx" ON "ClipPost"("organizationId");

-- CreateIndex
CREATE INDEX "ClipLayoutPreset_organizationId_idx" ON "ClipLayoutPreset"("organizationId");

-- AddForeignKey
ALTER TABLE "ClipVideo" ADD CONSTRAINT "ClipVideo_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipAsset" ADD CONSTRAINT "ClipAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipAsset" ADD CONSTRAINT "ClipAsset_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ClipVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipAsset" ADD CONSTRAINT "ClipAsset_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ClipVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipHighlightRun" ADD CONSTRAINT "ClipHighlightRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipJob" ADD CONSTRAINT "ClipJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipJob" ADD CONSTRAINT "ClipJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "ClipVideo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipPost" ADD CONSTRAINT "ClipPost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipPost" ADD CONSTRAINT "ClipPost_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipLayoutPreset" ADD CONSTRAINT "ClipLayoutPreset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
