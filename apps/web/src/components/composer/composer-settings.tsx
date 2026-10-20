'use client';

/**
 * Each platform's own options for a post (2026-10-19, after Postiz's
 * per-channel "Settings" bar): a YouTube title and visibility, who can reply
 * on X, a Pin's link, TikTok's privacy and so on.
 *
 * Placed where Postiz places it: a bar along the bottom of the writing
 * column that opens to the fields. With a channel's tab open it reads
 * "<channel> Settings" and holds that channel's fields; on "All channels" it
 * reads "Settings" and holds a block per selected channel that has any, each
 * headed by the channel. A platform with no options gets no bar, as Postiz
 * shows no settings for a provider without a settings component.
 *
 * Unlike Postiz, which writes a component per provider, the fields are drawn
 * from data: social-core's `settingsFieldsFor` lists them, and the API and
 * the worker validate against that same list (`validateProviderSettings`), so
 * the form cannot offer an option the publisher ignores.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { SettingsIcon } from '@animateicons/react/lucide/settings-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { type SettingField, tagsTotalLength } from '@postgear/social-core/composer';
import {
  Checkbox,
  cn,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import { type KeyboardEvent, useId, useState } from 'react';
import { ChannelMark } from '@/components/channels/channel-mark';
import type { Channel } from '@/types/channel';
import { FIELD_FOCUS } from './toolbar';

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export interface SettingsBlock {
  channel: Channel;
  fields: SettingField[];
  values: Record<string, unknown>;
  /** Problems to show under the fields, by field key. */
  errors: Record<string, string>;
}

export function SettingsBar({
  title,
  blocks,
  headed,
  open,
  onOpenChange,
  onChange,
  disabled = false,
  className,
}: {
  /** "<channel> Settings" on a channel's tab, "Settings" on All channels. */
  title: string;
  /** One per channel shown. */
  blocks: SettingsBlock[];
  /**
   * Each block headed by its channel: on All channels, where the title
   * names none. A channel's own tab already says whose fields these are.
   */
  headed: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `undefined` clears a field back to its default. */
  onChange: (channelId: string, key: string, value: unknown) => void;
  disabled?: boolean;
  className?: string;
}) {
  const panelId = useId();
  const errorCount = blocks.reduce((total, block) => total + Object.keys(block.errors).length, 0);

  return (
    <div
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border-2 border-outline bg-chrome',
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className={cn(
          'flex h-11 w-full shrink-0 items-center gap-2.5 px-4 text-start type-ui text-sm text-ink hover:bg-actionPrimary/10',
          FOCUS,
          'focus-visible:-outline-offset-4',
        )}
      >
        <MotionIcon icon={SettingsIcon} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {errorCount > 0 && !open ? (
          <span className="shrink-0 font-sans text-xs text-dangerInk">{errorCount} to fix</span>
        ) : null}
        <MotionIcon
          icon={ChevronDownIcon}
          strokeWidth={3}
          className={cn('h-4 w-4 shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {open ? (
        <section
          id={panelId}
          aria-label={title}
          className="flex flex-col gap-6 bg-secondary p-4 lg:max-h-[40dvh] lg:overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
        >
          {blocks.map((block) => (
            <section
              key={block.channel.id}
              aria-label={headed ? `${block.channel.name} settings` : undefined}
              className="flex flex-col gap-4"
            >
              {headed ? (
                <div className="flex items-center gap-3">
                  <ChannelMark
                    size="sm"
                    color={block.channel.color}
                    id={block.channel.id}
                    name={block.channel.name}
                    picture={block.channel.picture}
                    platform={block.channel.providerIdentifier}
                    platformName={block.channel.providerName}
                  />
                  <span className="min-w-0 truncate type-ui text-sm text-ink">
                    {block.channel.name}
                  </span>
                </div>
              ) : null}
              {block.fields.map((field) => (
                <SettingControl
                  key={field.key}
                  id={`settings-${block.channel.id}-${field.key}`}
                  field={field}
                  value={block.values[field.key]}
                  error={block.errors[field.key]}
                  disabled={disabled}
                  onChange={(value) => onChange(block.channel.id, field.key, value)}
                />
              ))}
            </section>
          ))}
        </section>
      ) : null}
    </div>
  );
}

