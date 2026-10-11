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
import type { PostSummary } from '@/types/post';

/** The same confirmation the composer uses, for the calendar and the queue. */
export function DeletePostDialog({
  post,
  busy,
  onOpenChange,
  onConfirm,
}: {
  post: PostSummary | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const queued = post?.state === 'QUEUE';
  const channels = post?.channels.length ?? 0;

  return (
    <AlertDialog open={post !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this post?</AlertDialogTitle>
          <AlertDialogDescription>
            It is removed for {channels === 1 ? 'its channel' : `all ${channels} channels`}
            {queued ? ' and taken out of the queue' : ''}. This cannot be undone.
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
