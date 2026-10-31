'use client';

import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
/**
 * Insert Data (blueprint 5.3, Zapier style): the data this step can use,
 * grouped by where it comes from: the trigger first, then the steps before
 * this one in run order, then the run and the workspace. Each field shows
 * its sample value; nested fields open as a tree (3 levels, Module 02's
 * `availableData`). Searching looks at labels and samples. Data from a
 * branch that might not run says "May Be Empty"; a turned-off step's rows
 * are greyed.
 *
 * `InsertDataList` is the panel itself (also what drag targets reuse);
 * `InsertDataPopover` puts it in a popover, from the Insert Data button or
 * at the caret when someone types `/` or `{` in a field.
 */
import { DatabaseIcon } from '@animateicons/react/lucide/database-icon';
import {
  type AutomationGraph,
  availableData,
  type DataField,
  type DataGroup,
  type FieldType,
  humanise,
  type RunScope,
  toText,
} from '@postgear/automation';
import {
  Badge,
  Button,
  cn,
  Input,
  MotionIcon,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  Text,
} from '@postgear/ui';
import {
  Braces,
  Calendar,
  Hash,
  Image,
  List,
  type LucideIcon,
  ToggleLeft,
  Type,
} from 'lucide-react';
import {
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppIcon } from '../app-icon';
import { fieldSample } from './chip-model';
import { DATA_DRAG_MIME } from './contract';

const TYPE_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  list: List,
  object: Braces,
  media: Image,
};

const TYPE_WORDS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes or no',
  date: 'Date',
  list: 'List',
  object: 'Group of fields',
  media: 'Media',
};

export const NOTHING_UPSTREAM = 'Connect this step after another step to use its data.';

function matches(field: DataField, query: string): boolean {
  if (field.label.toLowerCase().includes(query)) return true;
  return field.sample !== undefined && toText(field.sample).toLowerCase().includes(query);
}

/** The fields (and their parents) that match `query`; everything when it is empty. */
export function filterFields(fields: readonly DataField[], query: string): DataField[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...fields];
  return fields.flatMap((field) => {
    const children = filterFields(field.children, q);
    if (matches(field, q)) return [{ ...field, children: field.children }];
    return children.length ? [{ ...field, children }] : [];
  });
}

// Insert Data shows 3 levels (as `availableData` does); keys a token path can hold.
const SHOWN_LEVELS = 3;
const TOKEN_KEY = /^[A-Za-z0-9_-]+$/;
const MAX_SAMPLE_FIELDS = 30;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOfSample(value: unknown): FieldType {
  if (Array.isArray(value)) return 'list';
  if (isPlainObject(value)) return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}

/**
 * An open group of fields (declared with no fields of its own) listed from
 * its sample: an "All ..." row that inserts the whole group, then one row
 * per key of the sample.
 */
function openField(field: DataField, level: number): DataField {
  if (field.children.length > 0 || field.type !== 'object' || !isPlainObject(field.sample)) {
    return field;
  }
  if (level >= SHOWN_LEVELS) return field;
  const children = Object.entries(field.sample)
    .filter(([key]) => TOKEN_KEY.test(key))
    .slice(0, MAX_SAMPLE_FIELDS)
    .map(([key, value]) =>
      openField(
        {
          path: `${field.path}.${key}`,
          label: humanise(key),
          type: typeOfSample(value),
          sample: value,
          children: [],
        },
        level + 1,
      ),
    );
  if (children.length === 0) return field;
  const whole: DataField = { ...field, label: `All ${field.label}`, children: [] };
  return { ...field, children: [whole, ...children] };
}

function openFields(fields: readonly DataField[], level: number): DataField[] {
  return fields.map((field) =>
    field.children.length > 0
      ? { ...field, children: openFields(field.children, level + 1) }
      : openField(field, level),
  );
}

/**
 * The trigger's open groups of fields list the fields of their sample, so a
 * Webhook's Received Data offers the fields of the last data it received
 * (Module 13), or of the built-in sample until something arrives.
 */
export function withSampleFields(groups: readonly DataGroup[]): DataGroup[] {
  return groups.map((group) =>
    group.source === 'trigger' ? { ...group, fields: openFields(group.fields, 1) } : group,
  );
}

/** The groups Insert Data shows for a search, without groups that have nothing left. */
export function filterGroups(groups: readonly DataGroup[], query: string): DataGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  return groups.flatMap((group) => {
    if (group.title.toLowerCase().includes(q)) return [group];
    const fields = filterFields(group.fields, q);
    return fields.length ? [{ ...group, fields }] : [];
  });
}

export interface InsertDataListProps {
  graph: AutomationGraph;
  /** The step the data goes into: only steps before it are listed. */
  nodeKey: string;
  /** Sample values from pinned data or the last test; built-in samples when left out. */
  scope?: RunScope;
  /** A field was chosen: its token path. */
  onPick: (tokenPath: string) => void;
  /** The search box takes focus when the list opens. */
  autoFocus?: boolean;
}

