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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsList,
  TabsTrigger,
  Text,
  toast,
} from '@postgear/ui';
import { useEffect, useMemo, useState } from 'react';
import { AppIcon } from '../app-icon';
import type { DataSource } from '../fields/contract';
import { insertDataAtLastField } from '../fields/insert-target';
import { DataTable, DataTree, type DataViewKind, DataViews, RawView } from './data-view';
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

export function InputPane({
  graph,
  node,
  scope,
  scopeSource,
  insert = insertDataAtLastField,
  runInput = null,
}: {
  graph: AutomationGraph;
  node: GraphNode;
  scope: RunScope;
  scopeSource: Readonly<Record<string, DataSource>>;
  /** Click to map; the field kit's by default (tests pass their own). */
  insert?: (tokenPath: string) => boolean;
  /** Opened from a result badge: what the step got in that run. */
  runInput?: StepRunResult | null;
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
    if (!insert(path)) toast({ title: CLICK_A_FIELD_FIRST });
  }

  let body: React.ReactNode;
  if (runInput && mode === 'run') {
    const label = `${node.name} input in this run`;
    const fields = valueTree(runInput.step.input, []);
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{sourceLabel({ kind: 'lastTest', at: runInput.at })}</Badge>
        </div>
        {runInput.step.input === null || runInput.step.input === undefined ? (
          <Text size="sm">This step got no data in this run.</Text>
        ) : fields.length === 0 ? (
          <RawView text={rawText(runInput.step.input)} label={label} />
        ) : (
          <DataViews
            view={runView}
            onViewChange={setRunView}
            data={<DataTree fields={fields} label={label} />}
            table={<DataTable fields={fields} label={label} />}
            raw={<RawView text={rawText(runInput.step.input)} label={label} />}
          />
        )}
      </>
    );
  } else if (isTriggerType(node.type)) {
    body = <Text size="sm">{INPUT_TRIGGER}</Text>;
  } else if (steps.length === 0 || !group) {
    body = <Text size="sm">{INPUT_NOTHING_UPSTREAM}</Text>;
  } else {
    const source = group.nodeKey ? scopeSource[group.nodeKey] : undefined;
    const label = `${group.title} data`;
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={group.source} onValueChange={setChosen}>
            <SelectTrigger aria-label="Data from" className="h-9 min-w-0 flex-1">
              <SelectValue className="min-w-0 flex-1 overflow-hidden text-left" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((option) => (
                <SelectItem key={option.source} value={option.source}>
                  {/* One line in the trigger: a long step name is cut, not wrapped. */}
                  <span className="flex min-w-0 items-center gap-2 text-left">
                    <AppIcon icon={option.icon} className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">From: {option.title}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {group.nodeKey ? <Badge variant="outline">{sourceLabel(source)}</Badge> : null}
        </div>
        {group.note ? (
          <Text size="sm" muted>
            {group.note}
          </Text>
        ) : null}
        <DataViews
          view={view}
          onViewChange={setView}
          data={
            <DataTree fields={group.fields} label={label} actions={{ onInsert, draggable: true }} />
          }
          table={
            <DataTable
              fields={group.fields}
              label={label}
              actions={{ onInsert, draggable: true }}
            />
          }
          raw={<RawView text={rawText(groupData(scope, group))} label={label} />}
        />
        <Text size="sm" muted>
          Drag a field into the settings, or click it to add it where you last typed.
        </Text>
      </>
    );
  }

  return (
    <section aria-label="Input" className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="type-heading text-base text-ink">Input</h3>
        {runInput ? (
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'run' | 'data')}>
            <TabsList>
              <TabsTrigger value="run">This Run</TabsTrigger>
              <TabsTrigger value="data">Available Data</TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
      </div>
      {body}
    </section>
  );
}
