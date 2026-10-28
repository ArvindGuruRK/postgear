'use client';

/**
 * A colour as a picker and a hex field that stay in step (DS-2.1).
 *
 * The field is what the person types, valid or not; the swatch shows the
 * last valid colour, and picking one writes a full `#RRGGBB` back into the
 * field. Leaving the field tidies a short or lower-case hex into that form.
 * An invalid hex says "Enter a colour like #1A2B3C." under the field.
 */
import { cn, FormErrorMessage, FormField, FormLabel, Input } from '@postgear/ui';
import { useEffect, useId, useState } from 'react';
import { hexFromInput } from './studio-view-model';

export function ColorField({
  label,
  value,
  onChange,
  error,
  onBlur,
  hideLabel = false,
  className,
}: {
  label: string;
  /** What is typed: a hex while it is valid, anything while it is being typed. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  /** Called when the hex field loses focus, so a form can start showing its error. */
  onBlur?: () => void;
  /** For a row whose column already says what the field is: the label is read, not shown. */
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const valid = hexFromInput(value);
  const [shown, setShown] = useState(valid ?? '#000000');

  useEffect(() => {
    if (valid) setShown(valid);
  }, [valid]);

  return (
    <FormField className={cn('min-w-0', className)}>
      <FormLabel htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </FormLabel>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'relative h-11 w-11 shrink-0 overflow-hidden rounded-md border-2 border-outline shadow-surfaceSm',
            'focus-within:outline-solid focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focusRing',
          )}
          style={{ background: shown }}
        >
          <input
            type="color"
            value={shown.toLowerCase()}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            aria-label={`Pick the ${label.toLowerCase()} colour`}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </span>
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => {
            if (valid && valid !== value) onChange(valid);
            onBlur?.();
          }}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          placeholder="Enter your colour"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className="tabular-nums"
        />
      </div>
      {error ? <FormErrorMessage id={errorId}>{error}</FormErrorMessage> : null}
    </FormField>
  );
}
