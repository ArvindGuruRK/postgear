/**
 * The builder's one source of truth (Module 05): the draft graph, what is
 * selected, and undo history, in one reducer.
 *
 * - **React Flow draws what this holds.** Its nodes and edges are derived
 *   from `graph` on every render; a drag lives in React Flow until it stops,
 *   then arrives here as one `moveNodes`.
 * - **Undo and redo** keep up to 100 earlier graphs. Typing in one field
 *   (`updateConfig` per config path, `renameStep`) folds into one step while it continues within
 *   1.5 s; a drag, a Tidy Up or a paste is one step each. Selection and the
 *   workflow's name are not history.
 * - **No stale closures** (the TriForms lesson): every action reads the
 *   state the reducer is handed, never a value a handler captured earlier.
 *   Actions that need fresh keys carry a `makeKey`, so the reducer stays
 *   pure and testable.
 */
import {
  type AutomationGraph,
  canConnect,
  type GraphEdge,
  type GraphNode,
  isTriggerType,
  type OnErrorPolicy,
  type PortId,
  type StickyNote,
} from '@postgear/automation';
import {
  clone,
  connectSteps,
  createStep,
  firstOutput,
  makeEdge,
  placeAfter,
  pruneDanglingEdges,
  removeItems,
  sameJson,
  setConfigPath,
  snap,
  updateNode,
} from './graph-ops';

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1_500;

export interface Selection {
  nodes: string[];
  edges: string[];
  notes: string[];
}

export const EMPTY_SELECTION: Selection = { nodes: [], edges: [], notes: [] };

export interface BuilderState {
  graph: AutomationGraph;
  name: string;
  selection: Selection;
  past: AutomationGraph[];
  future: AutomationGraph[];
  /** The last change that may fold into the next one of the same kind. */
  coalesce: { key: string; at: number } | null;
}

export type Position = { x: number; y: number };

export type BuilderAction =
  | { type: 'load'; graph: AutomationGraph; name: string }
  | { type: 'rename'; name: string }
  | { type: 'select'; selection: Selection }
  /** React Flow's select and unselect changes, applied to the selection as it is now. */
  | {
      type: 'selectChanges';
      nodes?: Record<string, boolean>;
      edges?: Record<string, boolean>;
      notes?: Record<string, boolean>;
    }
  | {
      type: 'addStep';
      stepType: string;
      key: string;
      config?: Record<string, unknown>;
      /** Where to put it; after `from` (or the last leaf) when left out. */
      position?: Position;
      /** Connect it from this output. */
      from?: { source: string; sourcePort: PortId };
    }
  | {
      type: 'insertOnEdge';
      edgeId: string;
      stepType: string;
      key: string;
      config?: Record<string, unknown>;
    }
  | { type: 'connect'; source: string; sourcePort: PortId; target: string }
  | { type: 'disconnect'; edgeIds: string[] }
  | { type: 'moveNodes'; nodes: Record<string, Position>; notes?: Record<string, Position> }
  /**
   * One edit at a dotted config path (Module 06's `SchemaForm` reports
   * `onChange(path, value)`); '' replaces the whole config. Edits to the
   * same path within 1.5 s fold into one undo step, like typing.
   */
  | {
      type: 'updateConfig';
      key: string;
      path: string;
      value: unknown;
      now: number;
    }
  | { type: 'renameStep'; key: string; name: string; now: number }
  | { type: 'toggleDisabled'; keys: string[] }
  | {
      type: 'stepSettings';
      key: string;
      onError?: OnErrorPolicy | null;
      notes?: string | null;
      now: number;
    }
  | { type: 'deleteSelection' }
  | { type: 'duplicateSelection'; makeKey: () => string }
  | { type: 'paste'; nodes: GraphNode[]; edges: GraphEdge[] }
  | { type: 'tidy'; positions: Record<string, Position> }
  | { type: 'addNote'; note: StickyNote }
  | { type: 'updateNote'; id: string; patch: Partial<Omit<StickyNote, 'id'>>; now: number }
  | { type: 'undo' }
  | { type: 'redo' };

export function initialState(graph: AutomationGraph, name: string): BuilderState {
  return { graph, name, selection: EMPTY_SELECTION, past: [], future: [], coalesce: null };
}

/** Records `graph` as the new current graph, with `before` on the undo stack. */
function commit(
  state: BuilderState,
  graph: AutomationGraph,
  extra: Partial<BuilderState> = {},
  coalesce: { key: string; now: number } | null = null,
): BuilderState {
  if (graph === state.graph) return { ...state, ...extra };
  const folds =
    coalesce !== null &&
    state.coalesce !== null &&
    state.coalesce.key === coalesce.key &&
    coalesce.now - state.coalesce.at < COALESCE_MS;
  const past = folds ? state.past : [...state.past, state.graph].slice(-HISTORY_LIMIT);
  return {
    ...state,
    ...extra,
    graph,
    past,
    future: [],
    coalesce: coalesce ? { key: coalesce.key, at: coalesce.now } : null,
  };
}

