'use client';

import { getDef, type Key } from '@postgear/entitlements';
/**
 * Pieces every operator tab shares: the reason box every write needs, the
 * value control by type (switch, number with its unit, select), the sentence
 * an API refusal shows, and the alert for a list that could not be read.
 */
import {
  Alert,
  Button,
  Checkbox,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Toggle,
} from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { ApiError } from '@/lib/api';
import type { EntitlementCellValue } from '@/types/operator';
import { OPERATOR_COPY, parseNumberText, reasonError, unitLabel } from './operator-model';

/** The sentence a failed call shows: the API's own words, or a plain fallback. */
export function errorSentence(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

/** "Reason for this change": at least 10 characters, into the Change Log. */
export function ReasonField({
  value,
  onChange,
  attempted,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Show the error state once a save was tried with too short a reason. */
  attempted: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const error = attempted ? reasonError(value) : null;
  return (
    <FormField>
      <FormLabel htmlFor={`${id}-reason`} required>
        {OPERATOR_COPY.reasonLabel}
      </FormLabel>
      <Textarea
        id={`${id}-reason`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={OPERATOR_COPY.reasonPlaceholder}
        rows={3}
        maxLength={500}
        disabled={disabled}
        variant={error ? 'error' : 'default'}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-reason-help`}
      />
      {error ? (
        <FormErrorMessage id={`${id}-reason-help`}>{error}</FormErrorMessage>
      ) : (
        <FormHelperText id={`${id}-reason-help`}>{OPERATOR_COPY.reasonHelp}</FormHelperText>
      )}
    </FormField>
  );
}

/**
 * One value's control, by its key's type: a switch, a number with its unit
 * (and an Unlimited tick where the key allows it), or a select with reserved
 * members listed but not choosable. Reports `undefined` for an empty number.
 */
export function ValueControl({
  entitlementKey,
  value,
  onChange,
  id,
  size = 'md',
  autoFocus,
  onCommit,
  onCancel,
  invalid,
}: {
  entitlementKey: Key;
  value: EntitlementCellValue | undefined;
  onChange: (value: EntitlementCellValue | undefined) => void;
  id?: string;
  size?: 'sm' | 'md';
  autoFocus?: boolean;
  /** Enter in a number field. */
  onCommit?: () => void;
  /** Escape in a number field. */
  onCancel?: () => void;
  invalid?: boolean;
}) {
  const def = getDef(entitlementKey);
  const ownId = useId();
  const unlimitedId = `${id ?? ownId}-unlimited`;
  const [text, setText] = useState(typeof value === 'number' ? String(value) : '');

  // A value set from outside (a reset, another setting picked) shows in the field.
  useEffect(() => {
    if (typeof value === 'number') {
      setText((current) => (parseNumberText(current) === value ? current : String(value)));
    }
  }, [value]);

  if (!def) return null;

  if (def.type === 'boolean') {
    return (
      <span className="inline-flex items-center gap-2">
        <Toggle
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          aria-label={`${def.label}: ${value === true ? 'on' : 'off'}`}
        />
        <span className="font-sans text-sm text-ink">{value === true ? 'On' : 'Off'}</span>
      </span>
    );
  }

  if (def.type === 'enum') {
    return (
      <Select
        value={typeof value === 'string' ? value : undefined}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger
          id={id}
          className={size === 'sm' ? 'h-9 min-w-36 text-xs' : undefined}
          aria-label={def.label}
          aria-invalid={invalid ? true : undefined}
        >
          <SelectValue placeholder="Choose a value" />
        </SelectTrigger>
        <SelectContent>
          {def.options.map((option) => {
            const reserved = def.reserved?.includes(option) ?? false;
            return (
              <SelectItem key={option} value={option} disabled={reserved}>
                {def.optionLabels[option] ?? option}
                {reserved ? ' (reserved)' : ''}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    );
  }

  const unit = unitLabel(def);
  const unlimited = value === null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-2">
        <Input
          id={id}
          inputMode="decimal"
          size={size}
          className={size === 'sm' ? 'w-24' : 'w-36'}
          value={unlimited ? '' : text}
          disabled={unlimited}
          autoFocus={autoFocus}
          variant={invalid ? 'error' : 'default'}
          aria-invalid={invalid ? true : undefined}
          aria-label={unit ? `${def.label} in ${unit}` : def.label}
          placeholder={unlimited ? 'Unlimited' : 'Enter your value'}
          onChange={(event) => {
            setText(event.target.value);
            onChange(parseNumberText(event.target.value));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onCommit?.();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel?.();
            }
          }}
        />
        {unit ? <span className="font-sans text-xs text-ink type-muted">{unit}</span> : null}
      </span>
      {def.allowUnlimited ? (
        <span className="inline-flex items-center gap-2">
          <Checkbox
            id={unlimitedId}
            checked={unlimited}
            onCheckedChange={(checked) =>
              onChange(checked === true ? null : (parseNumberText(text) ?? undefined))
            }
          />
          <label htmlFor={unlimitedId} className="cursor-pointer font-sans text-xs text-ink">
            Unlimited
          </label>
        </span>
      ) : null}
    </span>
  );
}

/** A list that could not be read, with a way to try again. */
export function LoadFailed({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <Alert variant="warning" className="items-center">
      <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
      <p className="m-0 min-w-0 flex-1">{message ?? OPERATOR_COPY.loadFailed}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Try Again
      </Button>
    </Alert>
  );
}