/** One field, drawn by its kind. An unset field shows its default. */
function SettingControl({
  id,
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string;
  field: SettingField;
  value: unknown;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const describedBy = `${id}-note`;

  switch (field.kind) {
    case 'text': {
      const text = typeof value === 'string' ? value : '';
      return (
        <FormField>
          <FormLabel htmlFor={id} required={field.required}>
            {field.label}
          </FormLabel>
          <Input
            id={id}
            type={field.url ? 'url' : 'text'}
            inputMode={field.url ? 'url' : undefined}
            value={text}
            placeholder={field.placeholder ?? (field.url ? 'https://' : undefined)}
            disabled={disabled}
            variant={error ? 'error' : 'default'}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            // Empty means "not set", so the provider's fallback applies.
            onChange={(event) =>
              onChange(event.target.value === '' ? undefined : event.target.value)
            }
          />
          <Note
            id={describedBy}
            error={error}
            hint={field.hint}
            count={field.maxLength !== undefined ? `${text.length}/${field.maxLength}` : undefined}
          />
        </FormField>
      );
    }

    case 'select': {
      const selected = typeof value === 'string' ? value : field.default;
      return (
        <FormField>
          <FormLabel htmlFor={id}>{field.label}</FormLabel>
          <Select value={selected} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger
              id={id}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={error ? 'border-actionDanger' : undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Note id={describedBy} error={error} hint={field.hint} />
        </FormField>
      );
    }

    case 'boolean': {
      const checked = typeof value === 'boolean' ? value : field.default;
      return (
        <FormField>
          <div className="flex items-center gap-2.5">
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              aria-describedby={describedBy}
              onCheckedChange={(next) => onChange(next === true)}
            />
            <FormLabel htmlFor={id} className="cursor-pointer">
              {field.label}
            </FormLabel>
          </div>
          <Note id={describedBy} error={error} hint={field.hint} />
        </FormField>
      );
    }

    case 'tags':
      return (
        <KeywordsField
          id={id}
          field={field}
          words={Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []}
          error={error}
          disabled={disabled}
          onChange={(words) => onChange(words.length > 0 ? words : undefined)}
        />
      );
  }
}

/** The line under a field: its error, or its hint, and a count when it has a limit. */
function Note({
  id,
  error,
  hint,
  count,
}: {
  id: string;
  error: string | undefined;
  hint: string | undefined;
  count?: string;
}) {
  if (error) {
    return <FormErrorMessage id={id}>{error}</FormErrorMessage>;
  }

  if (!hint && !count) {
    return null;
  }

  return (
    <FormHelperText id={id} className="flex justify-between gap-3">
      <span>{hint}</span>
      {count ? <span className="shrink-0 tabular-nums">{count}</span> : null}
    </FormHelperText>
  );
}

/**
 * A list of short words (YouTube's video tags): typed into one box, each
 * becoming a chip on Enter or a comma, removable by its x or by Backspace
 * in the empty box.
 */
function KeywordsField({
  id,
  field,
  words,
  error,
  disabled,
  onChange,
}: {
  id: string;
  field: Extract<SettingField, { kind: 'tags' }>;
  words: string[];
  error: string | undefined;
  disabled: boolean;
  onChange: (words: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const describedBy = `${id}-note`;
  // Counted as YouTube counts it, as the API checks it.
  const total = tagsTotalLength(words);
  const full = words.length >= field.max;

  function add(raw: string) {
    const word = raw.trim().replace(/^#/, '');
    setDraft('');
    if (word && !full && !words.includes(word)) {
      onChange([...words, word]);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && draft === '' && words.length > 0) {
      onChange(words.slice(0, -1));
    }
  }

  return (
    <FormField>
      <FormLabel htmlFor={id}>{field.label}</FormLabel>
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border-2 border-outline bg-field px-2 py-1.5 shadow-surfaceSm',
          'focus-within:border-actionPrimary focus-within:ring-3 focus-within:ring-actionPrimary/20',
          error && 'border-actionDanger focus-within:border-actionDanger',
          disabled && 'cursor-not-allowed opacity-50 shadow-none',
        )}
      >
        {words.map((word) => (
          <span
            key={word}
            className="flex max-w-full items-center gap-0.5 rounded-full border-2 border-outline bg-secondary ps-2 pe-0.5 font-sans text-xs text-ink"
          >
            <span className="truncate">{word}</span>
            <button
              type="button"
              aria-label={`Remove ${word}`}
              disabled={disabled}
              onClick={() => onChange(words.filter((item) => item !== word))}
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-actionPrimary/10',
                FOCUS,
              )}
            >
              <MotionIcon icon={XIcon} size={12} strokeWidth={3} className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          disabled={disabled || full}
          placeholder={
            full ? undefined : words.length > 0 ? 'Add another' : 'Type a word, then Enter'
          }
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          className={cn(
            'h-7 min-w-28 flex-1 bg-transparent px-1 font-sans text-sm text-ink placeholder:text-ink/50',
            FIELD_FOCUS,
            'focus-visible:ring-0',
          )}
        />
      </div>
      <Note
        id={describedBy}
        error={error}
        hint={field.hint}
        count={`${words.length}/${field.max}${
          field.maxTotalLength !== undefined ? `, ${total}/${field.maxTotalLength} characters` : ''
        }`}
      />
    </FormField>
  );
}
