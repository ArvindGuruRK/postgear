/**
 * The Webhook trigger (Module 13): another app starts a workflow by sending
 * JSON to its private link, `POST /v1/automations/:id/hook`, with the
 * secret in `X-PostGear-Secret`.
 *
 * - **The secret is stored as a SHA-256 hash** and its last four
 *   characters. A random 32-byte secret needs no slow hash: there is
 *   nothing to guess. Every active hash is compared with `safeCompare`, so
 *   the answer takes the same time whichever one matches. A missing secret,
 *   a wrong one and an unknown workflow all answer the same bare 401.
 * - **Limits.** 256 KB of data (`LIMITS.webhookBodyCapBytes`, measured on the
 *   raw bytes), JSON objects only, and 60 calls a minute per workflow
 *   (`HookThrottlerGuard`, on top of the per-address limit).
 * - **The last data received is always kept** (redacted, 64 KB), even while
 *   the workflow is off: that is how a person building the workflow gets
 *   real test data before turning it on.
 * - **Only an active workflow whose live version starts with the Webhook
 *   trigger runs** (202 `{ runId }`); anything else is 409.
 * - **`Idempotency-Key`** (at most 128 characters) becomes the run's
 *   `triggerEventId` (`webhook:<key>`): a retried call finds the first run
 *   and answers 200 with its id, so the other app's retries never run the
 *   workflow twice.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LIMITS, redact } from '@postgear/automation';
import { type Prisma, safeCompare } from '@postgear/db';
import type { Env } from '../../../config/env';
import { SchedulingService } from '../../scheduling/scheduling.service';
import { WEBHOOK_MESSAGES } from '../automations.messages';
import { WebhookRepository } from './webhook.repository';

export const WEBHOOK_TRIGGER_TYPE = 'trigger.webhook';
export const WEBHOOK_SECRET_PREFIX = 'pgwh_';
export const WEBHOOK_SECRET_HEADER = 'x-postgear-secret';
export const IDEMPOTENCY_KEY_MAX = 128;
/** The saved sample is capped like a step's data. */
export const WEBHOOK_SAMPLE_CAP_BYTES = 65_536;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the controller hands over from the request. */
export interface HookCall {
  automationId: string;
  secret: string | undefined;
  contentType: string | undefined;
  /** Bytes as received (`request.rawBody`), else the declared length. */
  size: number;
  body: unknown;
  idempotencyKey: string | undefined;
}

export interface HookAnswer {
  status: HttpStatus.OK | HttpStatus.ACCEPTED;
  runId: string;
}

export interface WebhookPanel {
  url: string;
  secret: { last4: string; createdAt: string } | null;
  sample: Prisma.JsonValue | null;
  sampleAt: string | null;
}

export interface NewWebhookSecret {
  /** Shown once. */
  secret: string;
  last4: string;
  url: string;
}

