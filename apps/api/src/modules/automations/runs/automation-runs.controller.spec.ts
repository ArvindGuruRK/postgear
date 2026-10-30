/**
 * Who may call the run routes, read from the controllers' real metadata
 * through the real `RolesGuard`: any member tests, watches, cancels,
 * reviews, retries from a failed step and uses Run Now (the service decides
 * whether the workflow allows it); someone outside the workspace gets nothing. The events stream
 * skips the per-address throttle, as the bell's does.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

import { RolesGuard } from '../../../common/guards/roles.guard';
import { AutomationRunsController } from './automation-runs.controller';
import { AutomationTestRunsController } from './automation-test-runs.controller';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ORG_ID = 'org-1';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };

type AnyController = typeof AutomationRunsController | typeof AutomationTestRunsController;

function contextFor(controller: AnyController, handler: string) {
  const request = { user, cookies: { pg_org: ORG_ID } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (controller.prototype as unknown as Record<string, unknown>)[handler],
    getClass: () => controller,
  } as never;
}

function guard(): RolesGuard {
  const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
  return new RolesGuard(new Reflector(), config);
}

const ROUTES: [AnyController, string][] = [
  [AutomationTestRunsController, 'testRun'],
  [AutomationTestRunsController, 'testStep'],
  [AutomationTestRunsController, 'listRuns'],
  [AutomationRunsController, 'get'],
  [AutomationRunsController, 'stream'],
  [AutomationRunsController, 'cancel'],
  [AutomationRunsController, 'review'],
  [AutomationRunsController, 'retry'],
  [AutomationTestRunsController, 'runNow'],
];

describe('Run route roles', () => {
  beforeEach(() => prisma.userOrganization.findFirst.mockReset());

  it('lets any member use every run route', async () => {
    for (const role of [Role.USER, Role.ADMIN]) {
      prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG_ID, role });
      for (const [controller, handler] of ROUTES) {
        await expect(guard().canActivate(contextFor(controller, handler))).resolves.toBe(true);
      }
    }
  });

  it('refuses someone who is not in the workspace', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);
    for (const [controller, handler] of ROUTES) {
      await expect(guard().canActivate(contextFor(controller, handler))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('keeps the long-lived events stream out of the per-address throttle', () => {
    const reflector = new Reflector();
    const handler = AutomationRunsController.prototype.stream;
    const skipped = reflector.getAllAndOverride<Record<string, boolean> | boolean | undefined>(
      'THROTTLER:SKIPdefault',
      [handler],
    );
    expect(skipped).toBe(true);
  });
});
