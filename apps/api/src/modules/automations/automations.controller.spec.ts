/**
 * Who may call what, read from the controller's real metadata through the
 * real `RolesGuard`: any member edits workflows, only an admin turns one on
 * or off. The fixed paths come before `:id`, so `catalog` is never read as
 * an id.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

import { RolesGuard } from '../../common/guards/roles.guard';
import { AutomationsController } from './automations.controller';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ORG_ID = 'org-1';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };

function contextFor(handler: keyof AutomationsController) {
  const request = { user, cookies: { pg_org: ORG_ID } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => AutomationsController.prototype[handler],
    getClass: () => AutomationsController,
  } as never;
}

function guard(): RolesGuard {
  const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
  return new RolesGuard(new Reflector(), config);
}

function memberAs(role: Role) {
  prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG_ID, role });
}

describe('AutomationsController roles', () => {
  beforeEach(() => prisma.userOrganization.findFirst.mockReset());

  it('lets a member list, edit and test workflows', async () => {
    memberAs(Role.USER);
    for (const handler of [
      'list',
      'create',
      'update',
      'remove',
      'duplicate',
      'validate',
      'pin',
    ] as const) {
      await expect(guard().canActivate(contextFor(handler))).resolves.toBe(true);
    }
  });

  it('refuses a member who tries to turn a workflow on or off', async () => {
    memberAs(Role.USER);
    await expect(guard().canActivate(contextFor('activate'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(guard().canActivate(contextFor('pause'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets an admin through to activate (which answers 501 until Module 09)', async () => {
    memberAs(Role.ADMIN);
    await expect(guard().canActivate(contextFor('activate'))).resolves.toBe(true);
    await expect(guard().canActivate(contextFor('pause'))).resolves.toBe(true);
  });

  it('declares catalog and templates before :id', () => {
    const order = Object.getOwnPropertyNames(AutomationsController.prototype);
    expect(order.indexOf('catalog')).toBeLessThan(order.indexOf('get'));
    expect(order.indexOf('templates')).toBeLessThan(order.indexOf('get'));
  });
});
