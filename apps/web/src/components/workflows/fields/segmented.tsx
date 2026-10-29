'use client';

/**
 * One choice of a few as pressed buttons in a frame (the studio's
 * segmented control, the design system's view switcher pattern): All Of
 * or Any Of, Every Hour to Every Month, the weekday chips (`multiple`).
 */
import { cn } from '@postgear/ui';

const SEGMENT = cn(
  'flex h-8 min-w-8 items-center justify-center rounded-md px-2.5 type-ui text-xs',
  'outline-none transition-colors motion-reduce:transition-none',
  'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
  'disabled:cursor-not-allowed disabled:opacity-50',
);

export interface SegmentChoice<T extends string> {
  value: T;
  label: string;
  /** The full words for a short label ("Monday" for "Mon"). */
  title?: string;
}

interface SegmentedBase<T extends string> {
  /** The id of the text that names the group, or its own name. */
  labelledBy?: string;
  label?: string;
  options: readonly SegmentChoice<T>[];
  disabled?: boolean;
  className?: string;
}

export function Segmented<T extends string>({
  labelledBy,
  label,
  options,
  value,
  onValueChange,
  disabled,
  className,
}: SegmentedBase<T> & { value: T; onValueChange: (value: T) => void }) {
  return (
    <SegmentFrame labelledBy={labelledBy} label={label} className={className}>
      {options.map((option) => (
        <SegmentButton
          key={option.value}
          option={option}
          active={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onValueChange(option.value);
          }}
        />
      ))}
    </SegmentFrame>
  );
}

/** Several on at once (the weekday chips). */
export function SegmentedMany<T extends string>({
  labelledBy,
  label,
  options,
  values,
  onToggle,
  disabled,
  className,
}: SegmentedBase<T> & { values: readonly T[]; onToggle: (value: T) => void }) {
  return (
    <SegmentFrame labelledBy={labelledBy} label={label} className={className}>
      {options.map((option) => (
        <SegmentButton
          key={option.value}
          option={option}
          active={values.includes(option.value)}
          disabled={disabled}
          onClick={() => onToggle(option.value)}
        />
      ))}
    </SegmentFrame>
  );
}

function SegmentFrame({
  labelledBy,
  label,
  className,
  children,
}: {
  labelledBy?: string;
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a div[role=group] of pressed buttons is the ARIA pattern for one choice of a few
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn(
        'inline-flex max-w-full flex-wrap items-center gap-1 self-start rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm',
        className,
      )}
    >
      {children}
    </div>
  );
}

function SegmentButton<T extends string>({
  option,
  active,
  disabled,
  onClick,
}: {
  option: SegmentChoice<T>;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={option.title}
      title={option.title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        SEGMENT,
        active ? 'bg-actionPrimary text-onActionPrimary' : 'text-ink hover:bg-actionPrimary/10',
      )}
    >
      {option.label}
    </button>
  );
}
