import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, prisma } from '@postgear/db';
import { MailService } from '../mail/mail.service';

/**
 * Organizations and membership.
 *
 * ## Every method takes the caller's id
 *
 * Not because the controller could not hold it, but because it forces each
 * query to be scoped by "what is this user allowed to see" at the point the
 * query is written. The alternative — a service that trusts an organization id
 * handed in by the caller — is how multi-tenant data leaks happen, and it
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
  constructor(private readonly mail: MailService) {}

  /**
   * Creates a workspace and makes the creator its ADMIN.
   *
   * Both rows in one transaction: an organization with no members is
   * unreachable — nobody can list it, nobody can be invited to it, and it
   * cannot be deleted through any route. A partial failure here would leave
   * exactly that orphan.
   */
  async create(userId: string, name: string): Promise<OrgSummary> {
    return prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name } });

      await tx.userOrganization.create({
        data: { userId, organizationId: organization.id, role: Role.ADMIN },
      });

      return {
        id: organization.id,
        name: organization.name,
        role: Role.ADMIN,
        createdAt: organization.createdAt,
      };
    });
  }

  /**
   * The caller's workspaces.
   *
   * Returns an empty array for a user who has not onboarded yet — a valid
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
   * be set by hand in the browser — which is why `RolesGuard` re-checks
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

  /** Members of a workspace the caller belongs to. */
  async listMembers(userId: string, organizationId: string) {
    await this.assertMembership(userId, organizationId);

    const members = await prisma.userOrganization.findMany({
      where: { organizationId },
      select: {
        id: true,
        role: true,
        disabled: true,
        createdAt: true,
        user: { select: { id: true, email: true, name: true, lastName: true } },
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
    }));
  }

  /**
   * Invites someone by email.
   *
   * Two cases, and the response is the same for both so an admin cannot use
   * this endpoint to discover which addresses have PostGear accounts:
   *
   * - The address already has an account → a membership row is created
   *   immediately at the requested role.
   * - It does not → an invitation email is sent, and the row is created when
   *   they register. (`User.inviteId` exists for this; wiring the acceptance
   *   side is out of Sprint 2's scope and is recorded as a known gap.)
   */
  async invite(organizationId: string, email: string, role: Role): Promise<{ added: boolean }> {
    const invitee = await prisma.user.findFirst({ where: { email }, select: { id: true } });

    if (!invitee) {
      await this.mail.sendActivation(email, 'invite-placeholder');
      return { added: false };
    }

    // Upsert, not create: re-inviting an existing member updates their role
    // rather than colliding on @@unique([userId, organizationId]).
    await prisma.userOrganization.upsert({
      where: { userId_organizationId: { userId: invitee.id, organizationId } },
      update: { role, disabled: false },
      create: { userId: invitee.id, organizationId, role },
    });

    return { added: true };
  }

  /**
   * Changes a member's role.
   *
   * Refuses to remove the last ADMIN. Without that check an admin can demote
   * themselves in a single-admin workspace and lock everyone out of billing,
   * invitations and settings permanently — recoverable only by direct database
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

    await prisma.userOrganization.delete({ where: { id: membership.id } });
  }

  private async assertNotLastAdmin(organizationId: string, excludingUserId: string): Promise<void> {
    const otherAdmins = await prisma.userOrganization.count({
      where: {
        organizationId,
        role: Role.ADMIN,
        disabled: false,
        userId: { not: excludingUserId },
      },
    });

    if (otherAdmins === 0) {
      throw new ForbiddenException(
        'This workspace needs at least one admin. Promote someone else first.',
      );
    }
  }
}
