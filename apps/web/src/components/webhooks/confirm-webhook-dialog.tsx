'use client';

/**
 * The two confirmations a webhook needs: delete, and rotate its secret. Both
 * are the shape every destructive confirmation in the app has.
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
} from '@postgear/ui';
import type { WebhookView } from '@/types/webhooks';

export type WebhookConfirmKind = 'delete' | 'rotate';

export function ConfirmWebhookDialog({
  webhook,
  kind,
  busy,
  onOpenChange,
  onConfirm,
}: {
  webhook: WebhookView | null;
  kind: WebhookConfirmKind;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const isDelete = kind === 'delete';

  return (
    <AlertDialog open={webhook !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isDelete ? `Delete ${webhook?.name}?` : `Rotate the secret for ${webhook?.name}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isDelete
              ? 'Deliveries stop at once. Anything still being retried is dropped. This cannot be undone.'
              : 'The current secret stops verifying immediately. Update the receiver with the new one, which is shown once.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant={isDelete ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            data-testid={isDelete ? 'webhook-delete-confirm' : 'webhook-rotate-confirm'}
          >
            {busy ? (isDelete ? 'Deleting…' : 'Rotating…') : isDelete ? 'Delete' : 'Rotate secret'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
