/**
 * The health route against a mocked database, and the Sentry test route's
 * two outcomes: a superadmin gets the deliberate error, anyone else a 403.
 */
import { ForbiddenException, HttpException } from '@nestjs/common';

jest.mock('@postgear/db', () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock('../../common/sentry/sentry', () => ({ isSentryEnabled: () => false }));

import { prisma } from '@postgear/db';
import { HealthController } from './health.controller';

const queryRaw = prisma.$queryRaw as unknown as jest.Mock;
const user = (isSuperAdmin: boolean) => ({
  id: 'u1',
  email: 'x@y.z',
  isSuperAdmin,
  onboardingCompletedAt: null,
});

describe('HealthController', () => {
  const controller = new HealthController();

  it('answers ok when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.health()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
      sentry: false,
    });
  });

  it('answers 503 degraded when the database does not', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(controller.health()).rejects.toMatchObject({
      status: 503,
      response: { status: 'degraded', checks: { database: 'down' } },
    } satisfies Partial<HttpException> & { response: unknown });
  });

  it('throws the deliberate error for a superadmin and refuses everyone else', () => {
    expect(() => controller.sentryTest(user(true))).toThrow(/Sentry test error from apps\/api/);
    expect(() => controller.sentryTest(user(false))).toThrow(ForbiddenException);
  });
});
