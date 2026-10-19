'use client';

import { PanelLeftOpenIcon } from '@animateicons/react/lucide/panel-left-open-icon';
import { SquarePenIcon } from '@animateicons/react/lucide/square-pen-icon';
import {
  ANIMATED_ICON_CLASS,
  cn,
  MotionIcon,
  pressSm,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  useIconAnimation,
} from '@postgear/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { ChannelLimit, ProviderSummary } from '@/types/channel';
import { useCalendar } from './calendar-context';
import { CHANNEL_DRAGGING_ATTRIBUTE } from './channel-rows';
import { ChannelsColumn } from './channels-column';

const TILE = cn(
  'flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg border-2 border-outline px-3 type-ui text-sm',
  pressSm,
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
);

/**
 * The channel card on a phone (below `md`), where a 260px card beside the
 * grid would leave the grid no room: a row above the toolbar with a Channels
 * button, which opens the same card in a sheet from the left, and Create Post,
 * kept one tap away as on the card.
 *
 * The button says how many channels the calendar is filtered to, since the
 * filter itself is out of sight in the sheet.
 */
export function ChannelsSheet({
  providers,
  limit,
  className,
}: {
  providers: ProviderSummary[];
  limit: ChannelLimit | null;
  className?: string;
}) {
  const { orgId, channels, channelFilter } = useCalendar();
  const [open, setOpen] = useState(false);
  const channelsIcon = useIconAnimation();
  const filtering = channelFilter.length > 0;

  return (
    <div className={cn('flex gap-2', className)}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger {...channelsIcon.triggers} className={cn(TILE, 'flex-1 bg-chrome text-ink')}>
          <PanelLeftOpenIcon
            ref={channelsIcon.ref}
            aria-hidden
            size={16}
            className={cn('h-4 w-4 shrink-0', ANIMATED_ICON_CLASS)}
          />
          <span className="truncate">
            {filtering ? `Channels (${channelFilter.length} of ${channels.length})` : 'Channels'}
          </span>
        </SheetTrigger>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          // A link in the card (Create Post, Manage channels, Generate with
          // AI) leaves the calendar: close the sheet so it is not still open
          // when the person comes back.
          onClickCapture={(event) => {
            if ((event.target as Element).closest('a')) setOpen(false);
          }}
          // Escape during a keyboard reorder cancels the move (channel-rows);
          // it must not also close the sheet underneath it.
          onEscapeKeyDown={(event) => {
            if (document.querySelector(`[${CHANNEL_DRAGGING_ATTRIBUTE}="true"]`)) {
              event.preventDefault();
            }
          }}
          className="w-[18rem] max-w-[85vw] gap-0 bg-chrome p-0"
        >
          <SheetTitle className="px-5 pt-5 pb-4 text-xl">Channels</SheetTitle>
          <ChannelsColumn providers={providers} limit={limit} inSheet />
        </SheetContent>
      </Sheet>

      {channels.length > 0 ? (
        <Link
          href={`/${orgId}/composer`}
          className={cn(TILE, 'flex-1 bg-actionPrimary text-onActionPrimary')}
        >
          <MotionIcon icon={SquarePenIcon} className="h-4 w-4 shrink-0" />
          <span className="truncate">Create Post</span>
        </Link>
      ) : null}
    </div>
  );
}
