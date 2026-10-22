'use client';

/**
 * Confirms removing someone from the workspace. Their access ends on their
 * next request (`RolesGuard` re-reads membership every time), and the only
 * way back is a new invitation, so it takes the danger action.
 *
 * A refusal (the API's last-admin rule, a stale page) is a toast, like every
 * other row action on the Team page, and the dialog closes: there is nothing
 * in it to correct.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  toast,
} from '@postgear/ui';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { TeamMember } from '@/types/team';
import { displayName } from './team-view-model';

interface RemoveMemberDialogProps {
  member: TeamMember | null;
  orgId: string;
  workspaceName: string;
  onOpenChange: (open: boolean) => void;
  onRemoved: () => void;
}

export function RemoveMemberDialog({
  member,
  orgId,
  workspaceName,
  onOpenChange,
  onRemoved,
}: RemoveMemberDialogProps) {
  const [working, setWorking] = useState(false);
  const name = member ? displayName(member) : '';

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    if (!member || working) {
      return;
    }

    setWorking(true);

    try {
      await api(`/orgs/${orgId}/members/${member.userId}`, { method: 'DELETE' });
      toast({
        title: 'Member removed',
        description: `${name} no longer has access to ${workspaceName}.`,
      });
      onRemoved();
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : `We could not remove ${name}.`,
        variant: 'danger',
      });
      onOpenChange(false);
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={member !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {name} loses access to {workspaceName} straight away. Their posts stay. To bring them
            back, invite them again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep Them</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={confirm} disabled={working}>
            {working ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