export function InsertDataList({
  graph,
  nodeKey,
  scope,
  onPick,
  autoFocus = true,
}: InsertDataListProps) {
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () => withSampleFields(availableData(graph, nodeKey, { scope })),
    [graph, nodeKey, scope],
  );
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const stepGroups = groups.filter(
    (group) => group.source !== 'run' && group.source !== 'workspace',
  );

  function moveFocus(event: KeyboardEvent, from: HTMLElement | null) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-insert-row]') ?? [],
    );
    if (rows.length === 0) return;
    event.preventDefault();
    const at = from ? rows.indexOf(from) : -1;
    const next =
      event.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at - 1);
    rows[next]?.focus();
  }

  return (
    <div className="flex min-h-0 flex-col gap-3" data-testid="insert-data">
      <Input
        autoFocus={autoFocus}
        size="sm"
        value={query}
        aria-label="Search data"
        placeholder="Enter your search"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => moveFocus(event, null)}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys walk the rows inside */}
      <div
        ref={listRef}
        className="flex max-h-80 min-h-0 flex-col gap-3 overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
        onKeyDown={(event) => moveFocus(event, event.target as HTMLElement)}
      >
        {stepGroups.length === 0 ? (
          <Text size="sm" muted>
            {NOTHING_UPSTREAM}
          </Text>
        ) : null}
        {shown.length === 0 ? (
          <Text size="sm" muted>
            No data matches your search.
          </Text>
        ) : (
          shown.map((group) => (
            <GroupBlock
              key={group.source}
              group={group}
              searching={query.trim() !== ''}
              onPick={onPick}
            />
          ))
        )}
      </div>
    </div>
  );
}

function GroupBlock({
  group,
  searching,
  onPick,
}: {
  group: DataGroup;
  searching: boolean;
  onPick: (path: string) => void;
}) {
  return (
    <section
      aria-label={group.title}
      data-group={group.source}
      className={cn('flex flex-col gap-1', group.turnedOff && 'opacity-50')}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-secondary">
          <AppIcon icon={group.icon} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate type-ui text-sm text-ink">{group.title}</span>
        {group.maybeEmpty ? <Badge variant="accent">May Be Empty</Badge> : null}
      </div>
      {group.turnedOff ? (
        <Text size="xs" muted>
          This step is turned off.
        </Text>
      ) : null}
      <ul className="m-0 flex list-none flex-col p-0">
        {group.fields.map((field) => (
          <FieldRow
            key={field.path}
            field={field}
            depth={0}
            searching={searching}
            turnedOff={group.turnedOff === true}
            onPick={onPick}
          />
        ))}
      </ul>
    </section>
  );
}

function FieldRow({
  field,
  depth,
  searching,
  turnedOff,
  onPick,
}: {
  field: DataField;
  depth: number;
  searching: boolean;
  turnedOff: boolean;
  onPick: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const branch = field.children.length > 0;
  const open = branch && (expanded || searching);
  const Icon = TYPE_ICONS[field.type] ?? Type;
  const sample = fieldSample(field);

  return (
    <li>
      <button
        type="button"
        data-insert-row=""
        data-path={field.path}
        aria-expanded={branch ? open : undefined}
        draggable={!branch}
        onDragStart={(event) => {
          event.dataTransfer.setData(DATA_DRAG_MIME, field.path);
          event.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => (branch ? setExpanded((current) => !current) : onPick(field.path))}
        title={turnedOff ? 'This step is turned off, so this data will be empty.' : undefined}
        className={cn(
          'flex w-full items-center gap-2 rounded-md py-1.5 pe-2 text-left font-sans text-sm text-ink',
          'outline-none hover:bg-actionPrimary/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing',
        )}
        style={{ paddingInlineStart: `${0.5 + depth * 1}rem` }}
      >
        {branch ? (
          <MotionIcon
            icon={ChevronRightIcon}
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
        ) : (
          <span className="w-3.5 shrink-0" aria-hidden="true" />
        )}
        <Icon
          aria-label={TYPE_WORDS[field.type]}
          role="img"
          className="h-3.5 w-3.5 shrink-0"
          strokeWidth={2.5}
        />
        <span className="shrink-0 font-bold">{field.label}</span>
        {sample !== undefined ? (
          <span className="min-w-0 truncate text-xs text-ink type-muted">{sample}</span>
        ) : null}
      </button>
      {open ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {field.children.map((child) => (
            <FieldRow
              key={child.path}
              field={child}
              depth={depth + 1}
              searching={searching}
              turnedOff={turnedOff}
              onPick={onPick}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Where a caret-anchored popover points: a rectangle in the viewport. */
export type AnchorRect = () => DOMRect;

export interface InsertDataPopoverProps extends Omit<InsertDataListProps, 'autoFocus'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The Insert Data button; left out when the popover opens at the caret. */
  trigger?: ReactNode;
  /** The caret's rectangle when opened by typing `/` or `{`. */
  anchor?: AnchorRect | null;
  /** Called when the popover closes, to give the field its focus back. */
  onCloseFocus?: () => void;
}

export function InsertDataPopover({
  open,
  onOpenChange,
  trigger,
  anchor,
  onCloseFocus,
  ...list
}: InsertDataPopoverProps) {
  const virtual = useMemo(
    () => (anchor ? { current: { getBoundingClientRect: anchor } } : null),
    [anchor],
  );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {virtual ? <PopoverAnchor virtualRef={virtual} /> : null}
      {trigger ? <PopoverTrigger asChild>{trigger}</PopoverTrigger> : null}
      <PopoverContent
        align="start"
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col p-3"
        aria-label="Insert data"
        onCloseAutoFocus={(event) => {
          if (onCloseFocus) {
            event.preventDefault();
            onCloseFocus();
          }
        }}
      >
        {open ? (
          <InsertDataList
            {...list}
            onPick={(path) => {
              list.onPick(path);
              onOpenChange(false);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The Insert Data button of a field, a secondary button with the data icon. */
export function InsertDataButton({
  iconOnly = false,
  className,
  ...props
}: ComponentProps<typeof Button> & { iconOnly?: boolean }) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn(iconOnly && 'h-7 w-7 px-0', className)}
      {...props}
    >
      <MotionIcon icon={DatabaseIcon} className="h-4 w-4" />
      {iconOnly ? <span className="sr-only">Insert Data</span> : 'Insert Data'}
    </Button>
  );
}
