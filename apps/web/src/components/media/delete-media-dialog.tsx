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
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { MediaItem } from '@/types/media';

/**
 * Confirms deleting a library item, stating what it affects.
 *
 * The same shape as the channel disconnect dialog, for the same reason: the
 * consequence is invisible from where the button is. Drafts and queued posts
 * that attach this file lose the attachment, so the count is fetched and said
 * before anyone confirms.
 */
export function DeleteMediaDialog({
  item,
  onOpenChange,
  onDeleted,
}: {
  item: MediaItem | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (item: MediaItem) => void;
}) {
  const [posts, setPosts] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const id = item?.id ?? null;

  useEffect(() => {
    setPosts(null);
    setError(null);

    if (!id) {
      return;
    }

    let cancelled = false;

    api<{ posts: number }>(`/media/${id}/usage`)
      .then((result) => !cancelled && setPosts(result.posts))
      // Not knowing the count is no reason to block the delete.
      .catch(() => !cancelled && setPosts(0));

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function confirm(event: React.MouseEvent) {
    // Keep the dialog open until the request settles, so an error has somewhere to show.
    event.preventDefault();

    if (!item) {
      return;
    }

    setWorking(true);

    try {
      await api(`/media/${item.id}`, { method: 'DELETE' });
      onDeleted(item);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That file could not be deleted.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog open={item !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {item?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The file is removed from the library and from storage. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {posts === null ? (
          <Text size="sm" muted>
            Checking where it is used…
          </Text>
        ) : posts > 0 ? (
          <Text size="sm">
            {posts} unpublished {posts === 1 ? 'post uses' : 'posts use'} this file and will lose
            the attachment.
          </Text>
        ) : (
          <Text size="sm" muted>
            No draft or queued post uses this file.
          </Text>
        )}

        {error ? (
          <Text size="sm" className="text-actionDanger" role="alert">
            {error}
          </Text>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="danger"
            onClick={confirm}
            disabled={working || posts === null}
          >
            {working ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
