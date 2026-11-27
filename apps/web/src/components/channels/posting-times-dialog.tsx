'use client';

import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { ShuffleIcon } from '@animateicons/react/lucide/shuffle-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Button,
  ChoiceTilesMany,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  TimePicker,
} from '@postgear/ui';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Channel, PostingTime } from '@/types/channel';
import {
  fromClock,
  MAX_POSTING_SLOTS,
  nextNewSlot,
  SLOTS_HELP,
  slotLabel,
  slotsProblem,
  slotsToSave,
  toClock,
  toggleDay,
  WEEKDAY_OPTIONS,
  WINDOW_OPTIONS,
} from './posting-slots-model';
import { type ShuffleChoice, ShuffleTimesDialog } from './shuffle-times-dialog';

interface PostingTimesDialogProps {
  channel: Channel | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/**
 * Manage Posting Time Slots (Sprint 13 Module 13; the Sprint 3 posting times
 * dialog, extended).
 *
 * Each slot is a row: a time, a window (Exact, Within 5, 15 or 30 Minutes)
 * and the weekdays it runs on (at least one stays on). A post placed in a
 * slot (Add To Queue, Next Available) goes out at a natural minute inside
 * the window; a slot with no window is exact, as every slot was before.
 * Shuffle Times suggests a week of slots; Back To Suggested Times reopens it
 * where it was left.
 *
 * Times are edited and stored as minutes since local midnight, with no time
 * zone arithmetic on the way in or out: the conversion happens once, where a
 * post is actually scheduled.
 */
export function PostingTimesDialog({ channel, onOpenChange, onDone }: PostingTimesDialogProps) {
  const [slots, setSlots] = useState<PostingTime[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [suggested, setSuggested] = useState<ShuffleChoice | null>(null);

  useEffect(() => {
    setSlots((channel?.postingTimes ?? []).map((slot) => ({ ...slot, days: [...slot.days] })));
    setError(null);
    setSuggested(null);
  }, [channel]);

  function update(index: number, change: Partial<PostingTime>) {
    setSlots((current) =>
      current.map((slot, position) => (position === index ? { ...slot, ...change } : slot)),
    );
  }

  const problem = slotsProblem(slots);

  async function save() {
    if (!channel || problem) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await api(`/channels/${channel.id}`, {
        method: 'PATCH',
        body: { postingTimes: slotsToSave(slots) },
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not save those times.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={channel !== null && !shuffleOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage Posting Time Slots</DialogTitle>
            <DialogDescription>
              The times {channel?.name} posts at when you add a post to its queue.
            </DialogDescription>
          </DialogHeader>

          <Stack gap="md">
            {slots.length === 0 ? (
              <Text size="sm" muted>
                No times yet. Add at least one before saving.
              </Text>
            ) : (
              <ul className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto pr-1 pg-scrollbar">
                {slots.map((slot, index) => {
                  const name = slotLabel(slot.time);
                  return (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id, and a row's time is what is being edited
                      key={index}
                      className="flex flex-col gap-2 rounded-md border-2 border-outline p-3"
                      data-testid="posting-slot"
                    >
                      <div className="flex items-center gap-2">
                        <TimePicker
                          label={`Time of slot ${index + 1}`}
                          value={toClock(slot.time)}
                          onValueChange={(value) => {
                            const time = fromClock(value);
                            if (time !== null) update(index, { time });
                          }}
                          className="w-36"
                        />
                        <Select
                          value={String(slot.windowMinutes)}
                          onValueChange={(value) => update(index, { windowMinutes: Number(value) })}
                        >
                          <SelectTrigger className="w-52" aria-label={`Window for ${name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {WINDOW_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={String(option.value)}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-auto"
                          aria-label={`Remove ${name}`}
                          onClick={() =>
                            setSlots((current) =>
                              current.filter((_, position) => position !== index),
                            )
                          }
                        >
                          <MotionIcon icon={Trash2Icon} strokeWidth={2} className="h-4 w-4" />
                        </Button>
                      </div>
                      <ChoiceTilesMany
                        label={`Days for ${name}`}
                        options={WEEKDAY_OPTIONS}
                        values={slot.days.map(String)}
                        onToggle={(day) =>
                          update(index, { days: toggleDay(slot.days, Number(day)) })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={slots.length >= MAX_POSTING_SLOTS}
                onClick={() => setSlots((current) => [...current, nextNewSlot(current)])}
              >
                <MotionIcon icon={PlusIcon} strokeWidth={2} className="h-4 w-4" />
                Add Another Time
              </Button>
              {suggested ? (
                <button
                  type="button"
                  onClick={() => setShuffleOpen(true)}
                  className="rounded-md px-1 type-ui text-sm text-ink underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
                >
                  Back To Suggested Times
                </button>
              ) : null}
            </div>

            <Text size="sm" muted>
              {SLOTS_HELP}
            </Text>

            {error || (problem && slots.length > 0) ? (
              <Text size="sm" className="text-dangerInk" role="alert">
                {error ?? problem}
              </Text>
            ) : null}
          </Stack>

          <DialogFooter className="sm:justify-between">
            <Button variant="secondary" onClick={() => setShuffleOpen(true)}>
              <MotionIcon icon={ShuffleIcon} strokeWidth={2} className="h-4 w-4" />
              Shuffle Times
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || problem !== null}>
                {saving ? 'Saving…' : 'Save Times'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShuffleTimesDialog
        open={channel !== null && shuffleOpen}
        onOpenChange={setShuffleOpen}
        start={suggested}
        onUse={(next, choice) => {
          setSlots(next);
          setSuggested(choice);
          setShuffleOpen(false);
        }}
      />
    </>
  );
}
