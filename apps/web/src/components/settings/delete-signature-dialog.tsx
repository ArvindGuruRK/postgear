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
} from '@postgear/ui';
import type { Signature } from '@/types/signature';

/**
 * Confirms deleting a signature, the shape every destructive confirmation in
 * the app has. Says what is not affected: a post the signature was already
 * added to keeps its text, because by then it is just part of the post.
 */
export function DeleteSignatureDialog({
  signature,
  busy,
  onOpenChange,
  onConfirm,
}: {
  signature: Signature | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={signature !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this signature?</AlertDialogTitle>
          <AlertDialogDescription>
            {signature?.autoAdd
              ? 'New posts will start empty again. Posts it was already added to keep their text.'
              : 'Posts it was already added to keep their text.'}{' '}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            onClick={(event) => {
              // Closed by the owner once the API agrees, not by the click.
              event.preventDefault();
              onConfirm();
            }}
            disabled={busy}
            data-testid="signature-delete-confirm"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
