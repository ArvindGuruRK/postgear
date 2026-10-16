'use client';

/**
 * Confirms rotating a key.
 *
 * Rotation is not destructive to data, but it is to integrations: the old
 * secret stops working the instant the new one exists, and whatever still
 * sends it gets 401 until someone updates it. The copy says so plainly, and
 * the action is the primary colour rather than danger — it is the right
 * thing to do to a leaked key, not a deletion.
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
} from '@postgear/ui';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { ApiKeyCreated, ApiKeyView } from '@/types/developers';

interface RotateKeyDialogProps {
  apiKey: ApiKeyView | null;
  onOpenChange: (open: boolean) => void;
  onRotated: (result: ApiKeyCreated) => void;
}

export function RotateKeyDialog({ apiKey, onOpenChange, onRotated }: RotateKeyDialogProps) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(event: React.MouseEvent<HTMLButtonElement>) {
    // Radix closes the dialog on action by default; the secret dialog that
    // follows is opened by the parent once the request has succeeded.
    event.preventDefault();

    if (!apiKey) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      const result = await api<ApiKeyCreated>(`/developers/api-keys/${apiKey.id}/rotate`, {
        method: 'POST',
      });
      onRotated(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not rotate that key.');
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
          <AlertDialogTitle>Rotate {apiKey?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A new secret is issued under the same name and the current one ({apiKey?.prefix}…)
            stops working immediately. Any integration still sending the old secret will be refused
            until you update it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <Text size="sm" className="text-actionDanger">
            {error}
          </Text>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="primary" onClick={confirm} disabled={working}>
            {working ? 'Rotating…' : 'Rotate key'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
