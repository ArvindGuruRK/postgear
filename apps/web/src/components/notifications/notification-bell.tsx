'use client';

/**
 * The bell in the top bar (Sprint 8): the design system's `NotificationCenter`
 * fed by `useNotifications`.
 *
 * A click on an item navigates by what its link is: an app path goes
 * through the router and closes the panel; a platform URL (a published post)
 * opens in a new tab with `noopener`, since the destination is not ours;
 * anything else is inert. Content is rendered as text by the component:
 * nothing a provider's error message contains can become markup here.
 *
 * Timestamps are formatted only after mount (`useMounted`): "2h ago" is the
 * viewer's clock, which the server does not share.
 */
import { NotificationCenter, type NotificationItem, toast } from '@postgear/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { leaveThen } from '@/lib/leave-guard';
import { useWorkspace } from '../navigation/workspace-provider';
import { useMounted } from '../posts/use-mounted';
import { formatTimestamp, linkKind, titleOf } from './notifications-state';
import { useNotifications } from './use-notifications';

export function NotificationBell() {
  const router = useRouter();
  const { activeOrgId } = useWorkspace();
  const mounted = useMounted();
  const { state, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  const items = useMemo<NotificationItem[]>(
    () =>
      state.items.map((item) => ({
        id: item.id,
        title: titleOf(item),
        description: item.content,
        timestamp: mounted ? formatTimestamp(item.createdAt) : undefined,
        read: item.read,
        href: item.link,
        type: item.type,
      })),
    [state.items, mounted],
  );

  const onItemClick = useCallback(
    (id: string) => {
      const item = state.items.find((candidate) => candidate.id === id);
      if (!item) {
        return;
      }

      switch (linkKind(item.link)) {
        case 'app':
          setOpen(false);
          // Unsaved work on the page (the Studio editor) is saved first.
          leaveThen(() => router.push(item.link as string));
          return;
        case 'external':
          window.open(item.link as string, '_blank', 'noopener');
          return;
        case 'none':
          return;
      }
    },
    [router, state.items],
  );

  const onMarkAllRead = useCallback(async () => {
    setMarking(true);
    try {
      await markAllRead();
    } catch (error) {
      toast({
        variant: 'danger',
        title: "Couldn't mark as read",
        description:
          error instanceof ApiError ? error.message : 'Check your connection and try again.',
      });
    } finally {
      setMarking(false);
    }
  }, [markAllRead]);

  const emptyMessage = state.error ?? "You're all caught up.";

  return (
    <NotificationCenter
      open={open}
      onOpenChange={setOpen}
      notifications={items}
      unreadCount={state.unread}
      loading={!state.loaded || marking}
      emptyMessage={emptyMessage}
      onNotificationClick={onItemClick}
      onMarkAllRead={() => void onMarkAllRead()}
      footer={
        <div className="flex items-center justify-between gap-3">
          <Link
            href={`/${activeOrgId}/settings/notifications`}
            onClick={() => setOpen(false)}
            className="font-sans text-xs font-semibold text-actionPrimary underline decoration-2 underline-offset-4 outline-none hover:text-actionPrimaryHover focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          >
            Notification settings
          </Link>
          {state.loaded && state.connection !== 'open' && (
            <span
              className="font-sans text-xs font-medium text-ink opacity-60"
              data-testid="notification-connection"
              data-state={state.connection}
            >
              {state.connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
            </span>
          )}
        </div>
      }
    />
  );
}
