'use client';

/**
 * The schedule's time zone, from a searchable list of every zone the browser
 * knows (Sprint 13, Module 14 section C4). The picture prints the zone's
 * name; nothing is guessed from the broadcaster.
 */
import { Combobox } from '@postgear/ui';
import { useMemo } from 'react';
import { zoneOptions } from './schedule-field-model';

export function ScheduleZoneSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const options = useMemo(() => zoneOptions(value), [value]);

  return (
    <Combobox
      id={id}
      options={options}
      value={value}
      onValueChange={(zone) => {
        if (zone && zone !== value) onChange(zone);
      }}
      placeholder="Choose a time zone"
      searchPlaceholder="Search time zones"
      emptyText="No time zone matches."
      disabled={disabled}
    />
  );
}
