/**
 * Built-in sample data, so Insert Data shows real-looking values and Test
 * Step works before any real run: a post that went out on Instagram, a
 * post that failed because its channel needs reconnecting, a schedule
 * tick, a manual run with its fields filled in.
 */
import { getDefinition, outputFieldsOf } from '../catalog';
import type { AutomationGraph, GraphNode } from '../graph/schema';
import { buildIndex } from '../plan/build-index';
import { resolveTemplate } from '../tokens/resolve';
import type { RunScope } from '../tokens/values';
import { asRecord } from '../validate/config-paths';

function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** The sample values a step's output fields declare, as one object. */
function fromFields(
  node: Pick<GraphNode, 'type' | 'typeVersion' | 'config'>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of outputFieldsOf(node)) {
    // Error fields only appear when a step fails; a sample run succeeds.
    if (field.path === 'error' || field.path.startsWith('error.')) {
      if (node.type !== 'trigger.postFailed') continue;
    }
    if (field.sample !== undefined) setAtPath(output, field.path, clone(field.sample));
  }
  return output;
}

const SAMPLE_IMAGE = {
  url: 'https://media.postgear.local/samples/sourdough.png',
  type: 'image',
  alt: 'A loaf of sourdough bread',
};

/** The data a trigger gives when a sample run starts. */
export function triggerSample(node: Pick<GraphNode, 'type' | 'typeVersion' | 'config'>): unknown {
  const output = fromFields(node);
  const config = asRecord(node.config);
  switch (node.type) {
    case 'trigger.postFailed':
      setAtPath(output, 'post.state', 'ERROR');
      break;
    case 'trigger.schedule':
      if (typeof config.timeZone === 'string') output.timeZone = config.timeZone;
      break;
    case 'trigger.manual': {
      const inputs: Record<string, unknown> = {};
      for (const field of Array.isArray(config.fields) ? config.fields : []) {
        const { key, type, options, label } = asRecord(field);
        if (typeof key !== 'string') continue;
        if (type === 'number') inputs[key] = 3;
        else if (type === 'choice' && Array.isArray(options) && options.length)
          inputs[key] = options[0];
        else inputs[key] = typeof label === 'string' ? `Sample ${label.toLowerCase()}` : 'Sample';
      }
      output.inputs = inputs;
      break;
    }
  }
  return output;
}

/** The output a step gives in a sample run. */
export function stepSample(
  node: Pick<GraphNode, 'type' | 'typeVersion' | 'config'>,
  scope: RunScope = {},
): unknown {
  if (!getDefinition(node.type, node.typeVersion)) return {};
  const output = fromFields(node);
  if (node.type === 'logic.setFields') {
    const fields = asRecord(node.config).fields;
    for (const field of Array.isArray(fields) ? fields : []) {
      const { name, value, type } = asRecord(field);
      if (typeof name !== 'string' || typeof value !== 'string') continue;
      const resolved = resolveTemplate(value, scope).value;
      output[name] = type === 'number' ? Number(resolved) || 0 : resolved;
    }
  }
  for (const field of outputFieldsOf(node)) {
    if (field.type === 'media' && field.sample === undefined && !field.path.startsWith('error')) {
      setAtPath(output, field.path, clone(SAMPLE_IMAGE));
    }
  }
  return output;
}

/** The fixed run data of a sample run. */
export const SAMPLE_RUN = {
  id: 'run_sample',
  startedAt: '2026-11-03T09:00:00.000Z',
  mode: 'test',
} as const;

/**
 * A whole run's worth of sample data for a graph: the trigger's sample and
 * every step's, in run order, so Set Fields samples are built from the
 * samples before them. Turned-off steps output nothing, as in a real run.
 */
export function sampleScope(graph: AutomationGraph, workspaceName = 'Bloom Bakery'): RunScope {
  const index = buildIndex(graph);
  const scope: RunScope & { nodes: Record<string, { output?: unknown }> } = {
    nodes: {},
    run: { ...SAMPLE_RUN },
    workspace: { name: workspaceName },
  };
  const trigger = index.triggers[0];
  if (trigger) scope.trigger = triggerSample(trigger);
  for (const key of index.order) {
    const node = index.nodes.get(key);
    if (!node || node.key === trigger?.key || node.disabled) continue;
    scope.nodes[key] = { output: stepSample(node, scope) };
  }
  return scope;
}
