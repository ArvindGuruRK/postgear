'use client';

/**
 * Confirms leaving the workspace, for anyone in it.
 *
 * On success the page navigates to `/` and refreshes, rather than choosing a
 * destination itself: the root route already decides between another
 * workspace and onboarding (and the API restarts onboarding for someone who
 * just left their only workspace, so that choice cannot loop). The refresh
 * matters as much as the navigation: without it the router could replay the
 * cached layout of the workspace that was just left.
 *
 * The last admin is refused by the API; that message is a toast.
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
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';

interface LeaveWorkspaceDialogProps {
  open: boolean;
  orgId: string;
  workspaceName: string;
  onOpenChange: (open: boolean) => void;
}

export function LeaveWorkspaceDialog({
  open,
  orgId,
  workspaceName,
  onOpenChange,
}: LeaveWorkspaceDialogProps) {
  const router = useRouter();
  const [working, setWorking] = useState(false);

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    if (working) {
      return;
    }

    setWorking(true);

    try {
      await api(`/orgs/${orgId}/leave`, { method: 'POST' });
      toast({ title: `You left ${workspaceName}` });
      router.replace('/');
      router.refresh();
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'We could not take you out of it.',
        variant: 'danger',
      });
      onOpenChange(false);
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {workspaceName}?</AlertDialogTitle>
          <AlertDialogDescription>
            You lose access to its posts, channels and media straight away. To come back, an admin
            has to invite you again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Stay</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={confirm} disabled={working}>
            {working ? 'Leaving…' : 'Leave Workspace'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
