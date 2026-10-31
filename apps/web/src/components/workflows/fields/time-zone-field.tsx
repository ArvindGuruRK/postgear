'use client';

/**
 * An IANA time zone (Add To Queue, Module 10): the same searchable list the
 * Schedule step's zone uses, every zone this browser knows with its offset
 * now ("Asia/Kolkata (UTC+05:30)"). The stored zone and the browser's are
 * always in the list.
 */
import { Combobox } from '@postgear/ui';
import { useMemo } from 'react';
import { useFieldEnv } from './field-env';
import { asText, type FieldControlProps } from './field-types';
import { timeZoneChoices } from './schedule-model';

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function TimeZoneField({ spec, value, onChange, ids }: FieldControlProps) {
  const env = useFieldEnv();
  const zone = env?.context.timeZone ?? browserTimeZone();
  const current = asText(value);
  const zones = useMemo(() => timeZoneChoices(current, zone), [current, zone]);
  return (
    // biome-ignore lint/a11y/useSemanticElements: names the design system's combobox, which takes no id
    <div role="group" aria-labelledby={ids.label} aria-describedby={ids.message}>
      <Combobox
        options={zones}
        value={current || undefined}
        onValueChange={(next) => onChange(spec.path, next)}
        placeholder="Choose a time zone"
        searchPlaceholder="Enter your time zone"
        emptyText="No time zone matches your search."
      />
    </div>
  );
}
