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
  Text,
  toast,
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';

interface DisableChannelDialogProps {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Confirms disabling a channel, after the reference's "Disable channel"
 * (UI revamp, 2026-10-19).
 *
 * Asked first because the consequence is out of sight: posts already
 * scheduled to the channel stay in the calendar, but none of them publishes
 * while it is disabled (the worker refuses a disabled channel). Unlike a
 * disconnect nothing is moved or revoked, so enabling it again, from the
 * same menu and without a confirmation, picks up where it left off.
 */
export function DisableChannelDialog({ channel, onOpenChange, onDone }: DisableChannelDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (channel) {
      setError(null);
    }
  }, [channel]);

  async function confirm() {
    if (!channel) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      await api(`/channels/${channel.id}`, { method: 'PATCH', body: { disabled: true } });
      toast({ title: 'Channel disabled' });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not disable that channel.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={channel !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Disable this channel?</AlertDialogTitle>
          <AlertDialogDescription>
            Posts scheduled to {channel?.name ?? 'this channel'} will not publish until it is
            enabled again. They stay in the calendar, and nothing is deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <Text size="sm" className="text-dangerInk">
            {error}
          </Text>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep It</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            onClick={(event) => {
              // Closed by `onDone` once the API agrees, not by the click, so
              // a refusal stays on screen with its reason.
              event.preventDefault();
              void confirm();
            }}
            disabled={working}
          >
            {working ? 'Disabling…' : 'Disable Channel'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
