'use client';

import { BotIcon } from '@animateicons/react/lucide/bot-icon';
/**
 * The calendar's channel card, after the reference's channel column (UI
 * revamp, 2026-10-18): the workspace's channels beside the grid, and the one
 * place a person starts from, whether adding a channel or creating a post.
 * That is why neither Channels nor Composer is in the rail.
 *
 * Its layout, kept as is: the "Channels" title with a collapse toggle; Add
 * Channel with a square companion button; Create Post with the AI shortcut
 * beside it (both only once a channel exists); then one row per channel, its
 * picture with the platform sticker, its name, and a menu. Collapsed, it
 * keeps only the icons and the pictures. It is the page's one framed card:
 * the toolbar and grid beside it sit on the page ground.
 *
 * Where PostGear differs, and why:
 * - The square beside Add Channel opens the full Channels page (plan limit,
 *   health, every channel's detail). The reference's invites a customer,
 *   which PostGear does not have.
 * - Clicking a channel filters the calendar to it, and to any other selected;
 *   this is where the calendar's channel filter lives.
 * - A channel that cannot publish shows a red "!" on its picture that starts
 *   the fix (reconnect, or finish choosing the page), as the reference's does.
 * - Admins can drag a channel by its grip into the workspace's order
 *   (2026-10-19, `channel-rows.tsx`); the reference has no reordering.
 * - The foot carries the plan's channel usage and quick-connect icons, after
 *   Buffer's sidebar (`channels-usage.tsx`).
 *
 * The ⋮ menu is the reference's channel menu (`ChannelMenuContent`, shared
 * with the Channels page), so the two places never offer different things.
 */
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { EllipsisVerticalIcon } from '@animateicons/react/lucide/ellipsis-vertical-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { SlidersHorizontalIcon } from '@animateicons/react/lucide/sliders-horizontal-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import {
  ANIMATED_ICON_CLASS,
  cn,
  DropdownMenu,
  DropdownMenuTrigger,
  fillHoverNeutral,
  fillHoverNeutralLayer,
  MotionIcon,
  pressSm,
  TooltipHint,
  useFillHover,
  useIconAnimation,
} from '@postgear/ui';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { CHANNEL_HEALTH, isBroken } from '@/components/channels/channel-health';
import { ChannelMark } from '@/components/channels/channel-mark';
import { ChannelMenuContent, type ChannelMenuHandlers } from '@/components/channels/channel-menu';
import { ChannelPreferencesDialog } from '@/components/channels/channel-preferences-dialog';
import { ConnectChannelDialog } from '@/components/channels/connect-channel-dialog';
import { DisableChannelDialog } from '@/components/channels/disable-channel-dialog';
import { DisconnectDialog } from '@/components/channels/disconnect-dialog';
import { FinishSetupDialog } from '@/components/channels/finish-setup-dialog';
import { PostingTimesDialog } from '@/components/channels/posting-times-dialog';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import { channelConnectUrl } from '@/lib/api';
import type { Channel, ChannelLimit, ProviderSummary } from '@/types/channel';
import { useCalendar } from './calendar-context';
import { SortableChannelList } from './channel-rows';
import { ChannelsUsage } from './channels-usage';

const STORAGE_KEY = 'postgear:channels-collapsed';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

/** The pressable tile every button in the card shares, sized by the caller. */
const TILE = cn(
  'flex h-11 shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-outline type-ui text-sm',
  pressSm,
  'disabled:opacity-50',
  FOCUS,
);

/** TooltipContent's default gap from its trigger, in px. */
const TOOLTIP_GAP = 6;

/**
 * What a channel row's tooltip must clear to open past the row's ⋮ button:
 * the button (w-6, 24px) plus the row's gap-1 (4px). Kept in step with those
 * two classes below.
 */
const ROW_MENU_CLEARANCE = 28;

/**
 * The red "!" on a channel that cannot publish, laid on its picture's top-left
 * corner the way the bell's count sits on the bell. Measured from the row: the
 * picture starts 6px in (the row button's 2px border and 4px padding), so at
 * 2px the badge's centre lands 4px inside the picture's corner. With the
 * reorder grip before the button (w-4 plus the row's gap-1) everything moves
 * 20px along, hence `start-5.5`.
 */
const BADGE = cn(
  'absolute top-0.5 z-10 flex h-4 w-4 items-center justify-center rounded-full border-2 border-outline',
  'bg-actionDanger font-sans text-[10px] font-bold leading-none text-onActionLight',
);

