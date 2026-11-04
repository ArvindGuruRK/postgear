'use client';

/**
 * How the step editor shows data (blueprint 5.2, n8n's schema, table and JSON
 * views, 2026-11-03: rebuilt so a person can read it). **Data** is a tree: what
 * kind of thing each field is, its name and its value, and in the Input pane the
 * name is a chip to drag into a field or click to insert at the last field used.
 * **Table** is for scanning: values in words, wrapped not cut, and a list of
 * records as real columns. **Raw** is the data as written (read only; the one
 * place braces appear).
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import type { DataField, FieldType } from '@postgear/automation';
import {
  Button,
  cn,
  MotionIcon,
  Segmented,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TooltipHint,
  toast,
} from '@postgear/ui';
import {
  Calendar,
  ChevronRight,
  Hash,
  Image,
  Layers,
  Link,
  List,
  type LucideIcon,
  ToggleLeft,
  Type,
} from 'lucide-react';
import { type DragEvent, type ReactNode, useState } from 'react';
import { DATA_DRAG_MIME } from '../fields/contract';
import {
  childrenOf,
  humanValue,
  isEmptyValue,
  type RecordTable,
  recordTable,
} from './panel-view-model';
import { type RawToken, type RawTokenKind, rawFileName, rawLines } from './raw-lines';

export type DataViewKind = 'data' | 'table' | 'raw';

/** Depth 0 keeps the cell's own padding, so it lines up with the header above it. */
const INDENT = ['ps-3', 'ps-7', 'ps-11', 'ps-15'];

const TYPE_ICONS: Record<FieldType, LucideIcon> = {
  text: Type,
  number: Hash,
  boolean: ToggleLeft,
  date: Calendar,
  list: List,
  object: Layers,
  media: Image,
};

const TYPE_WORDS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes or no',
  date: 'Date',
  list: 'List',
  object: 'Group',
  media: 'Media',
};

const LINK = /^https?:\/\//;

const VIEWS = [
  { value: 'data', label: 'Data' },
  { value: 'table', label: 'Table' },
  { value: 'raw', label: 'Raw' },
] as const;

export interface DataRowActions {
  /** Click to map: inserts this path at the last field used. */
  onInsert?: (path: string, label: string) => void;
  /** Drag to map: rows carry the token path under `DATA_DRAG_MIME`. */
  draggable?: boolean;
}

function startDrag(event: DragEvent<HTMLElement>, path: string) {
  event.dataTransfer.setData(DATA_DRAG_MIME, path);
  event.dataTransfer.effectAllowed = 'copy';
}

/** The full value on hover, where the row has room for only part of it. */
function fullValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function Chevron({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      aria-expanded={open}
      onClick={onToggle}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink outline-none hover:bg-primary focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          'h-4 w-4 transition-transform motion-reduce:transition-none',
          open ? 'rotate-90' : '',
        )}
        strokeWidth={2.5}
      />
    </button>
  );
}

/** Top-level rows keep the chevron's column only if one of them has a chevron; children always do. */
function hasChevrons(fields: readonly DataField[]): boolean {
  return fields.some((field) => childrenOf(field).length > 0);
}

