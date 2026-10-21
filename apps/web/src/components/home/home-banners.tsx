'use client';

/**
 * What needs attention, one line each, under the stats (after Buffer's
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
 * that answers 403.
 */
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { PlugIcon } from '@animateicons/react/lucide/plug-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { RotateCwIcon } from '@animateicons/react/lucide/rotate-cw-icon';
import { Alert, Button, MotionIcon } from '@postgear/ui';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Plug, RefreshCw, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Channel } from '@/types/channel';
import { ActionLink } from './home-actions';
import type { HomeBanner } from './home-model';

/**
 * Only the design system's own alert fills, through its `Alert`: the info
 * fill (the primary button blue) for a step to take while nothing is wrong
 * (connect a channel), the warning fill (orange) for something that stops
 * publishing, the danger fill (red) for a failure. No tint of any colour of
 * our own: a hand-mixed blue or brown is not in the system and reads
 * differently in every theme. The action on each stays the neutral secondary
 * button (red buttons are for deleting).
 */
type Tone = 'info' | 'warning' | 'danger';

/**
 * The sentence in the blue "connect a channel" banner is set like the First
 * steps card's lines look in light mode: the UI weight (600) and tracking, in
 * both modes (the owner's call; `type-muted` itself drops to 400 in dark). It
 * stays fully white because `type-ui` has no fade, unlike `type-muted`, which
 * would grey the white on the blue.
 */
const INFO_TEXT = 'type-ui';

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
              <Banner key="no-channels" tone="info" icon={Plug} kind={banner.kind}>
                {canManage ? (
                  <>
                    <span className={INFO_TEXT}>
                      Connect a channel to start tracking your posting streak and goal.
                    </span>
                    <Action
                      onClick={onConnect}
                      icon={<MotionIcon icon={PlugIcon} className="h-4 w-4" />}
                    >
                      Connect A Channel
                    </Action>
                  </>
                ) : (
                  <span className={INFO_TEXT}>
                    No channels are connected yet. Ask a workspace admin to connect one.
                  </span>
                )}
              </Banner>
            );
          case 'reconnect':
            return (
              <Banner
                key={`reconnect-${banner.channel.id}`}
                tone="warning"
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
                tone="warning"
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
                    Finish Setup
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
                <ActionLink href={`/${orgId}/queue?state=ERROR`}>
                  View Failed Posts
                  <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
                </ActionLink>
              </Banner>
            );
          case 'stats-error':
            return (
              <Banner key="stats-error" tone="warning" icon={TriangleAlert} kind={banner.kind}>
                <span>The streak and weekly goal didn't load.</span>
                <Action
                  onClick={onRetryStats}
                  icon={<MotionIcon icon={RotateCwIcon} className="h-4 w-4" />}
                >
                  Try Again
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
    <li data-testid="home-banner" data-kind={kind}>
      <Alert
        variant={tone}
        // On a phone the action wraps under the copy, so the icon keeps to
        // the first line; from `md` everything fits one line and centres.
        className="md:items-center"
      >
        <Icon aria-hidden="true" strokeWidth={2.5} className="mt-0.5 h-4 w-4 shrink-0 md:mt-0" />
        <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {children}
        </span>
      </Alert>
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
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      {icon}
      {children}
    </Button>
  );
}
