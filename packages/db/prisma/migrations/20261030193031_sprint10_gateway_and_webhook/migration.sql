-- AlterEnum
ALTER TYPE "CreationMethod" ADD VALUE 'AUTOMATION';

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "webhookSample" JSONB,
ADD COLUMN     "webhookSampleAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AutomationEffect" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationWebhookSecret" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AutomationWebhookSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomationEffect_idempotencyKey_key" ON "AutomationEffect"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AutomationEffect_createdAt_idx" ON "AutomationEffect"("createdAt");

-- CreateIndex
CREATE INDEX "AutomationWebhookSecret_automationId_revokedAt_idx" ON "AutomationWebhookSecret"("automationId", "revokedAt");

-- AddForeignKey
ALTER TABLE "AutomationEffect" ADD CONSTRAINT "AutomationEffect_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationWebhookSecret" ADD CONSTRAINT "AutomationWebhookSecret_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationWebhookSecret" ADD CONSTRAINT "AutomationWebhookSecret_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