function TreeRow({
  field,
  depth,
  gutter,
  actions,
}: {
  field: DataField;
  depth: number;
  gutter: boolean;
  actions: DataRowActions;
}) {
  const [open, setOpen] = useState(depth === 0);
  const children = childrenOf(field);
  const hasChildren = children.length > 0;
  const isLink = typeof field.sample === 'string' && LINK.test(field.sample);
  const Icon = isLink ? Link : TYPE_ICONS[field.type];
  return (
    <li>
      <div className="flex min-h-9 min-w-0 items-center gap-2">
        {hasChildren ? (
          <Chevron open={open} label={field.label} onToggle={() => setOpen((value) => !value)} />
        ) : gutter ? (
          <span aria-hidden="true" className="w-6 shrink-0" />
        ) : null}
        <span title={isLink ? 'Link' : TYPE_WORDS[field.type]} className="flex shrink-0">
          <Icon aria-hidden="true" className="h-4 w-4 text-ink type-muted" strokeWidth={2.5} />
        </span>
        {actions.onInsert ? (
          <button
            type="button"
            draggable={actions.draggable}
            onDragStart={(event) => startDrag(event, field.path)}
            onClick={() => actions.onInsert?.(field.path, field.label)}
            data-data-path={field.path}
            aria-label={`Insert ${field.label}`}
            className="type-ui max-w-3/5 shrink-0 cursor-grab truncate rounded-md border-2 border-outline bg-secondary px-2 py-0.5 text-sm text-ink outline-none transition-colors hover:bg-primary focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing motion-reduce:transition-none"
          >
            {field.label}
          </button>
        ) : (
          <span className="type-ui max-w-3/5 shrink-0 truncate text-sm text-ink">
            {field.label}
          </span>
        )}
        <span
          title={fullValue(field.sample)}
          className="min-w-0 truncate font-sans text-sm text-ink type-muted"
        >
          {humanValue(field.sample)}
        </span>
      </div>
      {hasChildren && open ? (
        // A guide under the chevron, so what belongs to what reads at a glance.
        <ul className="ms-2.75 border-s-2 border-outline ps-2">
          {children.map((child) => (
            <TreeRow
              key={child.path}
              field={child}
              depth={depth + 1}
              gutter
              actions={actions}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function DataTree({
  fields,
  actions = {},
  label,
}: {
  fields: readonly DataField[];
  actions?: DataRowActions;
  label: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col">
      {fields.map((field) => (
        <TreeRow
          key={field.path}
          field={field}
          depth={0}
          gutter={hasChevrons(fields)}
          actions={actions}
        />
      ))}
    </ul>
  );
}

function ValueWords({ value }: { value: unknown }) {
  return (
    <span
      title={fullValue(value)}
      className={cn('line-clamp-3 break-words', isEmptyValue(value) ? 'type-muted' : '')}
    >
      {humanValue(value)}
    </span>
  );
}

/** A list of records: one row per item, one column per field, scrolling sideways on its own. */
function RecordsTable({ table, label }: { table: RecordTable; label: string }) {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 px-3">Item</TableHead>
          {table.columns.map((column) => (
            <TableHead key={column.key} className="h-9 px-3 whitespace-nowrap">
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, index) => (
          <TableRow key={row.path}>
            <TableCell className="px-3 py-2 align-top">{index + 1}</TableCell>
            {table.columns.map((column) => (
              <TableCell key={column.key} className="max-w-64 min-w-32 px-3 py-2 align-top">
                <ValueWords value={row.cells[column.key]} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FieldRows({
  field,
  depth,
  actions,
}: {
  field: DataField;
  depth: number;
  actions: DataRowActions;
}) {
  const [open, setOpen] = useState(depth === 0);
  const children = childrenOf(field);
  const hasChildren = children.length > 0;
  const records = open && hasChildren ? recordTable(children) : null;
  return (
    <>
      <TableRow
        draggable={actions.draggable && Boolean(actions.onInsert)}
        onDragStart={(event) => startDrag(event, field.path)}
      >
        <TableCell className={cn('w-2/5 py-2 pe-3 align-top', INDENT[Math.min(depth, 3)])}>
          {/* The chevron comes after the name, so every name starts on the same edge. */}
          <span className="flex min-h-5 items-start gap-1">
            {actions.onInsert ? (
              <button
                type="button"
                onClick={() => actions.onInsert?.(field.path, field.label)}
                aria-label={`Insert ${field.label}`}
                className="type-ui min-w-0 cursor-grab break-words rounded-sm text-left outline-none hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
              >
                {field.label}
              </button>
            ) : (
              <span className="type-ui min-w-0 break-words">{field.label}</span>
            )}
            {hasChildren ? (
              <span className="-my-0.5">
                <Chevron
                  open={open}
                  label={field.label}
                  onToggle={() => setOpen((value) => !value)}
                />
              </span>
            ) : null}
          </span>
        </TableCell>
        <TableCell className="px-3 py-2 align-top">
          <ValueWords value={field.sample} />
        </TableCell>
      </TableRow>
      {records ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={2} className="p-3">
            <RecordsTable table={records} label={field.label} />
          </TableCell>
        </TableRow>
      ) : open ? (
        children.map((child) => (
          <FieldRows key={child.path} field={child} depth={depth + 1} actions={actions} />
        ))
      ) : null}
    </>
  );
}

export function DataTable({
  fields,
  actions = {},
  label,
}: {
  fields: readonly DataField[];
  actions?: DataRowActions;
  label: string;
}) {
  const records = recordTable(fields);
  if (records) return <RecordsTable table={records} label={label} />;
  return (
    <Table aria-label={label} className="table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 w-2/5 px-3">Field</TableHead>
          <TableHead className="h-9 px-3">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fields.map((field) => (
          <FieldRows key={field.path} field={field} depth={0} actions={actions} />
        ))}
      </TableBody>
    </Table>
  );
}

const TOKEN_COLOURS: Record<RawTokenKind, string> = {
  key: 'text-codeKey',
  string: 'text-codeString',
  number: 'text-codeNumber',
  literal: 'text-codeKeyword',
  null: 'text-codeKeyword',
  punctuation: 'text-codePunctuation',
  bracket: '',
};

/** VS Code's bracket pair colours, turn and turn about as they nest. */
const BRACKET_COLOURS = ['text-codeBracket1', 'text-codeBracket2', 'text-codeBracket3'];

function tokenColour(token: RawToken): string {
  return token.kind === 'bracket'
    ? BRACKET_COLOURS[(token.depth ?? 0) % BRACKET_COLOURS.length]
    : TOKEN_COLOURS[token.kind];
}

export function RawView({ text, label }: { text: string; label: string }) {
  function copy() {
    navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: 'Data copied' }))
      .catch(() => toast({ title: 'The browser did not allow copying.', variant: 'danger' }));
  }
  const lines = rawLines(text);
  return (
    <section
      aria-label={label}
      className="flex min-h-0 flex-col overflow-hidden rounded-md border-2 border-outline bg-inset"
    >
      {/* An editor's tab strip, ruled off from the code under it. */}
      <div className="flex h-9 shrink-0 items-stretch justify-between gap-2 border-b-2 border-outline bg-secondary pe-1">
        <span
          className="flex min-w-0 items-center gap-2 border-e-2 border-outline bg-inset px-3 font-mono text-xs text-codePunctuation"
          title={rawFileName(label)}
        >
          <span aria-hidden="true" className="shrink-0 font-bold text-codeBracket1">
            {'{ }'}
          </span>
          <span className="truncate">{rawFileName(label)}</span>
        </span>
        {lines.length > 0 ? (
          <span className="flex shrink-0 items-center">
            <TooltipHint label="Copy Data" side="left">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 px-0"
                aria-label="Copy Data"
                onClick={copy}
              >
                <MotionIcon icon={CopyIcon} className="h-4 w-4" />
              </Button>
            </TooltipHint>
          </span>
        ) : null}
      </div>
      <div className="min-h-0 overflow-y-auto py-2 font-mono text-xs leading-5 pg-scrollbar">
        {lines.length === 0 ? (
          <p className="px-3 font-sans text-sm text-ink type-muted">Empty</p>
        ) : (
          lines.map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one fixed text, never reordered
            <div key={index} className="flex">
              <span
                aria-hidden="true"
                className="w-10 shrink-0 pe-3 text-right text-codeLineNumber select-none"
              >
                {index + 1}
              </span>
              {/* Padding, not spaces, so a long value wraps under its own indent. */}
              <code
                className="relative min-w-0 flex-1 pe-3 break-words whitespace-pre-wrap"
                style={{ paddingInlineStart: `${line.level}rem` }}
              >
                {Array.from({ length: line.level }, (_, level) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: one guide per level, never reordered
                    key={level}
                    aria-hidden="true"
                    className="absolute inset-y-0 border-s border-codeGuide"
                    style={{ insetInlineStart: `${level + 0.25}rem` }}
                  />
                ))}
                {line.tokens.map((token, at) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: pieces of one fixed line
                  <span key={at} className={tokenColour(token)}>
                    {token.text}
                  </span>
                ))}
              </code>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/**
 * The Data, Table and Raw switch over one set of data: where the data comes from
 * or how the test went on the left of its row, then a notice if there is one,
 * then the view.
 */
export function DataViews({
  view,
  onViewChange,
  meta,
  notice,
  data,
  table,
  raw,
}: {
  view: DataViewKind;
  onViewChange: (view: DataViewKind) => void;
  meta?: ReactNode;
  notice?: ReactNode;
  data: ReactNode;
  table: ReactNode;
  raw: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">{meta}</div>
        <Segmented
          tight
          label="Show data as"
          className="shrink-0 flex-nowrap self-center"
          options={VIEWS}
          value={view}
          onValueChange={onViewChange}
        />
      </div>
      {notice}
      <div className="min-h-0 flex-1 overflow-y-auto pg-scrollbar">
        {view === 'data' ? data : view === 'table' ? table : raw}
      </div>
    </div>
  );
}
