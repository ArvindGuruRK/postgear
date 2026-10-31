/**
 * Module 14, roles and public routes across every Workflows controller in
 * one table, read from the real route metadata through the real
 * `RolesGuard`:
 *
 * - a member is refused (403) exactly on activate, pause, every connection
 *   write (Reconnect, Check and starting OAuth included) and making a
 *   webhook secret; every other signed-in route lets a member through;
 * - the only routes that skip the session are the webhook hook (behind its
 *   own throttle and the secret), the OAuth callback (bound by its state),
 *   and the worker's gateway routes, each behind `InternalTokenGuard`;
 * - a new route can only be added by adding it to this table.
 */
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Role } from '@postgear/db';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() } },
}));

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AutomationsController } from './automations.controller';
import { ConnectionsController } from './connections/connections.controller';
import { GatewayAiController } from './gateway/gateway-ai.controller';
import { GatewayEmailController } from './gateway/gateway-email.controller';
import { GatewayPostsController } from './gateway/gateway-posts.controller';
import { InternalTokenGuard } from './gateway/internal-token.guard';
import { AutomationRunsController } from './runs/automation-runs.controller';
import { AutomationTestRunsController } from './runs/automation-test-runs.controller';
import { HookController } from './webhook/hook.controller';
import { HookThrottlerGuard } from './webhook/hook-throttler.guard';
import { WebhookController } from './webhook/webhook.controller';

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock } };
};

type Access = 'any member' | 'admin only' | 'public: hook' | 'public: callback' | 'internal';

// biome-ignore lint/suspicious/noExplicitAny: controllers of every shape.
type AnyController = abstract new (...args: any[]) => object;

/** Every route of the Workflows API and who may call it. */
const ROUTES: [AnyController, Record<string, Access>][] = [
  [
    AutomationsController,
    {
      list: 'any member',
      catalog: 'any member',
      templates: 'any member',
      create: 'any member',
      get: 'any member',
      update: 'any member',
      remove: 'any member',
      duplicate: 'any member',
      validate: 'any member',
      pin: 'any member',
      unpin: 'any member',
      activate: 'admin only',
      pause: 'admin only',
      discard: 'any member',
      versions: 'any member',
      version: 'any member',
      restore: 'any member',
    },
  ],
  [
    ConnectionsController,
    {
      list: 'any member',
      start: 'admin only',
      callback: 'public: callback',
      create: 'admin only',
      update: 'admin only',
      remove: 'admin only',
      pickerToken: 'any member',
      spreadsheet: 'any member',
      header: 'any member',
      createSpreadsheet: 'any member',
      check: 'admin only',
    },
  ],
  [
    AutomationRunsController,
    {
      get: 'any member',
      stream: 'any member',
      cancel: 'any member',
      retry: 'any member',
      review: 'any member',
    },
  ],
  [
    AutomationTestRunsController,
    { testRun: 'any member', testStep: 'any member', runNow: 'any member', listRuns: 'any member' },
  ],
  [WebhookController, { panel: 'any member', newSecret: 'admin only' }],
  [HookController, { hook: 'public: hook' }],
  [
    GatewayAiController,
    { text: 'internal', image: 'internal', hashtags: 'internal', rewrite: 'internal' },
  ],
  [GatewayEmailController, { send: 'internal' }],
  [
    GatewayPostsController,
    { draft: 'internal', queue: 'internal', publish: 'internal', get: 'internal' },
  ],
];

const ORG_ID = 'org-1';
const user = { id: 'u1', email: 'a@x.com', isSuperAdmin: false, onboardingCompletedAt: null };

/** The handlers Nest routes: methods that carry a path. */
function routesOf(controller: AnyController): string[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto).filter(
    (name) =>
      name !== 'constructor' &&
      typeof proto[name] === 'function' &&
      Reflect.getMetadata(PATH_METADATA, proto[name] as object) !== undefined,
  );
}

function handlerOf(controller: AnyController, name: string): object {
  return (controller.prototype as Record<string, object>)[name];
}

function guardsOf(controller: AnyController, name: string): unknown[] {
  return [
    ...(Reflect.getMetadata(GUARDS_METADATA, controller) ?? []),
    ...(Reflect.getMetadata(GUARDS_METADATA, handlerOf(controller, name)) ?? []),
  ];
}

function isPublic(controller: AnyController, name: string): boolean {
  return (
    new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      handlerOf(controller, name) as never,
      controller,
    ]) === true
  );
}

async function memberMayCall(controller: AnyController, name: string): Promise<boolean> {
  prisma.userOrganization.findFirst.mockResolvedValue({ organizationId: ORG_ID, role: Role.USER });
  const config = { get: (_key: string, fallback: string) => fallback } as unknown as ConfigService;
  const guard = new RolesGuard(new Reflector(), config);
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user, cookies: { pg_org: ORG_ID } }) }),
    getHandler: () => handlerOf(controller, name),
    getClass: () => controller,
  } as never;
  try {
    return await guard.canActivate(context);
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('Workflows routes: roles and public access (Module 14)', () => {
  it('lists every route in the table, and nothing that is not a route', () => {
    for (const [controller, table] of ROUTES) {
      expect(routesOf(controller).sort()).toEqual(Object.keys(table).sort());
    }
  });

  it('refuses a member exactly on activate, pause, connection writes, OAuth start and webhook secrets', async () => {
    const refused: string[] = [];
    for (const [controller, table] of ROUTES) {
      for (const [name, access] of Object.entries(table)) {
        if (access !== 'any member' && access !== 'admin only') continue;
        expect(isPublic(controller, name)).toBe(false);
        if (!(await memberMayCall(controller, name))) refused.push(`${controller.name}.${name}`);
        expect(refused.includes(`${controller.name}.${name}`)).toBe(access === 'admin only');
      }
    }
    expect(refused.sort()).toEqual(
      [
        'AutomationsController.activate',
        'AutomationsController.pause',
        'ConnectionsController.check',
        'ConnectionsController.create',
        'ConnectionsController.remove',
        'ConnectionsController.start',
        'ConnectionsController.update',
        'WebhookController.newSecret',
      ].sort(),
    );
  });

  it('skips the session only for the hook, the OAuth callback and the token-guarded gateway', () => {
    for (const [controller, table] of ROUTES) {
      for (const [name, access] of Object.entries(table)) {
        const guards = guardsOf(controller, name);
        switch (access) {
          case 'internal':
            expect(isPublic(controller, name)).toBe(true);
            expect(guards).toContain(InternalTokenGuard);
            break;
          case 'public: hook':
            expect(isPublic(controller, name)).toBe(true);
            expect(guards).toContain(HookThrottlerGuard);
            break;
          case 'public: callback':
            expect(isPublic(controller, name)).toBe(true);
            break;
          default:
            expect(isPublic(controller, name)).toBe(false);
            expect(guards).not.toContain(InternalTokenGuard);
        }
      }
    }
  });
});
