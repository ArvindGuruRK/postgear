'use client';

import { type AnimatedIcon, cn, MotionIcon, pressSm } from '@postgear/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * One onboarding question's answers as a grid of cards (Buffer's onboarding,
 * docs/screenshots 21 to 23): two columns from `sm`, one below it. A card is
 * an optional icon tile, the label with an optional line under it, and, for a
 * multi-select, a checkbox on the right.
 *
 * Built on real radio or checkbox inputs kept visually hidden rather than on
 * styled `<div onClick>`s, so the group is keyboard-navigable (arrow keys for
 * radios, Space for checkboxes), is announced as a group by screen readers,
 * and participates in the form: all behaviour that a div would have to
 * reimplement badly. The visible card is the `<label>`, which is why clicking
 * anywhere on it selects the option.
 *
 * The group takes its name from the screen's heading (`labelledBy`) rather
 * than a legend of its own, so the question is written once.
 */

export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
  /** An icon on a palette fill, the way the reference marks each answer. */
  icon?: AnimatedIcon;
  /** The fill for `icon`: a `bg-avatarN text-onAvatarN` pair. */
  fill?: string;
  /** Drawn in place of `icon`: a platform logo, which is its own tile. */
  media?: ReactNode;
}

const FOCUS_WITHIN =
  'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focusRing';

export function ChoiceGroup({
  name,
  labelledBy,
  options,
  value,
  onChange,
}: {
  /** The radio group's name, also the prefix of each input's id. */
  name: string;
  labelledBy: string;
  options: ChoiceOption[];
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      className="grid w-full gap-2 sm:grid-cols-2"
    >
      {options.map((option) => (
        <ChoiceCard
          key={option.value}
          inputId={`${name}-${option.value}`}
          option={option}
          selected={value === option.value}
          input={
            <input
              type="radio"
              id={`${name}-${option.value}`}
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              // Visually hidden, not `hidden` and not `display: none`: either
              // of those removes it from the tab order and from the
              // accessibility tree, which is the whole reason to use a real
              // input here.
              className="sr-only"
            />
          }
        />
      ))}
    </div>
  );
}

/**
 * The multi-select variant, for step 4's channel picker. Checkboxes rather
 * than radios, each with its box drawn on the right of the card.
 */
export function MultiChoiceGroup({
  name,
  labelledBy,
  options,
  values,
  onToggle,
}: {
  name: string;
  labelledBy: string;
  options: ChoiceOption[];
  values: string[];
  onToggle: (value: string) => void;
}) {
  return (
    // A fieldset with no legend: the screen's heading names it.
    <fieldset aria-labelledby={labelledBy} className="grid w-full min-w-0 gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const selected = values.includes(option.value);

        return (
          <ChoiceCard
            key={option.value}
            inputId={id}
            option={option}
            selected={selected}
            multiple
            input={
              <input
                type="checkbox"
                id={id}
                value={option.value}
                checked={selected}
                onChange={() => onToggle(option.value)}
                className="sr-only"
              />
            }
          />
        );
      })}
    </fieldset>
  );
}

function ChoiceCard({
  inputId,
  option,
  selected,
  multiple = false,
  input,
}: {
  /** The id of `input`, which the card wraps and also names outright. */
  inputId: string;
  option: ChoiceOption;
  selected: boolean;
  multiple?: boolean;
  input: ReactNode;
}) {
  const hasMedia = Boolean(option.media || option.icon);

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border-2 border-outline bg-secondary px-3 text-ink',
        hasMedia || option.description ? 'min-h-14 py-2.5' : 'min-h-12 py-2',
        pressSm,
        FOCUS_WITHIN,
        // The avatar picker's selection ring: the action colour, offset from
        // the card by the page colour so it reads as a ring rather than a
        // thicker border.
        selected && 'ring-2 ring-actionPrimary ring-offset-2 ring-offset-primary',
      )}
    >
      {input}

      {option.media ? (
        <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center">
          {option.media}
        </span>
      ) : option.icon ? (
        <span
          aria-hidden
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-outline',
            option.fill,
          )}
        >
          <MotionIcon icon={option.icon} className="h-4 w-4" />
        </span>
      ) : null}

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="type-ui text-sm">{option.label}</span>
        {option.description ? (
          <span className="font-sans text-xs opacity-70">{option.description}</span>
        ) : null}
      </span>

      {multiple ? (
        <span
          aria-hidden
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border-2 border-outline',
            selected ? 'bg-actionPrimary text-onActionPrimary' : 'bg-field',
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : null}
        </span>
      ) : selected ? (
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : null}
    </label>
  );
}
