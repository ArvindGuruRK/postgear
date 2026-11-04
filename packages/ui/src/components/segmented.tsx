'use client';

import type { AnimatedIcon } from '../lib/icon-animation';
import { SEGMENT_FRAME, SEGMENT_ICON, SEGMENT_WORDS, segment } from '../lib/segmented';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';
import { TooltipHint } from './tooltip';

export interface SegmentedOption<T extends string> {
  value: T;
  /** The option's name: its text, or, with a short form or an icon, its tooltip and spoken name. */
  label: string;
  /** Shown in place of the label, such as S for Small or Mon for Monday. */
  short?: string;
  /** Shown in place of any text. */
  icon?: AnimatedIcon;
}

interface SegmentedBase<T extends string> {
  /** The id of the text that names the group, or its own name. */
  labelledBy?: string;
  label?: string;
  options: readonly SegmentedOption<T>[];
  disabled?: boolean;
  className?: string;
  /** Options only as wide as their words, for a narrow pane with something beside the bar. */
  tight?: boolean;
}

/**
 * One choice from a few, as pressed buttons: the toggle bar `Tabs` draws, for a
 * choice that sets a value and does not swap a panel. An option shown as a
 * short form or an icon names itself on hover and keyboard focus, and to a
 * screen reader always.
 */
export function Segmented<T extends string>({
  labelledBy,
  label,
  options,
  value,
  onValueChange,
  disabled,
  className,
  tight,
}: SegmentedBase<T> & { value: T; onValueChange: (value: T) => void }) {
  return (
    <SegmentFrame labelledBy={labelledBy} label={label} className={className}>
      {options.map((option) => (
        <SegmentButton
          key={option.value}
          option={option}
          active={option.value === value}
          disabled={disabled}
          tight={tight}
          onClick={() => {
            if (option.value !== value) onValueChange(option.value);
          }}
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
        'inline-flex max-w-full flex-wrap items-center self-start',
        SEGMENT_FRAME,
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
  tight,
  onClick,
}: {
  option: SegmentedOption<T>;
  active: boolean;
  disabled?: boolean;
  tight?: boolean;
  onClick: () => void;
}) {
  const compact = option.icon !== undefined || option.short !== undefined;
  const button = (
    <button
      type="button"
      aria-pressed={active}
      aria-label={compact ? option.label : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        segment(active),
        option.icon
          ? SEGMENT_ICON
          : option.short
            ? 'min-w-9 px-1.5'
            : tight
              ? 'px-2.5'
              : SEGMENT_WORDS,
      )}
    >
      {option.icon ? (
        <MotionIcon icon={option.icon} className="h-4 w-4" />
      ) : (
        (option.short ?? option.label)
      )}
    </button>
  );

  // Flush buttons: the tooltip closes as the pointer leaves, so it never covers
  // the next one (see ViewSwitcher).
  return compact ? (
    <TooltipHint
      label={option.label}
      side="top"
      sideOffset={10}
      hoverable={false}
      hidden={disabled}
    >
      {button}
    </TooltipHint>
  ) : (
    button
  );
}
