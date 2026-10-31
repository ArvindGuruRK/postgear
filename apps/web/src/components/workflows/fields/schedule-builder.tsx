'use client';

/**
 * The schedule builder (blueprint 5.4): how often (Every Hour to Every
 * Month), then only what that needs (hours apart, the days, the day of the
 * month, a 24 hour time) and the time zone, read back as a sentence with
 * the next three runs. It edits the Schedule trigger's whole config (path
 * ''), always in a shape `scheduleConfigSchema` accepts.
 */
import {
  describeSchedule,
  HOURLY_STEPS,
  type ScheduleConfig,
  scheduleNotes,
  WEEKDAYS,
} from '@postgear/automation';
import {
  Alert,
  Combobox,
  FormErrorMessage,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
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
  joinTime,
  minuteChoices,
  scheduleFor,
  splitTime,
  timeZoneChoices,
  toggleDay,
  upcomingRuns,
} from './schedule-model';
import { Segmented, SegmentedMany } from './segmented';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const pad = (n: number) => String(n).padStart(2, '0');

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
  const upcoming = upcomingRuns(config, new Date().toISOString());
  const hasAi = (env?.graph.nodes ?? []).some(
    (node) => !node.disabled && node.type.startsWith('ai.'),
  );
  const [hour, minute] = splitTime(config.time);

  return (
    // biome-ignore lint/a11y/useSemanticElements: the schedule's parts, named by the field's label
    <div role="group" aria-labelledby={ids.label} className="flex flex-col gap-4">
      <Part path="frequency" labelId={`${own}-often`} label="How often" error={errors.frequency}>
        <Segmented
          labelledBy={`${own}-often`}
          options={FREQUENCY_CHOICES}
          value={config.frequency}
          onValueChange={(frequency) => write(scheduleFor(frequency, config, zone))}
        />
      </Part>

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
            <SelectTrigger aria-labelledby={`${own}-hours`} className="max-w-56">
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
      ) : null}

      {config.frequency === 'weekly' ? (
        <Part path="days" labelId={`${own}-days`} label="Days" error={errors.days}>
          <SegmentedMany
            labelledBy={`${own}-days`}
            options={WEEKDAYS.map((day) => ({
              value: day,
              label: DAY_SHORT[day],
              title: DAY_NAMES[day],
            }))}
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
            <SelectTrigger aria-labelledby={`${own}-dom`} className="max-w-56">
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

      {config.frequency !== 'hourly' ? (
        <Part path="time" labelId={`${own}-time`} label="Time" error={errors.time}>
          <div className="flex items-center gap-2">
            <Select
              value={String(hour)}
              onValueChange={(next) => write({ ...config, time: joinTime(Number(next), minute) })}
            >
              <SelectTrigger aria-label="Hour" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {pad(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span aria-hidden="true" className="type-ui text-sm text-ink">
              :
            </span>
            <Select
              value={String(minute)}
              onValueChange={(next) => write({ ...config, time: joinTime(hour, Number(next)) })}
            >
              <SelectTrigger aria-label="Minute" className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {minuteChoices(minute).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {pad(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </Part>
      ) : null}

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

      <div className="flex flex-col gap-2 rounded-md border-2 border-dashed border-outline bg-inset px-3 py-2">
        <span className="font-sans text-sm text-ink" aria-live="polite">
          {describeSchedule(config)}
        </span>
        {scheduleNotes(config).map((note) => (
          <Text key={note} size="xs" muted>
            {note}
          </Text>
        ))}
        {upcoming.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="type-label text-xs text-ink">Next Runs</span>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {upcoming.map((run) => (
                <li key={run} className="font-sans text-xs text-ink">
                  {run}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

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
  labelId: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div {...{ [FIELD_PATH_ATTRIBUTE]: path }} className="flex flex-col gap-1.5">
      <Label id={labelId} asChild>
        <span>{label}</span>
      </Label>
      {children}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
    </div>
  );
}
