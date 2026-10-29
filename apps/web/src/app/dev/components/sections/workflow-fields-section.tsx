'use client';

/**
 * The step form's field kit (Sprint 10, Module 06) on real steps: the
 * Publishing Report template with a few more steps after its trigger, the
 * built-in sample data, and live checks from the package's own
 * validation. Each specimen prints the config it stores, so a round trip
 * can be checked by eye.
 */
import {
  type AutomationGraph,
  type FormTab,
  type GraphNode,
  getDefinition,
  getTemplate,
  instantiateTemplate,
  type NodeDefinition,
  sampleScope,
  validateGraph,
} from '@postgear/automation';
import { useMemo, useState } from 'react';
import { ChipInput } from '@/components/workflows/fields/chip-input';
import type { FieldContext } from '@/components/workflows/fields/contract';
import { setAtPath } from '@/components/workflows/fields/form-model';
import { InsertDataList } from '@/components/workflows/fields/insert-data';
import { SchemaForm } from '@/components/workflows/fields/schema-form';
import { Row, Section, Spec } from '../shared';

const EXTRA: { key: string; type: string; config?: Record<string, unknown> }[] = [
  { key: 'kshowfilter', type: 'logic.filter' },
  { key: 'kshowpaths', type: 'logic.switch' },
  { key: 'kshowdelay', type: 'logic.delay' },
  { key: 'kshowmanual', type: 'trigger.manual' },
  { key: 'kshowsched', type: 'trigger.schedule' },
  { key: 'kshowwrite', type: 'ai.generateText' },
];

/** Publishing Report, then the extra steps chained after Slack. */
function demoGraph(): AutomationGraph {
  let n = 0;
  const template = getTemplate('publishing-report') as NonNullable<ReturnType<typeof getTemplate>>;
  const graph = instantiateTemplate(template, () => `kdemo${(n++).toString().padStart(5, '0')}`, {
    timeZone: 'UTC',
  });
  let last = graph.nodes[graph.nodes.length - 1].key;
  const nodes: GraphNode[] = [...graph.nodes];
  const edges = [...graph.edges];
  EXTRA.forEach((extra, i) => {
    const definition = getDefinition(extra.type) as NodeDefinition;
    nodes.push({
      key: extra.key,
      type: extra.type,
      typeVersion: definition.typeVersion,
      name: definition.title,
      position: { x: 0, y: 600 + i * 200 },
      config:
        extra.config ??
        (JSON.parse(JSON.stringify(definition.defaultConfig)) as Record<string, unknown>),
    });
    if (extra.type.startsWith('trigger.')) return;
    edges.push({ ...graph.edges[0], id: `edemo-${i}`, source: last, target: extra.key });
    last = extra.key;
  });
  return { ...graph, nodes, edges };
}

function useDemo() {
  const [graph, setGraph] = useState(demoGraph);
  const issues = useMemo(() => validateGraph(graph), [graph]);
  const context = useMemo<FieldContext>(
    () => ({
      orgId: 'seed-demo-org',
      automationId: 'demo',
      connections: [],
      channels: [],
      canManage: true,
      scope: sampleScope(graph),
      scopeSource: {},
      timeZone: 'Asia/Kolkata',
    }),
    [graph],
  );
  const update = (key: string, path: string, value: unknown) =>
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.key === key ? { ...node, config: setAtPath(node.config, path, value) } : node,
      ),
    }));
  return { graph, issues, context, update };
}

function StepDemo({
  demo,
  match,
  tab = 'configure',
}: {
  demo: ReturnType<typeof useDemo>;
  match: (node: GraphNode) => boolean;
  tab?: FormTab;
}) {
  const node = demo.graph.nodes.find(match);
  const definition = node ? getDefinition(node.type) : undefined;
  if (!node || !definition) return null;
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="rounded-lg border-2 border-outline bg-secondary p-4">
        <SchemaForm
          definition={definition}
          node={node}
          graph={demo.graph}
          tab={tab}
          issues={demo.issues.filter((issue) => issue.nodeKey === node.key)}
          context={demo.context}
          onChange={(path, value) => demo.update(node.key, path, value)}
        />
      </div>
      <Spec>{JSON.stringify(node.config)}</Spec>
    </div>
  );
}

export function WorkflowFieldsSection() {
  const demo = useDemo();
  const slack = demo.graph.nodes.find((node) => node.type === 'notify.slack') as GraphNode;
  const [lone, setLone] = useState(
    'Hi {{ nodes.gone00001.output.text }} and {{ trigger.post.url }}',
  );

  return (
    <Section
      title="Workflow Fields"
      description="The step form's controls on the Publishing Report template, with sample data and live checks. Each one prints what it stores."
    >
      <Row label="Slack message with data chips (type / or { to insert data)">
        <StepDemo demo={demo} match={(node) => node.type === 'notify.slack'} />
      </Row>
      <Row label="A chip whose step was removed turns red">
        <div className="flex w-full max-w-xl flex-col gap-3">
          <ChipInput
            value={lone}
            onChange={setLone}
            label="Message"
            fieldPath="message"
            graph={demo.graph}
            nodeKey={slack.key}
            scope={demo.context.scope}
          />
          <Spec>{lone}</Spec>
        </div>
      </Row>
      <Row label="Insert Data for the Slack step">
        <div className="w-80 rounded-lg border-2 border-outline bg-secondary p-3">
          <InsertDataList
            graph={demo.graph}
            nodeKey={slack.key}
            scope={demo.context.scope}
            autoFocus={false}
            onPick={() => undefined}
          />
        </div>
      </Row>
      <Row label="Condition builder (Filter)">
        <StepDemo demo={demo} match={(node) => node.type === 'logic.filter'} />
      </Row>
      <Row label="Paths">
        <StepDemo demo={demo} match={(node) => node.type === 'logic.switch'} />
      </Row>
      <Row label="Schedule builder">
        <StepDemo demo={demo} match={(node) => node.type === 'trigger.schedule'} />
      </Row>
      <Row label="Set Fields rows">
        <StepDemo demo={demo} match={(node) => node.type === 'logic.setFields'} />
      </Row>
      <Row label="Delay">
        <StepDemo demo={demo} match={(node) => node.type === 'logic.delay'} />
      </Row>
      <Row label="Manual trigger inputs">
        <StepDemo demo={demo} match={(node) => node.type === 'trigger.manual'} />
      </Row>
      <Row label="Generate Text, with its credits line">
        <StepDemo demo={demo} match={(node) => node.type === 'ai.generateText'} />
      </Row>
    </Section>
  );
}
