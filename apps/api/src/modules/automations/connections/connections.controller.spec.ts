/**
 * Who may call what, read from the controller's real metadata through the
 * real `RolesGuard`: members see connections, only admins change them
 * (Reconnect and starting OAuth included), and the OAuth callback is public.
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
import { ConnectionsController } from './connections.controller';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const ORG_ID = 'org-1';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };

function contextFor(handler: keyof ConnectionsController, signedIn = true) {
  const request = signedIn ? { user, cookies: { pg_org: ORG_ID } } : { cookies: {} };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ConnectionsController.prototype[handler],
    getClass: () => ConnectionsController,
  } as never;
}

function guard(): RolesGuard {
  const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
  return new RolesGuard(new Reflector(), config);
}

function memberAs(role: Role) {
  prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG_ID, role });
}

const WRITES = ['create', 'update', 'remove', 'check', 'start'] as const;

describe('ConnectionsController roles', () => {
  beforeEach(() => prisma.userOrganization.findFirst.mockReset());

  it('lets a member list connections', async () => {
    memberAs(Role.USER);
    await expect(guard().canActivate(contextFor('list'))).resolves.toBe(true);
  });

  it('refuses a member every change, Reconnect and OAuth start included', async () => {
    memberAs(Role.USER);
    for (const handler of WRITES) {
      await expect(guard().canActivate(contextFor(handler))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('lets an admin make every change', async () => {
    memberAs(Role.ADMIN);
    for (const handler of [...WRITES, 'list'] as const) {
      await expect(guard().canActivate(contextFor(handler))).resolves.toBe(true);
    }
  });

  it('leaves the callback public: the state is what binds it', async () => {
    await expect(guard().canActivate(contextFor('callback', false))).resolves.toBe(true);
  });

  it('refuses someone outside the workspace', async () => {
    prisma.userOrganization.findFirst.mockResolvedValue(null);
    await expect(guard().canActivate(contextFor('list'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
