/**
 * Who may call what, read from the controller's real metadata through the
 * real `RolesGuard`: any member edits workflows, discards changes, reads and
 * restores versions; only an admin turns one on or off. The fixed paths come
 * before `:id`, so `catalog` is never read as an id. Versions have no route
 * that changes or deletes one.
 */
import { ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
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
      'discard',
      'versions',
      'version',
      'restore',
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

  it('lets an admin through to activate and pause', async () => {
    memberAs(Role.ADMIN);
    await expect(guard().canActivate(contextFor('activate'))).resolves.toBe(true);
    await expect(guard().canActivate(contextFor('pause'))).resolves.toBe(true);
  });

  it('has no route that changes or deletes a version', () => {
    const routes = Object.getOwnPropertyNames(AutomationsController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => {
        const handler = AutomationsController.prototype[name as keyof AutomationsController];
        return {
          path: Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined,
        };
      })
      .filter((route) => route.path?.includes('versions'));

    expect(routes).toEqual(
      expect.arrayContaining([
        { path: ':id/versions', method: RequestMethod.GET },
        { path: ':id/versions/:version', method: RequestMethod.GET },
        { path: ':id/versions/:version/restore', method: RequestMethod.POST },
      ]),
    );
    expect(routes).toHaveLength(3);
    for (const route of routes) {
      expect([RequestMethod.PUT, RequestMethod.PATCH, RequestMethod.DELETE]).not.toContain(
        route.method,
      );
    }
  });

  it('declares catalog and templates before :id', () => {
    const order = Object.getOwnPropertyNames(AutomationsController.prototype);
    expect(order.indexOf('catalog')).toBeLessThan(order.indexOf('get'));
    expect(order.indexOf('templates')).toBeLessThan(order.indexOf('get'));
  });
});
