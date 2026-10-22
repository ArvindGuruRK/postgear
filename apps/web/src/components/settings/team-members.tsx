'use client';

/**
 * Settings > Team (2026-10-19): who is in the workspace, and, for admins,
 * inviting, re-roling and removing them. The mechanism follows Postiz's team
 * settings: invitations are links (emailed or copied), and a row's actions
 * depend on who is looking.
 *
 * ## Who sees what
 *
 * - **Admins** get "Invite member" in the actions row, a role picker on every
 *   row (their own included: demoting yourself is allowed while another
 *   admin remains, and the page refreshes into the read-only view), and
 *   Remove on everyone else's row.
 * - **Members** see the same list read-only: roles as text, no remove.
 * - **Everyone** gets "Leave workspace" on their own row, which is where
 *   "remove" would otherwise be: you leave, you are not removed.
 *
 * The role comes from `useWorkspace()` and is presentation only; the API
 * refuses anything the page should not have offered, and that refusal (the
 * last-admin rule included) is shown as a toast.
 *
 * ## Which workspace
 *
 * The list is read by the URL's workspace (`GET /orgs/:id/members` checks
 * membership of `:id`), while the admin routes act on the active-workspace
 * cookie, which the dashboard keeps in step with the URL. Every call still
 * names this page's workspace in its path, and the API answers 409 if the
 * two have drifted apart (another tab switched), so nothing lands in the
 * wrong workspace.
 *
 * ## Layout
 *
 * A restrained list (design-system-rules.md §15, §16d): bordered rows in one
 * card, no brutal shadow on the data. Each row is the person on the left and
 * their controls on the right, stacking below `sm` so a long address
 * truncates instead of widening the page on a phone.
 */
