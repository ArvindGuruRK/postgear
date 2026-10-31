'use client';

/**
 * The step form's field kit (Sprint 10, Module 06) on real steps: the
 * Publishing Report template with a few more steps after its trigger, the
 * built-in sample data, and live checks from the package's own
 * validation. Each specimen prints the config it stores, so a round trip
 * can be checked by eye.
 *
 * Modules 10 to 13 add the post, sheet, webhook and message steps: media
 * picks, channels for one platform, platform settings, time zones, the
 * Google Sheets fields (on a simulated Google connection), the webhook link
 * and the message previews. Controls that ask the API (sheets, the webhook
 * link, media thumbnails) show their failure state here, since this page
 * has no real workflow behind it.
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
import type { Channel } from '@/types/channel';
import type { Connection } from '@/types/workflows';
import { Row, Section, Spec } from '../shared';

const EXTRA: { key: string; type: string; config?: Record<string, unknown> }[] = [
  { key: 'kshowfilter', type: 'logic.filter' },
  { key: 'kshowpaths', type: 'logic.switch' },
  { key: 'kshowdelay', type: 'logic.delay' },
  { key: 'kshowmanual', type: 'trigger.manual' },
  { key: 'kshowsched', type: 'trigger.schedule' },
  { key: 'kshowwrite', type: 'ai.generateText' },
  {
    key: 'kshowdraft',
    type: 'postgear.createDraft',
    config: { channels: [], text: 'New post: {{ trigger.post.url }}', media: '', mediaIds: [] },
  },
  {
    key: 'kshowpublish',
    type: 'postgear.publish',
    config: { provider: 'youtube', channels: [], text: '', media: '', mediaIds: [] },
  },
  {
    key: 'kshowlinkedin',
    type: 'postgear.publish',
    config: { provider: 'linkedin', channels: [], text: '', media: '', mediaIds: [] },
  },
  { key: 'kshowqueue', type: 'postgear.addToQueue' },
  {
    key: 'kshowsheet',
    type: 'data.googleSheetsAppendRow',
    config: { connectionId: 'demo-google', spreadsheet: null, sheet: null, columns: [] },
  },
  { key: 'kshowhook', type: 'trigger.webhook' },
  { key: 'kshowteams', type: 'notify.teams' },
  { key: 'kshowdiscord', type: 'notify.discord' },
  { key: 'kshowemail', type: 'notify.email' },
];

const DEMO_TIME = '2026-10-01T09:00:00.000Z';

/** A simulated Google connection, so the sheet fields have one to use. */
const DEMO_CONNECTIONS: Connection[] = [
  {
    id: 'demo-google',
    provider: 'google',
    name: 'Simulated Google',
    status: 'CONNECTED',
    maskedHint: 'demo@example.com',
    meta: { simulated: true },
    lastCheckedAt: null,
    lastError: null,
    createdAt: DEMO_TIME,
    updatedAt: DEMO_TIME,
    usedBy: [],
  },
];

function demoChannel(id: string, providerIdentifier: string, name: string): Channel {
  return {
    id,
    providerIdentifier,
    providerName: providerIdentifier,
    name,
    profile: null,
    picture: null,
    health: 'connected',
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [],
    createdAt: DEMO_TIME,
    color: 0,
  };
}

/** A LinkedIn profile and Page (both count as LinkedIn) and an X account; no YouTube. */
const DEMO_CHANNELS: Channel[] = [
  demoChannel('demo-li', 'linkedin', 'Demo Profile'),
  demoChannel('demo-lip', 'linkedin-page', 'Demo Page'),
  demoChannel('demo-x', 'x', 'Demo X'),
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
      connections: DEMO_CONNECTIONS,
      channels: DEMO_CHANNELS,
      canManage: true,
      scope: sampleScope(graph),
      scopeSource: {},
      timeZone: 'Asia/Kolkata',
      workflowName: 'Publishing Report',
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
      <Row label="Create Draft: media from a step or the media library">
        <StepDemo demo={demo} match={(node) => node.key === 'kshowdraft'} />
      </Row>
      <Row label="Publish To LinkedIn: only LinkedIn channels (profile and Page)">
        <StepDemo demo={demo} match={(node) => node.key === 'kshowlinkedin'} tab="setup" />
      </Row>
      <Row label="Publish To YouTube: no channel yet, then its platform settings">
        <div className="flex w-full max-w-xl flex-col gap-3">
          <StepDemo demo={demo} match={(node) => node.key === 'kshowpublish'} tab="setup" />
          <StepDemo demo={demo} match={(node) => node.key === 'kshowpublish'} />
        </div>
      </Row>
      <Row label="Add To Queue: time zone">
        <StepDemo demo={demo} match={(node) => node.type === 'postgear.addToQueue'} />
      </Row>
      <Row label="Google Sheets: spreadsheet and tab (simulated connection)">
        <StepDemo
          demo={demo}
          match={(node) => node.type === 'data.googleSheetsAppendRow'}
          tab="setup"
        />
      </Row>
      <Row label="Google Sheets: columns">
        <StepDemo demo={demo} match={(node) => node.type === 'data.googleSheetsAppendRow'} />
      </Row>
      <Row label="Webhook link (needs a saved workflow, so it fails here)">
        <StepDemo demo={demo} match={(node) => node.type === 'trigger.webhook'} />
      </Row>
      <Row label="Teams message with its preview">
        <StepDemo demo={demo} match={(node) => node.type === 'notify.teams'} />
      </Row>
      <Row label="Discord message with its preview and count">
        <StepDemo demo={demo} match={(node) => node.type === 'notify.discord'} />
      </Row>
      <Row label="Email with its preview">
        <StepDemo demo={demo} match={(node) => node.type === 'notify.email'} />
      </Row>
    </Section>
  );
}
