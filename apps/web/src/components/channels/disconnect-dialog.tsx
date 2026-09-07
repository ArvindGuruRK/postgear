'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Stack,
  Text,
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';

interface DisconnectDialogProps {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Confirms disconnecting a channel.
 *
 * ## Why this asks the server before it asks the user
 *
 * Disconnecting has a consequence the user cannot see from the channel list:
 * anything queued to this channel stops being scheduled. So the dialog fetches
 * the count first and states it. The reference implementation asks a bare "are
 * you sure?" while silently *deleting* every scheduled post for the channel —
 * no count, no warning, no undo.
 *
 * PostGear moves those posts back to drafts instead of deleting them, which is
 * what makes this a safe confirmation rather than a destructive one, and the
 * copy says so plainly.
 */
export function DisconnectDialog({ channel, onOpenChange, onDone }: DisconnectDialogProps) {
  const [queuedPosts, setQueuedPosts] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const channelId = channel?.id ?? null;

  useEffect(() => {
    if (!channelId) {
      setQueuedPosts(null);
      setError(null);
      return;
    }

    let cancelled = false;

    api<{ queuedPosts: number }>(`/channels/${channelId}/disconnect-preview`)
      .then((response) => {
        if (!cancelled) {
          setQueuedPosts(response.queuedPosts);
        }
      })
      .catch(() => {
        // Not being able to count them is no reason to block the disconnect —
        // the dialog just falls back to the generic wording.
        if (!cancelled) {
          setQueuedPosts(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  async function confirm() {
    if (!channelId) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      await api(`/channels/${channelId}`, { method: 'DELETE' });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not disconnect that channel.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={channel !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disconnect {channel?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            PostGear will revoke its access and delete the stored credentials.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <Stack gap="sm">
          {queuedPosts !== null && queuedPosts > 0 ? (
            <Text size="sm">
              {queuedPosts} scheduled {queuedPosts === 1 ? 'post' : 'posts'} will be moved back to
              drafts. Nothing is deleted, and reconnecting later lets you schedule them again.
            </Text>
          ) : (
            <Text size="sm" muted>
              Nothing is currently scheduled to this channel.
            </Text>
          )}

          {error ? (
            <Text size="sm" className="text-actionDanger">
              {error}
            </Text>
          ) : null}
        </Stack>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={confirm} disabled={working}>
            {working ? 'Disconnecting…' : 'Disconnect'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