import { UserPlusIcon } from '@animateicons/react/lucide/user-plus-icon';
import {
  Button,
  Card,
  ErrorState,
  MotionIcon,
  PageActions,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  toast,
} from '@postgear/ui';
import { Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { InviteRole, TeamMember } from '@/types/team';
import { useWorkspace } from '../navigation/workspace-provider';
import { UserAvatar } from '../profile/user-avatar';
import { InviteMemberDialog } from './invite-member-dialog';
import { LeaveWorkspaceDialog } from './leave-workspace-dialog';
import { RemoveMemberDialog } from './remove-member-dialog';
import {
  avatarSeed,
  canChangeRole,
  canManageTeam,
  canRemove,
  displayName,
  INVITE_ROLES,
  roleLabel,
  roleWithArticle,
} from './team-view-model';

interface TeamMembersProps {
  orgId: string;
  /** Null when the list could not be loaded. */
  initialMembers: TeamMember[] | null;
  /** The signed-in user, to mark "(you)" and put Leave on the right row. */
  currentUserId: string | null;
}

export function TeamMembers({ orgId, initialMembers, currentUserId }: TeamMembersProps) {
  const router = useRouter();
  const { role, organizations } = useWorkspace();
  const canManage = canManageTeam(role);
  const workspaceName =
    organizations.find((organization) => organization.id === orgId)?.name ?? 'this workspace';

  const [members, setMembers] = useState<TeamMember[] | null>(initialMembers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  /** Rows with a role change in flight, so a second pick waits for the first. */
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());

  async function refresh() {
    try {
      const response = await api<{ members: TeamMember[] }>(`/orgs/${orgId}/members`);
      setMembers(response.members);
    } catch (cause) {
      toast({
        title: "Couldn't refresh the list",
        description: cause instanceof ApiError ? cause.message : 'Reload the page to see the team.',
      });
    }
  }

  function setRoleLocally(userId: string, next: TeamMember['role']) {
    setMembers(
      (current) =>
        current?.map((member) => (member.userId === userId ? { ...member, role: next } : member)) ??
        null,
    );
  }

  async function changeRole(member: TeamMember, next: InviteRole) {
    if (next === member.role || saving.has(member.userId)) {
      return;
    }

    const previous = member.role;
    setRoleLocally(member.userId, next);
    setSaving((current) => new Set(current).add(member.userId));

    try {
      await api(`/orgs/${orgId}/members/${member.userId}`, {
        method: 'PATCH',
        body: { role: next },
      });
      const isSelf = member.userId === currentUserId;
      toast({
        title: 'Role updated',
        description: isSelf
          ? `You are now ${roleWithArticle(next)} of ${workspaceName}.`
          : `${displayName(member)} is now ${roleWithArticle(next)}.`,
      });
      if (isSelf) {
        // The provider's role is read on the server; refreshing re-renders
        // this page as what the person now is.
        router.refresh();
      }
    } catch (cause) {
      setRoleLocally(member.userId, previous);
      toast({
        title: cause instanceof ApiError ? cause.message : 'We could not change that role.',
        variant: 'danger',
      });
    } finally {
      setSaving((current) => {
        const next = new Set(current);
        next.delete(member.userId);
        return next;
      });
    }
  }

  return (
    <Stack gap="lg">
      {canManage ? (
        <PageActions>
          <Button onClick={() => setInviteOpen(true)} data-testid="team-invite">
            <MotionIcon icon={UserPlusIcon} className="h-4 w-4" />
            Invite Member
          </Button>
        </PageActions>
      ) : null}

      {members === null ? (
        <ErrorState
          icon={Users}
          title="Couldn't load the team"
          description="The API did not answer. Check that it is running, then try again."
          action={{ label: 'Try Again', onClick: () => void refresh() }}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul aria-label={`Members of ${workspaceName}`} className="divide-y-2 divide-outline">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const name = displayName(member);

              return (
                <li
                  key={member.membershipId}
                  data-testid="team-member"
                  data-email={member.email}
                  data-role={member.role}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <UserAvatar name={avatarSeed(member)} avatar={member.avatar} />
                    <div className={member.disabled ? 'min-w-0 opacity-60' : 'min-w-0'}>
                      <p className="truncate type-ui text-sm text-ink">
                        {name}
                        {isSelf ? <span className="opacity-60"> (you)</span> : null}
                        {member.disabled ? <span className="opacity-60"> (suspended)</span> : null}
                      </p>
                      <Text size="xs" muted className="truncate">
                        {member.email}
                      </Text>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 ps-13 sm:shrink-0 sm:flex-nowrap sm:ps-0">
                    {canChangeRole(role, member) ? (
                      <Select
                        value={member.role}
                        onValueChange={(value) => void changeRole(member, value as InviteRole)}
                        disabled={saving.has(member.userId)}
                      >
                        <SelectTrigger
                          className="h-9 w-28 text-xs sm:w-32"
                          aria-label={isSelf ? 'Your role' : `Role of ${name}`}
                          data-testid="team-member-role"
                        >
                          {/* The label as children: Radix fills an empty
                              SelectValue only after hydration, which left
                              the server-rendered picker blank. */}
                          <SelectValue>{roleLabel(member.role)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {INVITE_ROLES.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Text size="sm" as="span" className="sm:w-32" data-testid="team-member-role">
                        {roleLabel(member.role)}
                      </Text>
                    )}

                    {/* A fixed slot from `sm` up, so the role column lines up
                        down the list whether a row ends in "Leave workspace",
                        "Remove" or nothing. */}
                    <div className="flex sm:w-36 sm:justify-end">
                      {isSelf ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setLeaveOpen(true)}
                          data-testid="team-leave"
                        >
                          Leave Workspace
                        </Button>
                      ) : canRemove(role, member, isSelf) ? (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setRemoving(member)}
                          aria-label={`Remove ${name}`}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <InviteMemberDialog
        open={inviteOpen}
        orgId={orgId}
        workspaceName={workspaceName}
        onOpenChange={setInviteOpen}
      />

      <RemoveMemberDialog
        member={removing}
        orgId={orgId}
        workspaceName={workspaceName}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
          }
        }}
        onRemoved={() => {
          setRemoving(null);
          void refresh();
        }}
      />

      <LeaveWorkspaceDialog
        open={leaveOpen}
        orgId={orgId}
        workspaceName={workspaceName}
        onOpenChange={setLeaveOpen}
      />
    </Stack>
  );
}
