-- Sprint 12, Module 01: plans as data, and the usage ledger.
--
-- Additive: four new tables and two enums. Limits stop being fields on a
-- plan: a key is declared in code (packages/entitlements), its value per tier
-- is a PlanEntitlement row, a workspace can carry an override with an end
-- date, every edit adds an EntitlementChange row, and used allowances are an
-- insert-only UsageEntry ledger in thousandths.
--
-- The seed at the end inserts the 13 Clips keys for the five tiers (65 rows)
-- with ON CONFLICT DO NOTHING, so it never overwrites an operator edit, and
-- logs one EntitlementChange row per cell. The values match TIER_SEED in
-- packages/entitlements/src/seed.ts; a test there checks they agree.

-- CreateEnum
CREATE TYPE "EntitlementChangeAction" AS ENUM ('SET', 'REMOVE', 'EXPIRE', 'ADJUST_USAGE', 'RESET_TO_SEED');

-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('CHARGE', 'REVERSAL', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "PlanEntitlement" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgEntitlementOverride" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgEntitlementOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementChange" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "tier" TEXT,
    "organizationId" TEXT,
    "key" TEXT NOT NULL,
    "action" "EntitlementChangeAction" NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntitlementChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "refId" TEXT,
    "reversesId" TEXT,
    "cycleStart" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanEntitlement_tier_key_key" ON "PlanEntitlement"("tier", "key");

-- CreateIndex
CREATE INDEX "OrgEntitlementOverride_expiresAt_idx" ON "OrgEntitlementOverride"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgEntitlementOverride_organizationId_key_key" ON "OrgEntitlementOverride"("organizationId", "key");

-- CreateIndex
CREATE INDEX "EntitlementChange_createdAt_idx" ON "EntitlementChange"("createdAt");

-- CreateIndex
CREATE INDEX "EntitlementChange_organizationId_createdAt_idx" ON "EntitlementChange"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "EntitlementChange_scope_tier_key_createdAt_idx" ON "EntitlementChange"("scope", "tier", "key", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEntry_organizationId_meter_cycleStart_idx" ON "UsageEntry"("organizationId", "meter", "cycleStart");

-- CreateIndex
CREATE INDEX "UsageEntry_refId_idx" ON "UsageEntry"("refId");

-- CreateIndex
CREATE INDEX "UsageEntry_reversesId_idx" ON "UsageEntry"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageEntry_organizationId_idempotencyKey_key" ON "UsageEntry"("organizationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "OrgEntitlementOverride" ADD CONSTRAINT "OrgEntitlementOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEntry" ADD CONSTRAINT "UsageEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: the Clips keys for every tier (placeholders the operator edits).
INSERT INTO "PlanEntitlement" ("id", "tier", "key", "value", "updatedBy", "updatedAt", "createdAt") VALUES
  ('seed_free_clips_enabled', 'FREE', 'clips.enabled', 'true'::jsonb, NULL, now(), now()),
  ('seed_free_clips_max_video_minutes', 'FREE', 'clips.max_video_minutes', '60'::jsonb, NULL, now(), now()),
  ('seed_free_clips_import_minutes_per_month', 'FREE', 'clips.import_minutes_per_month', '180'::jsonb, NULL, now(), now()),
  ('seed_free_clips_storage_gb', 'FREE', 'clips.storage_gb', '3'::jsonb, NULL, now(), now()),
  ('seed_free_clips_retention_days', 'FREE', 'clips.retention_days', '7'::jsonb, NULL, now(), now()),
  ('seed_free_clips_export_max_quality', 'FREE', 'clips.export_max_quality', '"720p"'::jsonb, NULL, now(), now()),
  ('seed_free_clips_export_watermark', 'FREE', 'clips.export_watermark', 'true'::jsonb, NULL, now(), now()),
  ('seed_free_clips_ai_minutes_per_month', 'FREE', 'clips.ai_minutes_per_month', '30'::jsonb, NULL, now(), now()),
  ('seed_free_clips_concurrent_imports', 'FREE', 'clips.concurrent_imports', '1'::jsonb, NULL, now(), now()),
  ('seed_free_clips_upload_max_gb', 'FREE', 'clips.upload_max_gb', '2'::jsonb, NULL, now(), now()),
  ('seed_free_clips_downloads_per_day', 'FREE', 'clips.downloads_per_day', '5'::jsonb, NULL, now(), now()),
  ('seed_free_clips_queue_priority', 'FREE', 'clips.queue_priority', '"low"'::jsonb, NULL, now(), now()),
  ('seed_free_clips_browse_channels', 'FREE', 'clips.browse_channels', '1'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_enabled', 'STANDARD', 'clips.enabled', 'true'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_max_video_minutes', 'STANDARD', 'clips.max_video_minutes', '180'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_import_minutes_per_month', 'STANDARD', 'clips.import_minutes_per_month', '900'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_storage_gb', 'STANDARD', 'clips.storage_gb', '15'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_retention_days', 'STANDARD', 'clips.retention_days', '14'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_export_max_quality', 'STANDARD', 'clips.export_max_quality', '"1080p"'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_export_watermark', 'STANDARD', 'clips.export_watermark', 'false'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_ai_minutes_per_month', 'STANDARD', 'clips.ai_minutes_per_month', '300'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_concurrent_imports', 'STANDARD', 'clips.concurrent_imports', '2'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_upload_max_gb', 'STANDARD', 'clips.upload_max_gb', '2'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_downloads_per_day', 'STANDARD', 'clips.downloads_per_day', '20'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_queue_priority', 'STANDARD', 'clips.queue_priority', '"normal"'::jsonb, NULL, now(), now()),
  ('seed_standard_clips_browse_channels', 'STANDARD', 'clips.browse_channels', '3'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_enabled', 'PRO', 'clips.enabled', 'true'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_max_video_minutes', 'PRO', 'clips.max_video_minutes', '360'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_import_minutes_per_month', 'PRO', 'clips.import_minutes_per_month', '2400'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_storage_gb', 'PRO', 'clips.storage_gb', '50'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_retention_days', 'PRO', 'clips.retention_days', '30'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_export_max_quality', 'PRO', 'clips.export_max_quality', '"1080p60"'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_export_watermark', 'PRO', 'clips.export_watermark', 'false'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_ai_minutes_per_month', 'PRO', 'clips.ai_minutes_per_month', '900'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_concurrent_imports', 'PRO', 'clips.concurrent_imports', '2'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_upload_max_gb', 'PRO', 'clips.upload_max_gb', '2'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_downloads_per_day', 'PRO', 'clips.downloads_per_day', '20'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_queue_priority', 'PRO', 'clips.queue_priority', '"normal"'::jsonb, NULL, now(), now()),
  ('seed_pro_clips_browse_channels', 'PRO', 'clips.browse_channels', '5'::jsonb, NULL, now(), now()),
  ('seed_team_clips_enabled', 'TEAM', 'clips.enabled', 'true'::jsonb, NULL, now(), now()),
  ('seed_team_clips_max_video_minutes', 'TEAM', 'clips.max_video_minutes', '360'::jsonb, NULL, now(), now()),
  ('seed_team_clips_import_minutes_per_month', 'TEAM', 'clips.import_minutes_per_month', '7200'::jsonb, NULL, now(), now()),
  ('seed_team_clips_storage_gb', 'TEAM', 'clips.storage_gb', '150'::jsonb, NULL, now(), now()),
  ('seed_team_clips_retention_days', 'TEAM', 'clips.retention_days', '30'::jsonb, NULL, now(), now()),
  ('seed_team_clips_export_max_quality', 'TEAM', 'clips.export_max_quality', '"1080p60"'::jsonb, NULL, now(), now()),
  ('seed_team_clips_export_watermark', 'TEAM', 'clips.export_watermark', 'false'::jsonb, NULL, now(), now()),
  ('seed_team_clips_ai_minutes_per_month', 'TEAM', 'clips.ai_minutes_per_month', '3000'::jsonb, NULL, now(), now()),
  ('seed_team_clips_concurrent_imports', 'TEAM', 'clips.concurrent_imports', '3'::jsonb, NULL, now(), now()),
  ('seed_team_clips_upload_max_gb', 'TEAM', 'clips.upload_max_gb', '2'::jsonb, NULL, now(), now()),
  ('seed_team_clips_downloads_per_day', 'TEAM', 'clips.downloads_per_day', '50'::jsonb, NULL, now(), now()),
  ('seed_team_clips_queue_priority', 'TEAM', 'clips.queue_priority', '"high"'::jsonb, NULL, now(), now()),
  ('seed_team_clips_browse_channels', 'TEAM', 'clips.browse_channels', '10'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_enabled', 'ULTIMATE', 'clips.enabled', 'true'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_max_video_minutes', 'ULTIMATE', 'clips.max_video_minutes', '360'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_import_minutes_per_month', 'ULTIMATE', 'clips.import_minutes_per_month', '18000'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_storage_gb', 'ULTIMATE', 'clips.storage_gb', '400'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_retention_days', 'ULTIMATE', 'clips.retention_days', '60'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_export_max_quality', 'ULTIMATE', 'clips.export_max_quality', '"1080p60"'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_export_watermark', 'ULTIMATE', 'clips.export_watermark', 'false'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_ai_minutes_per_month', 'ULTIMATE', 'clips.ai_minutes_per_month', '10000'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_concurrent_imports', 'ULTIMATE', 'clips.concurrent_imports', '4'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_upload_max_gb', 'ULTIMATE', 'clips.upload_max_gb', '2'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_downloads_per_day', 'ULTIMATE', 'clips.downloads_per_day', '100'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_queue_priority', 'ULTIMATE', 'clips.queue_priority', '"high"'::jsonb, NULL, now(), now()),
  ('seed_ultimate_clips_browse_channels', 'ULTIMATE', 'clips.browse_channels', '20'::jsonb, NULL, now(), now())
ON CONFLICT ("tier", "key") DO NOTHING;

-- One change-log row per seeded cell.
INSERT INTO "EntitlementChange" ("id", "scope", "tier", "organizationId", "key", "action", "oldValue", "newValue", "reason", "actorId", "actorEmail", "createdAt") VALUES
  ('seedlog_free_clips_enabled', 'PLAN', 'FREE', NULL, 'clips.enabled', 'SET', NULL, 'true'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_max_video_minutes', 'PLAN', 'FREE', NULL, 'clips.max_video_minutes', 'SET', NULL, '60'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_import_minutes_per_month', 'PLAN', 'FREE', NULL, 'clips.import_minutes_per_month', 'SET', NULL, '180'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_storage_gb', 'PLAN', 'FREE', NULL, 'clips.storage_gb', 'SET', NULL, '3'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_retention_days', 'PLAN', 'FREE', NULL, 'clips.retention_days', 'SET', NULL, '7'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_export_max_quality', 'PLAN', 'FREE', NULL, 'clips.export_max_quality', 'SET', NULL, '"720p"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_export_watermark', 'PLAN', 'FREE', NULL, 'clips.export_watermark', 'SET', NULL, 'true'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_ai_minutes_per_month', 'PLAN', 'FREE', NULL, 'clips.ai_minutes_per_month', 'SET', NULL, '30'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_concurrent_imports', 'PLAN', 'FREE', NULL, 'clips.concurrent_imports', 'SET', NULL, '1'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_upload_max_gb', 'PLAN', 'FREE', NULL, 'clips.upload_max_gb', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_downloads_per_day', 'PLAN', 'FREE', NULL, 'clips.downloads_per_day', 'SET', NULL, '5'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_queue_priority', 'PLAN', 'FREE', NULL, 'clips.queue_priority', 'SET', NULL, '"low"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_free_clips_browse_channels', 'PLAN', 'FREE', NULL, 'clips.browse_channels', 'SET', NULL, '1'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_enabled', 'PLAN', 'STANDARD', NULL, 'clips.enabled', 'SET', NULL, 'true'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_max_video_minutes', 'PLAN', 'STANDARD', NULL, 'clips.max_video_minutes', 'SET', NULL, '180'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_import_minutes_per_month', 'PLAN', 'STANDARD', NULL, 'clips.import_minutes_per_month', 'SET', NULL, '900'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_storage_gb', 'PLAN', 'STANDARD', NULL, 'clips.storage_gb', 'SET', NULL, '15'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_retention_days', 'PLAN', 'STANDARD', NULL, 'clips.retention_days', 'SET', NULL, '14'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_export_max_quality', 'PLAN', 'STANDARD', NULL, 'clips.export_max_quality', 'SET', NULL, '"1080p"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_export_watermark', 'PLAN', 'STANDARD', NULL, 'clips.export_watermark', 'SET', NULL, 'false'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_ai_minutes_per_month', 'PLAN', 'STANDARD', NULL, 'clips.ai_minutes_per_month', 'SET', NULL, '300'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_concurrent_imports', 'PLAN', 'STANDARD', NULL, 'clips.concurrent_imports', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_upload_max_gb', 'PLAN', 'STANDARD', NULL, 'clips.upload_max_gb', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_downloads_per_day', 'PLAN', 'STANDARD', NULL, 'clips.downloads_per_day', 'SET', NULL, '20'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_queue_priority', 'PLAN', 'STANDARD', NULL, 'clips.queue_priority', 'SET', NULL, '"normal"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_standard_clips_browse_channels', 'PLAN', 'STANDARD', NULL, 'clips.browse_channels', 'SET', NULL, '3'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_enabled', 'PLAN', 'PRO', NULL, 'clips.enabled', 'SET', NULL, 'true'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_max_video_minutes', 'PLAN', 'PRO', NULL, 'clips.max_video_minutes', 'SET', NULL, '360'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_import_minutes_per_month', 'PLAN', 'PRO', NULL, 'clips.import_minutes_per_month', 'SET', NULL, '2400'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_storage_gb', 'PLAN', 'PRO', NULL, 'clips.storage_gb', 'SET', NULL, '50'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_retention_days', 'PLAN', 'PRO', NULL, 'clips.retention_days', 'SET', NULL, '30'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_export_max_quality', 'PLAN', 'PRO', NULL, 'clips.export_max_quality', 'SET', NULL, '"1080p60"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_export_watermark', 'PLAN', 'PRO', NULL, 'clips.export_watermark', 'SET', NULL, 'false'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_ai_minutes_per_month', 'PLAN', 'PRO', NULL, 'clips.ai_minutes_per_month', 'SET', NULL, '900'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_concurrent_imports', 'PLAN', 'PRO', NULL, 'clips.concurrent_imports', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_upload_max_gb', 'PLAN', 'PRO', NULL, 'clips.upload_max_gb', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_downloads_per_day', 'PLAN', 'PRO', NULL, 'clips.downloads_per_day', 'SET', NULL, '20'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_queue_priority', 'PLAN', 'PRO', NULL, 'clips.queue_priority', 'SET', NULL, '"normal"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_pro_clips_browse_channels', 'PLAN', 'PRO', NULL, 'clips.browse_channels', 'SET', NULL, '5'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_enabled', 'PLAN', 'TEAM', NULL, 'clips.enabled', 'SET', NULL, 'true'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_max_video_minutes', 'PLAN', 'TEAM', NULL, 'clips.max_video_minutes', 'SET', NULL, '360'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_import_minutes_per_month', 'PLAN', 'TEAM', NULL, 'clips.import_minutes_per_month', 'SET', NULL, '7200'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_storage_gb', 'PLAN', 'TEAM', NULL, 'clips.storage_gb', 'SET', NULL, '150'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_retention_days', 'PLAN', 'TEAM', NULL, 'clips.retention_days', 'SET', NULL, '30'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_export_max_quality', 'PLAN', 'TEAM', NULL, 'clips.export_max_quality', 'SET', NULL, '"1080p60"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_export_watermark', 'PLAN', 'TEAM', NULL, 'clips.export_watermark', 'SET', NULL, 'false'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_ai_minutes_per_month', 'PLAN', 'TEAM', NULL, 'clips.ai_minutes_per_month', 'SET', NULL, '3000'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_concurrent_imports', 'PLAN', 'TEAM', NULL, 'clips.concurrent_imports', 'SET', NULL, '3'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_upload_max_gb', 'PLAN', 'TEAM', NULL, 'clips.upload_max_gb', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_downloads_per_day', 'PLAN', 'TEAM', NULL, 'clips.downloads_per_day', 'SET', NULL, '50'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_queue_priority', 'PLAN', 'TEAM', NULL, 'clips.queue_priority', 'SET', NULL, '"high"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_team_clips_browse_channels', 'PLAN', 'TEAM', NULL, 'clips.browse_channels', 'SET', NULL, '10'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_enabled', 'PLAN', 'ULTIMATE', NULL, 'clips.enabled', 'SET', NULL, 'true'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_max_video_minutes', 'PLAN', 'ULTIMATE', NULL, 'clips.max_video_minutes', 'SET', NULL, '360'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_import_minutes_per_month', 'PLAN', 'ULTIMATE', NULL, 'clips.import_minutes_per_month', 'SET', NULL, '18000'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_storage_gb', 'PLAN', 'ULTIMATE', NULL, 'clips.storage_gb', 'SET', NULL, '400'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_retention_days', 'PLAN', 'ULTIMATE', NULL, 'clips.retention_days', 'SET', NULL, '60'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_export_max_quality', 'PLAN', 'ULTIMATE', NULL, 'clips.export_max_quality', 'SET', NULL, '"1080p60"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_export_watermark', 'PLAN', 'ULTIMATE', NULL, 'clips.export_watermark', 'SET', NULL, 'false'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_ai_minutes_per_month', 'PLAN', 'ULTIMATE', NULL, 'clips.ai_minutes_per_month', 'SET', NULL, '10000'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_concurrent_imports', 'PLAN', 'ULTIMATE', NULL, 'clips.concurrent_imports', 'SET', NULL, '4'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_upload_max_gb', 'PLAN', 'ULTIMATE', NULL, 'clips.upload_max_gb', 'SET', NULL, '2'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_downloads_per_day', 'PLAN', 'ULTIMATE', NULL, 'clips.downloads_per_day', 'SET', NULL, '100'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_queue_priority', 'PLAN', 'ULTIMATE', NULL, 'clips.queue_priority', 'SET', NULL, '"high"'::jsonb, 'Seed', NULL, NULL, now()),
  ('seedlog_ultimate_clips_browse_channels', 'PLAN', 'ULTIMATE', NULL, 'clips.browse_channels', 'SET', NULL, '20'::jsonb, 'Seed', NULL, NULL, now())
ON CONFLICT ("id") DO NOTHING;
