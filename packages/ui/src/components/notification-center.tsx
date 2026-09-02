'use client';

import { Bell } from 'lucide-react';
import { cn } from '../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  timestamp?: string;
  read?: boolean;
}

export interface NotificationCenterProps {
  notifications: NotificationItem[];
  onNotificationClick?: (id: string) => void;
  emptyMessage?: string;
  className?: string;
}

export function NotificationCenter({
  notifications,
  onNotificationClick,
  emptyMessage = "You're all caught up.",
  className,
}: NotificationCenterProps) {
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notifications"
          className={cn(
            'relative flex h-10 w-10 items-center justify-center rounded-md border-2 border-outline bg-secondary shadow-brutalSm outline-none',
            'transition-[transform,box-shadow] duration-100 active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
            'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            className,
          )}
        >
          <Bell className="h-4 w-4 text-ink" strokeWidth={2.5} />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-outline bg-actionDanger px-1 font-sans text-[10px] font-bold text-onActionLight">
              {unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b-2 border-outline px-4 py-3">
          <p className="font-display text-sm uppercase tracking-wide text-ink">Notifications</p>
        </div>
        <div className="max-h-80 overflow-y-auto pg-scrollbar pg-scrollbar-secondary">
          {notifications.length === 0 ? (
            <p className="px-4 py-8 text-center font-sans text-sm text-ink opacity-60">{emptyMessage}</p>
          ) : (
            notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => onNotificationClick?.(notification.id)}
                className={cn(
                  'flex w-full flex-col gap-0.5 border-b-2 border-outline px-4 py-3 text-left outline-none last:border-b-0',
                  'hover:bg-actionPrimary/5',
                  !notification.read && 'bg-actionPrimary/5',
                )}
              >
                <span className="font-sans text-sm font-semibold text-ink">{notification.title}</span>
                {notification.description && (
                  <span className="font-sans text-xs font-medium text-ink opacity-70">{notification.description}</span>
                )}
                {notification.timestamp && (
                  <span className="font-sans text-xs text-ink opacity-50">{notification.timestamp}</span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
