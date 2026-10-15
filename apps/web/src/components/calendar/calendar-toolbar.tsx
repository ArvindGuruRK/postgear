'use client';

import { Badge, Button, Toolbar, ViewSwitcher } from '@postgear/ui';
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, Rows3 } from 'lucide-react';
import { useCalendar } from './calendar-context';
import { type CalendarView, isCalendarView, rangeLabel } from './calendar-math';
import { ChannelFilter } from './channel-filter';

const VIEWS = [
  { value: 'month', label: 'Month view', icon: CalendarDays },
  { value: 'week', label: 'Week view', icon: CalendarRange },
  { value: 'day', label: 'Day view', icon: Rows3 },
];

/**
 * Where, when and what: navigation, the view switch and the channel filter.
 *
 * This is the chrome *around* the dense grid, so it carries the full
 * treatment — display face on the range label, brutal shadows on the buttons —
 * that the grid itself does without (design-system-rules.md §15).
 */
export function CalendarToolbar() {
  const calendar = useCalendar();

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        start={
          <>
            <Button variant="secondary" size="sm" onClick={calendar.today}>
              Today
            </Button>
            <div className="flex items-center gap-1">
              <Button
                variant="secondary"
                size="sm"
                className="w-9 px-0"
                aria-label={`Previous ${calendar.view}`}
                onClick={() => calendar.step(-1)}
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={3} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="w-9 px-0"
                aria-label={`Next ${calendar.view}`}
                onClick={() => calendar.step(1)}
              >
                <ChevronRight className="h-4 w-4" strokeWidth={3} />
              </Button>
            </div>
            <h2
              className="type-heading text-xl text-ink"
              aria-live="polite"
              data-testid="calendar-range"
            >
              {rangeLabel(calendar.view, calendar.anchor)}
            </h2>
            {calendar.loading ? (
              <Badge variant="outline" className="normal-case tracking-normal">
                Loading…
              </Badge>
            ) : null}
          </>
        }
        end={
          <ViewSwitcher
            options={VIEWS}
            value={calendar.view}
            onValueChange={(value) => {
              if (isCalendarView(value)) {
                calendar.setView(value as CalendarView);
              }
            }}
          />
        }
      />

      {calendar.channels.length > 1 ? <ChannelFilter /> : null}
    </div>
  );
}
