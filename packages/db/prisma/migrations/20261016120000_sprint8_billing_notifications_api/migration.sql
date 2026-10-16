-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "NotificationEmailStatus" AS ENUM ('NONE', 'PENDING', 'SENDING', 'SENT', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'FAILED');

-- AlterTable
ALTER TABLE "Notifications" ADD COLUMN     "emailStatus" "NotificationEmailStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "emailedAt" TIMESTAMP(3),
ADD COLUMN     "meta" JSONB,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'info';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "lastStripeEventAt" TIMESTAMP(3),
ADD COLUMN     "scheduledPeriod" "Period",
ADD COLUMN     "scheduledTier" "SubscriptionTier",
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Webhooks" ADD COLUMN     "disabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "events" TEXT[] DEFAULT ARRAY['post.published', 'post.failed']::TEXT[],
ADD COLUMN     "secret" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "NotificationCursor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "deliveryKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "organizationId" TEXT,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationCursor_userId_organizationId_key" ON "NotificationCursor"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_deliveryKey_key" ON "WebhookDelivery"("deliveryKey");

-- CreateIndex
CREATE INDEX "WebhookDelivery_organizationId_createdAt_idx" ON "WebhookDelivery"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_createdAt_idx" ON "WebhookDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhookId_createdAt_idx" ON "WebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "BillingEvent_organizationId_createdAt_idx" ON "BillingEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notifications_emailStatus_idx" ON "Notifications"("emailStatus");

-- AddForeignKey
ALTER TABLE "NotificationCursor" ADD CONSTRAINT "NotificationCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationCursor" ADD CONSTRAINT "NotificationCursor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "Webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
