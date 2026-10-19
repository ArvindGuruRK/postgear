'use client';

/**
 * What needs attention, one line each, under the stats (Buffer's blue
 * "Connect a channel..." banner). Only what is true right now is shown, and
 * each line carries the one action that fixes it:
 *
 * - no channels: the same connect dialog the calendar's Add Channel opens;
 * - a channel needing reconnection or an unfinished setup: the same fix the
 *   channel card's red "!" starts (the OAuth handshake again, or the
 *   page picker);
 * - failed posts: the queue, filtered to them;
 * - the stats failing to load: try again.
 *
 * Actions that need an admin (connecting, reconnecting) are only offered to
 * admins; members are told who can fix it instead of being handed a button
 * that answers 403. The tint is the action colour at low strength over the
 * page, the way the reference tints its banner, so the text stays `ink` in
 * every theme.
 */
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { PlugIcon } from '@animateicons/react/lucide/plug-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { RotateCwIcon } from '@animateicons/react/lucide/rotate-cw-icon';
import { cn, MotionIcon } from '@postgear/ui';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Plug, RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Channel } from '@/types/channel';
import type { HomeBanner } from './home-model';
import { PLAIN_ACTION } from './home-ui';

type Tone = 'primary' | 'accent' | 'danger';

const TINT: Record<Tone, string> = {
  primary: 'bg-actionPrimary/15',
  accent: 'bg-actionAccent/20',
  danger: 'bg-actionDanger/15',
};

const ICON_TONE: Record<Tone, string> = {
  primary: 'text-actionPrimary',
  accent: 'text-accentInk',
  danger: 'text-dangerInk',
};

export function HomeBanners({
  orgId,
  banners,
  canManage,
  onConnect,
  onReconnect,
  onFinishSetup,
  onRetryStats,
}: {
  orgId: string;
  banners: HomeBanner[];
  /** Connecting and reconnecting are admin actions on the API. */
  canManage: boolean;
  onConnect: () => void;
  onReconnect: (channel: Channel) => void;
  onFinishSetup: (channel: Channel) => void;
  onRetryStats: () => void;
}) {
  if (banners.length === 0) {
    return null;
  }

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Needs attention">
      {banners.map((banner) => {
        switch (banner.kind) {
          case 'no-channels':
            return (
              <Banner key="no-channels" tone="primary" icon={Plug} kind={banner.kind}>
                {canManage ? (
                  <>
                    <span>Connect a channel to start tracking your posting streak and goal.</span>
                    <Action
                      onClick={onConnect}
                      icon={<MotionIcon icon={PlugIcon} className="h-4 w-4" />}
                    >
                      Connect a channel
                    </Action>
                  </>
                ) : (
                  <span>No channels are connected yet. Ask a workspace admin to connect one.</span>
                )}
              </Banner>
            );
          case 'reconnect':
            return (
              <Banner
                key={`reconnect-${banner.channel.id}`}
                tone="accent"
                icon={RefreshCw}
                kind={banner.kind}
              >
                <span>
                  <strong className="type-ui">{banner.channel.name}</strong> needs reconnecting
                  before it can publish again.
                  {canManage ? null : ' Ask a workspace admin to reconnect it.'}
                </span>
                {canManage ? (
                  <Action
                    onClick={() => onReconnect(banner.channel)}
                    icon={<MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />}
                  >
                    Reconnect
                  </Action>
                ) : null}
              </Banner>
            );
          case 'setup':
            return (
              <Banner
                key={`setup-${banner.channel.id}`}
                tone="accent"
                icon={Plug}
                kind={banner.kind}
              >
                <span>
                  <strong className="type-ui">{banner.channel.name}</strong> needs its setup
                  finished before it can publish.
                  {canManage ? null : ' Ask a workspace admin to finish it.'}
                </span>
                {canManage ? (
                  <Action
                    onClick={() => onFinishSetup(banner.channel)}
                    icon={<MotionIcon icon={PlugIcon} className="h-4 w-4" />}
                  >
                    Finish setup
                  </Action>
                ) : null}
              </Banner>
            );
          case 'failed':
            return (
              <Banner key="failed" tone="danger" icon={CircleAlert} kind={banner.kind}>
                <span>
                  {banner.count === 1
                    ? '1 post failed to publish.'
                    : `${banner.count} posts failed to publish.`}
                </span>
                <Link href={`/${orgId}/queue?state=ERROR`} className={PLAIN_ACTION}>
                  View failed posts
                  <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
                </Link>
              </Banner>
            );
          case 'stats-error':
            return (
              <Banner key="stats-error" tone="accent" icon={TriangleAlert} kind={banner.kind}>
                <span>The streak and weekly goal didn't load.</span>
                <Action
                  onClick={onRetryStats}
                  icon={<MotionIcon icon={RotateCwIcon} className="h-4 w-4" />}
                >
                  Try again
                </Action>
              </Banner>
            );
          default:
            return null;
        }
      })}
    </ul>
  );
}

function Banner({
  tone,
  icon: Icon,
  kind,
  children,
}: {
  tone: Tone;
  icon: LucideIcon;
  kind: HomeBanner['kind'];
  children: ReactNode;
}) {
  return (
    <li
      data-testid="home-banner"
      data-kind={kind}
      className={cn(
        // On a phone the action wraps under the copy, so the icon keeps to
        // the first line; from `md` everything fits one line and centres.
        'flex items-start gap-3 rounded-lg border-2 border-outline px-4 py-3 md:items-center',
        'font-sans text-sm text-ink',
        TINT[tone],
      )}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={2.5}
        className={cn('mt-0.5 h-4 w-4 shrink-0 md:mt-0', ICON_TONE[tone])}
      />
      <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {children}
      </span>
    </li>
  );
}

function Action({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className={PLAIN_ACTION}>
      {icon}
      {children}
    </button>
  );
}
