'use client';

/**
 * The footer's Tags control (2026-10-19, after Postiz's tags component): a
 * bordered button naming the post's first tag, as a chip in its colour, and
 * how many more there are. It opens upward onto the workspace's tags: tick
 * one to put it on the post, the pencil to rename or recolour it, the bin to
 * delete it from the workspace (after a yes), and "New tag" for a name and
 * one of the seven palette colours.
 *
 * The form and the delete question replace the list inside the same panel,
 * rather than opening a dialog over a popover over the composer's dialog
 * (Postiz opens a modal for each): one layer, so focus and Escape never have
 * to choose between three.
 *
 * Any member may manage tags (the API's rule, as in Postiz). The list is
 * fetched on every open, so a tag made in another tab is there, and the
 * post's own chips are brought up to date from it: a tag renamed or deleted
 * elsewhere shows as it is now.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { TagIcon } from '@animateicons/react/lucide/tag-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  type AnimatedIcon,
  Button,
  Checkbox,
  cn,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  TooltipHint,
} from '@postgear/ui';
import { Check } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { TAG_COLOR_CLASS, TAG_COLOR_LABEL, TAG_COLORS, type Tag, type TagColor } from '@/types/tag';
import { MAX_TAGS } from './composer-state';
import { FIELD_TRIGGER } from './toolbar';

/** Mirrors the API's limit on a tag's name. */
const MAX_NAME = 40;

type View = { kind: 'list' } | { kind: 'form'; tag: Tag | null } | { kind: 'confirm'; tag: Tag };

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/** A tag as it appears everywhere: its name on its colour, as a sticker. */
export function TagChip({ tag, className }: { tag: Tag; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center truncate rounded-full border-2 border-outline px-2 py-px type-ui text-xs',
        TAG_COLOR_CLASS[tag.color] ?? TAG_COLOR_CLASS.violet,
        className,
      )}
    >
      <span className="truncate">{tag.name}</span>
    </span>
  );
}

