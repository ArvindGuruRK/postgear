'use client';

import type { ReactNode } from 'react';
import type { AnimatedIcon } from '../lib/icon-animation';
import { keyTile } from '../lib/key-tile';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';
import { TooltipHint } from './tooltip';

export interface ChoiceTileOption<T extends string> {
  value: T;
  /** The option's name: its text, or, with a short form, its tooltip and spoken name. */
  label: string;
  /** Shown in place of the label, such as Mon for Monday. */
  short?: string;
  /** Shown above the text. */
  icon?: AnimatedIcon;
}

interface ChoiceTilesBase<T extends string> {
  /** The id of the text that names the group, or its own name. */
  labelledBy?: string;
  label?: string;
  options: readonly ChoiceTileOption<T>[];
  disabled?: boolean;
  className?: string;
}

/**
 * One choice from a few, as a full-width row of equal keys in the time picker's
 * look. For a choice that is the point of a form (how often a schedule runs),
 * where `Segmented` reads as tabs. No frame and, as a toggle, no shadow. Always
 * one row, so keep the options few.
 */
export function ChoiceTiles<T extends string>({
  labelledBy,
  label,
  options,
  value,
  onValueChange,
  disabled,
  className,
}: ChoiceTilesBase<T> & { value: T; onValueChange: (value: T) => void }) {
  return (
    <TileRow labelledBy={labelledBy} label={label} className={className}>
      {options.map((option) => (
        <Tile
          key={option.value}
          option={option}
          active={option.value === value}
          disabled={disabled}
          onClick={() => {
            if (option.value !== value) onValueChange(option.value);
          }}
        />
      ))}
    </TileRow>
  );
}

/** Several on at once (the days of the week). */
export function ChoiceTilesMany<T extends string>({
  labelledBy,
  label,
  options,
  values,
  onToggle,
  disabled,
  className,
}: ChoiceTilesBase<T> & { values: readonly T[]; onToggle: (value: T) => void }) {
  return (
    <TileRow labelledBy={labelledBy} label={label} className={className}>
      {options.map((option) => (
        <Tile
          key={option.value}
          option={option}
          active={values.includes(option.value)}
          disabled={disabled}
          onClick={() => onToggle(option.value)}
        />
      ))}
    </TileRow>
  );
}

function TileRow({
  labelledBy,
  label,
  className,
  children,
}: {
  labelledBy?: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a div[role=group] of pressed buttons is the ARIA pattern for one choice of a few
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn('grid w-full auto-cols-fr grid-flow-col gap-2', className)}
    >
      {children}
    </div>
  );
}

function Tile<T extends string>({
  option,
  active,
  disabled,
  onClick,
}: {
  option: ChoiceTileOption<T>;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const button = (
    <button
      type="button"
      aria-pressed={active}
      aria-label={option.short ? option.label : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full flex-col items-center justify-center gap-1.5 px-1 type-ui text-sm',
        'disabled:pointer-events-none disabled:opacity-50',
        option.icon ? 'h-16' : 'h-10',
        keyTile(active),
      )}
    >
      {option.icon ? <MotionIcon icon={option.icon} className="h-5 w-5" /> : null}
      {option.short ?? option.label}
    </button>
  );

  return option.short ? (
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
