'use client';

/**
 * The step picker (Module 05, blueprint 4.4): n8n's node creator and
 * Zapier's app picker in one component, used three ways:
 *
 * - `panel`: the dock on the right while no step is open (n8n's node
 *   creator, Zapier's side panel); items can also be dragged onto the canvas;
 * - `next`: the same dock, opened from a "+" or a dropped line, "What
 *   happens next?", with triggers hidden;
 * - `trigger`: the empty canvas's Add A Trigger, triggers only.
 *
 * Search first (ranked in `picker-search.ts`); without one, Recent and then
 * the categories, which drill down. Fully keyboard driven: Up and Down
 * move, Enter adds or opens, Right opens a category, Left goes back, Esc
 * goes back and then closes. Coming Soon steps and steps that need
 * something first show why and cannot be added.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { BellIcon } from '@animateicons/react/lucide/bell-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { DatabaseIcon } from '@animateicons/react/lucide/database-icon';
import { GitBranchIcon } from '@animateicons/react/lucide/git-branch-icon';
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import { ShareIcon } from '@animateicons/react/lucide/share-icon';
import { SparklesIcon } from '@animateicons/react/lucide/sparkles-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { ZapIcon } from '@animateicons/react/lucide/zap-icon';
import type { NodeCategory } from '@postgear/automation';
import { Badge, Button, cn, MotionIcon, SearchInput, Spinner, TooltipHint } from '@postgear/ui';
import Link from 'next/link';
import {
  type ComponentProps,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkspaceCatalog } from '@/types/workflows';
import { StepGlyph } from '../list/step-glyph';
import { STEP_DRAG_TYPE } from '../canvas/flow-model';
import {
  itemsIn,
  PICKER_CATEGORIES,
  type PickerItem,
  type PickerPlacement,
  pickerItems,
  recentItems,
  searchPicker,
} from './picker-search';

type AnimatedIcon = ComponentProps<typeof MotionIcon>['icon'];

const CATEGORY_ICONS: Record<NodeCategory, AnimatedIcon> = {
  trigger: ZapIcon,
  postgear: SendIcon,
  social: ShareIcon,
  ai: SparklesIcon,
  logic: GitBranchIcon,
  notify: BellIcon,
  data: DatabaseIcon,
};

const TITLES: Record<PickerPlacement, string> = {
  panel: 'Add A Step',
  next: 'What Happens Next?',
  trigger: 'Add A Trigger',
};

type Row =
  | { kind: 'category'; id: NodeCategory; title: string; count: number }
  | { kind: 'item'; item: PickerItem };

export interface StepPickerProps {
  placement: PickerPlacement;
  catalog: WorkspaceCatalog | null;
  hasTrigger: boolean;
  recent: readonly string[];
  orgId: string;
  onPick: (item: PickerItem) => void;
  onClose?: () => void;
  /** The dock's hide button. */
  onCollapse?: () => void;
  autoFocus?: boolean;
  className?: string;
}

