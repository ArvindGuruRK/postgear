/**
 * MailService against a fake transport: what each email carries, how a
 * failure is retried, that nothing ever throws into the caller, and that the
 * logs never hold a link or a token.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { MailRepository } from './mail.repository';
import { MAIL_RETRY, MailService, maskAddress, scrub } from './mail.service';
import {
  ConsoleTransport,
  MailSendError,
  type MailTransport,
  type OutboundMail,
} from './mail.transport';
import { verifyUnsubscribe } from './mail.unsubscribe';

const SECRET = 's'.repeat(40);

function config(values: Record<string, string> = {}): ConfigService {
  const all: Record<string, string> = {
    WEB_URL: 'http://web.test',
    API_URL: 'http://api.test',
    JWT_SECRET: SECRET,
    SMTP_FROM: 'PostGear <no-reply@send.example>',
    ...values,
  };
  return { get: (key: string) => all[key] } as unknown as ConfigService;
}

class FakeTransport implements MailTransport {
  readonly name = 'resend' as const;
  sent: OutboundMail[] = [];
  signals: AbortSignal[] = [];
  failures: Error[] = [];

  async send(mail: OutboundMail, signal: AbortSignal) {
    this.signals.push(signal);
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(mail);
    return { id: `msg_${this.sent.length}` };
  }
}

function harness(options: { suppressed?: string[]; repositoryFails?: boolean } = {}) {
  const transport = new FakeTransport();
  const repository = {
    isSuppressed: jest.fn(async (email: string) => {
      if (options.repositoryFails) throw new Error('database down');
      return (options.suppressed ?? []).includes(email.toLowerCase());
    }),
  } as unknown as MailRepository;
  const service = new MailService(config(), repository, transport);
  const waits: number[] = [];
  (service as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async (ms) => {
    waits.push(ms);
  };
  return { service, transport, repository, waits };
}

/** Lets a background send finish. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const invitation = {
  workspaceName: 'Acme Social',
  inviterName: 'Grace Hopper',
  role: 'USER' as const,
  link: 'http://web.test/invite/abc.def',
  expiresAt: new Date('2026-10-26T12:00:00Z'),
};

let logs: string[];

beforeEach(() => {
  logs = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
      logs.push(String(args[0]));
    });
  }
});

afterEach(() => jest.restoreAllMocks());

describe('MailService.sendWorkspaceInvitation', () => {
  it('names the inviter, the workspace and the role, and carries the link and expiry', async () => {
    const { service, transport } = harness();

    await expect(service.sendWorkspaceInvitation('ada@example.com', invitation)).resolves.toBe(
      true,
    );

    const [message] = transport.sent;
    expect(message.to).toBe('ada@example.com');
    expect(message.from).toBe('PostGear <no-reply@send.example>');
    expect(message.subject).toBe('Grace Hopper invited you to Acme Social on PostGear');
    expect(message.text).toContain(
      'Grace Hopper invited you to join Acme Social on PostGear as a member.',
    );
    expect(message.text).toContain('http://web.test/invite/abc.def');
    expect(message.text).toContain('Expires: 26 October 2026 (UTC)');
    expect(message.text).toContain('works once');
    expect(message.html).toContain('href="http://web.test/invite/abc.def"');
    expect(message.html).toContain('Accept Invitation');
  });

  it('says "an admin" for the admin role', async () => {
    const { service, transport } = harness();

    await service.sendWorkspaceInvitation('ada@example.com', { ...invitation, role: 'ADMIN' });

    expect(transport.sent[0].text).toContain('as an admin.');
  });

  it('keeps the subject on one line whatever the names contain', async () => {
    const { service, transport } = harness();

    await service.sendWorkspaceInvitation('ada@example.com', {
      ...invitation,
      workspaceName: 'Acme\r\nBcc: victim@example.com',
      inviterName: '  Grace\n Hopper ',
    });

    const { subject } = transport.sent[0];
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toBe('Grace Hopper invited you to Acme Bcc: victim@example.com on PostGear');
  });

  it('says nothing about whether the address has an account', async () => {
    const { service, transport } = harness();

    await service.sendWorkspaceInvitation('ada@example.com', invitation);

    const { text } = transport.sent[0];
    expect(text).toContain('login or create an account');
    expect(text).not.toMatch(/already have an account|your account/i);
  });
});

describe('account and security mail', () => {
  it('sends in the background, so the caller does not wait for the provider', async () => {
    const { service, transport } = harness();
    let release: () => void = () => undefined;
    transport.send = jest.fn(
      () => new Promise((resolve) => (release = () => resolve({ id: 'x' }))),
    ) as never;

    await service.sendActivation('ada@example.com', 'tok_123');

    // The call returned while the send is still waiting on the provider.
    expect(transport.send).toHaveBeenCalledTimes(1);
    release();
    await settle();
    expect(logs.some((line) => line.includes('"event":"mail.sent"'))).toBe(true);
  });

  it('puts each link in HTML and text, and states how long it lasts', async () => {
    const { service, transport } = harness();

    await service.sendActivation('ada@example.com', 'tok/1');
    await service.sendPasswordReset('ada@example.com', 'tok_2');
    await service.sendAccountLocked('ada@example.com', 15, 'tok_3');
    await service.sendDuplicateRegistration('ada@example.com');
    await settle();

    const [activation, reset, locked, duplicate] = transport.sent;
    expect(activation.text).toContain('http://web.test/verify?token=tok%2F1');
    expect(activation.text).toContain('24 hours');
    expect(reset.html).toContain('http://web.test/reset-password/tok_2');
    expect(reset.text).toContain('1 hour');
    expect(locked.text).toContain('locked for 15 minutes');
    expect(locked.text).toContain('http://web.test/reset-password/tok_3');
    expect(duplicate.text).toContain('http://web.test/login');
    // No unsubscribe on security mail.
    for (const message of transport.sent) {
      expect(message.headers).toBeUndefined();
      expect(message.html.length).toBeGreaterThan(1_000);
    }
  });

  it('still sends security mail to a suppressed address', async () => {
    const { service, transport } = harness({ suppressed: ['ada@example.com'] });

    await service.sendPasswordReset('ada@example.com', 'tok');
    await settle();

    expect(transport.sent).toHaveLength(1);
  });
});

describe('retries and failures', () => {
  it('retries a transient failure with backoff, keeping one idempotency key', async () => {
    const { service, transport, waits } = harness();
    transport.failures.push(
      new MailSendError('rate_limit_exceeded: slow down', true),
      new MailSendError('internal_server_error: oops', true),
    );

    await expect(service.sendWorkspaceInvitation('ada@example.com', invitation)).resolves.toBe(
      true,
    );

    expect(transport.signals).toHaveLength(3);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(MAIL_RETRY.backoffMs[0]);
    expect(waits[1]).toBeGreaterThanOrEqual(MAIL_RETRY.backoffMs[1]);
    expect(logs.filter((line) => line.includes('"event":"mail.retry"'))).toHaveLength(2);
    expect(transport.sent[0].idempotencyKey).toMatch(/^workspace_invitation-/);
  });

  it('gives each try its own timeout signal', async () => {
    const { service, transport } = harness();

    await service.sendWorkspaceInvitation('ada@example.com', invitation);

    expect(transport.signals[0]).toBeInstanceOf(AbortSignal);
    expect(transport.signals[0].aborted).toBe(false);
  });

  it('does not retry a permanent failure, and reports false without throwing', async () => {
    const { service, transport, waits } = harness();
    transport.failures.push(new MailSendError('validation_error: bad from', false));

    await expect(service.sendPlain('ada@example.com', 'Hi', ['Hello'])).resolves.toBe(false);

    expect(transport.signals).toHaveLength(1);
    expect(waits).toHaveLength(0);
    expect(logs.some((line) => line.includes('"event":"mail.failed"'))).toBe(true);
  });

  it('gives up after the last attempt', async () => {
    const { service, transport } = harness();
    for (let i = 0; i < MAIL_RETRY.attempts; i += 1) {
      transport.failures.push(new MailSendError('network down', true));
    }

    await expect(service.sendPlain('ada@example.com', 'Hi', ['Hello'])).resolves.toBe(false);
    expect(transport.signals).toHaveLength(MAIL_RETRY.attempts);
  });

  it('never throws from a background send, even when the transport throws oddly', async () => {
    const { service, transport } = harness();
    transport.send = jest.fn(async () => {
      throw 'not even an Error';
    }) as never;

    await expect(service.sendActivation('ada@example.com', 'tok')).resolves.toBeUndefined();
    await settle();
  });

  it('never logs the link, the token or the full address', async () => {
    const { service, transport } = harness();
    transport.failures.push(
      new MailSendError('failed for http://web.test/reset-password/SECRET_TOKEN_123', false),
    );

    await service.sendPasswordReset('ada.lovelace@example.com', 'SECRET_TOKEN_123');
    await settle();

    const all = logs.join('\n');
    expect(all).not.toContain('SECRET_TOKEN_123');
    expect(all).not.toContain('reset-password');
    expect(all).not.toContain('ada.lovelace@');
    expect(all).toContain('a***@example.com');
  });

  it('refuses a malformed address without calling the transport', async () => {
    const { service, transport } = harness();

    await expect(service.sendPlain('not an address', 'Hi', ['x'])).resolves.toBe(false);
    await expect(service.sendPlain('a@b.c\r\nBcc: x@y.z', 'Hi', ['x'])).resolves.toBe(false);
    expect(transport.signals).toHaveLength(0);
  });

  it('never hands a reserved test domain to a real transport', async () => {
    const { service, transport } = harness();

    await expect(service.sendPlain('demo@postgear.local', 'Hi', ['x'])).resolves.toBe(false);
    await expect(service.sendPlain('qa@site.test', 'Hi', ['x'])).resolves.toBe(false);
    await service.sendPasswordReset('member@postgear.local', 'reset-token');
    await settle();

    expect(transport.signals).toHaveLength(0);
    expect(logs.join('\n')).toContain('mail.reserved_domain');
  });

  it('still prints mail for reserved domains with the console transport', async () => {
    const service = new MailService(config({ NODE_ENV: 'development' }));

    await expect(service.sendPlain('demo@postgear.local', 'Hi', ['x'])).resolves.toBe(true);
    expect(logs.join('\n')).not.toContain('mail.reserved_domain');
  });
});

describe('suppression', () => {
  it('skips notifications and invitations to a suppressed address', async () => {
    const { service, transport } = harness({ suppressed: ['ada@example.com'] });

    await expect(service.sendWorkspaceInvitation('ADA@example.com', invitation)).resolves.toBe(
      false,
    );
    await expect(service.sendPlain('ada@example.com', 'Hi', ['x'])).resolves.toBe(false);
    expect(transport.signals).toHaveLength(0);
    expect(logs.some((line) => line.includes('"event":"mail.suppressed"'))).toBe(true);
    await expect(service.isSuppressed('ada@example.com')).resolves.toBe(true);
  });

  it('sends anyway when the list cannot be read', async () => {
    const { service, transport } = harness({ repositoryFails: true });

    await expect(service.sendPlain('ada@example.com', 'Hi', ['x'])).resolves.toBe(true);
    expect(transport.sent).toHaveLength(1);
  });
});

describe('notifications', () => {
  const content = {
    subject: '[PostGear] Could not publish',
    tone: 'danger' as const,
    badge: 'Post Failed',
    heading: 'Post Failed',
    message: 'Your post could not be published.',
    facts: [{ label: 'Channel', value: 'Acme on LinkedIn' }],
    action: { label: 'Open The Queue', url: 'http://web.test/org_1/queue' },
    reason: 'You got this email because failure emails are on.',
    settingsUrl: 'http://web.test/org_1/settings/notifications',
  };

  it('adds one-click List-Unsubscribe headers with a token that verifies', async () => {
    const { service, transport } = harness();

    await service.sendNotification('ada@example.com', content, {
      unsubscribe: { topic: 'failure', orgId: 'org_1' },
    });

    const { headers, text } = transport.sent[0];
    expect(headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const match = headers?.['List-Unsubscribe']?.match(
      /^<http:\/\/api\.test\/mail\/unsubscribe\?token=([^>]+)>$/,
    );
    expect(match).not.toBeNull();
    expect(verifyUnsubscribe(SECRET, match?.[1])).toEqual({
      email: 'ada@example.com',
      topic: 'failure',
      orgId: 'org_1',
    });
    expect(text).toContain('Channel: Acme on LinkedIn');
    expect(text).toContain('Notification Settings: http://web.test/org_1/settings/notifications');
  });

  it('leaves the headers off when no topic is given (admin and owner mail)', async () => {
    const { service, transport } = harness();

    await service.sendNotification('ada@example.com', content);

    expect(transport.sent[0].headers).toBeUndefined();
  });
});

describe('dependency injection', () => {
  it('hands the real repository to MailService, so suppression runs', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [MailService, MailRepository, { provide: ConfigService, useValue: config() }],
    }).compile();

    const service = moduleRef.get(MailService);
    expect((service as unknown as { repository: unknown }).repository).toBeInstanceOf(
      MailRepository,
    );
  });
});

describe('transports', () => {
  it('refuses the console transport in production', () => {
    expect(() => new ConsoleTransport('production')).toThrow(/RESEND_API_KEY/);
    expect(() => new MailService(config({ NODE_ENV: 'production' }))).toThrow(
      /console transport never runs/,
    );
  });

  it('picks the console transport only outside production with no keys', () => {
    const service = new MailService(config({ NODE_ENV: 'development' }));
    expect((service as unknown as { transport: MailTransport }).transport.name).toBe('console');
  });

  it('picks Resend when RESEND_API_KEY is set, over SMTP', () => {
    const service = new MailService(
      config({
        NODE_ENV: 'production',
        RESEND_API_KEY: 're_test_placeholder',
        SMTP_HOST: 'smtp.example',
      }),
    );
    expect((service as unknown as { transport: MailTransport }).transport.name).toBe('resend');
  });

  it('picks SMTP when only SMTP_HOST is set', () => {
    const service = new MailService(config({ NODE_ENV: 'production', SMTP_HOST: 'smtp.example' }));
    expect((service as unknown as { transport: MailTransport }).transport.name).toBe('smtp');
  });
});

describe('helpers', () => {
  it('masks an address and scrubs links and tokens from errors', () => {
    expect(maskAddress('kim@example.com')).toBe('k***@example.com');
    expect(maskAddress('nope')).toBe('***');
    expect(
      scrub(new Error('bad https://x.test/reset/abc and abcdefghijklmnopqrstuvwxyz0123456789')),
    ).toBe('bad [link] and [redacted]');
  });
});
