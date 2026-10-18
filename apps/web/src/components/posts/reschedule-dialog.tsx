'use client';

/**
 * "Reschedule": a new time for a whole post.
 *
 * The keyboard-first counterpart to dragging a card on the calendar, and the
 * only way to move a post from the queue list. Offers the channels' own posting
 * times for the chosen day first (those are the slots the person configured
 * on the Channels page, so they are usually what is wanted) and a free field
 * for anything else.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  Text,
  cn,
} from '@postgear/ui';
import { Clock } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toLocalInputValue } from '@/components/composer/composer-state';
import type { Channel } from '@/types/channel';
import type { PostSummary } from '@/types/post';
import { formatClock } from './post-status';

export function RescheduleDialog({
  post,
  channels,
  busy,
  onOpenChange,
  onConfirm,
}: {
  post: PostSummary | null;
  channels: Channel[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (publishDate: Date) => void;
}) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (!post) {
      return;
    }

    // A failed or overdue post opens on the next whole hour rather than on its
    // old, past time, which would only be refused.
    const current = new Date(post.publishDate);
    const nextHour = new Date();
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const start = post.state !== 'DRAFT' && current.getTime() <= Date.now() ? nextHour : current;

    setValue(toLocalInputValue(start));
  }, [post]);

  const chosen = value ? new Date(value) : null;
  const valid = chosen !== null && !Number.isNaN(chosen.getTime());
  const mustBeFuture = post !== null && post.state !== 'DRAFT';
  const inPast = valid && mustBeFuture && chosen.getTime() <= Date.now();

  // The posting times of the channels this post goes to, on the chosen day.
  const suggestions = useMemo(() => {
    if (!post || !valid) {
      return [];
    }

    const ids = new Set(post.channels.map((channel) => channel.channelId));
    const minutes = new Set(
      channels
        .filter((channel) => ids.has(channel.id))
        .flatMap((channel) => channel.postingTimes.map((slot) => slot.time)),
    );

    return [...minutes]
      .sort((a, b) => a - b)
      .map((total) => {
        const at = new Date(chosen);
        at.setHours(Math.floor(total / 60), total % 60, 0, 0);
        return at;
      })
      .filter((at) => !mustBeFuture || at.getTime() > Date.now());
  }, [post, channels, chosen, valid, mustBeFuture]);

  return (
    <Dialog open={post !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule</DialogTitle>
          <DialogDescription>
            Every channel of this post moves to the new time.
            {mustBeFuture ? ' A queued post can only move to a time in the future.' : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex flex-col gap-4">
          <FormField>
            <FormLabel htmlFor="reschedule-at">Publish at</FormLabel>
            <Input
              id="reschedule-at"
              type="datetime-local"
              value={value}
              variant={inPast ? 'error' : 'default'}
              onChange={(event) => setValue(event.target.value)}
            />
            {inPast ? (
              <FormErrorMessage>
                That time has passed. Choose a time in the future, or use "Post now".
              </FormErrorMessage>
            ) : (
              <FormHelperText>
                Your local time ({Intl.DateTimeFormat().resolvedOptions().timeZone}).
              </FormHelperText>
            )}
          </FormField>

          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <Text size="sm" weight="bold">
                Posting times that day
              </Text>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((at) => {
                  const selected = valid && at.getTime() === chosen.getTime();
                  return (
                    <button
                      key={at.getTime()}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setValue(toLocalInputValue(at))}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border-2 border-outline px-3 py-1 font-sans text-xs font-bold',
                        'outline-none transition-[transform,box-shadow] duration-100',
                        'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                        selected
                          ? 'bg-actionPrimary text-onActionPrimary shadow-brutalPressed'
                          : 'bg-secondary text-ink shadow-brutalSm hover:bg-actionPrimary/10',
                      )}
                    >
                      <Clock className="h-3 w-3" strokeWidth={3} />
                      {formatClock(at)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => valid && !inPast && onConfirm(chosen)}
            disabled={!valid || inPast || busy}
          >
            {busy ? 'Moving…' : 'Move post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
