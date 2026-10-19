/**
 * Creating a workspace starts its trial (Sprint 8), after the transaction,
 * and best-effort: a trial that cannot start never loses the workspace.
 *
 * Settings > Team (2026-10-19): invitations are signed links that nobody is
 * added by until they accept; accepting is single use, bound to the address
 * when there is one, and idempotent for someone already in; and anyone can
 * leave except the last admin.
 */
jest.mock('@postgear/db', () => ({
  ...jest.requireActual('@postgear/db'),
  prisma: {
    $transaction: jest.fn(),
    organization: { create: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    userOrganization: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { prisma } from '@postgear/db';
import type { EntitlementsService } from '../billing/entitlements.service';
import type { MailService } from '../mail/mail.service';
import type { RedisService } from '../redis/redis.service';
import { InviteTokenService } from './invite-token.service';
import { INVITE_MESSAGES, OrgService } from './org.service';

type PrismaMock = {
  $transaction: jest.Mock;
  organization: { create: jest.Mock; findUnique: jest.Mock };
  user: { findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  userOrganization: {
    create: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    delete: jest.Mock;
    upsert: jest.Mock;
  };
};

const prismaMock = prisma as unknown as PrismaMock;

const ORG = { id: 'org-1', name: 'Acme', createdAt: new Date('2026-10-01') };
const ada = { id: 'user-ada', email: 'ada@example.com' };

const tokens = new InviteTokenService({
  getOrThrow: () => 'a-test-secret-that-is-at-least-32-chars',
} as unknown as ConfigService);

interface Harness {
  service: OrgService;
  mail: { sendWorkspaceInvitation: jest.Mock; linkTo: jest.Mock; sendActivation: jest.Mock };
  entitlements: { startTrial: jest.Mock };
  redis: { get: jest.Mock; rawClient: { set: jest.Mock; del: jest.Mock } | null };
}

function harness(options: { redis?: 'up' | 'none' } = {}): Harness {
  const mail = {
    sendWorkspaceInvitation: jest.fn().mockResolvedValue(true),
    linkTo: jest.fn((path: string) => `http://web.test${path}`),
    sendActivation: jest.fn(),
  };
  const entitlements = {
    startTrial: jest.fn().mockResolvedValue({ tier: 'PRO', status: 'trialing' }),
  };
  const redis = {
    get: jest.fn().mockResolvedValue(null),
    rawClient:
      options.redis === 'none' ? null : { set: jest.fn().mockResolvedValue('OK'), del: jest.fn() },
  };
  const service = new OrgService(
    mail as unknown as MailService,
    entitlements as unknown as EntitlementsService,
    tokens,
    redis as unknown as RedisService,
  );
  return { service, mail, entitlements, redis };
}

beforeEach(() => {
  jest.resetAllMocks();
  prismaMock.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) =>
    work(prismaMock),
  );
  prismaMock.organization.findUnique.mockResolvedValue(ORG);
});

describe('OrgService.create', () => {
  beforeEach(() => {
    prismaMock.organization.create.mockResolvedValue({
      id: 'org_new',
      name: 'Acme',
      createdAt: new Date('2026-10-16'),
    });
    prismaMock.userOrganization.create.mockResolvedValue({ id: 'm_1' });
  });

  it('creates the workspace and its admin membership, then starts the trial', async () => {
    const { service, entitlements } = harness();
    const created = await service.create('user_1', 'Acme');

    expect(created).toMatchObject({ id: 'org_new', name: 'Acme', role: 'ADMIN' });
    expect(prismaMock.userOrganization.create).toHaveBeenCalledWith({
      data: { userId: 'user_1', organizationId: 'org_new', role: 'ADMIN' },
    });
    expect(entitlements.startTrial).toHaveBeenCalledWith('org_new');
  });

  it('keeps the workspace when the trial cannot be started', async () => {
    const { service, entitlements } = harness();
    entitlements.startTrial.mockRejectedValue(new Error('billing down'));

    await expect(service.create('user_1', 'Acme')).resolves.toMatchObject({ id: 'org_new' });
  });

  it('does not start a trial for a workspace that was not created', async () => {
    const { service, entitlements } = harness();
    prismaMock.$transaction.mockRejectedValue(new Error('db down'));

    await expect(service.create('user_1', 'Acme')).rejects.toThrow('db down');
    expect(entitlements.startTrial).not.toHaveBeenCalled();
  });
});

describe('OrgService.listMembers', () => {
  it('adds each member avatar in the session shape, keeping every other field', async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue({ role: 'ADMIN', organization: ORG });
    prismaMock.userOrganization.findMany.mockResolvedValue([
      {
        id: 'm-1',
        role: 'ADMIN',
        disabled: false,
        createdAt: new Date('2026-10-02'),
        user: {
          id: 'u-1',
          email: 'ada@example.com',
          name: 'Ada',
          lastName: 'Lovelace',
          avatarUrl: 'http://cdn.test/a.webp',
          avatarPreset: null,
        },
      },
      {
        id: 'm-2',
        role: 'USER',
        disabled: false,
        createdAt: new Date('2026-10-03'),
        user: {
          id: 'u-2',
          email: 'bob@example.com',
          name: null,
          lastName: null,
          avatarUrl: null,
          avatarPreset: 'notionists-03',
        },
      },
    ]);

    const members = await service.listMembers('u-1', 'org-1');

    expect(members).toEqual([
      {
        membershipId: 'm-1',
        userId: 'u-1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        role: 'ADMIN',
        disabled: false,
        joinedAt: new Date('2026-10-02'),
        avatar: { kind: 'image', url: 'http://cdn.test/a.webp' },
      },
      {
        membershipId: 'm-2',
        userId: 'u-2',
        email: 'bob@example.com',
        name: null,
        role: 'USER',
        disabled: false,
        joinedAt: new Date('2026-10-03'),
        avatar: { kind: 'preset', id: 'notionists-03' },
      },
    ]);
  });

  it('is refused to someone outside the workspace', async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue(null);

    await expect(service.listMembers('u-9', 'org-1')).rejects.toThrow(NotFoundException);
    expect(prismaMock.userOrganization.findMany).not.toHaveBeenCalled();
  });
});

describe('OrgService.createInvite', () => {
  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      name: 'Grace',
      lastName: 'Hopper',
      email: 'grace@example.com',
    });
  });

  it('returns a link to /invite/<token> and when it expires, signed for the workspace and role', async () => {
    const { service } = harness();

    const result = await service.createInvite('org-1', 'user-grace', {
      role: 'ADMIN',
      sendEmail: false,
    });

    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'url']);
    const token = result.url.replace('http://web.test/invite/', '');
    const verified = tokens.verify(token);
    expect(verified).toMatchObject({ ok: true, payload: { orgId: 'org-1', role: 'ADMIN' } });
    expect(verified.ok && verified.payload.exp).toBe(result.expiresAt.getTime());
  });

  it('emails the link, bound to the address, with the workspace, inviter and role', async () => {
    const { service, mail } = harness();

    const { url, expiresAt } = await service.createInvite('org-1', 'user-grace', {
      role: 'USER',
      sendEmail: true,
      email: 'ada@example.com',
    });

    expect(mail.sendWorkspaceInvitation).toHaveBeenCalledWith('ada@example.com', {
      workspaceName: 'Acme',
      inviterName: 'Grace Hopper',
      role: 'USER',
      link: url,
      expiresAt,
    });
    const verified = tokens.verify(url.split('/invite/')[1]);
    expect(verified.ok && verified.payload.email).toBe('ada@example.com');
  });

  it('sends nothing for a copied link, but still binds it to an address when given', async () => {
    const { service, mail } = harness();

    const { url } = await service.createInvite('org-1', 'user-grace', {
      role: 'USER',
      sendEmail: false,
      email: 'ada@example.com',
    });

    expect(mail.sendWorkspaceInvitation).not.toHaveBeenCalled();
    const verified = tokens.verify(url.split('/invite/')[1]);
    expect(verified.ok && verified.payload.email).toBe('ada@example.com');
  });

  it('never looks the address up and never adds anyone, so the answer cannot enumerate accounts', async () => {
    const { service, mail } = harness();

    const first = await service.createInvite('org-1', 'user-grace', {
      role: 'USER',
      sendEmail: true,
      email: 'has-an-account@example.com',
    });
    const second = await service.createInvite('org-1', 'user-grace', {
      role: 'USER',
      sendEmail: true,
      email: 'nobody@example.com',
    });

    expect(Object.keys(first)).toEqual(Object.keys(second));
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.userOrganization.upsert).not.toHaveBeenCalled();
    expect(prismaMock.userOrganization.create).not.toHaveBeenCalled();
    expect(mail.sendActivation).not.toHaveBeenCalled();
    expect(mail.sendWorkspaceInvitation).toHaveBeenCalledTimes(2);
  });
});