export function StepPicker({
  placement,
  catalog,
  hasTrigger,
  recent,
  orgId,
  onPick,
  onClose,
  onCollapse,
  autoFocus = true,
  className,
}: StepPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<NodeCategory | null>(null);
  // The highlighted row, which starts again at the top whenever the search or the category changes.
  const [highlight, setHighlight] = useState({ view: '', index: 0 });
  // Shown only while someone is using the picker, so a row never looks chosen at rest.
  const [focused, setFocused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();

  const items = useMemo(
    () => (catalog ? pickerItems(catalog, { placement, hasTrigger }) : []),
    [catalog, placement, hasTrigger],
  );

  const rows = useMemo((): Row[] => {
    if (query.trim())
      return searchPicker(items, query, recent).map((item) => ({ kind: 'item', item }));
    if (placement === 'trigger') return items.map((item) => ({ kind: 'item', item }));
    if (category) return itemsIn(items, category).map((item) => ({ kind: 'item', item }));
    const list: Row[] = recentItems(items, recent).map((item) => ({ kind: 'item', item }));
    for (const group of PICKER_CATEGORIES) {
      const count = itemsIn(items, group.id).length;
      if (count > 0) list.push({ kind: 'category', id: group.id, title: group.title, count });
    }
    return list;
  }, [items, query, recent, category, placement]);

  const recentCount =
    !query.trim() && !category && placement !== 'trigger' ? recentItems(items, recent).length : 0;

  const view = `${query}|${category ?? ''}`;
  const active = highlight.view === view ? highlight.index : 0;
  const setActive = (next: number | ((index: number) => number)) =>
    setHighlight({ view, index: typeof next === 'number' ? next : next(active) });

  useEffect(() => {
    if (autoFocus) search.current?.focus();
  }, [autoFocus]);

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.kind === 'category') {
      setCategory(row.id);
      return;
    }
    if (row.item.blocked) return;
    onPick(row.item);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(rows.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === 'ArrowRight' && rows[active]?.kind === 'category') {
      event.preventDefault();
      choose(rows[active]);
    } else if (event.key === 'ArrowLeft' && category && !query) {
      event.preventDefault();
      setCategory(null);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery('');
      else if (category) setCategory(null);
      else onClose?.();
    }
  }

  const activeId = rows[active] ? `${listId}-${active}` : undefined;
  const heading = category
    ? PICKER_CATEGORIES.find((group) => group.id === category)?.title
    : TITLES[placement];

  return (
    <section
      aria-label={TITLES[placement]}
      className={cn('flex min-h-0 flex-col', className)}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="flex items-center gap-2 px-4 pt-4">
        {category && !query ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 px-0"
            aria-label="Back"
            onClick={() => setCategory(null)}
          >
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          </Button>
        ) : null}
        <h2 className="type-heading min-w-0 flex-1 truncate text-2xl text-ink">{heading}</h2>
        {onCollapse ? (
          <TooltipHint label="Hide Steps">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 px-0"
              aria-label="Hide Steps"
              onClick={onCollapse}
            >
              <MotionIcon icon={XIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
        {onClose ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 px-0"
            aria-label="Close"
            onClick={onClose}
          >
            <MotionIcon icon={XIcon} className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div className="px-4 pt-3 pb-3">
        <SearchInput
          ref={search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
          placeholder="Enter your search"
          aria-label="Search steps"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
        />
      </div>

      {catalog === null ? (
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      ) : (
        <div
          id={listId}
          role="listbox"
          aria-label={heading}
          className="min-h-0 flex-1 overflow-y-auto px-3 pb-4"
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
          {recentCount > 0 ? (
            <div
              role="presentation"
              className="type-label px-2 pt-1 pb-1 text-xs text-ink type-muted"
            >
              Recent
            </div>
          ) : null}
          {rows.map((row, index) => {
            const isActive = (focused || hovering) && index === active;
            const id = `${listId}-${index}`;
            if (row.kind === 'category') {
              return (
                <div key={`category-${row.id}`} role="presentation">
                  {index === recentCount && recentCount > 0 ? (
                    <div className="type-label px-2 pt-3 pb-1 text-xs text-ink type-muted">
                      Categories
                    </div>
                  ) : null}
                  <button
                    type="button"
                    id={id}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(row)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border-2 px-2 py-2 text-left',
                      'border-transparent text-ink',
                      isActive ? 'bg-primary' : '',
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center text-ink">
                      <MotionIcon icon={CATEGORY_ICONS[row.id]} className="h-4 w-4" />
                    </span>
                    <span className="type-ui flex-1 text-sm">{row.title}</span>
                    <span className="font-sans text-xs type-muted">{row.count}</span>
                    <MotionIcon icon={ChevronRightIcon} className="h-4 w-4" />
                  </button>
                </div>
              );
            }
            const { item } = row;
            const addable = item.blocked === null;
            return (
              <div key={item.id} role="presentation">
                <div
                  id={id}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={!addable}
                  tabIndex={-1}
                  draggable={addable && placement === 'panel'}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(STEP_DRAG_TYPE, item.id);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(row)}
                  onKeyDown={() => undefined}
                  data-testid="picker-item"
                  data-item-id={item.id}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md border-2 px-2 py-2 text-left',
                    addable ? 'cursor-pointer' : 'cursor-not-allowed',
                    'border-transparent text-ink',
                    isActive ? 'bg-primary' : '',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center',
                      addable ? '' : 'opacity-50',
                    )}
                  >
                    <StepGlyph icon={item.icon} className="h-7 w-7" />
                  </span>
                  <span
                    className={cn(
                      'flex min-w-0 flex-1 flex-col gap-0.5',
                      addable ? '' : 'opacity-70',
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="type-ui text-sm">{item.title}</span>
                      {item.state === 'comingSoon' ? (
                        <Badge variant="outline">Coming Soon</Badge>
                      ) : null}
                      {item.state === 'needsConnection' ? (
                        <Badge variant="secondary">Needs Connection</Badge>
                      ) : null}
                    </span>
                    <span className="font-sans text-xs type-muted">
                      {item.blocked ?? item.description}
                    </span>
                    {item.fixHref === 'channels' ? (
                      <Link
                        href={`/${orgId}/channels`}
                        className="font-sans text-xs underline underline-offset-2"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Go To Channels
                      </Link>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
          {rows.length === 0 ? (
            <div role="presentation" className="px-2 py-4 font-sans text-sm text-ink type-muted">
              No steps match that search.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
