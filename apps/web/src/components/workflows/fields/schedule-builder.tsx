'use client';

/**
 * The schedule builder (blueprint 5.4): how often (Hourly to
 * Monthly), then only what that needs (hours apart, the days, the day of the
 * month, a time) and the time zone, read back as a sentence with the next
 * three runs. It edits the Schedule trigger's whole config (path ''), always in
 * a shape `scheduleConfigSchema` accepts.
 *
 * Every row reaches both edges of the column (the owner asked, 2026-11-04): the
 * tiles and days share it equally, and the time or hours sit level with the time
 * zone. The field's own label names the tiles, so no second label stacks on it.
 */
import { BriefcaseIcon } from '@animateicons/react/lucide/briefcase-icon';
import { CalendarCheckIcon } from '@animateicons/react/lucide/calendar-check-icon';
import { CalendarDaysIcon } from '@animateicons/react/lucide/calendar-days-icon';
import { ClockIcon } from '@animateicons/react/lucide/clock-icon';
import { SunIcon } from '@animateicons/react/lucide/sun-icon';
import {
  describeSchedule,
  HOURLY_STEPS,
  type ScheduleConfig,
  type ScheduleFrequency,
  scheduleNotes,
  WEEKDAYS,
  zoneWords,
} from '@postgear/automation';
import {
  Alert,
  type AnimatedIcon,
  ChoiceTiles,
  ChoiceTilesMany,
  Combobox,
  FormErrorMessage,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SummaryBox,
  TimePicker,
  useTimeText,
} from '@postgear/ui';
import { Info } from 'lucide-react';
import { type ReactNode, useId, useMemo } from 'react';
import { FIELD_PATH_ATTRIBUTE } from './contract';
import { useFieldEnv } from './field-env';
import type { FieldControlProps } from './field-types';
import {
  asSchedule,
  DAY_NAMES,
  DAY_SHORT,
  dayOfMonthChoices,
  FREQUENCY_CHOICES,
  hoursLabel,
  runRows,
  scheduleFor,
  timeZoneChoices,
  toggleDay,
  upcomingRuns,
} from './schedule-model';

const FREQUENCY_ICON: Record<ScheduleFrequency, AnimatedIcon> = {
  hourly: ClockIcon,
  daily: SunIcon,
  weekdays: BriefcaseIcon,
  weekly: CalendarDaysIcon,
  monthly: CalendarCheckIcon,
};

const FREQUENCY_TILES = FREQUENCY_CHOICES.map((choice) => ({
  ...choice,
  icon: FREQUENCY_ICON[choice.value],
}));

const DAY_TILES = WEEKDAYS.map((day) => ({
  value: day,
  label: DAY_NAMES[day],
  short: DAY_SHORT[day],
}));

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function ScheduleBuilder({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const env = useFieldEnv();
  const zone = env?.context.timeZone ?? browserZone();
  const config = asSchedule(value, zone);
  const own = useId();
  const write = (next: ScheduleConfig) => onChange(spec.path, next);
  const zones = useMemo(() => timeZoneChoices(config.timeZone, zone), [config.timeZone, zone]);
  const formatTime = useTimeText();
  const hasAi = (env?.graph.nodes ?? []).some(
    (node) => !node.disabled && node.type.startsWith('ai.'),
  );

  return (
    // biome-ignore lint/a11y/useSemanticElements: the schedule's parts, named by the field's label
    <div role="group" aria-labelledby={ids.label} className="flex flex-col gap-4">
      <Part path="frequency" error={errors.frequency}>
        <ChoiceTiles
          label="How often"
          options={FREQUENCY_TILES}
          value={config.frequency}
          onValueChange={(frequency) => write(scheduleFor(frequency, config, zone))}
        />
      </Part>

      {config.frequency === 'weekly' ? (
        <Part path="days" labelId={`${own}-days`} label="Days" error={errors.days}>
          <ChoiceTilesMany
            labelledBy={`${own}-days`}
            options={DAY_TILES}
            values={config.days ?? []}
            onToggle={(day) => write(toggleDay(config, day))}
          />
        </Part>
      ) : null}

      {config.frequency === 'monthly' ? (
        <Part
          path="dayOfMonth"
          labelId={`${own}-dom`}
          label="Day of the month"
          error={errors.dayOfMonth}
        >
          <Select
            value={String(config.dayOfMonth ?? 1)}
            onValueChange={(next) =>
              write({ ...config, dayOfMonth: next === 'last' ? 'last' : Number(next) })
            }
          >
            <SelectTrigger aria-labelledby={`${own}-dom`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dayOfMonthChoices().map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Part>
      ) : null}

      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
        {config.frequency === 'hourly' ? (
          <Part
            path="everyHours"
            labelId={`${own}-hours`}
            label="Hours apart"
            error={errors.everyHours}
          >
            <Select
              value={String(config.everyHours ?? 1)}
              onValueChange={(next) => write({ ...config, everyHours: Number(next) })}
            >
              <SelectTrigger aria-labelledby={`${own}-hours`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURLY_STEPS.map((step) => (
                  <SelectItem key={step} value={String(step)}>
                    {hoursLabel(step)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Part>
        ) : (
          <Part path="time" labelId={`${own}-time`} label="Time" error={errors.time}>
            <TimePicker
              label="Time"
              value={config.time ?? null}
              onValueChange={(time) => write({ ...config, time })}
              className="w-full"
            />
          </Part>
        )}

        <Part path="timeZone" labelId={`${own}-zone`} label="Time zone" error={errors.timeZone}>
          {/* biome-ignore lint/a11y/useSemanticElements: names the design system's combobox, which takes no id */}
          <div role="group" aria-labelledby={`${own}-zone`}>
            <Combobox
              options={zones}
              value={config.timeZone}
              onValueChange={(timeZone) => write({ ...config, timeZone })}
              placeholder="Choose a time zone"
              searchPlaceholder="Enter your time zone"
              emptyText="No time zone matches your search."
            />
          </div>
        </Part>
      </div>

      <SummaryBox
        title={describeSchedule(config, { timeZone: false, formatTime })}
        notes={[zoneWords(config.timeZone), ...scheduleNotes(config)]}
        rowsLabel="Next Runs"
        rows={runRows(upcomingRuns(config, new Date().toISOString()), formatTime)}
      />

      {hasAi && config.frequency === 'hourly' ? (
        <Alert variant="info" className="items-center p-3">
          <Info aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          <span>Workflows with AI steps can run at most once an hour.</span>
        </Alert>
      ) : null}
      {errors[''] ? <FormErrorMessage>{errors['']}</FormErrorMessage> : null}
    </div>
  );
}

function Part({
  path,
  labelId,
  label,
  error,
  children,
}: {
  path: string;
  /** With no label, the field's own names this part. */
  labelId?: string;
  label?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div {...{ [FIELD_PATH_ATTRIBUTE]: path }} className="flex flex-col gap-1.5">
      {label ? (
        <Label id={labelId} asChild>
          <span>{label}</span>
        </Label>
      ) : null}
      {children}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
    </div>
  );
}
