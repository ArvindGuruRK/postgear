/**
 * Rows behind the Webhook trigger (Module 13): the workflow's private link
 * secret (stored only as a SHA-256 hash and its last four characters), the
 * last data received, and the live runs a call starts.
 */
import { Injectable } from '@nestjs/common';
import {
  AutomationRunMode,
  AutomationRunStatus,
  type AutomationStatus,
  Prisma,
  prisma,
} from '@postgear/db';

/** What the hook needs to accept a call: the active secrets and the live version. */
export interface HookTarget {
  id: string;
  organizationId: string;
  status: AutomationStatus;
  activeVersion: { id: string; triggerType: string } | null;
  webhookSecrets: { secretHash: string }[];
}

/** What the Webhook panel shows (the secret itself is never stored). */
export interface WebhookPanelRow {
  id: string;
  webhookSample: Prisma.JsonValue;
  webhookSampleAt: Date | null;
  webhookSecrets: { last4: string; createdAt: Date }[];
}

export interface LiveRunCreate {
  automationId: string;
  organizationId: string;
  versionId: string;
  triggerType: string;
  triggerPayload: Prisma.InputJsonValue;
  /** `webhook:<Idempotency-Key>`, or null when the caller sent none. */
  triggerEventId: string | null;
}

@Injectable()
export class WebhookRepository {
  async findHookTarget(id: string): Promise<HookTarget | null> {
    return prisma.automation.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        status: true,
        activeVersion: { select: { id: true, triggerType: true } },
        webhookSecrets: { where: { revokedAt: null }, select: { secretHash: true } },
      },
    });
  }

  async findPanel(orgId: string, id: string): Promise<WebhookPanelRow | null> {
    return prisma.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        webhookSample: true,
        webhookSampleAt: true,
        webhookSecrets: {
          where: { revokedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { last4: true, createdAt: true },
        },
      },
    });
  }

  async automationExists(orgId: string, id: string): Promise<boolean> {
    const row = await prisma.automation.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  /** Revokes every active secret of the workflow and adds the new one, together. */
  async replaceSecret(
    orgId: string,
    automationId: string,
    secret: { secretHash: string; last4: string },
    now: Date,
  ): Promise<{ last4: string; createdAt: Date }> {
    return prisma.$transaction(async (tx) => {
      await tx.automationWebhookSecret.updateMany({
        where: { automationId, organizationId: orgId, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.automationWebhookSecret.create({
        data: { automationId, organizationId: orgId, ...secret },
        select: { last4: true, createdAt: true },
      });
    });
  }

  async saveSample(id: string, sample: Prisma.InputJsonValue, at: Date): Promise<void> {
    await prisma.automation.update({
      where: { id },
      data: { webhookSample: sample, webhookSampleAt: at },
    });
  }

  /**
   * A live run. With an event id, a repeat of the same id finds the first
   * run (the unique `(automationId, triggerEventId)` index) instead of adding
   * one; `created` says which happened.
   */
  async createLiveRun(data: LiveRunCreate): Promise<{ runId: string; created: boolean }> {
    const row = {
      id: crypto.randomUUID(),
      automationId: data.automationId,
      organizationId: data.organizationId,
      versionId: data.versionId,
      mode: AutomationRunMode.LIVE,
      status: AutomationRunStatus.QUEUED,
      triggerType: data.triggerType,
      triggerEventId: data.triggerEventId,
      triggerPayload: data.triggerPayload,
    };

    if (data.triggerEventId === null) {
      await prisma.automationRun.create({ data: row, select: { id: true } });
      return { runId: row.id, created: true };
    }

    await prisma.automationRun.createMany({ data: [row], skipDuplicates: true });
    const existing = await prisma.automationRun.findFirst({
      where: { automationId: data.automationId, triggerEventId: data.triggerEventId },
      select: { id: true },
    });
    const runId = existing?.id ?? row.id;
    return { runId, created: runId === row.id };
  }
}
