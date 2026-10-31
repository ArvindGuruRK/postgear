/**
 * The Webhook trigger (Module 13) against a fake store: the bare 401s, the
 * size and JSON rules, the paused workflow that still keeps its test data,
 * the live run, a repeated Idempotency-Key, the per-workflow limit, secrets
 * hidden in what is kept, and the panel and secret routes.
 */
import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
// Not re-exported from the package root; the house `resilient-throttler.storage.ts` imports it the same way.
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { LIMITS } from '@postgear/automation';
import { Role } from '@postgear/db';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import type { SchedulingService } from '../../scheduling/scheduling.service';
import { WEBHOOK_MESSAGES } from '../automations.messages';
import { HookController, requestSize } from './hook.controller';
import { HOOK_CALLS_PER_MINUTE, HOOK_THROTTLER, HookThrottlerGuard } from './hook-throttler.guard';
import { WebhookController } from './webhook.controller';
import type { HookTarget, LiveRunCreate, WebhookRepository } from './webhook.repository';
import { type HookCall, hashWebhookSecret, WebhookService } from './webhook.service';

const ORG = 'org-1';
const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SECRET = 'pgwh_the-real-secret-value-0123456789abcdefghij';
const NOW = new Date('2026-11-02T09:30:00.000Z');

function fakeStore() {
  const state = {
    target: {
      id: ID,
      organizationId: ORG,
      status: 'ACTIVE',
      activeVersion: { id: 'version-1', triggerType: 'trigger.webhook' },
      webhookSecrets: [{ secretHash: hashWebhookSecret(SECRET) }],
    } as HookTarget,
    sample: null as unknown,
    sampleAt: null as Date | null,
    runs: [] as (LiveRunCreate & { id: string })[],
    secrets: [] as { secretHash: string; last4: string; createdAt: Date; revokedAt: Date | null }[],
  };
  const repository = {
    findHookTarget: jest.fn(async (id: string) => (id === ID ? state.target : null)),
    saveSample: jest.fn(async (_id: string, sample: unknown, at: Date) => {
      state.sample = sample;
      state.sampleAt = at;
    }),
    createLiveRun: jest.fn(async (data: LiveRunCreate) => {
      const first =
        data.triggerEventId === null
          ? undefined
          : state.runs.find((run) => run.triggerEventId === data.triggerEventId);
      if (first) return { runId: first.id, created: false };
      const id = `run-${state.runs.length + 1}`;
      state.runs.push({ ...data, id });
      return { runId: id, created: true };
    }),
    findPanel: jest.fn(async (org: string, id: string) =>
      org === ORG && id === ID
        ? {
            id,
            webhookSample: state.sample,
            webhookSampleAt: state.sampleAt,
            webhookSecrets: state.secrets
              .filter((secret) => !secret.revokedAt)
              .map(({ last4, createdAt }) => ({ last4, createdAt })),
          }
        : null,
    ),
    automationExists: jest.fn(async (org: string, id: string) => org === ORG && id === ID),
    replaceSecret: jest.fn(
      async (
        _org: string,
        _id: string,
        secret: { secretHash: string; last4: string },
        at: Date,
      ) => {
        for (const old of state.secrets) old.revokedAt ??= at;
        state.secrets.push({ ...secret, createdAt: at, revokedAt: null });
        state.target.webhookSecrets = state.secrets
          .filter((row) => !row.revokedAt)
          .map(({ secretHash }) => ({ secretHash }));
        return { last4: secret.last4, createdAt: at };
      },
    ),
  };
  return { state, repository };
}

function setup() {
  const { state, repository } = fakeStore();
  const scheduling = { startAutomationRun: jest.fn(async () => true) };
  const config = {
    get: (key: string) => (key === 'API_URL' ? 'https://api.postgear.test/' : undefined),
  };
  const service = new WebhookService(
    repository as unknown as WebhookRepository,
    scheduling as unknown as SchedulingService,
    config as never,
  );
  return { service, state, repository, scheduling };
}

function call(overrides: Partial<HookCall> = {}): HookCall {
  const body = overrides.body ?? { title: 'New Post', tags: ['launch'] };
  return {
    automationId: ID,
    secret: SECRET,
    contentType: 'application/json; charset=utf-8',
    size: Buffer.byteLength(JSON.stringify(body)),
    body,
    idempotencyKey: undefined,
    ...overrides,
  };
}

