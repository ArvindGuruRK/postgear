'use client';

/**
 * Confirms revoking a key. Destructive in the sense that matters — every
 * call with this secret is refused from now on, and there is no undo — so
 * it takes the danger action, like disconnecting a channel.
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
  Text,
  toast,
} from '@postgear/ui';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { ApiKeyView } from '@/types/developers';

interface RevokeKeyDialogProps {
  apiKey: ApiKeyView | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function RevokeKeyDialog({ apiKey, onOpenChange, onDone }: RevokeKeyDialogProps) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();

    if (!apiKey) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      await api(`/developers/api-keys/${apiKey.id}`, { method: 'DELETE' });
      toast({ title: 'Key revoked', description: `${apiKey.name} can no longer call the API.` });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not revoke that key.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog
      open={apiKey !== null}
      onOpenChange={(open) => {
        if (!open) {
          setError(null);
        }
        onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke {apiKey?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Calls made with {apiKey?.prefix}… will be refused from now on. The key stays in the list
            as revoked for your records. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <Text size="sm" className="text-actionDanger">
            {error}
          </Text>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={confirm} disabled={working}>
            {working ? 'Revoking…' : 'Revoke'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
