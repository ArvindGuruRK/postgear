'use client';

/**
 * A chip's Format menu (blueprint 5.3): the fixed data formats of Module 02
 * in plain words ("Shorten to 200 characters", "Date as 2026-11-03", "If
 * empty use ..."), applied in order, with the result on the sample value.
 * Never an expression: only the listed formats and their one setting.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { applyFilter, TOKEN_FILTERS, type TokenFilter } from '@postgear/automation';
import { Button, Input, MotionIcon, Text } from '@postgear/ui';
import { useId, useState } from 'react';
import { filterWords, previewText } from './chip-model';

export interface FormatMenuProps {
  filters: readonly TokenFilter[];
  onChange: (filters: TokenFilter[]) => void;
  /** The chip's value before any format, for the Result line; left out when there is none. */
  value?: unknown;
  timeZone?: string;
}

/** What each setting is called next to its box. */
const ARG_LABELS: Record<string, string> = {
  truncate: 'Characters',
  date: 'Pattern',
  default: 'Text to use',
  join: 'Between items',
};

const ARG_PLACEHOLDERS: Record<string, string> = {
  truncate: 'Enter your number of characters',
  date: 'Enter your pattern, like yyyy-MM-dd',
  default: 'Enter your text',
  join: 'Enter your separator',
};

/** Applies the formats in order; the result line of the menu. */
export function formatResult(value: unknown, filters: readonly TokenFilter[], timeZone?: string) {
  let result = value;
  for (const filter of filters) result = applyFilter(result, filter, { timeZone });
  return result;
}

export function FormatMenu({ filters, onChange, value, timeZone }: FormatMenuProps) {
  const [adding, setAdding] = useState(false);
  const ids = useId();
  const used = new Set(filters.map((filter) => filter.name));
  const available = TOKEN_FILTERS.filter((info) => !used.has(info.name));

  function setArg(index: number, raw: string) {
    const next = filters.map((filter, i) => {
      if (i !== index) return filter;
      if (filter.name === 'truncate') {
        const n = Number.parseInt(raw, 10);
        return { ...filter, arg: Number.isFinite(n) ? Math.min(10_000, Math.max(1, n)) : 1 };
      }
      return { ...filter, arg: raw.slice(0, filter.name === 'default' ? 200 : 40) };
    });
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2" data-testid="format-menu">
      <span className="type-label text-xs text-ink">Format</span>
      {filters.length === 0 ? (
        <Text size="xs" muted>
          Shown as it comes.
        </Text>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {filters.map((filter, index) => {
            const info = TOKEN_FILTERS.find((candidate) => candidate.name === filter.name);
            const takesArg = info !== undefined && info.arg !== 'none';
            const argId = `${ids}-arg-${index}`;
            return (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: a format may appear twice; its place is its identity
                key={`${filter.name}-${index}`}
                className="flex flex-col gap-1 rounded-md border-2 border-outline bg-inset p-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-sm font-bold text-ink">
                    {filterWords(filter)}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-7 w-7 shrink-0 px-0"
                    aria-label={`Remove ${filterWords(filter)}`}
                    onClick={() => onChange(filters.filter((_, i) => i !== index))}
                  >
                    <MotionIcon icon={XIcon} className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {takesArg ? (
                  <div className="flex items-center gap-2">
                    <label htmlFor={argId} className="font-sans text-xs font-bold text-ink">
                      {ARG_LABELS[filter.name] ?? 'Setting'}
                    </label>
                    <Input
                      id={argId}
                      size="sm"
                      type={filter.name === 'truncate' ? 'number' : 'text'}
                      min={filter.name === 'truncate' ? 1 : undefined}
                      value={filter.arg === undefined ? '' : String(filter.arg)}
                      placeholder={ARG_PLACEHOLDERS[filter.name]}
                      onChange={(event) => setArg(index, event.target.value)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="sr-only">Formats to add</legend>
          {available.map((info) => {
            const filter: TokenFilter =
              info.defaultArg === undefined
                ? { name: info.name }
                : { name: info.name, arg: info.defaultArg };
            return (
              <button
                key={info.name}
                type="button"
                title={info.description}
                onClick={() => {
                  onChange([...filters, filter]);
                  setAdding(false);
                }}
                className="rounded-md px-2 py-1.5 text-left font-sans text-sm text-ink outline-none hover:bg-actionPrimary/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
              >
                {filterWords(filter)}
              </button>
            );
          })}
        </fieldset>
      ) : available.length > 0 ? (
        <div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Add Format
          </Button>
        </div>
      ) : null}

      {value !== undefined && filters.length > 0 ? (
        <Text size="xs" muted>
          Result: {previewText(formatResult(value, filters, timeZone))}
        </Text>
      ) : null}
    </div>
  );
}
