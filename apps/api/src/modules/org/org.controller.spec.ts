/**
 * The workspace routes' wiring (Settings > Team, 2026-10-19): who may reach
 * each invitation and membership route, run through the real guards with the
 * controller's own metadata the way Nest applies them; what the handlers do
 * with the active-workspace cookie; and the request bodies. The behaviour
 * behind them is in `org.service.spec.ts`.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@postgear/db';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { acceptInviteSchema, inviteMemberSchema } from './dto/org.schema';
import { OrgController } from './org.controller';
import type { OrgService } from './org.service';

jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: { userOrganization: { findFirst: jest.fn() }, user: { findUnique: jest.fn() } },
}));

const { prisma } = jest.requireMock('@postgear/db') as {
  prisma: { userOrganization: { findFirst: jest.Mock }; user: { findUnique: jest.Mock } };
};

const config = {
  get: (_key: string, fallback?: string) => fallback,
} as unknown as ConfigService;
const jwt = new JwtService({ secret: 'a-test-secret-that-is-at-least-32-chars' });

const member = {
  id: 'u-member',
  email: 'm@example.com',
  isSuperAdmin: false,
  onboardingCompletedAt: null,
};
const ORG = 'org-1';

type Handler = keyof OrgController;

function contextFor(handler: Handler, request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => OrgController.prototype[handler] as () => unknown,
    getClass: () => OrgController,
  } as never;
}

describe('OrgController access', () => {
  const roles = new RolesGuard(new Reflector(), config);
  const auth = new JwtAuthGuard(jwt, new Reflector(), config);

  beforeEach(() => {
    prisma.userOrganization.findFirst.mockReset();
  });

  function asRole(role: Role | null) {
    prisma.userOrganization.findFirst.mockResolvedValue(
      role ? { organizationId: ORG, role } : null,
    );
  }

  it.each<Handler>(['invite', 'changeRole', 'removeMember'])(
    '%s is for admins of the active workspace only',
    async (handler) => {
      asRole(Role.USER);
      await expect(
        roles.canActivate(contextFor(handler, { user: member, cookies: { pg_org: ORG } })),
      ).rejects.toThrow(ForbiddenException);

      asRole(Role.ADMIN);
      await expect(
        roles.canActivate(contextFor(handler, { user: member, cookies: { pg_org: ORG } })),
      ).resolves.toBe(true);
    },
  );

  it.each<Handler>(['acceptInvite', 'leave', 'members'])(
    '%s needs a session but no role, so someone not in the workspace yet can reach it',
    async (handler) => {
      asRole(null);

      await expect(
        roles.canActivate(contextFor(handler, { user: member, cookies: {} })),
      ).resolves.toBe(true);
      await expect(
        auth.canActivate(contextFor(handler, { cookies: {}, headers: {} })),
      ).rejects.toThrow('Your session has expired');
    },
  );

  it('the invitation preview is public: no session needed, none read by the guards', async () => {
    const request = { cookies: {}, headers: {} };

    await expect(auth.canActivate(contextFor('previewInvite', request))).resolves.toBe(true);
    await expect(roles.canActivate(contextFor('previewInvite', request))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('OrgController handlers', () => {
  const orgs = {
    createInvite: jest.fn(),
    previewInvite: jest.fn(),
    acceptInvite: jest.fn(),
    leave: jest.fn(),
    changeRole: jest.fn(),
    removeMember: jest.fn(),
  };
  const controller = new OrgController(orgs as unknown as OrgService, jwt, config);

  function response() {
    return { cookie: jest.fn(), clearCookie: jest.fn() } as unknown as Response & {
      cookie: jest.Mock;
      clearCookie: jest.Mock;
    };
  }

  beforeEach(() => {
    for (const fn of Object.values(orgs)) {
      fn.mockReset();
    }
  });

  it('answers an invitation with exactly { url, expiresAt }', async () => {
    const created = { url: 'http://web.test/invite/abc.def', expiresAt: new Date('2026-10-26') };
    orgs.createInvite.mockResolvedValue(created);

    const body = { role: Role.USER, sendEmail: false };
    await expect(
      controller.invite(member, { id: ORG, role: Role.ADMIN }, ORG, body as never),
    ).resolves.toEqual(created);
    expect(orgs.createInvite).toHaveBeenCalledWith(ORG, member.id, body);
  });

  it.each<[string, (c: OrgController) => Promise<unknown>]>([
    ['invite', (c) => c.invite(member, { id: ORG, role: Role.ADMIN }, 'org-2', {} as never)],
    [
      'changeRole',
      (c) => c.changeRole({ id: ORG, role: Role.ADMIN }, 'org-2', 'u-2', { role: Role.USER }),
    ],
    ['removeMember', (c) => c.removeMember({ id: ORG, role: Role.ADMIN }, 'org-2', 'u-2')],
  ])('%s refuses a page for one workspace while the cookie names another', async (_name, call) => {
    await expect(call(controller)).rejects.toThrow(ConflictException);
    expect(orgs.createInvite).not.toHaveBeenCalled();
    expect(orgs.changeRole).not.toHaveBeenCalled();
    expect(orgs.removeMember).not.toHaveBeenCalled();
  });

  it('accepting switches into the workspace with the same cookie as :id/switch', async () => {
    const organization = { id: ORG, name: 'Acme', role: Role.USER, createdAt: new Date() };
    orgs.acceptInvite.mockResolvedValue(organization);
    const res = response();

    await expect(controller.acceptInvite(member, { token: 't' }, res)).resolves.toEqual({
      organization,
    });
    expect(orgs.acceptInvite).toHaveBeenCalledWith('t', member);
    expect(res.cookie).toHaveBeenCalledWith(
      'pg_org',
      ORG,
      expect.objectContaining({ httpOnly: false, sameSite: 'lax', path: '/' }),
    );
  });

  it('leaving clears the active-workspace cookie only when it named that workspace', async () => {
    const pointing = response();
    await controller.leave(
      member,
      ORG,
      { cookies: { pg_org: ORG } } as unknown as Request,
      pointing,
    );
    expect(orgs.leave).toHaveBeenCalledWith(member.id, ORG);
    expect(pointing.clearCookie).toHaveBeenCalledWith(
      'pg_org',
      expect.objectContaining({ path: '/' }),
    );

    const elsewhere = response();
    await controller.leave(
      member,
      ORG,
      { cookies: { pg_org: 'org-2' } } as unknown as Request,
      elsewhere,
    );
    expect(elsewhere.clearCookie).not.toHaveBeenCalled();
  });

  it('does not clear the cookie when leaving fails', async () => {
    orgs.leave.mockRejectedValue(new ForbiddenException('last admin'));
    const res = response();

    await expect(
      controller.leave(member, ORG, { cookies: { pg_org: ORG } } as unknown as Request, res),
    ).rejects.toThrow(ForbiddenException);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('the preview reads a valid session for the "already a member" hint, and ignores a forged one', async () => {
    orgs.previewInvite.mockResolvedValue({});
    const session = await jwt.signAsync({ sub: 'u-member', email: member.email });

    await controller.previewInvite('tok', {
      cookies: { pg_session: session },
    } as unknown as Request);
    expect(orgs.previewInvite).toHaveBeenLastCalledWith('tok', 'u-member');

    const forged = await new JwtService({ secret: 'b'.repeat(32) }).signAsync({ sub: 'u-member' });
    await controller.previewInvite('tok', {
      cookies: { pg_session: forged },
    } as unknown as Request);
    expect(orgs.previewInvite).toHaveBeenLastCalledWith('tok', null);

    await controller.previewInvite('tok', { cookies: {} } as unknown as Request);
    expect(orgs.previewInvite).toHaveBeenLastCalledWith('tok', null);
  });
});

describe('POST /orgs/:id/invites body', () => {
  const pipe = new ZodBody(inviteMemberSchema, 'test');

  it('defaults to a member, sent by email', () => {
    expect(pipe.transform({ email: 'Ada@Example.com' })).toEqual({
      role: 'USER',
      sendEmail: true,
      email: 'ada@example.com',
    });
  });

  it('allows a copied link with no address, reading a blank field as none', () => {
    expect(pipe.transform({ role: 'ADMIN', sendEmail: false })).toEqual({
      role: 'ADMIN',
      sendEmail: false,
    });
    expect(pipe.transform({ sendEmail: false, email: '  ' })).toEqual({
      role: 'USER',
      sendEmail: false,
    });
  });

  it.each([
    ['an email to send with no address', { sendEmail: true }],
    ['an email to send to a blank address', { sendEmail: true, email: '' }],
    ['a malformed address', { sendEmail: false, email: 'not-an-address' }],
    ['the platform role', { role: 'SUPERADMIN', sendEmail: false }],
    ['an unknown field', { sendEmail: false, organizationId: 'org-2' }],
    ['a string for the flag', { sendEmail: 'yes', email: 'a@b.co' }],
  ])('rejects %s', (_label, body) => {
    expect(() => pipe.transform(body)).toThrow(BadRequestException);
  });
});

describe('POST /orgs/invites/accept body', () => {
  const pipe = new ZodBody(acceptInviteSchema, 'test');

  it('takes only a token', () => {
    expect(pipe.transform({ token: 'abc.def' })).toEqual({ token: 'abc.def' });
    expect(() => pipe.transform({ token: 'abc.def', role: 'ADMIN' })).toThrow(BadRequestException);
    expect(() => pipe.transform({})).toThrow(BadRequestException);
    expect(() => pipe.transform({ token: 'x'.repeat(4096) })).toThrow(BadRequestException);
  });
});
