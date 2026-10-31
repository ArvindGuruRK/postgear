'use client';

/**
 * Publish To {Platform}'s own post settings (Module 10): the platform's
 * fields from social-core's `settingsFieldsFor`, drawn by the composer's
 * own control, editing `config.settings`. The same list the API checks a
 * post against, so the form never offers an option the publisher ignores.
 * A platform with no settings (Instagram, LinkedIn) draws nothing.
 *
 * LinkedIn's card covers profiles and Pages; its settings are LinkedIn's.
 */
import { type FieldSpec, platformById } from '@postgear/automation';
import { settingsFieldsFor, validateProviderSettings } from '@postgear/social-core/composer';
import { SettingControl } from '@/components/composer/composer-settings';
import { asText, type FieldControlProps } from './field-types';
import { getAtPath } from './form-model';

/** The social-core provider whose settings a publish platform uses. */
export function settingsProviderOf(platformId: string): string {
  return platformById(platformId)?.providers[0] ?? platformId;
}

/** The settings as stored: only a record counts, and an empty one is left out. */
export function settingsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A copy with `key` set, or taken out when the value is cleared back to its default. */
export function withSetting(
  current: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> | undefined {
  const next = { ...current };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return Object.keys(next).length > 0 ? next : undefined;
}

/** The settings fields for the platform the step's config names (none for Instagram and LinkedIn). */
export function settingsFieldsOf(spec: FieldSpec, config: Record<string, unknown>) {
  const platformId = spec.providerPath ? asText(getAtPath(config, spec.providerPath)) : '';
  return platformId ? settingsFieldsFor(settingsProviderOf(platformId)) : [];
}

export function ProviderSettingsField({ spec, config, value, onChange, ids }: FieldControlProps) {
  const platformId = spec.providerPath ? asText(getAtPath(config, spec.providerPath)) : '';
  const provider = settingsProviderOf(platformId);
  const fields = settingsFieldsOf(spec, config);
  // The form hides the whole field for a platform without settings; this is the fallback.
  if (fields.length === 0) return null;
  const values = settingsOf(value);
  // Draft rules: a required field may stay empty here; the queue checks it.
  const issues = validateProviderSettings(provider, values, 'draft').issues;
  const errors = Object.fromEntries(issues.map((issue) => [issue.key, issue.message]));

  return (
    // biome-ignore lint/a11y/useSemanticElements: the platform's settings, named by the field's label
    <div
      role="group"
      aria-labelledby={ids.label}
      aria-describedby={ids.message}
      className="flex flex-col gap-4 rounded-md border-2 border-outline bg-chrome p-3"
    >
      {fields.map((field) => (
        <SettingControl
          key={field.key}
          id={`${ids.control}-${field.key}`}
          field={field}
          value={values[field.key]}
          error={errors[field.key]}
          disabled={false}
          onChange={(next) => onChange(spec.path, withSetting(values, field.key, next))}
        />
      ))}
    </div>
  );
}
