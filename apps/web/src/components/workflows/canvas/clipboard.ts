/**
 * Copy and paste of steps through the system clipboard (Module 05), so it
 * works across workflows and tabs. The text is JSON:
 *
 *   { "kind": "postgear.steps", "version": 1, "nodes": [...], "edges": [...] }
 *
 * Pasting never trusts that text: it must parse with the package's node and
 * edge schemas, then every step gets a fresh key (data chips between pasted
 * steps follow it), a name not taken yet and a 48 px offset. Lines to steps
 * that were not pasted are dropped, connection ids this workspace does not
 * have are cleared, and a trigger is left out when the workflow has one.
 * The graph never holds secrets, and test data is not part of it, so
 * nothing private can travel this way.
 */
import {
  type AutomationGraph,
  GRAPH_HARD_CAPS,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  graphEdgeSchema,
  graphNodeSchema,
  isTriggerType,
  renameNodesInConfig,
  uniqueNodeName,
} from '@postgear/automation';
import { clone, makeEdge, pruneDanglingEdges, snap } from '../builder/graph-ops';

export const CLIPBOARD_KIND = 'postgear.steps';
export const CLIPBOARD_VERSION = 1;
export const PASTE_OFFSET = 48;
/** Far above any real copy; stops a huge paste before it is parsed. */
const MAX_CLIPBOARD_CHARS = 1_000_000;

export interface ClipboardData {
  kind: typeof CLIPBOARD_KIND;
  version: typeof CLIPBOARD_VERSION;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const nodesSchema = graphNodeSchema.array().min(1).max(GRAPH_HARD_CAPS.nodes);
const edgesSchema = graphEdgeSchema.array().max(GRAPH_HARD_CAPS.edges);
const ENVELOPE_KEYS = ['edges', 'kind', 'nodes', 'version'];

/** The chosen steps and the lines between them, as clipboard text. */
export function copySteps(graph: AutomationGraph, keys: readonly string[]): string | null {
  const chosen = new Set(keys);
  const nodes = graph.nodes.filter((node) => chosen.has(node.key));
  if (nodes.length === 0) return null;
  const edges = graph.edges.filter((edge) => chosen.has(edge.source) && chosen.has(edge.target));
  const data: ClipboardData = {
    kind: CLIPBOARD_KIND,
    version: CLIPBOARD_VERSION,
    nodes: clone(nodes),
    edges: clone(edges),
  };
  return JSON.stringify(data);
}

/** Clipboard text as steps, or null when it is not something PostGear copied. */
export function readClipboard(text: string): ClipboardData | null {
  if (text.length > MAX_CLIPBOARD_CHARS || !text.includes(CLIPBOARD_KIND)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const envelope = raw as Record<string, unknown>;
  if (Object.keys(envelope).sort().join() !== ENVELOPE_KEYS.join()) return null;
  if (envelope.kind !== CLIPBOARD_KIND || envelope.version !== CLIPBOARD_VERSION) return null;
  const nodes = nodesSchema.safeParse(envelope.nodes);
  const edges = edgesSchema.safeParse(envelope.edges);
  if (!nodes.success || !edges.success) return null;
  return { kind: CLIPBOARD_KIND, version: CLIPBOARD_VERSION, nodes: nodes.data, edges: edges.data };
}

export interface PasteOptions {
  makeKey: () => string;
  /** The workspace's connection ids; any other id in a pasted step is cleared. */
  connectionIds: ReadonlySet<string>;
  offset?: number;
}

export interface PasteResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Plain words for what was left out, for a toast. */
  note: string | null;
}

export const PASTE_TOO_MANY = 'There is no room for these steps in this workflow.';
export const PASTE_TRIGGER_LEFT_OUT =
  'The trigger was not pasted: a workflow can have only one trigger.';
export const PASTE_UNKNOWN_LEFT_OUT =
  'Some steps were not pasted: this version of PostGear does not have them.';

/** The steps to add to `graph` for a paste; never mutates either input. */
export function pasteSteps(
  data: ClipboardData,
  graph: AutomationGraph,
  options: PasteOptions,
): PasteResult {
  const offset = options.offset ?? PASTE_OFFSET;
  let hasTrigger = graph.nodes.some((node) => isTriggerType(node.type));
  let triggerLeftOut = false;
  let unknownLeftOut = false;

  const kept: GraphNode[] = [];
  for (const node of data.nodes) {
    if (!getDefinition(node.type, node.typeVersion)) {
      unknownLeftOut = true;
      continue;
    }
    if (isTriggerType(node.type)) {
      if (hasTrigger) {
        triggerLeftOut = true;
        continue;
      }
      hasTrigger = true;
    }
    kept.push(node);
  }

  if (kept.length === 0) {
    return {
      nodes: [],
      edges: [],
      note: triggerLeftOut
        ? PASTE_TRIGGER_LEFT_OUT
        : unknownLeftOut
          ? PASTE_UNKNOWN_LEFT_OUT
          : null,
    };
  }
  if (graph.nodes.length + kept.length > GRAPH_HARD_CAPS.nodes) {
    return { nodes: [], edges: [], note: PASTE_TOO_MANY };
  }

  const keys = new Map(kept.map((node) => [node.key, options.makeKey()]));
  const added: GraphNode[] = [];
  for (const node of kept) {
    const config = renameNodesInConfig(clone(node.config), keys);
    const field = getDefinition(node.type, node.typeVersion)?.connection?.field;
    if (field && typeof config[field] === 'string' && !options.connectionIds.has(config[field])) {
      config[field] = '';
    }
    added.push({
      ...clone(node),
      key: keys.get(node.key) as string,
      name: uniqueNodeName(node.name, { nodes: [...graph.nodes, ...added] }),
      position: { x: snap(node.position.x + offset), y: snap(node.position.y + offset) },
      config,
    });
  }

  const edges = data.edges
    .filter((edge) => keys.has(edge.source) && keys.has(edge.target))
    .map((edge) =>
      makeEdge(keys.get(edge.source) as string, edge.sourcePort, keys.get(edge.target) as string),
    );
  // A copied line from an output the pasted step no longer has (a removed Paths case) is dropped.
  const tidy = pruneDanglingEdges({ ...graph, nodes: added, edges });

  return {
    nodes: added,
    edges: tidy.edges,
    note: triggerLeftOut ? PASTE_TRIGGER_LEFT_OUT : unknownLeftOut ? PASTE_UNKNOWN_LEFT_OUT : null,
  };
}
