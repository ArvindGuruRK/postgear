'use client';

/**
 * The Input pane (blueprint 5.2, n8n's input panel): the data this step
 * can use, from one earlier step at a time ("From: Post Published"), in
 * the Data, Table or Raw view, labelled with where it came from (Pinned,
 * Last Test 14:02 or Sample). Opened from a step's result badge (Module
 * 08), it first shows what the step got in that run (This Run).
 *
 * Drag to map: a row dragged onto a field that takes data drops a chip at
 * the drop caret (`DATA_DRAG_MIME`). Click to map: a click inserts it at
 * the last field used (`insertDataAtLastField`).
 */
import {
  type AutomationGraph,
  availableData,
  type GraphNode,
  isTriggerType,
  type RunScope,
} from '@postgear/automation';
import {
  Badge,
  EmptyState,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  toast,
} from '@postgear/ui';
import { FileInput } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { StepGlyph } from '../list/step-glyph';
import type { DataSource } from '../fields/contract';
import { insertDataAtLastField } from '../fields/insert-target';
import { DataTable, DataTree, type DataViewKind, DataViews, RawView } from './data-view';
import { PaneHeader } from './pane-header';
import {
  CLICK_A_FIELD_FIRST,
  groupData,
  INPUT_NOTHING_UPSTREAM,
  INPUT_TRIGGER,
  rawText,
  type StepRunResult,
  sourceLabel,
  valueTree,
} from './panel-view-model';

const MODES = [
  { value: 'run', label: 'This Run' },
  { value: 'data', label: 'Available Data' },
] as const;

export function InputPane({
  graph,
  node,
  scope,
  scopeSource,
  insert = insertDataAtLastField,
  runInput = null,
  connected,
}: {
  graph: AutomationGraph;
  node: GraphNode;
  scope: RunScope;
  scopeSource: Readonly<Record<string, DataSource>>;
  /** Click to map; the field kit's by default (tests pass their own). */
  insert?: (tokenPath: string) => boolean;
  /** Opened from a result badge: what the step got in that run. */
  runInput?: StepRunResult | null;
  /** The button to the step before this one, in the header. */
  connected?: ReactNode;
  /** Test Step in a trigger's empty state. */
}) {
  const [mode, setMode] = useState<'run' | 'data'>(runInput ? 'run' : 'data');
  const [runView, setRunView] = useState<DataViewKind>('data');
  const groups = useMemo(() => availableData(graph, node.key, { scope }), [graph, node.key, scope]);
  const steps = groups.filter((group) => group.nodeKey !== undefined);
  // The step right before this one, as n8n opens it.
  const fallback = steps.at(-1)?.source ?? groups[0]?.source ?? '';
  const [chosen, setChosen] = useState(fallback);
  const [view, setView] = useState<DataViewKind>('data');
  const group = groups.find((candidate) => candidate.source === chosen) ?? groups[0];

  // Walking to another step picks that step's nearest source again.
  useEffect(() => {
    setChosen(fallback);
  }, [fallback]);

  function onInsert(path: string) {
    if (!insert(path)) toast({ title: CLICK_A_FIELD_FIRST, variant: 'warning' });
  }

  let body: React.ReactNode;
  let footer: ReactNode = null;
  if (runInput && mode === 'run') {
    const label = `${node.name} input in this run`;
    const fields = valueTree(runInput.step.input, []);
    const meta = (
      <Badge variant="outline">{sourceLabel({ kind: 'lastTest', at: runInput.at })}</Badge>
    );
    body =
      runInput.step.input === null || runInput.step.input === undefined ? (
        <Text size="sm">This step got no data in this run.</Text>
      ) : fields.length === 0 ? (
        <RawView text={rawText(runInput.step.input)} label={label} />
      ) : (
        <DataViews
          meta={meta}
          view={runView}
          onViewChange={setRunView}
          data={<DataTree fields={fields} label={label} />}
          table={<DataTable fields={fields} label={label} />}
          raw={<RawView text={rawText(runInput.step.input)} label={label} />}
        />
      );
  } else if (isTriggerType(node.type)) {
    body = (
      <EmptyState
        icon={FileInput}
        title="No input data"
        description={INPUT_TRIGGER}
        className="flex-1 justify-start pt-24"
      />
    );
  } else if (steps.length === 0 || !group) {
    body = (
      <EmptyState
        icon={FileInput}
        title="No input data"
        description={INPUT_NOTHING_UPSTREAM}
        className="flex-1 justify-start pt-24"
      />
    );
  } else {
    const source = group.nodeKey ? scopeSource[group.nodeKey] : undefined;
    const label = `${group.title} data`;
    footer = (
      <footer className="flex shrink-0 items-center gap-2 border-t-2 border-outline px-4 py-2.5 font-sans text-xs text-ink">
        {group.nodeKey ? <span className="type-ui shrink-0">{sourceLabel(source)}</span> : null}
        <span
          className="min-w-0 truncate type-muted"
          title="Drag a field into the settings, or click it to insert it where you last typed."
        >
          Drag or click a field to insert it.
        </span>
      </footer>
    );
    body = (
      <DataViews
        view={view}
        onViewChange={setView}
        meta={
          <Select value={group.source} onValueChange={setChosen}>
            <SelectTrigger aria-label="Data from" className="h-9 min-w-0 flex-1 px-3">
              <span className="min-w-0 flex-1 overflow-hidden text-left">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {groups.map((option) => (
                <SelectItem key={option.source} value={option.source}>
                  {/* One line in the trigger: a long step name is cut, not wrapped. */}
                  <span className="flex min-w-0 items-center gap-2 text-left">
                    <StepGlyph icon={option.icon} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{option.title}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        notice={
          group.note ? (
            <Text size="sm" muted>
              {group.note}
            </Text>
          ) : null
        }
        data={
          <DataTree fields={group.fields} label={label} actions={{ onInsert, draggable: true }} />
        }
        table={
          <DataTable fields={group.fields} label={label} actions={{ onInsert, draggable: true }} />
        }
        raw={<RawView text={rawText(groupData(scope, group))} label={label} />}
      />
    );
  }

  return (
    <section aria-label="Input" className="flex min-h-0 flex-1 flex-col">
      <PaneHeader title={<h3 className="type-heading text-base text-ink">Input</h3>}>
        {connected}
      </PaneHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 pg-scrollbar">
        {runInput ? (
          <Segmented
            label="Which input"
            className="shrink-0"
            options={MODES}
            value={mode}
            onValueChange={setMode}
          />
        ) : null}
        {body}
      </div>
      {footer}
    </section>
  );
}