export function ChannelsColumn({
  providers,
  limit,
  inSheet = false,
  className,
}: {
  providers: ProviderSummary[];
  /** The plan's channel ceiling; null only when no workspace is active. */
  limit: ChannelLimit | null;
  /**
   * Shown in the phone's channel sheet (ChannelsSheet): always expanded,
   * unframed, and titled by the sheet, which also closes it.
   */
  inSheet?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { role } = useWorkspace();
  const { orgId, channels, channelFilter, toggleChannel, clearChannelFilter } = useCalendar();
  const aiIcon = useIconAnimation();
  // Connecting and disconnecting are ADMIN-only on the API; this only avoids
  // offering what would come back 403.
  const canManage = role === 'ADMIN' || role === 'SUPERADMIN';
  const atLimit = limit !== null && limit.used >= limit.max;
  // Add Channel is a neutral tile, so it fills on hover like Button's
  // secondary variant.
  const addFill = useFillHover({ disabled: atLimit });

  // Expanded is the default; the stored preference is applied after mount so
  // server and first client render agree.
  const [collapsedPreference, setCollapsed] = useState(false);
  const collapsed = !inSheet && collapsedPreference;
  const [connectOpen, setConnectOpen] = useState(false);
  const [setupChannel, setSetupChannel] = useState<Channel | null>(null);
  const [timesChannel, setTimesChannel] = useState<Channel | null>(null);
  const [preferencesChannel, setPreferencesChannel] = useState<Channel | null>(null);
  const [disableChannel, setDisableChannel] = useState<Channel | null>(null);
  const [disconnectChannel, setDisconnectChannel] = useState<Channel | null>(null);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === 'true') setCollapsed(true);
    } catch {
      // Storage unavailable (private mode, blocked cookies): keep the default.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // The preference just won't persist.
      }
      return next;
    });
  }

  function reconnect(channel: Channel) {
    // Restarts the handshake for this channel, passing PostGear's own id so
    // the API can verify the same account is re-authorized.
    window.location.href = channelConnectUrl(channel.providerIdentifier, channel.id);
  }

  function fix(channel: Channel) {
    if (channel.health === 'needs_setup') {
      setSetupChannel(channel);
    } else {
      reconnect(channel);
    }
  }

  function done() {
    setSetupChannel(null);
    setTimesChannel(null);
    setPreferencesChannel(null);
    setDisableChannel(null);
    setDisconnectChannel(null);
    // Re-runs the page's server fetch, so the card, the day view's posting
    // times and every post's avatar show what was just saved.
    router.refresh();
  }

  const menu: ChannelMenuHandlers = {
    onPreferences: setPreferencesChannel,
    onEditTimes: setTimesChannel,
    onReconnect: reconnect,
    onFinishSetup: setSetupChannel,
    onDisable: setDisableChannel,
    onDisconnect: setDisconnectChannel,
    onChanged: done,
  };

  const hasChannels = channels.length > 0;
  const filtering = channelFilter.length > 0;

  function renderRow(channel: Channel, grip: ReactNode) {
    const selected = channelFilter.includes(channel.id);
    const broken = isBroken(channel.health);
    const health = CHANNEL_HEALTH[channel.health];

    return (
      <>
        {/* The reference's hover marker on the card's edge. */}
        {collapsed ? null : (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -start-5 top-1 bottom-1 w-1 rounded-e-full bg-actionPrimary transition-opacity',
              selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100',
            )}
          />
        )}

        {grip}

        <TooltipHint
          label={
            collapsed
              ? channel.name
              : selected
                ? `Stop filtering by ${channel.name}`
                : `Show only ${channel.name}'s posts`
          }
          side="right"
          // Opens past the row's ⋮ button, not on top of it, and closes as
          // the pointer leaves, so moving onto the ⋮ shows its own name
          // instead of this one lingering.
          sideOffset={canManage && !collapsed ? TOOLTIP_GAP + ROW_MENU_CLEARANCE : undefined}
          hoverable={false}
        >
          <button
            type="button"
            onClick={() => toggleChannel(channel.id)}
            aria-pressed={selected}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-lg border-2 p-1',
              FOCUS,
              selected
                ? 'border-outline bg-actionPrimary/10'
                : 'border-transparent hover:bg-primary',
            )}
          >
            <ChannelMark
              color={channel.color}
              id={channel.id}
              name={channel.name}
              picture={channel.picture}
              platform={channel.providerIdentifier}
              platformName={channel.providerName}
            />
            {collapsed ? (
              <span className="sr-only">{channel.name}</span>
            ) : (
              <span className="min-w-0 flex-1 truncate text-start type-ui text-sm text-ink">
                {channel.name}
              </span>
            )}
          </button>
        </TooltipHint>

        {broken ? (
          <TooltipHint
            label={
              canManage
                ? `${health.explanation ?? health.label} Click to fix.`
                : (health.explanation ?? health.label)
            }
            // Above the badge: to its right it covered the channel's name,
            // the next thing the pointer reaches.
            side="top"
            align="start"
            hoverable={false}
          >
            {canManage ? (
              <button
                type="button"
                onClick={() => fix(channel)}
                aria-label={`${channel.name}: ${health.explanation ?? health.label}`}
                className={cn(BADGE, grip ? 'start-5.5' : 'start-0.5', FOCUS)}
              >
                !
              </button>
            ) : (
              // Not a disabled button: nothing here can be done by this
              // person, so it is a status mark, not a control.
              <span
                role="img"
                aria-label={`${channel.name}: ${health.explanation ?? health.label}`}
                className={cn(BADGE, grip ? 'start-5.5' : 'start-0.5')}
              >
                !
              </span>
            )}
          </TooltipHint>
        ) : null}

        {canManage && !collapsed ? (
          <DropdownMenu>
            <TooltipHint label="Channel Options" side="right">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Manage ${channel.name}`}
                  className={cn(
                    'flex h-8 w-6 shrink-0 items-center justify-center rounded-md text-ink opacity-60 hover:bg-primary hover:opacity-100',
                    FOCUS,
                  )}
                >
                  <MotionIcon icon={EllipsisVerticalIcon} className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipHint>
            <ChannelMenuContent channel={channel} orgId={orgId} handlers={menu} />
          </DropdownMenu>
        ) : null}
      </>
    );
  }

  return (
    <aside
      aria-label="Channels"
      className={cn(
        'relative flex shrink-0 flex-col overflow-hidden',
        inSheet
          ? 'min-h-0 flex-1'
          : 'rounded-2xl border-2 border-outline bg-chrome shadow-surfaceMd transition-[width] duration-150 ease-out',
        inSheet ? null : collapsed ? 'w-[5.5rem]' : 'w-[16.25rem]',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden pg-scrollbar-hidden',
          collapsed ? 'items-center px-3 py-5' : inSheet ? 'px-5 pb-5' : 'p-5',
        )}
      >
        <div
          className={cn(
            'flex items-center',
            collapsed ? 'justify-center' : 'gap-2',
            inSheet && 'hidden',
          )}
        >
          {collapsed ? null : (
            <h2 className="min-w-0 flex-1 truncate type-heading text-xl text-ink">Channels</h2>
          )}
          <TooltipHint label={collapsed ? 'Expand Channels' : 'Collapse Channels'} side="right">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand Channels' : 'Collapse Channels'}
              aria-expanded={!collapsed}
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary text-ink hover:bg-primary',
                FOCUS,
              )}
            >
              <MotionIcon
                icon={ChevronLeftIcon}
                className={cn('h-4 w-4 transition-transform', collapsed && 'rotate-180')}
              />
            </button>
          </TooltipHint>
        </div>

        <div className={cn('flex flex-col gap-2', collapsed && 'items-center')}>
          <div className={cn('flex gap-2', collapsed && 'flex-col')}>
            {canManage ? (
              <TooltipHint
                label={atLimit ? 'This plan’s channel limit is reached' : 'Add Channel'}
                side="right"
                disabled={atLimit}
                // Expanded, the button says "Add Channel" itself; only the
                // limit reason is worth a hover.
                hidden={!collapsed && !atLimit}
                triggerClassName={collapsed ? undefined : 'flex-1'}
              >
                <button
                  ref={addFill.rootRef}
                  type="button"
                  onClick={() => setConnectOpen(true)}
                  disabled={atLimit}
                  aria-label="Add Channel"
                  className={cn(TILE, fillHoverNeutral, collapsed ? 'w-11' : 'flex-1 px-3')}
                >
                  <span ref={addFill.fillRef} aria-hidden className={fillHoverNeutralLayer} />
                  <MotionIcon icon={PlusIcon} className="h-4 w-4 shrink-0" />
                  {collapsed ? null : <span className="truncate">Add Channel</span>}
                </button>
              </TooltipHint>
            ) : null}
            <ColumnLink
              href={`/${orgId}/channels`}
              label="Manage Channels"
              fill
              className={cn(TILE, 'w-11')}
            >
              <MotionIcon icon={SlidersHorizontalIcon} className="h-4 w-4" />
            </ColumnLink>
          </div>

          {/* Always offered (2026-10-21), channels or not: the composer lets a
              person start writing and connect a platform from inside it, so
              nothing here is blocked behind Add Channel. */}
          <div className={cn('flex gap-2', collapsed && 'flex-col')}>
            <ColumnLink
              href={`/${orgId}/composer`}
              label="Create Post"
              // Expanded, the label is on the button already.
              tooltip={collapsed}
              className={cn(
                TILE,
                'bg-actionPrimary text-onActionPrimary',
                collapsed ? 'w-11' : 'flex-1 px-3',
              )}
            >
              <MotionIcon icon={SquarePenIcon} className="h-4 w-4 shrink-0" />
              {collapsed ? null : <span className="truncate">Create Post</span>}
            </ColumnLink>
            <ColumnLink
              href={`/${orgId}/ai-copilot`}
              label="Generate With AI"
              triggers={aiIcon.triggers}
              className={cn(TILE, 'w-11 bg-actionAi text-onActionAi')}
            >
              <BotIcon
                ref={aiIcon.ref}
                aria-hidden
                // Larger than the tile's other glyphs: the bot's face is
                // detailed, and at 16px it read as a smudge in a 44px tile.
                size={22}
                className={cn('h-[22px] w-[22px]', ANIMATED_ICON_CLASS)}
              />
            </ColumnLink>
          </div>
        </div>

        {!hasChannels ? (
          collapsed ? null : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-2 text-center">
              <p className="type-heading text-lg text-ink">No channels yet</p>
              <p className="font-sans text-sm text-ink type-muted">
                Connect your social accounts to start posting.
              </p>
            </div>
          )
        ) : (
          <div className={cn('flex flex-col gap-3', collapsed && 'items-center')}>
            {filtering && !collapsed ? (
              <div className="flex items-center justify-between gap-2 font-sans text-xs text-ink">
                <span className="type-muted">
                  Showing {channelFilter.length} of {channels.length}
                </span>
                <button
                  type="button"
                  onClick={clearChannelFilter}
                  className={cn('rounded-sm type-ui underline underline-offset-2', FOCUS)}
                >
                  Show All
                </button>
              </div>
            ) : null}

            <SortableChannelList
              // Not while collapsed: the pictures alone leave no room for a
              // grip, and the order is easier to judge with the names shown.
              canReorder={canManage && !collapsed}
              renderRow={renderRow}
            />
          </div>
        )}
      </div>

      {/* Pinned under the list rather than scrolling with it. Not while
          collapsed: a meter and icons in an 88px card are noise. */}
      {collapsed ? null : (
        <ChannelsUsage
          orgId={orgId}
          channels={channels}
          providers={providers}
          limit={limit}
          canManage={canManage}
          className="px-5 pt-3 pb-5"
        />
      )}

      <ConnectChannelDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        providers={providers}
      />
      <FinishSetupDialog
        channel={setupChannel}
        onOpenChange={(open) => !open && setSetupChannel(null)}
        onDone={done}
      />
      <PostingTimesDialog
        channel={timesChannel}
        onOpenChange={(open) => !open && setTimesChannel(null)}
        onDone={done}
      />
      <ChannelPreferencesDialog
        channel={preferencesChannel}
        onOpenChange={(open) => !open && setPreferencesChannel(null)}
        onDone={done}
      />
      <DisableChannelDialog
        channel={disableChannel}
        onOpenChange={(open) => !open && setDisableChannel(null)}
        onDone={done}
      />
      <DisconnectDialog
        channel={disconnectChannel}
        onOpenChange={(open) => !open && setDisconnectChannel(null)}
        onDone={done}
      />
    </aside>
  );
}

/** A card button that navigates, named for screen readers and on hover. */
function ColumnLink({
  href,
  label,
  tooltip = true,
  triggers,
  fill = false,
  className,
  children,
}: {
  href: string;
  label: string;
  /** Off when the label is already written on the button. */
  tooltip?: boolean;
  /** An animated icon's `useIconAnimation().triggers`, played from the whole tile. */
  triggers?: ReturnType<typeof useIconAnimation>['triggers'];
  /** A neutral tile: the card surface, filling on hover like Button's secondary. */
  fill?: boolean;
  className: string;
  children: ReactNode;
}) {
  const { rootRef, fillRef } = useFillHover({ enabled: fill });

  return (
    <TooltipHint label={label} side="right" hidden={!tooltip}>
      <Link
        ref={rootRef}
        href={href}
        aria-label={label}
        {...triggers}
        className={cn(className, fill && fillHoverNeutral)}
      >
        {fill ? <span ref={fillRef} aria-hidden className={fillHoverNeutralLayer} /> : null}
        {children}
      </Link>
    </TooltipHint>
  );
}
