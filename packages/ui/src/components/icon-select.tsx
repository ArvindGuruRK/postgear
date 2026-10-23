'use client';

/**
 * A Select whose options carry an icon, shown again in the field once chosen
 * (2026-10-23): pick "Acme Studio" and the field reads [Instagram logo] Acme
 * Studio, not the bare name.
 *
 * Why it is its own component: a closed Radix Select shows only the chosen
 * option's text, so an icon inside `SelectItem` is lost from the field. Here
 * the field renders the chosen option itself, through `SelectValue`'s
 * children. The menu is exactly as wide as the field, so the two read as one
 * control; a long label wraps in the menu and truncates in the field.
 *
 * Data-agnostic on purpose: the app's `ChannelSelect` feeds it channels and
 * platform logos.
 */
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export interface IconSelectOption {
  value: string;
  /** The option's name, shown beside the icon and used for type-ahead. */
  label: string;
  /** Decorative: the label already names the option. Sized by the caller (`h-4 w-4`). */
  icon?: ReactNode;
}

export interface IconSelectProps {
  options: IconSelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  /** For the field (the trigger): width, height, surface. The menu follows its width. */
  className?: string;
}

function OptionContent({ option, truncate }: { option: IconSelectOption; truncate?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.icon ? (
        <span aria-hidden="true" className="flex shrink-0 items-center">
          {option.icon}
        </span>
      ) : null}
      <span className={cn(truncate && 'truncate')}>{option.label}</span>
    </span>
  );
}

export function IconSelect({
  options,
  value,
  onValueChange,
  placeholder,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: IconSelectProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={className}>
        <SelectValue placeholder={placeholder} className="min-w-0 flex-1 text-start">
          {selected ? <OptionContent option={selected} truncate /> : placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="w-(--radix-select-trigger-width)">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} textValue={option.label}>
            <OptionContent option={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
