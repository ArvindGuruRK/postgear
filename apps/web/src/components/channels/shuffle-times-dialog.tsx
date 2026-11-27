'use client';

/**
 * Shuffle Times (Sprint 13 Module 13): a week of posting slots from how many
 * posts a week the person wants (`suggestSlots`, pure). Shuffle Again gives
 * another set; Use These Times hands them to Manage Posting Time Slots, which
 * saves them with the rest.
 */
import { MAX_POSTS_PER_WEEK, MIN_POSTS_PER_WEEK, suggestSlots } from '@postgear/automation';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Slider,
  Stack,
  Text,
} from '@postgear/ui';
import { useEffect, useId, useMemo, useState } from 'react';
import type { PostingTime } from '@/types/channel';
import { aroundLabel, daysLabel, perWeekLabel } from './posting-slots-model';

function freshSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface ShuffleChoice {
  perWeek: number;
  seed: string;
}

interface ShuffleTimesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where it opens: the last choice (Back To Suggested Times), or 21 a week. */
  start?: ShuffleChoice | null;
  onUse: (slots: PostingTime[], choice: ShuffleChoice) => void;
}

export function ShuffleTimesDialog({ open, onOpenChange, start, onUse }: ShuffleTimesDialogProps) {
  const labelId = useId();
  const [perWeek, setPerWeek] = useState(21);
  const [seed, setSeed] = useState(freshSeed);

  useEffect(() => {
    if (!open) return;
    setPerWeek(start?.perWeek ?? 21);
    setSeed(start?.seed ?? freshSeed());
  }, [open, start]);

  const slots = useMemo(() => suggestSlots(perWeek, seed), [perWeek, seed]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shuffle Times</DialogTitle>
          <DialogDescription>
            We spread your posts across the week at natural minutes. You can change any of them
            after.
          </DialogDescription>
        </DialogHeader>

        <Stack gap="lg">
          <Stack gap="sm">
            <div className="flex items-baseline justify-between gap-3">
              <Text size="sm" weight="bold" id={labelId}>
                How many posts a week?
              </Text>
              <Text size="sm" className="tabular-nums" data-testid="shuffle-per-week">
                {perWeekLabel(perWeek)}
              </Text>
            </div>
            <Slider
              min={MIN_POSTS_PER_WEEK}
              max={MAX_POSTS_PER_WEEK}
              step={1}
              value={[perWeek]}
              onValueChange={([value]) => setPerWeek(value ?? perWeek)}
              thumbs={[{ 'aria-labelledby': labelId, 'aria-valuetext': perWeekLabel(perWeek) }]}
            />
          </Stack>

          <ul
            className="flex flex-col gap-1 rounded-md border-2 border-outline bg-inset p-2"
            aria-label="Suggested times"
          >
            {slots.map((slot) => (
              <li
                key={`${slot.time}-${slot.days.join()}`}
                className="flex items-center justify-between gap-3 px-1 py-1"
              >
                <Text size="sm" className="tabular-nums">
                  {aroundLabel(slot)}
                </Text>
                <Text size="sm" muted>
                  {daysLabel(slot.days)}
                </Text>
              </li>
            ))}
          </ul>
        </Stack>

        <DialogFooter>
          <Button variant="secondary" onClick={() => setSeed(freshSeed())}>
            Shuffle Again
          </Button>
          <Button onClick={() => onUse(slots, { perWeek, seed })}>Use These Times</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