describe('OrgService.previewInvite', () => {
  function link(email?: string) {
    return tokens.sign({ orgId: 'org-1', role: 'USER', ...(email ? { email } : {}) });
  }

  it('names the workspace, role, expiry and address for a signed-out visitor', async () => {
    const { service } = harness();
    const { token, payload } = link('ada@example.com');

    await expect(service.previewInvite(token, null)).resolves.toEqual({
      workspaceName: 'Acme',
      role: 'USER',
      expiresAt: new Date(payload.exp).toISOString(),
      email: 'ada@example.com',
    });
  });

  it('tells a signed-in visitor whether they are in already', async () => {
    const { service } = harness();
    const { token } = link();

    prismaMock.userOrganization.findFirst.mockResolvedValueOnce({ id: 'm-1' });
    await expect(service.previewInvite(token, 'user-ada')).resolves.toMatchObject({
      alreadyMember: true,
    });

    prismaMock.userOrganization.findFirst.mockResolvedValueOnce(null);
    await expect(service.previewInvite(token, 'user-bob')).resolves.toMatchObject({
      alreadyMember: false,
    });
  });

  it('answers 410 for a used link, unless the visitor is already a member', async () => {
    const { service, redis } = harness();
    const { token } = link();
    redis.get.mockResolvedValue('user-ada');

    await expect(service.previewInvite(token, null)).rejects.toThrow(
      new GoneException(INVITE_MESSAGES.USED),
    );

    prismaMock.userOrganization.findFirst.mockResolvedValueOnce({ id: 'm-1' });
    await expect(service.previewInvite(token, 'user-ada')).resolves.toMatchObject({
      alreadyMember: true,
    });
  });

  it('answers 404 for a tampered link and 410 for an expired one', async () => {
    const { service } = harness();
    const { token } = link();

    await expect(service.previewInvite(`${token}x`, null)).rejects.toThrow(
      new NotFoundException(INVITE_MESSAGES.INVALID),
    );

    const old = tokens.sign({ orgId: 'org-1', role: 'USER' }, Date.now() - 8 * 24 * 3600 * 1000);
    await expect(service.previewInvite(old.token, null)).rejects.toThrow(
      new GoneException(INVITE_MESSAGES.EXPIRED),
    );
  });

  it('answers 404 when the workspace no longer exists', async () => {
    const { service } = harness();
    prismaMock.organization.findUnique.mockResolvedValue(null);

    await expect(service.previewInvite(link().token, null)).rejects.toThrow(NotFoundException);
  });
});

