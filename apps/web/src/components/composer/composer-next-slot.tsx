'use client';

/**
 * Next Available (Sprint 13 Module 13): sets the post's time to the next free
 * posting slot of the first chosen channel, at a natural minute inside that
 * slot's window (`GET /channels/next-slot`). A post has one time, so with
 * several channels the first one's slot is used for all; the tooltip says
 * so. A channel with no posting times leaves the button off, with the reason
 * and a way to the Channels page.
 *
 * The seed is kept with the answer: on save the composer asks again with the
 * same seed, and a different answer means the slot was taken meanwhile.
 */
import { CalendarClockIcon } from '@animateicons/react/lucide/calendar-clock-icon';
import { Button, MotionIcon, TooltipHint } from '@postgear/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel } from '@/types/channel';

export interface NextSlotAnswer {
  at: string | null;
  channelId: string;
  windowMinutes: number;
  channels: { channelId: string; at: string | null; windowMinutes: number }[];
}

/** What Next Available last gave, to check again on save. */
export interface SlotPick {
  seed: string;
  channelIds: string[];
  /** The composer's local `YYYY-MM-DDTHH:mm` it set. */
  value: string;
}

export function newSeed(): string {
  return Math.random().toString(36).slice(2, 12);
}

export function nextSlotPath(channelIds: string[], seed: string): string {
  const params = new URLSearchParams({
    channelIds: channelIds.join(','),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    seed,
  });
  return `/channels/next-slot?${params.toString()}`;
}

export function fetchNextSlot(channelIds: string[], seed: string): Promise<NextSlotAnswer> {
  return api<NextSlotAnswer>(nextSlotPath(channelIds, seed));
}

/** Why the button is off, or null when it can be pressed. */
export function nextSlotBlock(channels: Pick<Channel, 'postingTimes'>[]): string | null {
  const first = channels[0];
  if (!first) return 'Choose a channel first.';
  if (first.postingTimes.length === 0) return 'Set posting times for this channel first.';
  return null;
}

/** "Tue 17 Nov, 7:52 AM". */
export function slotText(at: Date): string {
  const day = at.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

export function NextAvailableButton({
  channels,
  disabled = false,
  onPick,
  onError,
}: {
  /** The chosen channels, in order: the first one's slots are used. */
  channels: Channel[];
  disabled?: boolean;
  onPick: (at: Date, seed: string) => void;
  onError: (message: string) => void;
}) {
  const params = useParams<{ orgId?: string }>();
  const [busy, setBusy] = useState(false);
  const block = nextSlotBlock(channels);
  const first = channels[0];

  async function press() {
    if (block || busy) return;
    const seed = newSeed();
    setBusy(true);
    try {
      const answer = await fetchNextSlot(
        channels.map((channel) => channel.id),
        seed,
      );
      if (!answer.at) {
        onError('No free posting slot in the next year. Add more posting times.');
        return;
      }
      onPick(new Date(answer.at), seed);
    } catch (cause) {
      onError(cause instanceof ApiError ? cause.message : 'We could not find the next slot.');
    } finally {
      setBusy(false);
    }
  }

  const label =
    block === 'Set posting times for this channel first.' && params.orgId ? (
      <span>
        {block}{' '}
        <Link href={`/${params.orgId}/channels`} className="underline underline-offset-2">
          Open Channels
        </Link>
      </span>
    ) : (
      (block ??
      (channels.length > 1 && first
        ? `Uses ${first.name}'s posting times for every channel.`
        : 'The next free posting time of this channel.'))
    );

  return (
    <TooltipHint label={label} side="top" disabled={disabled || block !== null}>
      <Button
        variant="secondary"
        disabled={disabled || block !== null || busy}
        onClick={press}
        className="h-11 px-3 text-sm"
      >
        <MotionIcon icon={CalendarClockIcon} className="h-4 w-4 shrink-0" />
        Next Available
      </Button>
    </TooltipHint>
  );
}
