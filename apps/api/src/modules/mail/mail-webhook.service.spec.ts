/**
 * Resend's webhook: only a correctly signed delivery changes anything, and
 * only a permanent bounce or a complaint suppresses an address.
 */
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Webhook } from 'standardwebhooks';
import { securityLogger } from '../../common/logging/security-logger';
import type { MailRepository } from './mail.repository';
import { MailWebhookService, suppressionFor } from './mail-webhook.service';

// A Standard Webhooks secret: "whsec_" and base64 key bytes. Made up for the test.
const SECRET = `whsec_${Buffer.from('a-test-signing-key-that-is-long-enough').toString('base64')}`;

function signed(event: unknown, at = new Date()) {
  const payload = JSON.stringify(event);
  const id = 'msg_test_1';
  const signature = new Webhook(SECRET).sign(id, at, payload);
  return {
    body: Buffer.from(payload),
    headers: { id, timestamp: String(Math.floor(at.getTime() / 1000)), signature },
  };
}

function harness(secret: string | null = SECRET) {
  const repository = { suppress: jest.fn(async () => undefined) };
  const config = {
    get: (key: string) => (key === 'RESEND_WEBHOOK_SECRET' ? (secret ?? undefined) : undefined),
  };
  const service = new MailWebhookService(
    repository as unknown as MailRepository,
    config as unknown as ConfigService,
  );
  return { service, repository };
}

const bounce = (type: string) => ({
  type: 'email.bounced',
  created_at: '2026-11-12T10:00:00Z',
  data: {
    email_id: 'e1',
    to: ['Gone@Example.com'],
    bounce: { type, subType: 'General', message: 'mailbox does not exist' },
  },
});

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('MailWebhookService', () => {
  it('suppresses an address after a permanent bounce', async () => {
    const { service, repository } = harness();
    const { body, headers } = signed(bounce('Permanent'));

    await expect(service.receive(body, headers)).resolves.toEqual({
      received: true,
      type: 'email.bounced',
      suppressed: 1,
    });
    expect(repository.suppress).toHaveBeenCalledWith({
      email: 'gone@example.com',
      reason: 'BOUNCE',
      detail: 'Permanent, General',
      eventId: 'msg_test_1',
    });
  });

  it('suppresses after a spam complaint', async () => {
    const { service, repository } = harness();
    const { body, headers } = signed({
      type: 'email.complained',
      data: { to: ['ada@example.com'] },
    });

    await service.receive(body, headers);

    expect(repository.suppress).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', reason: 'COMPLAINT' }),
    );
  });

  it('ignores a transient bounce and every other event', async () => {
    const { service, repository } = harness();

    for (const event of [
      bounce('Transient'),
      { type: 'email.delivered', data: { to: ['a@b.co'] } },
    ]) {
      const { body, headers } = signed(event);
      await expect(service.receive(body, headers)).resolves.toMatchObject({ suppressed: 0 });
    }
    expect(repository.suppress).not.toHaveBeenCalled();
  });

  it('refuses a bad signature, a changed body and an old delivery, and logs it', async () => {
    const { service, repository } = harness();
    const good = signed(bounce('Permanent'));

    await expect(
      service.receive(good.body, { ...good.headers, signature: 'v1,AAAA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.receive(Buffer.from(good.body.toString().replace('Gone', 'Other')), good.headers),
    ).rejects.toBeInstanceOf(BadRequestException);
    const old = signed(bounce('Permanent'), new Date(Date.now() - 60 * 60 * 1000));
    await expect(service.receive(old.body, old.headers)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.receive(undefined, good.headers)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(repository.suppress).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('mail.webhook_rejected', expect.any(Object));
  });

  it('answers 503 when no signing secret is set', async () => {
    const { service } = harness(null);
    const { body, headers } = signed(bounce('Permanent'));

    await expect(service.receive(body, headers)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('suppressionFor', () => {
  it('reads only well-formed addresses', () => {
    expect(
      suppressionFor({ type: 'email.complained', data: { to: ['x', 42, ' A@B.co '] } }),
    ).toEqual({ reason: 'COMPLAINT', addresses: ['a@b.co'], detail: 'Marked as spam' });
    expect(suppressionFor({ type: 'email.complained', data: {} })).toBeNull();
  });
});
