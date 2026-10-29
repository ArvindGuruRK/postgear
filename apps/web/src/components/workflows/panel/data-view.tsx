'use client';

/**
 * How the Expanded view shows data (blueprint 5.2, n8n's schema, table and
 * JSON views): **Data** is a tree of labels and values, **Table** is one
 * row per field, **Raw** is the data as written (read only; the one place
 * braces appear). In the Input pane rows can be dragged into a field that
 * takes data, or clicked to insert at the last field used.
 */
import type { DataField } from '@postgear/automation';
import { cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@postgear/ui';
import { ChevronRight } from 'lucide-react';
import { type DragEvent, type ReactNode, useState } from 'react';
import { DATA_DRAG_MIME } from '../fields/contract';
import { flattenFields, valueWords } from './panel-view-model';

export type DataViewKind = 'data' | 'table' | 'raw';

const INDENT = ['ps-0', 'ps-4', 'ps-8', 'ps-12'];

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

function RowBody({ label, value }: { label: string; value: unknown }) {
  return (
    <>
      <span className="type-ui shrink-0 truncate text-xs text-ink">{label}</span>
      <span className="min-w-0 truncate font-sans text-xs text-ink type-muted">
        {valueWords(value)}
      </span>
    </>
  );
}

function TreeRow({
  field,
  depth,
  actions,
}: {
  field: DataField;
  depth: number;
  actions: DataRowActions;
}) {
  const [open, setOpen] = useState(depth === 0);
  const hasChildren = field.children.length > 0;
  const rowClass =
    'flex min-w-0 flex-1 items-center gap-2 rounded-md border-2 border-transparent px-1.5 py-1 text-left outline-none';
  return (
    <li>
      <div className={cn('flex items-center gap-1', INDENT[Math.min(depth, 3)])}>
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Hide ${field.label}` : `Show ${field.label}`}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink outline-none hover:bg-actionSecondary hover:text-onActionLight focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('h-3.5 w-3.5 transition-transform', open ? 'rotate-90' : '')}
              strokeWidth={2.5}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="w-6 shrink-0" />
        )}
        {actions.onInsert ? (
          <button
            type="button"
            draggable={actions.draggable}
            onDragStart={(event) => startDrag(event, field.path)}
            onClick={() => actions.onInsert?.(field.path, field.label)}
            data-data-path={field.path}
            aria-label={`Insert ${field.label}`}
            className={cn(
              rowClass,
              'cursor-grab hover:border-outline focus-visible:border-outline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing',
            )}
          >
            <RowBody label={field.label} value={field.sample} />
          </button>
        ) : (
          <div className={rowClass}>
            <RowBody label={field.label} value={field.sample} />
          </div>
        )}
      </div>
      {hasChildren && open ? (
        <ul>
          {field.children.map((child) => (
            <TreeRow key={child.path} field={child} depth={depth + 1} actions={actions} />
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
    <ul aria-label={label} className="flex flex-col gap-0.5">
      {fields.map((field) => (
        <TreeRow key={field.path} field={field} depth={0} actions={actions} />
      ))}
    </ul>
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
  const rows = flattenFields(fields);
  return (
    <div className="overflow-x-auto rounded-md border-2 border-outline">
      <table aria-label={label} className="w-full border-collapse font-sans text-xs text-ink">
        <thead className="bg-inset">
          <tr>
            <th className="type-ui border-b-2 border-outline px-2 py-1.5 text-left">Field</th>
            <th className="type-ui border-b-2 border-outline px-2 py-1.5 text-left">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.path}
              draggable={actions.draggable && Boolean(actions.onInsert)}
              onDragStart={(event) => startDrag(event, row.path)}
              className="border-b-2 border-outline last:border-b-0"
            >
              <td className={cn('px-2 py-1', INDENT[Math.min(row.depth, 3)])}>
                {actions.onInsert ? (
                  <button
                    type="button"
                    onClick={() => actions.onInsert?.(row.path, row.label)}
                    aria-label={`Insert ${row.label}`}
                    className="type-ui rounded-sm text-left outline-none hover:underline focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-focusRing"
                  >
                    {row.label}
                  </button>
                ) : (
                  <span className="type-ui">{row.label}</span>
                )}
              </td>
              <td className="max-w-48 truncate px-2 py-1 type-muted">{valueWords(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RawView({ text, label }: { text: string; label: string }) {
  return (
    <section aria-label={label} className="flex min-h-0 flex-col">
      <pre className="max-h-full overflow-auto whitespace-pre-wrap break-all rounded-md border-2 border-outline bg-inset p-3 font-sans text-xs text-ink">
        {text || 'Empty'}
      </pre>
    </section>
  );
}

/** The Data, Table and Raw switch over one set of data. */
export function DataViews({
  view,
  onViewChange,
  data,
  table,
  raw,
}: {
  view: DataViewKind;
  onViewChange: (view: DataViewKind) => void;
  data: ReactNode;
  table: ReactNode;
  raw: ReactNode;
}) {
  return (
    <Tabs
      value={view}
      onValueChange={(value) => onViewChange(value as DataViewKind)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <TabsList className="self-start">
        <TabsTrigger value="data">Data</TabsTrigger>
        <TabsTrigger value="table">Table</TabsTrigger>
        <TabsTrigger value="raw">Raw</TabsTrigger>
      </TabsList>
      <TabsContent value="data" className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {data}
      </TabsContent>
      <TabsContent value="table" className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {table}
      </TabsContent>
      <TabsContent value="raw" className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {raw}
      </TabsContent>
    </Tabs>
  );
}
