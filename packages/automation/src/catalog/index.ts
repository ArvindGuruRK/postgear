/**
 * The node catalog: every step type, declared once, plus the lookups and
 * per-step helpers the rest of the package and the apps use.
 */
import type { GraphNode } from '../graph/schema';
import { AI_NODES } from './ai';
import { DATA_NODES } from './data';
import { LOGIC_NODES } from './logic';
import { NOTIFY_NODES } from './notify';
import { POSTGEAR_NODES } from './postgear';
import { TRIGGER_NODES } from './triggers';
import {
  NODE_TYPES,
  type NodeCategory,
  type NodeDefinition,
  type NodeType,
  type OutputField,
  type PortSpec,
  type SummaryContext,
} from './types';

/** Every step type, in library order. */
export const NODE_CATALOG: readonly NodeDefinition[] = [
  ...TRIGGER_NODES,
  ...POSTGEAR_NODES,
  ...AI_NODES,
  ...LOGIC_NODES,
  ...NOTIFY_NODES,
  ...DATA_NODES,
];

const BY_TYPE = new Map<string, NodeDefinition>(NODE_CATALOG.map((def) => [def.type, def]));

export function isNodeType(type: string): type is NodeType {
  return (NODE_TYPES as readonly string[]).includes(type);
}

/** Triggers by id, so an unknown trigger type still counts as a trigger. */
export function isTriggerType(type: string): boolean {
  return type.startsWith('trigger.');
}

/**
 * The definition for a type, or `undefined` for an unknown type or a
 * version this code does not have.
 */
export function getDefinition(type: string, version?: number): NodeDefinition | undefined {
  const def = BY_TYPE.get(type);
  if (!def) return undefined;
  if (version !== undefined && version !== def.typeVersion) return undefined;
  return def;
}

export function listDefinitions(
  filter: { category?: NodeCategory; status?: NodeDefinition['status'] } = {},
): NodeDefinition[] {
  return NODE_CATALOG.filter(
    (def) =>
      (filter.category === undefined || def.category === filter.category) &&
      (filter.status === undefined || def.status === filter.status),
  );
}

type NodeLike = Pick<GraphNode, 'type' | 'typeVersion' | 'config'> &
  Partial<Pick<GraphNode, 'onError' | 'disabled'>>;

function rawConfig(node: NodeLike): Record<string, unknown> {
  const config: unknown = node.config;
  return typeof config === 'object' && config !== null && !Array.isArray(config)
    ? (config as Record<string, unknown>)
    : {};
}

/** True when the step's On Error sends failures down an `error` output. */
export function hasErrorBranch(node: NodeLike): boolean {
  const def = getDefinition(node.type, node.typeVersion);
  return Boolean(def?.canHandleErrors && node.onError?.mode === 'branch');
}

/**
 * The output ports a step has right now: its declared outputs (Paths: one
 * per case, then Otherwise) plus `error` ("On Error") when its On Error is
 * set to branch. Unknown types have none.
 */
export function outputPortsOf(node: NodeLike): PortSpec[] {
  const def = getDefinition(node.type, node.typeVersion);
  if (!def) return [];
  const ports = typeof def.outputs === 'function' ? def.outputs(rawConfig(node)) : [...def.outputs];
  if (hasErrorBranch(node)) ports.push({ id: 'error', label: 'On Error' });
  return ports;
}

const ERROR_FIELDS: OutputField[] = [
  { path: 'error', label: 'Error', type: 'object' },
  { path: 'error.message', label: 'Error Message', type: 'text', sample: 'Slack did not answer.' },
  { path: 'error.code', label: 'Error Code', type: 'text', sample: 'timeout' },
];

/**
 * The data a step gives later steps, for Insert Data and token checks.
 * Steps that carry on after a failure (On Error continue or branch) may
 * output an `error` object instead, so its fields are listed too.
 */
export function outputFieldsOf(node: NodeLike): OutputField[] {
  const def = getDefinition(node.type, node.typeVersion);
  if (!def) return [];
  const fields =
    typeof def.outputShape === 'function' ? def.outputShape(rawConfig(node)) : [...def.outputShape];
  const handles = def.canHandleErrors && (node.onError?.mode ?? 'stop') !== 'stop';
  return handles ? [...fields, ...ERROR_FIELDS] : fields;
}

/** The step's config parsed by its type's schema, for code that needs it typed. */
export function parseNodeConfig(node: NodeLike) {
  const def = getDefinition(node.type, node.typeVersion);
  if (!def) return undefined;
  return def.configSchema.safeParse(node.config);
}

/** The title a new step of this type gets: "Slack", "Publish To Instagram". */
export function nodeTitle(type: string, config?: Record<string, unknown>): string {
  const def = getDefinition(type);
  if (!def) return 'Step';
  if (def.titleFor && config) {
    const parsed = def.configSchema.safeParse(config);
    if (parsed.success) return def.titleFor(parsed.data);
  }
  return def.title;
}

/**
 * The one-line summary under a step's name on the canvas ("Every Monday at
 * 09:00", "Message to Marketing Slack"). Never throws: an unknown type or
 * an unfinished config gets a plain sentence instead.
 */
export function describeNode(node: NodeLike, ctx: SummaryContext = {}): string {
  const def = getDefinition(node.type, node.typeVersion);
  if (!def) return 'This step type is not available any more.';
  if (def.status === 'comingSoon') return def.comingSoonReason ?? 'Coming soon';
  const parsed = def.configSchema.safeParse(node.config);
  if (!parsed.success) return 'Finish setting up this step';
  try {
    return def.summary(parsed.data, ctx);
  } catch {
    return def.description;
  }
}

export { AI_STEP_CREDITS } from './ai';
export { EXECUTABLE_TYPES } from './executable';
export * from './platforms';
export * from './types';
