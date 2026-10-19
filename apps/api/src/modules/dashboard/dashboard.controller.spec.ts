/**
 * Who may do what on the dashboard: the controller's own `@Roles()` metadata
 * run through the real `RolesGuard`. Every member reads; only an admin sets
 * the weekly goal.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DashboardController } from './dashboard.controller';
import type { DashboardService } from './dashboard.service';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ORG = 'org-mine';
const caller = { id: 'u-1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };

function contextFor(handler: 'summary' | 'setGoal') {
  const request: Record<string, unknown> = { user: caller, cookies: { pg_org: ORG } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => DashboardController.prototype[handler],
      getClass: () => DashboardController,
    },
  };
}

describe('DashboardController access', () => {
  const config = { get: (_k: string, fallback: string) => fallback } as unknown as ConfigService;
  const guard = new RolesGuard(new Reflector(), config);

  function memberAs(role: Role) {
    prisma.userOrganization.findFirst.mockReset();
    prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG, role });
  }

  it('lets a plain member read the summary for the cookie workspace', async () => {
    memberAs(Role.USER);
    const { context, request } = contextFor('summary');

    await expect(guard.canActivate(context as never)).resolves.toBe(true);

    const service = { summary: jest.fn(async () => ({})) };
    const controller = new DashboardController(service as unknown as DashboardService);
    await controller.summary(request.activeOrg as never, { tz: 'Europe/Paris' });

    expect(service.summary).toHaveBeenCalledWith(ORG, 'Europe/Paris');
  });

  it('refuses the goal to a plain member', async () => {
    memberAs(Role.USER);
    const { context } = contextFor('setGoal');

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an admin set the goal', async () => {
    memberAs(Role.ADMIN);
    const { context, request } = contextFor('setGoal');

    await expect(guard.canActivate(context as never)).resolves.toBe(true);

    const service = { setGoal: jest.fn(async () => ({ target: 4, custom: true })) };
    const controller = new DashboardController(service as unknown as DashboardService);

    await expect(controller.setGoal(request.activeOrg as never, { target: 4 })).resolves.toEqual({
      goal: { target: 4, custom: true },
    });
    expect(service.setGoal).toHaveBeenCalledWith(ORG, 4);
  });
});
