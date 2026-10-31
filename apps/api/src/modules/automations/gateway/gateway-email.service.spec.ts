/**
 * The Email step's gateway (Module 12) on the in-memory run and effect
 * tables: binding, address checks, the schema's 10-recipient cap, the
 * daily workspace cap, a mail failure as retryable, and a retry that skips
 * everyone already emailed.
 */
import {
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LIMITS } from '@postgear/automation';
import { FakeGatewayDb, graphWith, ORG, RUN } from './testing/fake-gateway-db';

const db = new FakeGatewayDb();

/** `findMany` for the daily count, over the fake effect rows. */
const findMany = jest.fn(
  async (args: { where: { organizationId: string; kind: string; createdAt: { gte: Date } } }) =>
    db.effects
      .filter(
        (effect) =>
          effect.organizationId === args.where.organizationId &&
          effect.kind === args.where.kind &&
          effect.createdAt.getTime() >= args.where.createdAt.gte.getTime(),
      )
      .map((effect) => ({ result: effect.result })),
);

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  get prisma() {
    return {
      ...db.prisma,
      automationEffect: { ...db.prisma.automationEffect, findMany },
    };
  },
}));

import { GatewayBindingService } from './gateway-binding.service';
import { gatewayEmailSchema } from './gateway-email.schema';
import {
  EMAIL_LIMIT_MESSAGE,
  GatewayEmailService,
  maskEmail,
  notAnEmail,
} from './gateway-email.service';

const binding = { runId: RUN, nodeKey: 'mail01', organizationId: ORG };
const KEY = `${RUN}:mail01`;

function body(overrides: Record<string, unknown> = {}) {
  return {
    ...binding,
    to: ['kim@example.com', 'ash@example.com'],
    subject: 'Weekly report',
    message: 'All good.\nSee you.',
    ...overrides,
  } as Parameters<GatewayEmailService['send']>[0];
}

