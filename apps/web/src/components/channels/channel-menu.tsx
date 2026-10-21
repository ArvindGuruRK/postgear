'use client';

import { ClockIcon } from '@animateicons/react/lucide/clock-icon';
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { PlugIcon } from '@animateicons/react/lucide/plug-icon';
import { PowerIcon } from '@animateicons/react/lucide/power-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  MotionIcon,
  toast,
} from '@postgear/ui';
import Link from 'next/link';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';

/** What each item in the menu asks its owner to do; the dialogs live with the owner. */
export interface ChannelMenuHandlers {
  onPreferences: (channel: Channel) => void;
  onEditTimes: (channel: Channel) => void;
  onReconnect: (channel: Channel) => void;
  onFinishSetup: (channel: Channel) => void;
  /** Opens the confirmation (`DisableChannelDialog`). */
  onDisable: (channel: Channel) => void;
  onDisconnect: (channel: Channel) => void;
  /** After a change made here without a dialog (enabling): reload the channels. */
  onChanged: () => void;
}

/** Whether a post can be written for the channel now: the menu's "Create a post". */
export function canPostTo(channel: Channel): boolean {
  return !channel.disabled && !channel.refreshNeeded && !channel.inBetweenSteps;
}

/** Copies the channel's id, for the public API and support requests. */
export async function copyChannelId(channel: Channel): Promise<void> {
  try {
    await navigator.clipboard.writeText(channel.id);
    toast({ title: 'Channel ID copied' });
  } catch {
    // No clipboard (an insecure origin, a denied permission): say so rather
    // than claim a copy that did not happen.
    toast({ title: 'The channel ID could not be copied', variant: 'danger' });
  }
}

/** Enables a disabled channel. No confirmation: nothing is lost by it. */
export async function enableChannel(channel: Channel): Promise<boolean> {
  try {
    await api(`/channels/${channel.id}`, { method: 'PATCH', body: { disabled: false } });
    toast({ title: 'Channel enabled' });
    return true;
  } catch (cause) {
    toast({
      title: cause instanceof ApiError ? cause.message : 'We could not enable that channel.',
      variant: 'danger',
    });
    return false;
  }
}

/**
 * A channel's menu, after the reference's channel menu (UI revamp,
 * 2026-10-19), shared by the calendar's channel card and the Channels page so
 * the two never offer different things. Admins only, as before: every item
 * but "Create a post" and "Copy channel ID" changes the channel, which the
 * API keeps to admins.
 *
 * The reference's order, keeping what PostGear has: Create a post (left out
 * while the channel cannot publish: disabled, needing a reconnect, or still
 * waiting for its page to be chosen), Copy channel ID, Preferences (name and
 * colour), Edit posting times, Reconnect, Finish setup (only while it is
 * pending), then the two that take the channel out of use: Disable or
 * Enable, and Disconnect.
 */
export function ChannelMenuContent({
  channel,
  orgId,
  align = 'start',
  handlers,
}: {
  channel: Channel;
  orgId: string;
  align?: 'start' | 'end';
  handlers: ChannelMenuHandlers;
}) {
  return (
    <DropdownMenuContent align={align}>
      {canPostTo(channel) ? (
        <DropdownMenuItem asChild>
          <Link href={`/${orgId}/composer?channel=${encodeURIComponent(channel.id)}`}>
            <MotionIcon icon={SquarePenIcon} strokeWidth={2} className="me-2 h-4 w-4" />
            Create A Post
          </Link>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={() => void copyChannelId(channel)}>
        <MotionIcon icon={CopyIcon} strokeWidth={2} className="me-2 h-4 w-4" />
        Copy Channel ID
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => handlers.onPreferences(channel)}>
        <MotionIcon icon={SettingsIcon} strokeWidth={2} className="me-2 h-4 w-4" />
        Preferences
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => handlers.onEditTimes(channel)}>
        <MotionIcon icon={ClockIcon} strokeWidth={2} className="me-2 h-4 w-4" />
        Edit Posting Times
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => handlers.onReconnect(channel)}>
        <MotionIcon icon={RefreshCwIcon} strokeWidth={2} className="me-2 h-4 w-4" />
        Reconnect
      </DropdownMenuItem>
      {channel.inBetweenSteps ? (
        <DropdownMenuItem onSelect={() => handlers.onFinishSetup(channel)}>
          <MotionIcon icon={PlugIcon} strokeWidth={2} className="me-2 h-4 w-4" />
          Finish Setup
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuSeparator />
      {channel.disabled ? (
        <DropdownMenuItem
          onSelect={() => {
            void enableChannel(channel).then((enabled) => {
              if (enabled) {
                handlers.onChanged();
              }
            });
          }}
        >
          <MotionIcon icon={PowerIcon} strokeWidth={2} className="me-2 h-4 w-4" />
          Enable Channel
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem onSelect={() => handlers.onDisable(channel)}>
          <MotionIcon icon={PowerIcon} strokeWidth={2} className="me-2 h-4 w-4" />
          Disable Channel
        </DropdownMenuItem>
      )}
      <DropdownMenuItem onSelect={() => handlers.onDisconnect(channel)}>
        <MotionIcon icon={Trash2Icon} strokeWidth={2} className="me-2 h-4 w-4" />
        Disconnect
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