/** A selection with only what still exists in `graph`. */
function prune(selection: Selection, graph: AutomationGraph): Selection {
  const nodes = new Set(graph.nodes.map((node) => node.key));
  const edges = new Set(graph.edges.map((edge) => edge.id));
  const notes = new Set(graph.notes.map((note) => note.id));
  return {
    nodes: selection.nodes.filter((key) => nodes.has(key)),
    edges: selection.edges.filter((id) => edges.has(id)),
    notes: selection.notes.filter((id) => notes.has(id)),
  };
}

function only(key: string): Selection {
  return { nodes: [key], edges: [], notes: [] };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'load':
      return initialState(action.graph, action.name);

    case 'rename':
      return { ...state, name: action.name };

    case 'select':
      return { ...state, selection: action.selection };

    case 'selectChanges': {
      const apply = (current: string[], changes?: Record<string, boolean>) => {
        if (!changes) return current;
        const next = current.filter((id) => changes[id] !== false);
        for (const [id, on] of Object.entries(changes)) if (on && !next.includes(id)) next.push(id);
        return next;
      };
      const selection = prune(
        {
          nodes: apply(state.selection.nodes, action.nodes),
          edges: apply(state.selection.edges, action.edges),
          notes: apply(state.selection.notes, action.notes),
        },
        state.graph,
      );
      const same =
        selection.nodes.join() === state.selection.nodes.join() &&
        selection.edges.join() === state.selection.edges.join() &&
        selection.notes.join() === state.selection.notes.join();
      return same ? state : { ...state, selection };
    }

    case 'addStep': {
      const isTrigger = isTriggerType(action.stepType);
      if (isTrigger && state.graph.nodes.some((node) => isTriggerType(node.type))) return state;
      const position = action.position ?? placeAfter(state.graph, action.from?.source);
      const step = createStep(state.graph, action.stepType, action.key, position, action.config);
      if (!step) return state;
      let graph: AutomationGraph = { ...state.graph, nodes: [...state.graph.nodes, step] };
      if (action.from)
        graph = connectSteps(graph, action.from.source, action.from.sourcePort, step.key);
      return commit(state, graph, { selection: only(step.key) });
    }

    case 'insertOnEdge': {
      const edge = state.graph.edges.find((candidate) => candidate.id === action.edgeId);
      if (!edge) return state;
      const source = state.graph.nodes.find((node) => node.key === edge.source);
      const target = state.graph.nodes.find((node) => node.key === edge.target);
      if (!source || !target || isTriggerType(action.stepType)) return state;
      const position = {
        x: (source.position.x + target.position.x) / 2,
        y: (source.position.y + target.position.y) / 2 + 96,
      };
      const step = createStep(state.graph, action.stepType, action.key, position, action.config);
      if (!step) return state;
      const out = firstOutput(step);
      const edges = state.graph.edges.filter((candidate) => candidate.id !== edge.id);
      edges.push(makeEdge(source.key, edge.sourcePort, step.key));
      if (out) edges.push(makeEdge(step.key, out, target.key));
      const graph = { ...state.graph, nodes: [...state.graph.nodes, step], edges };
      return commit(state, graph, { selection: only(step.key) });
    }

    case 'connect': {
      const check = canConnect(state.graph, {
        source: action.source,
        sourcePort: action.sourcePort,
        target: action.target,
      });
      if (!check.ok) return state;
      return commit(
        state,
        connectSteps(state.graph, action.source, action.sourcePort, action.target),
      );
    }

    case 'disconnect': {
      const graph = removeItems(state.graph, [], action.edgeIds, []);
      return commit(state, graph, { selection: prune(state.selection, graph) });
    }

    case 'moveNodes': {
      let moved = false;
      const nodes = state.graph.nodes.map((node) => {
        const to = action.nodes[node.key];
        if (!to || (to.x === node.position.x && to.y === node.position.y)) return node;
        moved = true;
        return { ...node, position: { x: snap(to.x), y: snap(to.y) } };
      });
      const notes = state.graph.notes.map((note) => {
        const to = action.notes?.[note.id];
        if (!to || (to.x === note.position.x && to.y === note.position.y)) return note;
        moved = true;
        return { ...note, position: { x: snap(to.x), y: snap(to.y) } };
      });
      if (!moved) return state;
      return commit(state, { ...state.graph, nodes, notes });
    }

    case 'updateConfig': {
      const node = state.graph.nodes.find((candidate) => candidate.key === action.key);
      if (!node) return state;
      const config = setConfigPath(node.config, action.path, action.value);
      // A field that reports the value it already holds is not an edit.
      if (sameJson(config, node.config)) return state;
      const graph = pruneDanglingEdges(
        updateNode(state.graph, action.key, (current) => ({ ...current, config })),
      );
      return commit(
        state,
        graph,
        {},
        { key: `config:${action.key}:${action.path}`, now: action.now },
      );
    }

    case 'renameStep': {
      const name = action.name.slice(0, 60);
      const graph = updateNode(state.graph, action.key, (node) => ({ ...node, name }));
      return commit(state, graph, {}, { key: `name:${action.key}`, now: action.now });
    }

    case 'toggleDisabled': {
      const keys = new Set(action.keys);
      const targets = state.graph.nodes.filter((node) => keys.has(node.key));
      if (targets.length === 0) return state;
      // Several at once all go the same way: off, unless every one is off already.
      const turnOff = targets.some((node) => !node.disabled);
      const nodes = state.graph.nodes.map((node) => {
        if (!keys.has(node.key)) return node;
        const { disabled: _was, ...rest } = node;
        return turnOff ? { ...rest, disabled: true } : rest;
      });
      return commit(state, { ...state.graph, nodes });
    }

    case 'stepSettings': {
      const graph = pruneDanglingEdges(
        updateNode(state.graph, action.key, (node) => {
          const next: GraphNode = { ...node };
          if (action.onError !== undefined) {
            if (action.onError === null) delete next.onError;
            else next.onError = action.onError;
          }
          if (action.notes !== undefined) {
            if (!action.notes) delete next.notes;
            else next.notes = action.notes.slice(0, 280);
          }
          return next;
        }),
      );
      return commit(state, graph, {}, { key: `settings:${action.key}`, now: action.now });
    }

    case 'deleteSelection': {
      const { nodes, edges, notes } = state.selection;
      if (nodes.length + edges.length + notes.length === 0) return state;
      const graph = removeItems(state.graph, nodes, edges, notes);
      return commit(state, graph, { selection: EMPTY_SELECTION });
    }

    case 'duplicateSelection': {
      const chosen = state.graph.nodes.filter(
        (node) => state.selection.nodes.includes(node.key) && !isTriggerType(node.type),
      );
      if (chosen.length === 0) return state;
      const keys = new Map(chosen.map((node) => [node.key, action.makeKey()]));
      let graph = state.graph;
      const added: GraphNode[] = [];
      for (const node of chosen) {
        const copy = createStep(
          { ...graph, nodes: [...graph.nodes, ...added] },
          node.type,
          keys.get(node.key) as string,
          { x: node.position.x + 48, y: node.position.y + 48 },
          clone(node.config),
        );
        if (!copy) continue;
        added.push({
          ...copy,
          ...(node.disabled ? { disabled: true } : {}),
          ...(node.onError ? { onError: clone(node.onError) } : {}),
          ...(node.notes ? { notes: node.notes } : {}),
        });
      }
      const edges = state.graph.edges
        .filter((edge) => keys.has(edge.source) && keys.has(edge.target))
        .map((edge) =>
          makeEdge(
            keys.get(edge.source) as string,
            edge.sourcePort,
            keys.get(edge.target) as string,
          ),
        );
      graph = { ...graph, nodes: [...graph.nodes, ...added], edges: [...graph.edges, ...edges] };
      return commit(state, graph, {
        selection: { nodes: added.map((node) => node.key), edges: [], notes: [] },
      });
    }

    case 'paste': {
      if (action.nodes.length === 0) return state;
      const graph = {
        ...state.graph,
        nodes: [...state.graph.nodes, ...action.nodes],
        edges: [...state.graph.edges, ...action.edges],
      };
      return commit(state, graph, {
        selection: { nodes: action.nodes.map((node) => node.key), edges: [], notes: [] },
      });
    }

    case 'tidy': {
      const nodes = state.graph.nodes.map((node) => {
        const to = action.positions[node.key];
        return to ? { ...node, position: { x: to.x, y: to.y } } : node;
      });
      return commit(state, { ...state.graph, nodes });
    }

    case 'addNote':
      return commit(
        state,
        { ...state.graph, notes: [...state.graph.notes, action.note] },
        { selection: { nodes: [], edges: [], notes: [action.note.id] } },
      );

    case 'updateNote': {
      let changed = false;
      const notes = state.graph.notes.map((note) => {
        if (note.id !== action.id) return note;
        changed = true;
        return { ...note, ...action.patch };
      });
      if (!changed) return state;
      return commit(
        state,
        { ...state.graph, notes },
        {},
        { key: `note:${action.id}`, now: action.now },
      );
    }

    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        graph: previous,
        past: state.past.slice(0, -1),
        future: [state.graph, ...state.future].slice(0, HISTORY_LIMIT),
        selection: prune(state.selection, previous),
        coalesce: null,
      };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        graph: next,
        past: [...state.past, state.graph].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        selection: prune(state.selection, next),
        coalesce: null,
      };
    }
  }
}
