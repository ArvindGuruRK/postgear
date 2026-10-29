'use client';

import { BellIcon } from '@animateicons/react/lucide/bell-icon';
import {
  Bell,
  CheckCircle2,
  CreditCard,
  Info,
  type LucideIcon,
  Unplug,
  Webhook,
  Workflow,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { ANIMATED_ICON_CLASS } from '../lib/icon-animation';
import { pressSm } from '../lib/press';
import { useIconAnimation } from '../lib/use-icon-animation';
import { cn } from '../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Skeleton } from './skeleton';
import { TooltipHint } from './tooltip';

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  timestamp?: string;
  read?: boolean;
  /** Where the item leads. The host decides how to get there; this only marks it as a link. */
  href?: string | null;
  /** A catalogue type (`post.failed`, `billing.activated`, …) that picks the icon and its tone. */
  type?: string;
}

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  onNotificationClick?: (id: string) => void;
  emptyMessage?: string;
  className?: string;
  /**
   * The badge count. Defaults to the unread items in `notifications`; a host
   * whose list is a page of a longer feed passes the server's number.
   */
  unreadCount?: number;
  /** Shown as a header action when set; disabled while nothing is unread. */
  onMarkAllRead?: () => void;
  markAllReadLabel?: string;
  /** Rendered under the list: a settings link, a "see all". */
  footer?: ReactNode;
  /** Skeleton rows instead of the list, for the first load. */
  loading?: boolean;
  /** Controlled open state, so a host can close the panel after a navigation. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
}

/**
 * The icon and tone for a catalogue type (Sprint 8). Tones are the Sprint 5
 * vocabulary (success, danger, accent) and `ink` for everything neutral; a
 * type nobody has catalogued gets the plain bell.
 */
const ICONS: Array<{ match: (type: string) => boolean; icon: LucideIcon; tone: string }> = [
  { match: (t) => t === 'post.published', icon: CheckCircle2, tone: 'text-actionSuccess' },
  { match: (t) => t === 'post.failed', icon: XCircle, tone: 'text-actionDanger' },
  { match: (t) => t === 'channel.needs_reconnect', icon: Unplug, tone: 'text-actionAccent' },
  { match: (t) => t === 'billing.payment_failed', icon: CreditCard, tone: 'text-actionDanger' },
  { match: (t) => t.startsWith('billing.'), icon: CreditCard, tone: 'text-ink' },
  { match: (t) => t === 'webhook.failed', icon: Webhook, tone: 'text-actionDanger' },
  { match: (t) => t.startsWith('automation'), icon: Workflow, tone: 'text-ink' },
  { match: (t) => t === 'info', icon: Info, tone: 'text-ink' },
];

function iconFor(type: string | undefined): { icon: LucideIcon; tone: string } {
  const entry = type ? ICONS.find((candidate) => candidate.match(type)) : undefined;
  return entry ?? { icon: Bell, tone: 'text-ink' };
}

/** The badge never grows past three characters. */
function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

export function NotificationCenter({
  notifications,
  onNotificationClick,
  emptyMessage = "You're all caught up.",
  className,
  unreadCount,
  onMarkAllRead,
  markAllReadLabel = 'Mark all as read',
  footer,
  loading = false,
  open,
  onOpenChange,
  title = 'Notifications',
}: NotificationCenterProps) {
  const unread = unreadCount ?? notifications.filter((notification) => !notification.read).length;
  const bell = useIconAnimation();

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <TooltipHint
        label={unread > 0 ? `${title} (${badgeText(unread)} unread)` : title}
        side="bottom"
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            data-testid="notification-bell"
            data-unread={unread}
            {...bell.triggers}
            className={cn(
              // 36px, the theme toggle's size, so the top bar's tiles match.
              'relative flex h-9 w-9 items-center justify-center rounded-md border-2 border-outline bg-secondary outline-none',
              pressSm,
              'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              className,
            )}
          >
            <BellIcon
              ref={bell.ref}
              aria-hidden
              size={16}
              className={cn('h-4 w-4 text-ink', ANIMATED_ICON_CLASS)}
            />
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-outline bg-actionDanger px-1 font-sans text-[10px] font-bold text-onActionLight">
                {badgeText(unread)}
              </span>
            )}
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-3 border-b-2 border-outline px-4 py-3">
          <p className="type-label text-sm text-ink">{title}</p>
          {onMarkAllRead && (
            <button
              type="button"
              onClick={onMarkAllRead}
              disabled={unread === 0 || loading}
              className={cn(
                'font-sans text-xs font-semibold text-actionPrimary underline decoration-2 underline-offset-4',
                'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                'hover:text-actionPrimaryHover disabled:pointer-events-none disabled:opacity-50',
              )}
            >
              {markAllReadLabel}
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto pg-scrollbar pg-scrollbar-secondary">
          {loading ? (
            <div className="flex flex-col gap-3 px-4 py-3" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-8 text-center font-sans text-sm text-ink opacity-60">
              {emptyMessage}
            </p>
          ) : (
            notifications.map((notification) => {
              const { icon: Icon, tone } = iconFor(notification.type);
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => onNotificationClick?.(notification.id)}
                  data-testid="notification-item"
                  data-type={notification.type ?? 'info'}
                  data-read={notification.read ? 'true' : 'false'}
                  className={cn(
                    'flex w-full items-start gap-3 border-b-2 border-outline px-4 py-3 text-left outline-none last:border-b-0',
                    'hover:bg-actionPrimary/5',
                    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:-outline-offset-[3px] focus-visible:outline-focusRing',
                    !notification.read && 'bg-actionPrimary/5',
                  )}
                >
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', tone)} strokeWidth={2.5} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-sans text-sm font-semibold text-ink">
                        {notification.title}
                      </span>
                      {!notification.read && (
                        <>
                          <span
                            aria-hidden="true"
                            className="h-2 w-2 shrink-0 rounded-full bg-actionPrimary"
                          />
                          <span className="sr-only">Unread</span>
                        </>
                      )}
                    </span>
                    {notification.description && (
                      <span className="line-clamp-2 font-sans text-xs font-medium text-ink muted-tone">
                        {notification.description}
                      </span>
                    )}
                    {notification.timestamp && (
                      <span className="font-sans text-xs text-ink opacity-50">
                        {notification.timestamp}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {footer && <div className="border-t-2 border-outline px-4 py-3">{footer}</div>}
      </PopoverContent>
    </Popover>
  );
}
