'use client';

/**
 * A week of streams as fields (Sprint 13, Module 14 section C4): one card per
 * day with its day, its time and its title, and an Off box. Used by the
 * Studio editor's Schedule element and the Schedule Maker's Fill It In By
 * Hand tab, so both type a week the same way.
 *
 * Always seven days. Off keeps the day's words (unticking it brings them
 * back), and an Off day's time and title are not offered while it is off.
 * Every field is one line: a row on the picture has no second line.
 * Every control is named with its day ("Monday time", "Monday off"), so a
 * screen reader never hears seven boxes all called Off (Module 16).
 */
import {
  MAX_SCHEDULE_ROWS,
  MAX_SCHEDULE_TEXT_LENGTH,
  type ScheduleRow,
} from '@postgear/design-engine';
import { Checkbox, cn, Input } from '@postgear/ui';
import { useId } from 'react';
import { dayName, type RowField } from './schedule-field-model';

/** A row is its day's place in the week, so the place is its key (a typed day name is not). */
const PLACES = Array.from({ length: MAX_SCHEDULE_ROWS }, (_, place) => place);

export interface ScheduleRowsTableProps {
  rows: readonly ScheduleRow[];
  onField: (index: number, field: RowField, value: string) => void;
  onOff: (index: number, off: boolean) => void;
  /** The group's name for a screen reader. */
  label: string;
  className?: string;
}

export function ScheduleRowsTable({
  rows,
  onField,
  onOff,
  label,
  className,
}: ScheduleRowsTableProps) {
  const id = useId();

  return (
    <ol aria-label={label} className={cn('m-0 flex list-none flex-col gap-2 p-0', className)}>
      {PLACES.slice(0, rows.length).map((index) => {
        const row = rows[index];
        const name = dayName(index);
        const off = row.off === true;
        const offId = `${id}-off-${index}`;
        return (
          <li
            key={index}
            className="flex flex-col gap-2 rounded-md border-2 border-outline bg-inset p-2"
          >
            <div className="flex items-center gap-2">
              <Input
                value={row.day}
                aria-label={`${name} label`}
                maxLength={MAX_SCHEDULE_TEXT_LENGTH}
                placeholder="Enter your day"
                autoComplete="off"
                onChange={(event) => onField(index, 'day', event.target.value)}
                className="w-20 shrink-0"
              />
              <Input
                value={row.time}
                aria-label={`${name} time`}
                maxLength={MAX_SCHEDULE_TEXT_LENGTH}
                placeholder="Enter your time"
                autoComplete="off"
                disabled={off}
                onChange={(event) => onField(index, 'time', event.target.value)}
                className="min-w-0 flex-1"
              />
              <div className="flex shrink-0 items-center gap-2">
                <Checkbox
                  id={offId}
                  aria-label={`${name} off`}
                  checked={off}
                  onCheckedChange={(checked) => onOff(index, checked === true)}
                />
                <label htmlFor={offId} className="type-ui text-sm text-ink">
                  Off
                </label>
              </div>
            </div>
            <Input
              value={off ? '' : row.title}
              aria-label={`${name} stream`}
              maxLength={MAX_SCHEDULE_TEXT_LENGTH}
              placeholder="Enter your stream"
              autoComplete="off"
              disabled={off}
              onChange={(event) => onField(index, 'title', event.target.value)}
            />
          </li>
        );
      })}
    </ol>
  );
}
