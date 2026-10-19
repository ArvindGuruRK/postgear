'use client';

/**
 * The footer's "Repeat post" control (2026-10-19, after Postiz's "Repeat Post
 * Every"): how often a post publishes again. Each successful publish queues
 * the next occurrence that many days later, as its own post (the worker's
 * job; see the round 2 contract for why a copy and not a re-run). The
 * intervals are exactly the ones the API accepts.
 *
 * A menu of radio items, so the choice in force is announced and marked;
 * "Don't repeat" is a choice like the others rather than Postiz's "Cancel".
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { RepeatIcon } from '@animateicons/react/lucide/repeat-icon';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  MotionIcon,
} from '@postgear/ui';
import { useState } from 'react';
import { REPEAT_INTERVALS, type RepeatInterval } from '@/types/post';
import { FIELD_TRIGGER } from './toolbar';

export const REPEAT_LABEL: Record<RepeatInterval, string> = {
  1: 'Every day',
  2: 'Every 2 days',
  3: 'Every 3 days',
  4: 'Every 4 days',
  5: 'Every 5 days',
  6: 'Every 6 days',
  7: 'Every week',
  14: 'Every 2 weeks',
  30: 'Every month (30 days)',
};

const NONE = 'none';

export function RepeatControl({
  value,
  onChange,
  disabled = false,
}: {
  value: RepeatInterval | null;
  onChange: (value: RepeatInterval | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    // Modal, like every menu in the composer's dialog: see `DateTimePicker`.
    <DropdownMenu modal open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={value ? `Repeat: ${REPEAT_LABEL[value]}` : 'Repeat post'}
          className={cn(FIELD_TRIGGER, 'max-w-60')}
        >
          <MotionIcon icon={RepeatIcon} className="h-4 w-4 shrink-0" />
          <span className="truncate">{value ? REPEAT_LABEL[value] : 'Repeat post'}</span>
          <MotionIcon
            icon={ChevronDownIcon}
            strokeWidth={3}
            className={cn(
              'h-4 w-4 shrink-0 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel>Repeat post</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value === null ? NONE : String(value)}
          onValueChange={(next) =>
            onChange(
              next === NONE
                ? null
                : (REPEAT_INTERVALS.find((days) => String(days) === next) ?? null),
            )
          }
        >
          {REPEAT_INTERVALS.map((days) => (
            <DropdownMenuRadioItem key={days} value={String(days)}>
              {REPEAT_LABEL[days]}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuRadioItem value={NONE}>Don’t repeat</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
