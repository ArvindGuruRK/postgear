import {
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { type PrismaTransactionClient, prisma, Role } from '@postgear/db';
import { EntitlementsService } from '../billing/entitlements.service';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { toSessionAvatar } from '../users/session-avatar';
import { type InvitePayload, type InviteRole, InviteTokenService } from './invite-token.service';

/**
 * What the invitation routes say, in one place: the accept page shows these
 * verbatim, so they are written for the person holding the link.
 */
export const INVITE_MESSAGES = {
  /** Malformed, tampered, or for a workspace that no longer exists. */
  INVALID: 'This invitation link is not valid. Ask the person who invited you for a new one.',
  EXPIRED: 'This invitation has expired. Ask the person who invited you for a new one.',
  USED: 'This invitation has already been used. Ask the person who invited you for a new one.',
  WRONG_EMAIL: 'This invitation was sent to a different email address',
  SUSPENDED: 'Your access to this workspace is suspended. Ask one of its admins to restore it.',
  UNAVAILABLE: "Invitations can't be accepted right now. Please try again in a minute.",
} as const;

/** Where a claimed invitation id lives in Redis until the link would have expired anyway. */
const INVITE_CLAIM_PREFIX = 'org-invite:used:';

/** What the accept page needs to say who is inviting whom. */
export interface InvitePreview {
  workspaceName: string;
  role: InviteRole;
  expiresAt: string;
  email?: string;
  /** Only when the request came with a session: whether that person is in already. */
  alreadyMember?: boolean;
}

/**
 * Organizations and membership.
 *
 * ## Every method takes the caller's id
 *
 * Not because the controller could not hold it, but because it forces each
 * query to be scoped by "what is this user allowed to see" at the point the
 * query is written. The alternative (a service that trusts an organization id
 * handed in by the caller) is how multi-tenant data leaks happen, and it
 * looks perfectly reasonable in review.
 *
 * `RolesGuard` has already verified membership for role-guarded routes, but
 * these methods re-scope anyway. Defence in depth against a future route being
 * added without the decorator.
 */
export interface OrgSummary {
  id: string;
  name: string;
  role: Role;
  createdAt: Date;
}

@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    private readonly mail: MailService,
    private readonly entitlements: EntitlementsService,
    private readonly invites: InviteTokenService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Creates a workspace and makes the creator its ADMIN.
   *
   * Both rows in one transaction: an organization with no members is
   * unreachable; nobody can list it, nobody can be invited to it, and it
   * cannot be deleted through any route. A partial failure here would leave
   * exactly that orphan.
   *
   * The trial (Sprint 8) starts *after* the transaction, best-effort: a
   * workspace whose trial could not be written is still a workspace, and
   * the billing page offers "Start free trial" for exactly that case.
   * `EntitlementsService.startTrial` returns null when trials are off
   * (`BILLING_TRIAL_DAYS=0`), which is not a failure.
   */
  async create(userId: string, name: string): Promise<OrgSummary> {
    const organization = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name } });

      await tx.userOrganization.create({
        data: { userId, organizationId: created.id, role: Role.ADMIN },
      });

      return {
        id: created.id,
        name: created.name,
        role: Role.ADMIN,
        createdAt: created.createdAt,
      };
    });

    try {
      await this.entitlements.startTrial(organization.id);
    } catch (error) {
      this.logger.warn(
        `Workspace ${organization.id} was created but its trial could not be started: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return organization;
  }

  /**
   * The caller's workspaces.
   *
   * Returns an empty array for a user who has not onboarded yet: a valid
   * state, not an error. Nothing may assume `[0]` exists.
   */
  async listForUser(userId: string): Promise<OrgSummary[]> {
    const memberships = await prisma.userOrganization.findMany({
      where: { userId, disabled: false },
      select: {
        role: true,
        organization: { select: { id: true, name: true, createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      role: membership.role,
      createdAt: membership.organization.createdAt,
    }));
  }

  /**
   * Confirms the caller may switch into an organization.
   *
   * The controller only sets the cookie after this returns, so a forged
   * `pg_org` value can never be established through the API. (It could still
   * be set by hand in the browser, which is why `RolesGuard` re-checks
   * membership on every request rather than trusting the cookie.)
   */
  async assertMembership(userId: string, organizationId: string): Promise<OrgSummary> {
    const membership = await prisma.userOrganization.findFirst({
      where: { userId, organizationId, disabled: false },
      select: {
        role: true,
        organization: { select: { id: true, name: true, createdAt: true } },
      },
    });

    if (!membership) {
      // 404, not 403. A 403 would confirm the organization exists, letting a
      // caller enumerate ids by watching the status change.
      throw new NotFoundException('Workspace not found');
    }

    return {
      id: membership.organization.id,
      name: membership.organization.name,
      role: membership.role,
      createdAt: membership.organization.createdAt,
    };
  }

  /**
   * Members of a workspace the caller belongs to.
   *
   * `avatar` (2026-10-19) is the same shape `/auth/me` returns, so the Team
   * page draws each person exactly as their own account menu does.
   */
  async listMembers(userId: string, organizationId: string) {
    await this.assertMembership(userId, organizationId);

    const members = await prisma.userOrganization.findMany({
      where: { organizationId },
      select: {
        id: true,
        role: true,
        disabled: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            lastName: true,
            avatarUrl: true,
            avatarPreset: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((member) => ({
      membershipId: member.id,
      userId: member.user.id,
      email: member.user.email,
      name: [member.user.name, member.user.lastName].filter(Boolean).join(' ') || null,
      role: member.role,
      disabled: member.disabled,
      joinedAt: member.createdAt,
      avatar: toSessionAvatar(member.user),
    }));
  }

  /**
   * Creates an invitation link, and emails it when asked to.
   *
   * Nobody is added here (2026-10-19). The earlier version added an address
   * that already had an account on the spot and mailed a placeholder to one
   * that did not; now everyone joins the same way, by opening the link and
   * accepting, so a person is never put into a workspace they did not agree
   * to join.
   *
   * The address is never looked up, so the response cannot differ between
   * "has an account" and "does not": the endpoint is no enumeration oracle
   * for the admins of every workspace. Re-inviting someone already in the
   * workspace is harmless too: accepting leaves their role as it is.
   */
  async createInvite(
    organizationId: string,
    inviterId: string,
    input: { role: InviteRole; sendEmail: boolean; email?: string },
  ): Promise<{ url: string; expiresAt: Date }> {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    });

    if (!organization) {
      throw new NotFoundException('Workspace not found');
    }

    const { token, payload } = this.invites.sign({
      orgId: organizationId,
      role: input.role,
      email: input.email,
    });
    const url = this.mail.linkTo(`/invite/${token}`);
    const expiresAt = new Date(payload.exp);

    if (input.sendEmail && payload.email) {
      const inviter = await prisma.user.findUnique({
        where: { id: inviterId },
        select: { name: true, lastName: true, email: true },
      });
      const inviterName =
        [inviter?.name, inviter?.lastName].filter(Boolean).join(' ') ||
        inviter?.email ||
        'A PostGear admin';

      await this.mail.sendWorkspaceInvitation(payload.email, {
        workspaceName: organization.name,
        inviterName,
        role: payload.role,
        link: url,
        expiresAt,
      });
    }

    return { url, expiresAt };
  }

  /**
   * What the accept page shows before anyone signs in: the workspace and the
   * role. Public, because the person holding the link may not have an account
   * yet; holding it is what entitles them to see where it leads.
   *
   * `viewerId` is the caller when a session came with the request. For them
   * the preview also says whether they are in already, and a used link is not
   * an error for a member (it is most likely the link they used).
   */
  async previewInvite(token: string, viewerId: string | null): Promise<InvitePreview> {
    const payload = this.verifyInvite(token);
    const organization = await this.loadInvitedOrganization(payload);

    let alreadyMember: boolean | undefined;
    if (viewerId) {
      const membership = await prisma.userOrganization.findFirst({
        where: { userId: viewerId, organizationId: payload.orgId, disabled: false },
        select: { id: true },
      });
      alreadyMember = membership !== null;
    }

    // Display only, so the fallback-capable read is fine here; accepting
    // claims through Redis itself and fails closed.
    if (!alreadyMember && (await this.redis.get(claimKey(payload))) !== null) {
      throw new GoneException(INVITE_MESSAGES.USED);
    }

    return {
      workspaceName: organization.name,
      role: payload.role,
      expiresAt: new Date(payload.exp).toISOString(),
      ...(payload.email ? { email: payload.email } : {}),
      ...(alreadyMember === undefined ? {} : { alreadyMember }),
    };
  }

  /**
   * Joins the caller to the invitation's workspace.
   *
   * In order:
   *
   * 1. The signature and expiry (`InviteTokenService`).
   * 2. Already a member: succeed without touching their role or the link, so
   *    a double click, a retry, or opening the link again are all harmless,
   *    and a link opened by someone already inside stays usable for the
   *    person it was meant for. Before the address check on purpose: a
   *    member is not joining, so whose address the link names does not
   *    matter to them, and it grants them nothing they do not have.
   * 3. The address, when the link names one: it must be the caller's.
   * 4. Single use: `SET NX` on the link's id, kept until the link would have
   *    expired anyway. Through the raw client and **failing closed**: the
   *    in-process fallback `RedisService` uses for counters would let one
   *    link be used once per API instance, which is no longer single use.
   * 5. The membership, at the link's role. If writing it fails, the claim is
   *    released so the link still works on a retry.
   *
   * An invited person who has not finished onboarding skips its first step
   * ("Name your workspace"): joining a workspace is what that step is for.
   */
  async acceptInvite(token: string, caller: { id: string; email: string }): Promise<OrgSummary> {
    const payload = this.verifyInvite(token);
    const organization = await this.loadInvitedOrganization(payload);

    const existing = await prisma.userOrganization.findFirst({
      where: { userId: caller.id, organizationId: payload.orgId },
      select: { role: true, disabled: true },
    });

    if (existing) {
      if (existing.disabled) {
        throw new ForbiddenException(INVITE_MESSAGES.SUSPENDED);
      }
      return { ...organization, role: existing.role };
    }

    if (payload.email && payload.email !== caller.email.trim().toLowerCase()) {
      throw new ForbiddenException(INVITE_MESSAGES.WRONG_EMAIL);
    }

    await this.claimInvite(payload, caller.id);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.userOrganization.create({
          data: { userId: caller.id, organizationId: payload.orgId, role: payload.role },
        });
        await tx.user.updateMany({
          where: { id: caller.id, onboardingCompletedAt: null, onboardingStep: { lt: 2 } },
          data: { onboardingStep: 2 },
        });
      });
    } catch (error) {
      await this.releaseInvite(payload);

      // Two tabs accepting two different links to the same workspace: the
      // second insert collides on @@unique([userId, organizationId]). The
      // caller is a member either way, which is what they asked for.
      if (isUniqueViolation(error)) {
        return this.assertMembership(caller.id, payload.orgId);
      }
      throw error;
    }

    return { ...organization, role: payload.role };
  }

  /**
   * The caller leaves a workspace.
   *
   * Acts on the caller's own row only, so the path id is safe to use here
   * where it would not be for acting on someone else. The last admin cannot
   * leave, for the same reason they cannot demote themselves (see
   * `changeRole`).
   */
  async leave(userId: string, organizationId: string): Promise<void> {
    const membership = await prisma.userOrganization.findFirst({
      where: { userId, organizationId },
      select: { id: true, role: true },
    });

    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }

    if (membership.role === Role.ADMIN) {
      await this.assertNotLastAdmin(
        organizationId,
        userId,
        'Promote someone else to admin before you leave.',
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.userOrganization.delete({ where: { id: membership.id } });
      await restartOnboardingIfNoWorkspace(tx, userId);
    });
  }

  /**
   * Changes a member's role.
   *
   * Refuses to remove the last ADMIN. Without that check an admin can demote
   * themselves in a single-admin workspace and lock everyone out of billing,
   * invitations and settings permanently: recoverable only by direct database
   * access.
   */
  async changeRole(organizationId: string, targetUserId: string, role: Role): Promise<void> {
    const membership = await prisma.userOrganization.findFirst({
      where: { userId: targetUserId, organizationId },
      select: { id: true, role: true },
    });

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    if (membership.role === Role.ADMIN && role !== Role.ADMIN) {
      await this.assertNotLastAdmin(organizationId, targetUserId);
    }

    await prisma.userOrganization.update({ where: { id: membership.id }, data: { role } });
  }

  /**
   * Removes a member.
   *
   * Deletes the join row rather than setting `disabled`. `disabled` is for a
   * temporary suspension that preserves the row; removal is meant to be
   * removal, and leaving disabled rows behind would make the member list and
   * seat counting quietly wrong.
   */
  async removeMember(organizationId: string, targetUserId: string): Promise<void> {
    const membership = await prisma.userOrganization.findFirst({
      where: { userId: targetUserId, organizationId },
      select: { id: true, role: true },
    });

    if (!membership) {
      throw new NotFoundException('Member not found');
    }

    if (membership.role === Role.ADMIN) {
      await this.assertNotLastAdmin(organizationId, targetUserId);
    }

    await prisma.$transaction(async (tx) => {
      await tx.userOrganization.delete({ where: { id: membership.id } });
      await restartOnboardingIfNoWorkspace(tx, targetUserId);
    });
  }

  private async assertNotLastAdmin(
    organizationId: string,
    excludingUserId: string,
    message = 'This workspace needs at least one admin. Promote someone else first.',
  ): Promise<void> {
    const otherAdmins = await prisma.userOrganization.count({
      where: {
        organizationId,
        role: Role.ADMIN,
        disabled: false,
        userId: { not: excludingUserId },
      },
    });

    if (otherAdmins === 0) {
      throw new ForbiddenException(message);
    }
  }

  /** The verified payload, or the 404 / 410 the accept page shows as-is. */
  private verifyInvite(token: string): InvitePayload {
    const result = this.invites.verify(token);

    if (!result.ok) {
      throw result.reason === 'expired'
        ? new GoneException(INVITE_MESSAGES.EXPIRED)
        : new NotFoundException(INVITE_MESSAGES.INVALID);
    }

    return result.payload;
  }

  /** A link to a deleted workspace reads as an invalid link, not a 500. */
  private async loadInvitedOrganization(
    payload: InvitePayload,
  ): Promise<{ id: string; name: string; createdAt: Date }> {
    const organization = await prisma.organization.findUnique({
      where: { id: payload.orgId },
      select: { id: true, name: true, createdAt: true },
    });

    if (!organization) {
      throw new NotFoundException(INVITE_MESSAGES.INVALID);
    }

    return organization;
  }

  /** See step 4 of `acceptInvite`. */
  private async claimInvite(payload: InvitePayload, userId: string): Promise<void> {
    const client = this.redis.rawClient;

    if (!client) {
      this.logger.error('An invitation was refused because REDIS_URL is not set.');
      throw new ServiceUnavailableException(INVITE_MESSAGES.UNAVAILABLE);
    }

    const ttlSeconds = Math.max(1, Math.ceil((payload.exp - Date.now()) / 1000));
    let claimed: string | null;

    try {
      claimed = await client.set(claimKey(payload), userId, 'EX', ttlSeconds, 'NX');
    } catch (error) {
      this.logger.error(
        `Could not claim invitation ${payload.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(INVITE_MESSAGES.UNAVAILABLE);
    }

    if (claimed !== 'OK') {
      throw new GoneException(INVITE_MESSAGES.USED);
    }
  }

  /** Best effort: a claim that cannot be released only costs the invitee a new link. */
  private async releaseInvite(payload: InvitePayload): Promise<void> {
    try {
      await this.redis.rawClient?.del(claimKey(payload));
    } catch (error) {
      this.logger.warn(
        `Could not release invitation ${payload.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function claimKey(payload: InvitePayload): string {
  return `${INVITE_CLAIM_PREFIX}${payload.id}`;
}

/**
 * Sends someone who no longer belongs to any workspace back through
 * onboarding from its first step.
 *
 * Without it, leaving (or being removed from) your only workspace is a
 * redirect loop: `/` sends a user with no workspace to `/onboarding`, and
 * `/onboarding` sends anyone who has completed it back to `/`. Restarting at
 * step 1 ("Name your workspace") is the one screen that can create a new one;
 * the survey answers are kept, so the steps after it come back filled in.
 */
async function restartOnboardingIfNoWorkspace(
  tx: PrismaTransactionClient,
  userId: string,
): Promise<void> {
  const remaining = await tx.userOrganization.count({ where: { userId, disabled: false } });

  if (remaining === 0) {
    await tx.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: null, onboardingStep: 1 },
    });
  }
}

/**
 * Prisma's unique-constraint failure. Matched on the code rather than with
 * `instanceof`, so the unit tests can throw a plain object for it.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}