describe('WebhookService.receive', () => {
  it('answers a bare 401 for a missing, wrong or unknown secret or workflow', async () => {
    const { service, repository, scheduling } = setup();
    for (const bad of [
      call({ secret: undefined }),
      call({ secret: '' }),
      call({ secret: `${SECRET}x` }),
      call({ automationId: OTHER }),
      call({ automationId: 'not-a-uuid' }),
    ]) {
      await expect(service.receive(bad, NOW)).rejects.toMatchObject({
        status: 401,
        response: { message: WEBHOOK_MESSAGES.UNAUTHORIZED },
      });
    }
    expect(repository.saveSample).not.toHaveBeenCalled();
    expect(scheduling.startAutomationRun).not.toHaveBeenCalled();
  });

  it('refuses more than 256 KB with 413', async () => {
    const { service, repository } = setup();
    const big = { text: 'x'.repeat(300 * 1024) };
    await expect(
      service.receive(call({ body: big, size: Buffer.byteLength(JSON.stringify(big)) }), NOW),
    ).rejects.toMatchObject({ status: 413, response: { message: 'This request is too large.' } });
    expect(LIMITS.webhookBodyCapBytes).toBe(262_144);
    expect(repository.saveSample).not.toHaveBeenCalled();
  });

  it('refuses anything but a JSON object with 415', async () => {
    const { service } = setup();
    for (const bad of [
      call({ contentType: 'text/plain' }),
      call({ contentType: undefined }),
      call({ contentType: 'application/x-www-form-urlencoded' }),
      call({ body: [1, 2, 3] }),
      call({ body: 'hello' }),
    ]) {
      await expect(service.receive(bad, NOW)).rejects.toMatchObject({ status: 415 });
    }
  });

  it('keeps the data as test data but answers 409 while the workflow is off', async () => {
    const { service, state, scheduling } = setup();
    state.target.status = 'PAUSED';
    await expect(service.receive(call(), NOW)).rejects.toMatchObject({
      status: 409,
      response: { message: 'This workflow is not turned on.' },
    });
    expect(state.sample).toEqual({ title: 'New Post', tags: ['launch'] });
    expect(state.sampleAt).toEqual(NOW);
    expect(state.runs).toHaveLength(0);
    expect(scheduling.startAutomationRun).not.toHaveBeenCalled();
  });

  it('answers 409 when the live version starts with another trigger', async () => {
    const { service, state } = setup();
    state.target.activeVersion = { id: 'version-1', triggerType: 'trigger.manual' };
    await expect(service.receive(call(), NOW)).rejects.toMatchObject({ status: 409 });
  });

  it('starts a live run of the active version and answers 202', async () => {
    const { service, state, scheduling } = setup();
    await expect(service.receive(call(), NOW)).resolves.toEqual({
      status: HttpStatus.ACCEPTED,
      runId: 'run-1',
    });
    expect(state.runs[0]).toMatchObject({
      automationId: ID,
      organizationId: ORG,
      versionId: 'version-1',
      triggerType: 'trigger.webhook',
      triggerEventId: null,
      triggerPayload: {
        body: { title: 'New Post', tags: ['launch'] },
        receivedAt: NOW.toISOString(),
        headers: { contentType: 'application/json' },
      },
    });
    expect(scheduling.startAutomationRun).toHaveBeenCalledWith('run-1', ORG);
  });

  it('answers a repeated Idempotency-Key with the first run and 200', async () => {
    const { service, state, scheduling } = setup();
    const first = await service.receive(call({ idempotencyKey: 'order-42' }), NOW);
    const again = await service.receive(call({ idempotencyKey: 'order-42' }), NOW);
    expect(first).toEqual({ status: HttpStatus.ACCEPTED, runId: 'run-1' });
    expect(again).toEqual({ status: HttpStatus.OK, runId: 'run-1' });
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0].triggerEventId).toBe('webhook:order-42');
    expect(scheduling.startAutomationRun).toHaveBeenCalledTimes(1);
  });

  it('refuses an Idempotency-Key over 128 characters', async () => {
    const { service } = setup();
    await expect(
      service.receive(call({ idempotencyKey: 'k'.repeat(129) }), NOW),
    ).rejects.toMatchObject({ status: 400, response: { code: 'idempotency_key_too_long' } });
    await expect(
      service.receive(call({ idempotencyKey: 'k'.repeat(128) }), NOW),
    ).resolves.toMatchObject({ status: HttpStatus.ACCEPTED });
  });

  it('hides secret-looking values in what it keeps', async () => {
    const { service, state } = setup();
    await service.receive(call({ body: { password: 'x', name: 'Kim' } }), NOW);
    expect(state.sample).toEqual({ password: '[hidden]', name: 'Kim' });
    expect(state.runs[0].triggerPayload).toMatchObject({
      body: { password: '[hidden]', name: 'Kim' },
    });
  });

  it('accepts only the newest secret after a regenerate', async () => {
    const { service } = setup();
    const { secret } = await service.newSecret(ORG, ID, NOW);
    await expect(service.receive(call(), NOW)).rejects.toMatchObject({ status: 401 });
    await expect(service.receive(call({ secret }), NOW)).resolves.toMatchObject({
      status: HttpStatus.ACCEPTED,
    });
  });
});

