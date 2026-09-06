'use client';

import { Stack, Text, cn } from '@postgear/ui';
import type { Question } from '@/lib/onboarding-questions';

/**
 * One survey question rendered as a list of selectable cards.
 *
 * Cards rather than a `<select>`: five short options are faster to scan and
 * tap than a dropdown, and onboarding completion is sensitive to friction.
 *
 * Built on real radio inputs kept visually hidden rather than on styled
 * `<div onClick>`s, so the group is keyboard-navigable with arrow keys, is
 * announced as a radiogroup by screen readers, and participates in the form —
 * all behaviour that a div would have to reimplement badly. The visible card
 * is the `<label>`, which is why clicking anywhere on it selects the option.
 */
export function ChoiceGroup({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 font-display text-lg text-ink">{question.prompt}</legend>

      <Stack gap="sm">
        {question.options.map((option) => {
          const id = `${question.field}-${option.value}`;
          const selected = value === option.value;

          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-start gap-3 border-2 border-outline px-4 py-3 shadow-brutalSm transition-all',
                'hover:-translate-x-px hover:-translate-y-px hover:shadow-brutalMdHover',
                // The selected card uses the action colour with its paired
                // on-colour rather than a tint, so contrast holds in both
                // themes (design-system-rules §7: no raw hex, no ad-hoc tints).
                selected ? 'bg-actionPrimary text-onActionPrimary' : 'bg-secondary text-ink',
              )}
            >
              <input
                type="radio"
                id={id}
                name={question.field}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                // Visually hidden, not `hidden` and not `display: none` —
                // either of those removes it from the tab order and from the
                // accessibility tree, which is the whole reason to use a real
                // input here.
                className="sr-only"
              />

              <span
                aria-hidden
                className={cn(
                  'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-outline',
                  selected ? 'bg-onActionPrimary' : 'bg-primary',
                )}
              />

              <span className="flex flex-col">
                <span className="font-sans font-bold">{option.label}</span>
                {option.description ? (
                  <span className="text-sm opacity-80">{option.description}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </Stack>
    </fieldset>
  );
}

/**
 * The multi-select variant, for step 4's channel picker.
 *
 * Checkboxes rather than radios, and no "none" option — deselecting everything
 * is a valid answer that means the same thing as skipping.
 */
export function MultiChoiceGroup({
  prompt,
  options,
  values,
  onToggle,
}: {
  prompt: string;
  options: { value: string; label: string }[];
  values: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 font-display text-lg text-ink">{prompt}</legend>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {options.map((option) => {
          const id = `channel-${option.value}`;
          const selected = values.includes(option.value);

          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                'flex cursor-pointer items-center justify-center border-2 border-outline px-3 py-4 text-center font-sans font-bold shadow-brutalSm transition-all',
                'hover:-translate-x-px hover:-translate-y-px hover:shadow-brutalMdHover',
                selected ? 'bg-actionPrimary text-onActionPrimary' : 'bg-secondary text-ink',
              )}
            >
              <input
                type="checkbox"
                id={id}
                checked={selected}
                onChange={() => onToggle(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>

      <Text size="sm" muted className="mt-3">
        Pick as many as you like, or none — you can connect channels later.
      </Text>
    </fieldset>
  );
}
