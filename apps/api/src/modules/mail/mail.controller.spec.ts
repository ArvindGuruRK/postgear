/**
 * One-click unsubscribe: a signed token turns off one switch; anything else
 * changes nothing. GET never changes anything.
 */
import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { securityLogger } from '../../common/logging/security-logger';
import { MailController } from './mail.controller';
import type { MailRepository } from './mail.repository';
import type { MailWebhookService } from './mail-webhook.service';
import { signUnsubscribe, verifyUnsubscribe } from './mail.unsubscribe';

const SECRET = 'k'.repeat(40);

function harness() {
  const repository = { unsubscribe: jest.fn(async () => 1) };
  const config = {
    get: (key: string) =>
      ({ JWT_SECRET: SECRET, WEB_URL: 'https://app.test' })[key as 'JWT_SECRET' | 'WEB_URL'],
  };
  const controller = new MailController(
    {} as MailWebhookService,
    repository as unknown as MailRepository,
    config as unknown as ConfigService,
  );
  return { controller, repository };
}

beforeEach(() => {
  jest.spyOn(securityLogger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(securityLogger, 'log').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('unsubscribe tokens', () => {
  it('round-trips and lower-cases the address', () => {
    const token = signUnsubscribe(SECRET, {
      email: 'Ada@Example.com',
      topic: 'digest',
      orgId: 'org_1',
    });
    expect(verifyUnsubscribe(SECRET, token)).toEqual({
      email: 'ada@example.com',
      topic: 'digest',
      orgId: 'org_1',
    });
  });

  it('refuses another key, an edited body, a bad topic and junk', () => {
    const token = signUnsubscribe(SECRET, { email: 'a@b.co', topic: 'failure', orgId: 'o' });
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ e: 'b@b.co', t: 'failure', o: 'o' })).toString('base64url')}.${signature}`;
    const badTopic = signUnsubscribe(SECRET, {
      email: 'a@b.co',
      topic: 'everything' as never,
      orgId: 'o',
    });

    expect(verifyUnsubscribe('other'.repeat(10), token)).toBeNull();
    expect(verifyUnsubscribe(SECRET, forged)).toBeNull();
    expect(verifyUnsubscribe(SECRET, badTopic)).toBeNull();
    expect(verifyUnsubscribe(SECRET, 'a.b.c')).toBeNull();
    expect(verifyUnsubscribe(SECRET, undefined)).toBeNull();
  });
});

describe('MailController', () => {
  it('POST turns off the one switch the token names', async () => {
    const { controller, repository } = harness();
    const token = signUnsubscribe(SECRET, {
      email: 'ada@example.com',
      topic: 'success',
      orgId: 'org_1',
    });

    await expect(controller.unsubscribe(token)).resolves.toEqual({
      unsubscribed: true,
      topic: 'success',
    });
    expect(repository.unsubscribe).toHaveBeenCalledWith('ada@example.com', 'success');
  });

  it('POST refuses a bad token without touching anyone', async () => {
    const { controller, repository } = harness();

    await expect(controller.unsubscribe('nope')).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.unsubscribe).not.toHaveBeenCalled();
  });

  it('GET only redirects: to the settings page for a good token, to login otherwise', () => {
    const { controller, repository } = harness();
    const token = signUnsubscribe(SECRET, {
      email: 'ada@example.com',
      topic: 'success',
      orgId: 'org_1',
    });

    expect(controller.openUnsubscribe(token).url).toBe(
      'https://app.test/org_1/settings/notifications',
    );
    expect(controller.openUnsubscribe('nope').url).toBe('https://app.test/login');
    expect(repository.unsubscribe).not.toHaveBeenCalled();
  });
});