describe('OrgService.acceptInvite', () => {
  beforeEach(() => {
    prismaMock.userOrganization.findFirst.mockResolvedValue(null);
    prismaMock.userOrganization.create.mockResolvedValue({ id: 'm-new' });
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
  });

  it('claims the link once, until it would expire, then adds the membership at its role', async () => {
    const { service, redis } = harness();
    const { token, payload } = tokens.sign({ orgId: 'org-1', role: 'ADMIN' });

    await expect(service.acceptInvite(token, ada)).resolves.toEqual({ ...ORG, role: 'ADMIN' });

    expect(redis.rawClient?.set).toHaveBeenCalledWith(
      `org-invite:used:${payload.id}`,
      'user-ada',
      'EX',
      expect.any(Number),
      'NX',
    );
    const ttl = redis.rawClient?.set.mock.calls[0][3] as number;
    expect(ttl).toBeGreaterThan(7 * 24 * 3600 - 60);
    expect(ttl).toBeLessThanOrEqual(7 * 24 * 3600);
    expect(prismaMock.userOrganization.create).toHaveBeenCalledWith({
      data: { userId: 'user-ada', organizationId: 'org-1', role: 'ADMIN' },
    });
  });

  it('moves someone still onboarding past "Name your workspace"', async () => {
    const { service } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER' });

    await service.acceptInvite(token, ada);

    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-ada', onboardingCompletedAt: null, onboardingStep: { lt: 2 } },
      data: { onboardingStep: 2 },
    });
  });

  it('refuses a link sent to another address, before claiming it', async () => {
    const { service, redis } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER', email: 'bob@example.com' });

    await expect(service.acceptInvite(token, ada)).rejects.toThrow(
      new ForbiddenException('This invitation was sent to a different email address'),
    );
    expect(redis.rawClient?.set).not.toHaveBeenCalled();
    expect(prismaMock.userOrganization.create).not.toHaveBeenCalled();
  });

  it('matches the address case-insensitively', async () => {
    const { service } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER', email: 'ADA@example.com' });

    await expect(
      service.acceptInvite(token, { id: 'user-ada', email: 'Ada@Example.COM' }),
    ).resolves.toMatchObject({ id: 'org-1' });
  });

  it('is single use: a second acceptance of the same link is a 410', async () => {
    const { service, redis } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER' });
    redis.rawClient?.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await service.acceptInvite(token, ada);
    await expect(
      service.acceptInvite(token, { id: 'user-bob', email: 'bob@x.io' }),
    ).rejects.toThrow(new GoneException(INVITE_MESSAGES.USED));
    expect(prismaMock.userOrganization.create).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for a member: no claim, no write, role unchanged', async () => {
    const { service, redis } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'ADMIN' });
    prismaMock.userOrganization.findFirst.mockResolvedValue({ role: 'USER', disabled: false });

    await expect(service.acceptInvite(token, ada)).resolves.toEqual({ ...ORG, role: 'USER' });
    expect(redis.rawClient?.set).not.toHaveBeenCalled();
    expect(prismaMock.userOrganization.create).not.toHaveBeenCalled();
  });

  it('lets a member open a link meant for someone else without using it up', async () => {
    const { service, redis } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'ADMIN', email: 'bob@example.com' });
    prismaMock.userOrganization.findFirst.mockResolvedValue({ role: 'USER', disabled: false });

    await expect(service.acceptInvite(token, ada)).resolves.toEqual({ ...ORG, role: 'USER' });
    expect(redis.rawClient?.set).not.toHaveBeenCalled();
  });

  it('does not quietly restore a suspended membership', async () => {
    const { service } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER' });
    prismaMock.userOrganization.findFirst.mockResolvedValue({ role: 'USER', disabled: true });

    await expect(service.acceptInvite(token, ada)).rejects.toThrow(ForbiddenException);
  });

  it('releases the claim when the membership cannot be written, so the link still works', async () => {
    const { service, redis } = harness();
    const { token, payload } = tokens.sign({ orgId: 'org-1', role: 'USER' });
    prismaMock.$transaction.mockRejectedValueOnce(new Error('db down'));

    await expect(service.acceptInvite(token, ada)).rejects.toThrow('db down');
    expect(redis.rawClient?.del).toHaveBeenCalledWith(`org-invite:used:${payload.id}`);
  });

  it('treats a concurrent join of the same workspace as success, and frees the link', async () => {
    const { service, redis } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'ADMIN' });
    prismaMock.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    // assertMembership's read, after the collision.
    prismaMock.userOrganization.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: 'USER', organization: ORG });

    await expect(service.acceptInvite(token, ada)).resolves.toEqual({ ...ORG, role: 'USER' });
    expect(redis.rawClient?.del).toHaveBeenCalled();
  });

  it('fails closed without Redis rather than letting a link be used twice', async () => {
    const { service } = harness({ redis: 'none' });
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER' });

    await expect(service.acceptInvite(token, ada)).rejects.toThrow(INVITE_MESSAGES.UNAVAILABLE);
    expect(prismaMock.userOrganization.create).not.toHaveBeenCalled();
  });

  it('fails closed when Redis errors', async () => {
    const { service, redis } = harness();
    const { token } = tokens.sign({ orgId: 'org-1', role: 'USER' });
    redis.rawClient?.set.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(service.acceptInvite(token, ada)).rejects.toThrow(INVITE_MESSAGES.UNAVAILABLE);
    expect(prismaMock.userOrganization.create).not.toHaveBeenCalled();
  });

  it('refuses expired and tampered links before touching anything', async () => {
    const { service, redis } = harness();
    const old = tokens.sign({ orgId: 'org-1', role: 'USER' }, Date.now() - 8 * 24 * 3600 * 1000);

    await expect(service.acceptInvite(old.token, ada)).rejects.toThrow(GoneException);
    await expect(service.acceptInvite('forged.token', ada)).rejects.toThrow(NotFoundException);
    expect(redis.rawClient?.set).not.toHaveBeenCalled();
  });
});

