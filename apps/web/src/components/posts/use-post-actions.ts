'use client';

/**
 * The three things a person does to a scheduled post outside the composer:
 * publish it now, move it, delete it.
 *
 * One hook, used by the calendar and the queue, so both surfaces get the same
 * requests, the same toasts and the same error handling. Each action resolves
 * to the API's answer (or `null` on failure, after the toast), and the caller
 * decides how to refresh what it shows.
 */
import { useToast } from '@postgear/ui';
import { useCallback, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { PostDetail } from '@/types/post';
import { formatWhen } from './post-status';

export type PostActionKind = 'publishNow' | 'reschedule' | 'delete';

export function usePostActions() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<{ group: string; kind: PostActionKind } | null>(null);

  const run = useCallback(
    async <T>(
      group: string,
      kind: PostActionKind,
      request: () => Promise<T>,
      fallback: string,
    ): Promise<T | null> => {
      setBusy({ group, kind });

      try {
        return await request();
      } catch (cause) {
        toast({
          variant: 'danger',
          title: fallback,
          description: cause instanceof ApiError ? cause.message : 'Please try again.',
        });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const publishNow = useCallback(
    (group: string) =>
      run(
        group,
        'publishNow',
        async () => {
          const { post } = await api<{ post: PostDetail }>(`/posts/${group}/publish-now`, {
            method: 'POST',
          });
          toast({
            title: 'Publishing now',
            description: 'The worker picks it up within seconds. Watch its status here.',
          });
          return post;
        },
        'Could not publish the post',
      ),
    [run, toast],
  );

  const reschedule = useCallback(
    (group: string, publishDate: Date, options: { quiet?: boolean } = {}) =>
      run(
        group,
        'reschedule',
        async () => {
          const { post } = await api<{ post: PostDetail }>(`/posts/${group}/schedule`, {
            method: 'PUT',
            body: { publishDate: publishDate.toISOString() },
          });
          if (!options.quiet) {
            toast({ title: 'Rescheduled', description: `Now ${formatWhen(publishDate)}.` });
          }
          return post;
        },
        'Could not move the post',
      ),
    [run, toast],
  );

  const remove = useCallback(
    (group: string) =>
      run(
        group,
        'delete',
        async () => {
          await api(`/posts/${group}`, { method: 'DELETE' });
          toast({ title: 'Post deleted' });
          return true;
        },
        'Could not delete the post',
      ),
    [run, toast],
  );

  return { publishNow, reschedule, remove, busy };
}
