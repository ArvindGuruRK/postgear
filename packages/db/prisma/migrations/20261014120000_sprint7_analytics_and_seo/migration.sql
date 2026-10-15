-- CreateEnum
CREATE TYPE "AnalyticsSyncStatus" AS ENUM ('NEVER', 'OK', 'FAILED', 'UNSUPPORTED', 'NEEDS_RECONNECT', 'NEEDS_PERMISSIONS');

-- CreateEnum
CREATE TYPE "SEOAuditStatus" AS ENUM ('PENDING', 'CRAWLING', 'SCORING', 'ADVISING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "ChannelMetricSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostMetricSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSync" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "status" "AnalyticsSyncStatus" NOT NULL DEFAULT 'NEVER',
    "lastSyncedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "channelDays" INTEGER NOT NULL DEFAULT 0,
    "postsSynced" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SEOAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "status" "SEOAuditStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "overallScore" INTEGER,
    "grade" TEXT,
    "onPageScore" INTEGER,
    "technicalScore" INTEGER,
    "contentScore" INTEGER,
    "backlinkScore" INTEGER,
    "crawlMode" TEXT,
    "durationMs" INTEGER,
    "auditData" JSONB,
    "aiAdvice" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SEOAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelMetricSnapshot_organizationId_date_idx" ON "ChannelMetricSnapshot"("organizationId", "date");

-- CreateIndex
CREATE INDEX "ChannelMetricSnapshot_integrationId_date_idx" ON "ChannelMetricSnapshot"("integrationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMetricSnapshot_integrationId_metric_date_key" ON "ChannelMetricSnapshot"("integrationId", "metric", "date");

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_organizationId_capturedAt_idx" ON "PostMetricSnapshot"("organizationId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_postId_capturedAt_idx" ON "PostMetricSnapshot"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "PostMetricSnapshot_integrationId_capturedAt_idx" ON "PostMetricSnapshot"("integrationId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSync_integrationId_key" ON "AnalyticsSync"("integrationId");

-- CreateIndex
CREATE INDEX "AnalyticsSync_organizationId_idx" ON "AnalyticsSync"("organizationId");

-- CreateIndex
CREATE INDEX "SEOAudit_organizationId_createdAt_idx" ON "SEOAudit"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SEOAudit_organizationId_targetUrl_createdAt_idx" ON "SEOAudit"("organizationId", "targetUrl", "createdAt");

-- AddForeignKey
ALTER TABLE "ChannelMetricSnapshot" ADD CONSTRAINT "ChannelMetricSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMetricSnapshot" ADD CONSTRAINT "ChannelMetricSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMetricSnapshot" ADD CONSTRAINT "PostMetricSnapshot_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSync" ADD CONSTRAINT "AnalyticsSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSync" ADD CONSTRAINT "AnalyticsSync_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "Integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SEOAudit" ADD CONSTRAINT "SEOAudit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