describe('the panel and the secret', () => {
  it('shows the link, the last four characters and the sample, never the secret', async () => {
    const { service } = setup();
    expect(await service.panel(ORG, ID)).toEqual({
      url: `https://api.postgear.test/v1/automations/${ID}/hook`,
      secret: null,
      sample: null,
      sampleAt: null,
    });

    const created = await service.newSecret(ORG, ID, NOW);
    expect(created.secret).toMatch(/^pgwh_[A-Za-z0-9_-]{43}$/);
    expect(created).toEqual({
      secret: created.secret,
      last4: created.secret.slice(-4),
      url: `https://api.postgear.test/v1/automations/${ID}/hook`,
    });

    await service.receive(call({ secret: created.secret }), NOW);
    const panel = await service.panel(ORG, ID);
    expect(panel).toEqual({
      url: `https://api.postgear.test/v1/automations/${ID}/hook`,
      secret: { last4: created.last4, createdAt: NOW.toISOString() },
      sample: { title: 'New Post', tags: ['launch'] },
      sampleAt: NOW.toISOString(),
    });
    expect(JSON.stringify(panel)).not.toContain(created.secret);
    expect(JSON.stringify(panel)).not.toContain(hashWebhookSecret(created.secret));
  });

  it('stores only the hash of a new secret, and revokes the old one', async () => {
    const { service, state } = setup();
    const one = await service.newSecret(ORG, ID, NOW);
    const two = await service.newSecret(ORG, ID, NOW);
    expect(one.secret).not.toBe(two.secret);
    expect(JSON.stringify(state.secrets)).not.toContain(one.secret);
    expect(state.secrets.map((row) => row.revokedAt === null)).toEqual([false, true]);
  });

  it('answers 404 for another workspace workflow', async () => {
    const { service } = setup();
    await expect(service.panel('org-2', ID)).rejects.toMatchObject({ status: 404 });
    await expect(service.newSecret('org-2', ID, NOW)).rejects.toMatchObject({ status: 404 });
  });

  it('lets members read the panel and only admins make a secret', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, WebhookController)).toEqual([Role.ADMIN, Role.USER]);
    expect(reflector.get(ROLES_KEY, WebhookController.prototype.newSecret)).toEqual([Role.ADMIN]);
    expect(reflector.get(ROLES_KEY, WebhookController.prototype.panel)).toBeUndefined();
    expect(reflector.get(IS_PUBLIC_KEY, HookController)).toBe(true);
    expect(reflector.get(IS_PUBLIC_KEY, WebhookController)).toBeUndefined();
  });
});

describe('HookController', () => {
  it('measures the raw bytes, and passes the headers through', async () => {
    const { service, scheduling } = setup();
    const controller = new HookController(service);
    const body = { title: 'Hi' };
    const response = { status: jest.fn() };
    const request = {
      body,
      rawBody: Buffer.from(JSON.stringify(body)),
      headers: { 'content-type': 'application/json' },
    };

    const answer = await controller.hook(ID, request as never, response as never, {
      'x-postgear-secret': SECRET,
      'content-type': 'application/json',
      'idempotency-key': 'evt-1',
    });
    expect(answer).toEqual({ runId: 'run-1' });
    expect(response.status).toHaveBeenCalledWith(202);
    expect(scheduling.startAutomationRun).toHaveBeenCalled();

    await controller.hook(ID, request as never, response as never, {
      'x-postgear-secret': SECRET,
      'content-type': 'application/json',
      'idempotency-key': 'evt-1',
    });
    expect(response.status).toHaveBeenLastCalledWith(200);
  });

  it('falls back to the declared length when the raw body is not kept', () => {
    expect(requestSize({ headers: { 'content-length': '307200' } } as never)).toBe(307_200);
    expect(requestSize({ headers: {} } as never)).toBe(0);
  });
});

describe('HookThrottlerGuard', () => {
  class FakeStorage implements ThrottlerStorage {
    readonly hits = new Map<string, number>();
    async increment(key: string, _ttl: number, limit: number): Promise<ThrottlerStorageRecord> {
      const totalHits = (this.hits.get(key) ?? 0) + 1;
      this.hits.set(key, totalHits);
      return { totalHits, timeToExpire: 30, isBlocked: totalHits > limit, timeToBlockExpire: 30 };
    }
  }

  function context(id: string) {
    const req = {
      method: 'POST',
      path: `/v1/automations/${id}/hook`,
      params: { id },
      headers: {},
      ip: '10.0.0.1',
    };
    const res = { header: jest.fn() };
    return {
      res,
      context: {
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
        getHandler: () => function hook() {},
        getClass: () => HookController,
        getType: () => 'http',
      },
    };
  }

  it('lets 60 calls a minute through per workflow and answers the 61st with 429', async () => {
    const storage = new FakeStorage();
    const options: ThrottlerModuleOptions = {
      throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
    };
    const guard = new HookThrottlerGuard(options, storage, {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector);
    await guard.onModuleInit();

    for (let i = 0; i < HOOK_CALLS_PER_MINUTE; i++) {
      await expect(guard.canActivate(context(ID).context as never)).resolves.toBe(true);
    }
    const last = context(ID);
    await expect(guard.canActivate(last.context as never)).rejects.toMatchObject({
      status: 429,
      message: WEBHOOK_MESSAGES.THROTTLED,
    });
    expect(last.res.header).toHaveBeenCalledWith('Retry-After', 30);

    // Another workflow has its own minute.
    await expect(guard.canActivate(context(OTHER).context as never)).resolves.toBe(true);
    expect([...storage.hits.keys()]).toEqual([
      `${HOOK_THROTTLER}:${ID}`,
      `${HOOK_THROTTLER}:${OTHER}`,
    ]);
  });
});
