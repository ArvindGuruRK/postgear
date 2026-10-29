/**
 * What Insert Data offers a step: the data of every step before it (never
 * after), plus the run and the workspace, as a tree of fields in plain
 * words with a sample value each (n8n's schema view, at most 3 levels).
 */
import { getDefinition, outputFieldsOf } from '../catalog';
import type { FieldType, IconKey, OutputField } from '../catalog/types';
import type { AutomationGraph } from '../graph/schema';
import { buildIndex, type GraphInput, toIndex } from '../plan/build-index';
import { certainBefore } from '../plan/guaranteed';
import { upstreamOf } from '../plan/order';
import { sampleScope } from '../samples';
import { RUN_FIELDS, WORKSPACE_FIELDS } from './labels';
import { MAX_FIELD_DEPTH, type TokenSource, tokenSource } from './parse';
import { type RunScope, resolveValue } from './values';

export interface DataField {
  /** The full token path to insert (`trigger.post.url`). */
  path: string;
  label: string;
  type: FieldType;
  of?: FieldType;
  /** From the last test run when there is one, else the built-in sample. */
  sample?: unknown;
  children: DataField[];
}

export interface DataGroup {
  /** `trigger`, a step key, `run` or `workspace`. */
  source: string;
  nodeKey?: string;
  nodeType?: string;
  /** The step's name ("Post Published"), or "Run", "Workspace". */
  title: string;
  icon: IconKey;
  /** The step is turned off: listed, but greyed. */
  turnedOff?: boolean;
  /** The step sits on a branch that may not run before this one. */
  maybeEmpty?: boolean;
  /** "This step is turned off." or "May be empty". */
  note?: string;
  fields: DataField[];
}

const SHOWN_LEVELS = 3;

function fieldTree(fields: readonly OutputField[], prefix: string, scope: RunScope): DataField[] {
  const roots: DataField[] = [];
  const byPath = new Map<string, DataField>();
  for (const field of fields) {
    const parts = field.path.split('.');
    if (parts.length > SHOWN_LEVELS) continue;
    const path = `${prefix}${field.path}`;
    const live = resolveValue(path, scope);
    const item: DataField = {
      path,
      label: field.label,
      type: field.type,
      ...(field.of ? { of: field.of } : {}),
      ...(live !== undefined || field.sample !== undefined
        ? { sample: live !== undefined ? live : field.sample }
        : {}),
      children: [],
    };
    byPath.set(field.path, item);
    let parent = parts.slice(0, -1).join('.');
    while (parent && !byPath.has(parent)) parent = parent.split('.').slice(0, -1).join('.');
    (parent ? (byPath.get(parent) as DataField).children : roots).push(item);
  }
  return roots;
}

/**
 * The groups Insert Data lists for `nodeKey`, in run order: the trigger,
 * each earlier step, then the run and the workspace. `scope` is the last
 * test run's data; without it the built-in samples are shown.
 */
export function availableData(
  graph: AutomationGraph,
  nodeKey: string,
  ctx: { scope?: RunScope } = {},
): DataGroup[] {
  const index = buildIndex(graph);
  if (!index.nodes.has(nodeKey)) return [];
  const scope = ctx.scope ?? sampleScope(graph);
  const certain = certainBefore(index, nodeKey);
  const triggerKey = index.triggers[0]?.key;

  const groups: DataGroup[] = [];
  for (const key of upstreamOf(index, nodeKey)) {
    const node = index.nodes.get(key);
    const def = node && getDefinition(node.type, node.typeVersion);
    if (!node || !def) continue;
    const isTrigger = key === triggerKey;
    if (!isTrigger && def.category === 'trigger') continue;
    const prefix = isTrigger ? 'trigger.' : `nodes.${key}.output.`;
    const group: DataGroup = {
      source: isTrigger ? 'trigger' : key,
      nodeKey: key,
      nodeType: node.type,
      title: node.name,
      icon: def.icon,
      fields: fieldTree(outputFieldsOf(node), prefix, scope),
    };
    if (node.disabled) {
      group.turnedOff = true;
      group.note = 'This step is turned off.';
    } else if (!certain.has(key)) {
      group.maybeEmpty = true;
      group.note = 'May be empty';
    }
    groups.push(group);
  }
  groups.push(
    { source: 'run', title: 'Run', icon: 'run', fields: fieldTree(RUN_FIELDS, 'run.', scope) },
    {
      source: 'workspace',
      title: 'Workspace',
      icon: 'workspace',
      fields: fieldTree(WORKSPACE_FIELDS, 'workspace.', scope),
    },
  );
  return groups;
}

/** The fields a token's source declares, or `undefined` for an unknown source. */
export function sourceFields(
  input: GraphInput,
  source: TokenSource,
): readonly OutputField[] | undefined {
  const index = toIndex(input);
  switch (source.root) {
    case 'trigger': {
      const trigger = index.triggers[0];
      return trigger ? outputFieldsOf(trigger) : undefined;
    }
    case 'nodes': {
      const node = source.nodeKey ? index.nodes.get(source.nodeKey) : undefined;
      return node ? outputFieldsOf(node) : undefined;
    }
    case 'run':
      return RUN_FIELDS;
    case 'workspace':
      return WORKSPACE_FIELDS;
    default:
      return undefined;
  }
}

/**
 * Whether a field path exists in declared output. A list may be indexed
 * (`tags.0`), and an `object` or `media` field with no declared children
 * is open (an HTTP response, a webhook's body), so any path inside it is
 * accepted. Returns the field's type when it is known.
 */
export function lookupField(
  fields: readonly OutputField[],
  fieldPath: string,
): { known: boolean; type?: FieldType } {
  if (fieldPath === '') return { known: true, type: 'object' };
  const parts = fieldPath.split('.');
  if (parts.length > MAX_FIELD_DEPTH) return { known: false };
  const byPath = new Map(fields.map((field) => [field.path, field]));
  const hasChildren = (path: string) => fields.some((field) => field.path.startsWith(`${path}.`));

  let declared = '';
  let last: OutputField | undefined;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (last?.type === 'list' && /^\d+$/.test(part)) {
      if (i === parts.length - 1) return { known: true, type: last.of ?? 'text' };
      return last.of === 'object' || last.of === 'media' ? { known: true } : { known: false };
    }
    const next = declared ? `${declared}.${part}` : part;
    const field = byPath.get(next);
    if (!field) {
      const open =
        last && (last.type === 'object' || last.type === 'media') && !hasChildren(last.path);
      return open ? { known: true } : { known: false };
    }
    declared = next;
    last = field;
  }
  return { known: true, type: last?.type };
}

/**
 * A labeller for summaries: the plain-words label a step declares for a
 * token path ("Post Link"), or `undefined` when it declares none.
 */
export function tokenLabeler(graph: AutomationGraph): (path: string) => string | undefined {
  const index = buildIndex(graph);
  return (path) => {
    const source = tokenSource(path);
    if (!source.wellFormed) return undefined;
    return sourceFields(index, source)?.find((field) => field.path === source.field)?.label;
  };
}
