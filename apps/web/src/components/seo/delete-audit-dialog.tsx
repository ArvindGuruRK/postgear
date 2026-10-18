'use client';

/**
 * The confirmation before an audit is removed from the history: the same
 * shape as the post and media delete dialogs, because a destructive action
 * should ask the same way everywhere.
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
import type { SeoAuditSummary } from '@/types/seo';
import { hostOf } from './seo-view-model';

export function DeleteAuditDialog({
  audit,
  busy,
  onOpenChange,
  onConfirm,
}: {
  audit: SeoAuditSummary | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={audit !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this audit?</AlertDialogTitle>
          <AlertDialogDescription>
            The run for {audit ? hostOf(audit.targetUrl) : 'this site'}
            {audit?.grade ? ` (grade ${audit.grade})` : ''} is removed from the history and its
            trend. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep it</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