describe('GatewayEmailService', () => {
  let mail: { sendPlain: jest.Mock };
  let service: GatewayEmailService;

  beforeEach(() => {
    db.runs = [];
    db.effects = [];
    db.now = () => new Date();
    jest.clearAllMocks();
    db.addRun({
      graph: graphWith({ mail01: 'notify.email' }),
      automation: { name: 'Weekly Mail' },
    });
    mail = { sendPlain: jest.fn(async () => true) };
    service = new GatewayEmailService(new GatewayBindingService(), mail as never);
  });

  it('emails each person once, in plain text, and answers masked recipients', async () => {
    const answer = await service.send(
      body({ to: ['kim@example.com', 'KIM@example.com', 'ash@example.com'] }),
    );

    expect(answer).toEqual({
      output: { sent: 2, recipients: ['k***@example.com', 'a***@example.com'] },
      credits: 0,
    });
    expect(mail.sendPlain).toHaveBeenCalledTimes(2);
    expect(mail.sendPlain).toHaveBeenCalledWith('kim@example.com', '(Test) Weekly report', [
      'All good.',
      'See you.',
      '',
      'Sent by the workflow Weekly Mail in PostGear.',
    ]);
    expect(db.effect(KEY)).toMatchObject({ kind: 'email', status: 'DONE' });
  });

  it('keeps the subject on one line and leaves "(Test)" off live runs', async () => {
    db.runs[0].mode = 'LIVE';
    db.runs[0].version = { graph: db.runs[0].graphSnapshot };
    await service.send(body({ to: ['kim@example.com'], subject: 'Hi\r\nBcc: x@evil.example' }));
    expect(mail.sendPlain).toHaveBeenCalledWith(
      'kim@example.com',
      'Hi Bcc: x@evil.example',
      expect.any(Array),
    );
  });

  it('refuses a value that is not an email address, naming it, before sending', async () => {
    await expect(service.send(body({ to: ['kim@example.com', 'kim at work'] }))).rejects.toEqual(
      new UnprocessableEntityException({
        message: "'kim at work' is not an email address.",
        code: 'invalid_email',
      }),
    );
    expect(mail.sendPlain).not.toHaveBeenCalled();
    expect(db.effects).toHaveLength(0);
    expect(notAnEmail('x'.repeat(100))).toMatch(/^'x{57}\.\.\.' is not an email address\.$/);
  });

  it('refuses an empty subject', async () => {
    await expect(service.send(body({ subject: ' \n ' }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('only acts for a live run’s Email step', async () => {
    await expect(service.send(body({ nodeKey: 'other' }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
    db.runs[0].status = 'SUCCEEDED';
    await expect(service.send(body())).rejects.toBeInstanceOf(NotFoundException);
    expect(mail.sendPlain).not.toHaveBeenCalled();
  });

  it('a retry after a mail failure skips the people already emailed', async () => {
    mail.sendPlain.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await expect(service.send(body())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.effect(KEY)).toMatchObject({
      status: 'FAILED',
      result: { sentTo: ['kim@example.com'] },
    });

    mail.sendPlain.mockClear();
    const answer = await service.send(body());

    expect(mail.sendPlain).toHaveBeenCalledTimes(1);
    expect(mail.sendPlain).toHaveBeenCalledWith(
      'ash@example.com',
      expect.any(String),
      expect.any(Array),
    );
    expect(answer.output).toEqual({
      sent: 2,
      recipients: ['k***@example.com', 'a***@example.com'],
    });
  });

  it('a retry after success returns the stored answer without emailing again', async () => {
    const first = await service.send(body());
    const second = await service.send(body());
    expect(second).toEqual(first);
    expect(mail.sendPlain).toHaveBeenCalledTimes(2);
  });

  it('stops at 200 workflow emails a day per workspace, counted per recipient', async () => {
    // 199 already sent today by other steps.
    const now = new Date();
    db.effects.push(
      {
        id: 'eff_a',
        organizationId: ORG,
        idempotencyKey: 'other-run:mail01',
        kind: 'email',
        status: 'DONE',
        result: { output: { sent: 190, recipients: [] }, credits: 0 },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'eff_b',
        organizationId: ORG,
        idempotencyKey: 'third-run:mail01',
        kind: 'email',
        status: 'FAILED',
        result: { sentTo: Array.from({ length: 9 }, (_, i) => `p${i}@example.com`) },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'eff_old',
        organizationId: ORG,
        idempotencyKey: 'yesterday:mail01',
        kind: 'email',
        status: 'DONE',
        result: { output: { sent: 500, recipients: [] }, credits: 0 },
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        updatedAt: now,
      },
    );
    await expect(service.sentToday(ORG, now)).resolves.toBe(199);

    await expect(service.send(body())).rejects.toEqual(
      new UnprocessableEntityException({ message: EMAIL_LIMIT_MESSAGE, code: 'limit_reached' }),
    );
    expect(EMAIL_LIMIT_MESSAGE).toBe('This workspace has sent its 200 workflow emails for today.');
    expect(LIMITS.workflowEmailsPerDay).toBe(200);
    expect(mail.sendPlain).not.toHaveBeenCalled();

    // One recipient still fits.
    db.effects = db.effects.filter((effect) => effect.idempotencyKey !== KEY);
    await expect(service.send(body({ to: ['kim@example.com'] }))).resolves.toMatchObject({
      output: { sent: 1 },
    });
  });

  it('masks addresses to the first character and the domain', () => {
    expect(maskEmail('kim@example.com')).toBe('k***@example.com');
    expect(maskEmail('weird')).toBe('***');
  });
});

describe('gatewayEmailSchema', () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => `p${i}@example.com`);
  const valid = { ...binding, subject: 'Hi', message: 'Hello' };

  it('takes 1 to 10 recipients and refuses 11 or none', () => {
    expect(gatewayEmailSchema.safeParse({ ...valid, to: people(10) }).success).toBe(true);
    expect(gatewayEmailSchema.safeParse({ ...valid, to: people(11) }).success).toBe(false);
    expect(gatewayEmailSchema.safeParse({ ...valid, to: [] }).success).toBe(false);
  });

  it('is strict', () => {
    expect(gatewayEmailSchema.safeParse({ ...valid, to: people(1), cc: ['x@y.z'] }).success).toBe(
      false,
    );
  });
});