export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** `application/json`, with or without a charset. */
export function isJsonContentType(contentType: string | undefined): boolean {
  const media = contentType?.split(';')[0]?.trim().toLowerCase();
  return media === 'application/json';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException(WEBHOOK_MESSAGES.UNAUTHORIZED);
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly repository: WebhookRepository,
    private readonly scheduling: SchedulingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  hookUrl(automationId: string): string {
    const base = this.config.get('API_URL', { infer: true }).replace(/\/+$/, '');
    return `${base}/v1/automations/${automationId}/hook`;
  }

  /* ───────────────────────── the panel ───────────────────────── */

  async panel(orgId: string, automationId: string): Promise<WebhookPanel> {
    const row = UUID_PATTERN.test(automationId)
      ? await this.repository.findPanel(orgId, automationId)
      : null;
    if (!row) throw new NotFoundException(WEBHOOK_MESSAGES.WORKFLOW_NOT_FOUND);

    const secret = row.webhookSecrets[0];
    return {
      url: this.hookUrl(row.id),
      secret: secret ? { last4: secret.last4, createdAt: secret.createdAt.toISOString() } : null,
      sample: row.webhookSample ?? null,
      sampleAt: row.webhookSampleAt?.toISOString() ?? null,
    };
  }

  /** Creates the secret, or replaces it: the old one stops working at once. */
  async newSecret(
    orgId: string,
    automationId: string,
    now = new Date(),
  ): Promise<NewWebhookSecret> {
    const exists =
      UUID_PATTERN.test(automationId) &&
      (await this.repository.automationExists(orgId, automationId));
    if (!exists) throw new NotFoundException(WEBHOOK_MESSAGES.WORKFLOW_NOT_FOUND);

    const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
    const saved = await this.repository.replaceSecret(
      orgId,
      automationId,
      { secretHash: hashWebhookSecret(secret), last4: secret.slice(-4) },
      now,
    );
    this.logger.log(
      JSON.stringify({ event: 'automation.webhook.secret_created', orgId, automationId }),
    );
    return { secret, last4: saved.last4, url: this.hookUrl(automationId) };
  }

  /* ───────────────────────── the hook ───────────────────────── */

  async receive(call: HookCall, now = new Date()): Promise<HookAnswer> {
    if (!call.secret || !UUID_PATTERN.test(call.automationId)) throw unauthorized();
    if (call.size > LIMITS.webhookBodyCapBytes) {
      throw new PayloadTooLargeException(WEBHOOK_MESSAGES.TOO_LARGE);
    }
    if (!isJsonContentType(call.contentType)) {
      throw new UnsupportedMediaTypeException(WEBHOOK_MESSAGES.JSON_ONLY);
    }

    const target = await this.repository.findHookTarget(call.automationId);
    const presented = hashWebhookSecret(call.secret);
    // Every hash is compared, matched or not, so timing says nothing.
    let matched = false;
    for (const { secretHash } of target?.webhookSecrets ?? []) {
      if (safeCompare(presented, secretHash)) matched = true;
    }
    if (!target || !matched) {
      this.logger.warn(
        JSON.stringify({
          event: 'automation.webhook.unauthorized',
          automationId: call.automationId,
          known: target !== null,
        }),
      );
      throw unauthorized();
    }

    const key = call.idempotencyKey?.trim() ?? '';
    if (key.length > IDEMPOTENCY_KEY_MAX) {
      throw new BadRequestException({
        message: WEBHOOK_MESSAGES.IDEMPOTENCY_KEY_TOO_LONG,
        code: 'idempotency_key_too_long',
      });
    }
    if (!isPlainObject(call.body)) {
      throw new UnsupportedMediaTypeException(WEBHOOK_MESSAGES.JSON_ONLY);
    }

    // Kept whether or not the workflow runs: the trigger's test data.
    const sample = redact(call.body, { capBytes: WEBHOOK_SAMPLE_CAP_BYTES }).value;
    await this.repository.saveSample(target.id, sample as Prisma.InputJsonValue, now);

    const version = target.activeVersion;
    if (target.status !== 'ACTIVE' || version?.triggerType !== WEBHOOK_TRIGGER_TYPE) {
      throw new ConflictException({ message: WEBHOOK_MESSAGES.NOT_ON, code: 'workflow_not_on' });
    }

    const payload = redact(
      {
        body: call.body,
        receivedAt: now.toISOString(),
        headers: { contentType: 'application/json' },
      },
      { capBytes: LIMITS.stepIoCapBytes },
    ).value as Prisma.InputJsonValue;

    const { runId, created } = await this.repository.createLiveRun({
      automationId: target.id,
      organizationId: target.organizationId,
      versionId: version.id,
      triggerType: WEBHOOK_TRIGGER_TYPE,
      triggerPayload: payload,
      triggerEventId: key ? `webhook:${key}` : null,
    });

    if (created) {
      // False is logged by the scheduler; the reconcile starts the run later.
      await this.scheduling.startAutomationRun(runId, target.organizationId);
    }
    return { status: created ? HttpStatus.ACCEPTED : HttpStatus.OK, runId };
  }
}
