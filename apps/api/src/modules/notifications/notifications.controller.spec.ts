/**
 * Who may read a workspace's feed: the controller's own `@Roles()` metadata
 * run through the real `RolesGuard`, the way Nest wires them.
 *
 * The web app now holds the bell back until the `pg_org` cookie names the
 * workspace in the URL, so the 403 a sign-in used to produce no longer
 * happens; this keeps the other half true: the cookie is still the only
 * scope, and it is only honoured for a workspace the caller is a member of.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NotificationsController } from './notifications.controller';
import type { NotificationsService } from './notifications.service';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

const member = {
  id: 'u-member',
  email: 'm@x.com',
  isSuperAdmin: false,
  onboardingCompletedAt: null,
};
const MY_ORG = 'org-mine';
const OTHER_ORG = 'org-other';

type Handler = 'list' | 'unread' | 'readAll' | 'stream';

function contextFor(handler: Handler, cookies: Record<string, string>) {
  const request: Record<string, unknown> = { user: member, cookies };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => NotificationsController.prototype[handler],
      getClass: () => NotificationsController,
    },
  };
}

describe('NotificationsController access', () => {
  const config = { get: (_k: string, fallback: string) => fallback } as unknown as ConfigService;
  const guard = new RolesGuard(new Reflector(), config);

  beforeEach(() => {
    prisma.userOrganization.findFirst.mockReset();
    // Membership only in MY_ORG, as a plain USER.
    prisma.userOrganization.findFirst.mockImplementation(
      async ({ where }: { where: { userId: string; organizationId: string } }) =>
        where.userId === member.id && where.organizationId === MY_ORG
          ? { organizationId: MY_ORG, role: Role.USER }
          : null,
    );
  });

  it.each<Handler>(['list', 'unread', 'readAll', 'stream'])(
    '%s refuses a cookie naming a workspace the caller is not in',
    async (handler) => {
      const { context, request } = contextFor(handler, { pg_org: OTHER_ORG });

      await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
      expect(request.activeOrg).toBeUndefined();
    },
  );

  it.each<Handler>(['list', 'stream'])(
    '%s refuses a request with no workspace cookie',
    async (handler) => {
      const { context } = contextFor(handler, {});

      await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('lets a plain member read their own workspace, scoped to the guard-resolved org', async () => {
    const { context, request } = contextFor('list', { pg_org: MY_ORG });

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.activeOrg).toEqual({ id: MY_ORG, role: Role.USER });

    const service = { list: jest.fn(async () => ({ notifications: [] })) };
    const controller = new NotificationsController(service as unknown as NotificationsService);
    await controller.list(member, request.activeOrg as never, { limit: 20 } as never);

    expect(service.list).toHaveBeenCalledWith(member.id, MY_ORG, { limit: 20 });
  });
});
