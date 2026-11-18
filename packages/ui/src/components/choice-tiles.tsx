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
  /**
   * A small picture of the choice, above the text, for a choice that is
   * easier seen than named (the clip editor's Vertical, Horizontal, Square).
   * Decorative: the label names it. Takes the place of `icon`.
   */
  drawing?: ReactNode;
  /** One short sentence under the name. The tile grows to hold it. */
  line?: string;
  /**
   * A small mark on the tile's top right corner, such as a plan lock: it sits
   * over the corner like a sticker, so it never covers the tile's own words.
   * Decorative: say what it means in `spokenLabel`.
   */
  corner?: ReactNode;
  /** The tile's spoken name when it differs from `label` ("1080p, locked"). */
  spokenLabel?: string;
}

interface ChoiceTilesBase<T extends string> {
  /** The id of the text that names the group, or its own name. */
  labelledBy?: string;
  label?: string;
  options: readonly ChoiceTileOption<T>[];
  disabled?: boolean;
  className?: string;
  /**
   * Wraps the tiles into a grid of this many columns, for a choice of more
   * than a row holds (the clip editor's seven layouts). Left out, one row.
   */
  columns?: 2 | 3 | 4;
}

const COLUMNS: Readonly<Record<2 | 3 | 4, string>> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
};

/**
 * One choice from a few, as a full-width row of equal keys in the time picker's
 * look. For a choice that is the point of a form (how often a schedule runs),
 * where `Segmented` reads as tabs. No frame and, as a toggle, no shadow. One
 * row, so keep the options few; `columns` wraps a longer set into a grid.
 */
export function ChoiceTiles<T extends string>({
  labelledBy,
  label,
  options,
  value,
  onValueChange,
  disabled,
  className,
  columns,
}: ChoiceTilesBase<T> & { value: T; onValueChange: (value: T) => void }) {
  return (
    <TileRow labelledBy={labelledBy} label={label} className={className} columns={columns}>
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
  columns,
}: ChoiceTilesBase<T> & { values: readonly T[]; onToggle: (value: T) => void }) {
  return (
    <TileRow labelledBy={labelledBy} label={label} className={className} columns={columns}>
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
  columns,
  children,
}: {
  labelledBy?: string;
  label?: string;
  className?: string;
  columns?: 2 | 3 | 4;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a div[role=group] of pressed buttons is the ARIA pattern for one choice of a few
    <div
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn(
        'grid w-full gap-2',
        columns ? COLUMNS[columns] : 'auto-cols-fr grid-flow-col',
        className,
      )}
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
  const tall = option.drawing !== undefined || option.line !== undefined;
  const button = (
    <button
      type="button"
      aria-pressed={active}
      aria-label={option.spokenLabel ?? (option.short ? option.label : undefined)}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex w-full flex-col items-center justify-center gap-1.5 px-1 type-ui text-sm',
        'disabled:pointer-events-none disabled:opacity-50',
        tall ? 'h-full px-3 py-4 text-center' : option.icon ? 'h-16' : 'h-10',
        keyTile(active),
      )}
    >
      {option.drawing !== undefined ? (
        <span aria-hidden="true" className="flex items-center justify-center">
          {option.drawing}
        </span>
      ) : option.icon ? (
        <MotionIcon icon={option.icon} className="h-5 w-5" />
      ) : null}
      {option.short ?? option.label}
      {option.line ? (
        <span className="font-sans text-xs leading-snug type-muted">{option.line}</span>
      ) : null}
      {option.corner ? (
        <span aria-hidden="true" className="absolute -top-2 -right-2 flex">
          {option.corner}
        </span>
      ) : null}
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