describe('OrgService.leave', () => {
  beforeEach(() => {
    prismaMock.userOrganization.delete.mockResolvedValue({});
    prismaMock.user.update.mockResolvedValue({});
  });

  it("deletes the caller's membership", async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue({ id: 'm-1', role: 'USER' });
    prismaMock.userOrganization.count.mockResolvedValue(1);

    await service.leave('user-ada', 'org-1');

    expect(prismaMock.userOrganization.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-ada', organizationId: 'org-1' },
      select: { id: true, role: true },
    });
    expect(prismaMock.userOrganization.delete).toHaveBeenCalledWith({ where: { id: 'm-1' } });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses the last admin', async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue({ id: 'm-1', role: 'ADMIN' });
    prismaMock.userOrganization.count.mockResolvedValue(0);

    await expect(service.leave('user-ada', 'org-1')).rejects.toThrow(
      new ForbiddenException('Promote someone else to admin before you leave.'),
    );
    expect(prismaMock.userOrganization.delete).not.toHaveBeenCalled();
  });

  it('lets an admin leave when another admin remains', async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue({ id: 'm-1', role: 'ADMIN' });
    // Other admins, then the caller's remaining workspaces.
    prismaMock.userOrganization.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await service.leave('user-ada', 'org-1');

    expect(prismaMock.userOrganization.delete).toHaveBeenCalled();
  });

  it('answers 404 for a workspace the caller is not in', async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue(null);

    await expect(service.leave('user-ada', 'org-1')).rejects.toThrow(NotFoundException);
  });

  it("restarts onboarding when that was the caller's last workspace, so / does not loop", async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue({ id: 'm-1', role: 'USER' });
    prismaMock.userOrganization.count.mockResolvedValue(0);

    await service.leave('user-ada', 'org-1');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-ada' },
      data: { onboardingCompletedAt: null, onboardingStep: 1 },
    });
  });
});

describe('OrgService.removeMember', () => {
  it('restarts onboarding for someone removed from their only workspace', async () => {
    const { service } = harness();
    prismaMock.userOrganization.findFirst.mockResolvedValue({ id: 'm-2', role: 'USER' });
    prismaMock.userOrganization.count.mockResolvedValue(0);

    await service.removeMember('org-1', 'user-bob');

    expect(prismaMock.userOrganization.delete).toHaveBeenCalledWith({ where: { id: 'm-2' } });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-bob' },
      data: { onboardingCompletedAt: null, onboardingStep: 1 },
    });
  });
});