export function TagsControl({
  selected,
  onChange,
  onTagChanged,
  onTagDeleted,
  disabled = false,
}: {
  /** The post's tags, in the order they were added. */
  selected: Tag[];
  onChange: (tags: Tag[]) => void;
  /** A tag was renamed or recoloured: the post's copy follows. */
  onTagChanged: (tag: Tag) => void;
  /** A tag was deleted from the workspace, and so from this post. */
  onTagDeleted: (tagId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'list' });
  // The selection as of the latest render, for a list that arrives later.
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  function load() {
    setLoadError(null);
    api<{ tags: Tag[] }>('/tags').then(
      (result) => {
        setTags([...result.tags].sort(byName));
        for (const tag of selectedRef.current) {
          const current = result.tags.find((candidate) => candidate.id === tag.id);
          if (!current) {
            onTagDeleted(tag.id);
          } else if (current.name !== tag.name || current.color !== tag.color) {
            onTagChanged(current);
          }
        }
      },
      (cause: unknown) =>
        setLoadError(cause instanceof ApiError ? cause.message : 'Tags could not be loaded.'),
    );
  }

  function openWith(next: boolean) {
    if (next) {
      setView({ kind: 'list' });
      load();
    }
    setOpen(next);
  }

  function toggle(tag: Tag, on: boolean) {
    if (on) {
      if (selected.length < MAX_TAGS && !selected.some((item) => item.id === tag.id)) {
        onChange([...selected, tag]);
      }
    } else {
      onChange(selected.filter((item) => item.id !== tag.id));
    }
  }

  function saved(tag: Tag, created: boolean) {
    setTags((current) =>
      [...(current ?? []).filter((item) => item.id !== tag.id), tag].sort(byName),
    );
    if (created) {
      // A tag made from a post is made for it, as in Postiz.
      toggle(tag, true);
    } else {
      onTagChanged(tag);
    }
    setView({ kind: 'list' });
  }

  function deleted(tag: Tag) {
    setTags((current) => (current ?? []).filter((item) => item.id !== tag.id));
    onTagDeleted(tag.id);
    setView({ kind: 'list' });
  }

  const [first, ...rest] = selected;

  return (
    <Popover modal open={open} onOpenChange={openWith}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={
            selected.length > 0 ? `Tags: ${selected.map((tag) => tag.name).join(', ')}` : 'Add tag'
          }
          className={cn(FIELD_TRIGGER, 'max-w-60')}
        >
          <MotionIcon icon={TagIcon} className="h-4 w-4 shrink-0" />
          {first ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <TagChip tag={first} className="min-w-0" />
              {rest.length > 0 ? (
                <span className="shrink-0 tabular-nums">+{rest.length}</span>
              ) : null}
            </span>
          ) : (
            <span className="truncate">Add tag</span>
          )}
          <MotionIcon
            icon={ChevronDownIcon}
            strokeWidth={3}
            className={cn(
              'h-4 w-4 shrink-0 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label="Tags"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col p-0"
      >
        {view.kind === 'form' ? (
          <TagForm
            tag={view.tag}
            taken={(tags ?? []).filter((tag) => tag.id !== view.tag?.id)}
            onCancel={() => setView({ kind: 'list' })}
            onSaved={saved}
          />
        ) : view.kind === 'confirm' ? (
          <DeleteTag
            tag={view.tag}
            onCancel={() => setView({ kind: 'list' })}
            onDeleted={deleted}
          />
        ) : (
          <>
            {loadError ? (
              <p role="alert" className="m-0 p-4 font-sans text-sm text-dangerInk">
                {loadError}
              </p>
            ) : tags === null ? (
              <div className="flex flex-col gap-2 p-3" aria-busy="true">
                <Skeleton className="h-7" />
                <Skeleton className="h-7" />
              </div>
            ) : tags.length === 0 ? (
              <p className="m-0 p-4 font-sans text-sm text-ink opacity-70">No tags yet.</p>
            ) : (
              <ul
                aria-label="Workspace tags"
                className="m-0 flex min-h-0 list-none flex-col gap-0.5 overflow-y-auto p-2 pg-scrollbar pg-scrollbar-secondary"
              >
                {tags.map((tag) => {
                  const checked = selected.some((item) => item.id === tag.id);
                  return (
                    <li
                      key={tag.id}
                      className="flex items-center gap-1 rounded-md pe-1 hover:bg-actionPrimary/10"
                    >
                      <label
                        htmlFor={`composer-tag-${tag.id}`}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 py-1.5 ps-2"
                      >
                        <Checkbox
                          id={`composer-tag-${tag.id}`}
                          checked={checked}
                          disabled={!checked && selected.length >= MAX_TAGS}
                          onCheckedChange={(value) => toggle(tag, value === true)}
                        />
                        <TagChip tag={tag} className="min-w-0" />
                      </label>
                      <RowAction
                        label={`Edit ${tag.name}`}
                        icon={PencilIcon}
                        onClick={() => setView({ kind: 'form', tag })}
                      />
                      <RowAction
                        label={`Delete ${tag.name}`}
                        icon={Trash2Icon}
                        danger
                        onClick={() => setView({ kind: 'confirm', tag })}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-col gap-2 p-2">
              {selected.length >= MAX_TAGS ? (
                <FormHelperText className="px-1">
                  A post can have up to {MAX_TAGS} tags.
                </FormHelperText>
              ) : null}
              <Button
                size="sm"
                className="w-full"
                onClick={() => setView({ kind: 'form', tag: null })}
              >
                <MotionIcon icon={PlusIcon} className="h-4 w-4" />
                New Tag
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function RowAction({
  label,
  icon,
  danger = false,
  onClick,
}: {
  label: string;
  icon: AnimatedIcon;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipHint label={label} side="top">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 border-transparent',
          danger ? 'text-dangerInk' : 'text-ink',
          'outline-none hover:border-outline hover:bg-secondary',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        )}
      >
        <MotionIcon icon={icon} size={14} className="h-3.5 w-3.5" />
      </button>
    </TooltipHint>
  );
}

/**
 * A tag's name and colour, new or changed. The colours are native radios,
 * visually hidden inside their swatches (as `ChannelColorDialog` does), so
 * the browser supplies the group and the arrow keys.
 */
function TagForm({
  tag,
  taken,
  onCancel,
  onSaved,
}: {
  /** Null for a new tag. */
  tag: Tag | null;
  /** The workspace's other tags: a new one starts on a colour none of them use. */
  taken: Tag[];
  onCancel: () => void;
  onSaved: (tag: Tag, created: boolean) => void;
}) {
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState<TagColor>(
    () =>
      tag?.color ??
      TAG_COLORS.find((candidate) => !taken.some((other) => other.color === candidate)) ??
      TAG_COLORS[0],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError('Give the tag a name.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const result = tag
        ? await api<{ tag: Tag }>(`/tags/${encodeURIComponent(tag.id)}`, {
            method: 'PATCH',
            body: { name: trimmed, color },
          })
        : await api<{ tag: Tag }>('/tags', { method: 'POST', body: { name: trimmed, color } });
      onSaved(result.tag, tag === null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The tag could not be saved.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 p-4" noValidate>
      <p className="m-0 type-ui text-sm text-ink">{tag ? `Edit ${tag.name}` : 'New tag'}</p>
      <FormField>
        <FormLabel htmlFor="composer-tag-name">Name</FormLabel>
        <Input
          id="composer-tag-name"
          size="sm"
          value={name}
          maxLength={MAX_NAME}
          onChange={(event) => setName(event.target.value)}
          variant={error ? 'error' : 'default'}
          aria-invalid={error ? true : undefined}
          // Opening the form is itself the request to type a name.
          autoFocus
        />
      </FormField>

      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 font-sans text-sm font-bold text-ink">Colour</legend>
        <div className="flex flex-wrap gap-2">
          {TAG_COLORS.map((candidate) => {
            const checked = candidate === color;
            return (
              <label
                key={candidate}
                title={TAG_COLOR_LABEL[candidate]}
                className={cn(
                  'flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-2 border-outline',
                  'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focusRing',
                  TAG_COLOR_CLASS[candidate],
                  checked ? 'shadow-brutalSm' : 'opacity-90 hover:opacity-100',
                )}
              >
                <input
                  type="radio"
                  name="composer-tag-color"
                  value={candidate}
                  checked={checked}
                  onChange={() => setColor(candidate)}
                  className="sr-only"
                />
                <span className="sr-only">{TAG_COLOR_LABEL[candidate]}</span>
                {checked ? <Check aria-hidden className="h-4 w-4" strokeWidth={3} /> : null}
              </label>
            );
          })}
        </div>
      </fieldset>

      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? 'Saving…' : tag ? 'Save Tag' : 'Create Tag'}
        </Button>
      </div>
    </form>
  );
}

function DeleteTag({
  tag,
  onCancel,
  onDeleted,
}: {
  tag: Tag;
  onCancel: () => void;
  onDeleted: (tag: Tag) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setDeleting(true);
    setError(null);

    try {
      await api(`/tags/${encodeURIComponent(tag.id)}`, { method: 'DELETE' });
      onDeleted(tag);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The tag could not be deleted.');
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="m-0 type-ui text-sm text-ink">Delete “{tag.name}”?</p>
      <p className="m-0 font-sans text-sm text-ink opacity-80">
        It comes off every post that has it. This cannot be undone.
      </p>
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Keep It
        </Button>
        <Button variant="danger" size="sm" onClick={() => void remove()} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete Tag'}
        </Button>
      </div>
    </div>
  );
}
