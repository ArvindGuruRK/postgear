/**
 * Words and small rules for the step panel and the Expanded view (Module
 * 06): the data every field sees (pinned data over the built-in samples),
 * the run order the Expanded view's arrows walk, how values read in the
 * Input and Output panes, and the pinned data editor's checks. Pure and
 * unit tested.
 */
import {
  type AutomationGraph,
  type DataField,
  type DataGroup,
  type FieldType,
  type GraphNode,
  humanise,
  isTriggerType,
  type OutputField,
  outputFieldsOf,
  type RunScope,
  sampleScope,
  stepSample,
  topologicalOrder,
  triggerSample,
} from '@postgear/automation';
import type { PinnedStep } from '@/types/workflows';
import type { DataSource } from '../fields/contract';

// ---- Copy ----------------------------------------------------------------------------

export const OUTPUT_EMPTY = 'Test this step to see its result.';
export const INPUT_NOTHING_UPSTREAM = 'Connect this step after another step to use its data.';
export const INPUT_TRIGGER = 'This step starts the workflow, so nothing comes before it.';
export const PINNED_TOO_LARGE =
  'This is more than 64 KB of data. Pin a smaller sample, for example fewer items in a list.';
export const PINNED_NOT_SAVED_YET =
  'This step is not saved yet. Wait a moment for the workflow to save, then pin again.';
export const PIN_NOTE =
  'Test runs use pinned data instead of running this step. Live runs never do.';
export const CLICK_A_FIELD_FIRST =
  'Click into a field that takes data first, then choose the data.';

// ---- The data fields see ---------------------------------------------------------------

/**
 * Data for chips, Insert Data and the Input pane: each step's pinned data
 * when this browser knows it, else the built-in sample (Module 02). The
 * last test run joins in Module 08. `scopeSource` says where each step's
 * data came from, keyed by step key (and `trigger` for the trigger).
 */
export function buildScope(
  graph: AutomationGraph,
  pinned: readonly PinnedStep[],
  workspaceName?: string,
): { scope: RunScope; scopeSource: Record<string, DataSource> } {
  const base = sampleScope(graph, workspaceName);
  const trigger = graph.nodes.find((node) => isTriggerType(node.type));
  const nodes: Record<string, { output?: unknown } | undefined> = { ...(base.nodes ?? {}) };
  let triggerData = base.trigger;
  const scopeSource: Record<string, DataSource> = {};
  for (const node of graph.nodes) scopeSource[node.key] = { kind: 'sample' };

  for (const pin of pinned) {
    if (pin.output === undefined) continue;
    const node = graph.nodes.find((candidate) => candidate.key === pin.nodeKey);
    if (!node || node.disabled) continue;
    if (node.key === trigger?.key) triggerData = pin.output;
    else nodes[node.key] = { output: pin.output };
    scopeSource[node.key] = { kind: 'pinned', at: pin.pinnedAt };
  }
  if (trigger) scopeSource.trigger = scopeSource[trigger.key];
  return { scope: { ...base, trigger: triggerData, nodes }, scopeSource };
}

/** "Pinned", "Last Test 14:02" or "Sample" (a badge, so Title Case): where a pane's data came from. */
export function sourceLabel(source: DataSource | undefined): string {
  if (!source || source.kind === 'sample') return 'Sample';
  if (source.kind === 'pinned') return 'Pinned';
  const at = new Date(source.at);
  if (Number.isNaN(at.getTime())) return 'Last Test';
  const time = at.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `Last Test ${time}`;
}

/** The data a group of Insert Data stands for, for the Raw view. */
export function groupData(scope: RunScope, group: Pick<DataGroup, 'source' | 'nodeKey'>): unknown {
  if (group.source === 'trigger') return scope.trigger;
  if (group.source === 'run') return scope.run;
  if (group.source === 'workspace') return scope.workspace;
  return group.nodeKey ? scope.nodes?.[group.nodeKey]?.output : undefined;
}

/** A step's own data as the Output pane shows it: its pin, else nothing (until Module 08). */
export function sampleOutput(node: GraphNode, scope: RunScope): unknown {
  return isTriggerType(node.type) ? triggerSample(node) : stepSample(node, scope);
}

// ---- Walking the steps -----------------------------------------------------------------

/** Every step in run order; steps in a loop or on their own follow in canvas order. */
export function walkOrder(graph: AutomationGraph): string[] {
  const order = topologicalOrder(graph);
  const seen = new Set(order);
  return [...order, ...graph.nodes.map((node) => node.key).filter((key) => !seen.has(key))];
}

/** The steps before and after `key` in run order, for the Expanded view's arrows. */
export function neighbours(
  graph: AutomationGraph,
  key: string,
): { previous: string | null; next: string | null } {
  const order = walkOrder(graph);
  const at = order.indexOf(key);
  if (at === -1) return { previous: null, next: null };
  return { previous: order[at - 1] ?? null, next: order[at + 1] ?? null };
}

// ---- How values read ---------------------------------------------------------------------

/** A value in a few plain words: text as it is (cut), "3 items", "Yes". Never braces. */
export function valueWords(value: unknown, max = 80): string {
  if (value === undefined || value === null || value === '') return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  if (Array.isArray(value)) return value.length === 1 ? '1 item' : `${value.length} items`;
  if (typeof value === 'object') {
    const count = Object.keys(value as object).length;
    return count === 1 ? '1 field' : `${count} fields`;
  }
  return String(value);
}

export interface DataRow {
  /** The full token path (what a drag or a click inserts). */
  path: string;
  label: string;
  depth: number;
  value: unknown;
  type: FieldType;
}

/** A field tree as one row per field path, parents first: the Table view. */
export function flattenFields(fields: readonly DataField[], depth = 0): DataRow[] {
  const rows: DataRow[] = [];
  for (const field of fields) {
    rows.push({
      path: field.path,
      label: field.label,
      depth,
      value: field.sample,
      type: field.type,
    });
    rows.push(...flattenFields(field.children, depth + 1));
  }
  return rows;
}

function kindOf(value: unknown): FieldType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object' && value !== null) return 'object';
  return 'text';
}

/**
 * Any data as a field tree (the Output pane's Data and Table views), with
 * the labels the step declares for its fields and plain words for the
 * rest. Three levels, the first 20 items of a list, like Insert Data.
 */
export function valueTree(
  value: unknown,
  declared: readonly OutputField[],
  prefix = '',
  depth = 0,
): DataField[] {
  if (typeof value !== 'object' || value === null || depth >= 3) return [];
  const list = Array.isArray(value);
  const entries: [string, unknown][] = list
    ? (value as unknown[]).slice(0, 20).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  return entries.map(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    const field = declared.find((candidate) => candidate.path === path);
    return {
      path,
      label: field?.label ?? (list ? `Item ${Number(key) + 1}` : humanise(key)),
      type: field?.type ?? kindOf(child),
      sample: child,
      children: valueTree(child, declared, path, depth + 1),
    };
  });
}

/** Formatted data for a Raw view, the only place it appears as written. */
export function rawText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return '';
  }
}

// ---- The pinned data editor -------------------------------------------------------------

export type ParsedPin =
  | { ok: true; value: unknown }
  | { ok: false; line: number | null; message: string };

/**
 * Where text stops being valid data: a small JSON walk, because each
 * browser words (or leaves out) the position in `JSON.parse`'s error.
 */
export function locateDataError(text: string): { position: number; atEnd: boolean } | null {
  let i = 0;
  const fail = (): never => {
    throw { position: Math.min(i, text.length), atEnd: i >= text.length };
  };
  const space = () => {
    while (i < text.length && ' \t\n\r'.includes(text[i])) i += 1;
  };
  const string = () => {
    i += 1;
    while (i < text.length) {
      const char = text[i];
      if (char === '"') {
        i += 1;
        return;
      }
      if (char === '\n') fail();
      i += char === '\\' ? 2 : 1;
    }
    fail();
  };
  const number = () => {
    const pattern = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y;
    pattern.lastIndex = i;
    if (!pattern.exec(text)) fail();
    i = pattern.lastIndex;
  };
  const value = (): void => {
    space();
    if (i >= text.length) fail();
    const char = text[i];
    if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']';
      i += 1;
      space();
      if (text[i] === close) {
        i += 1;
        return;
      }
      for (;;) {
        if (close === '}') {
          space();
          if (text[i] !== '"') fail();
          string();
          space();
          if (text[i] !== ':') fail();
          i += 1;
        }
        value();
        space();
        if (text[i] === ',') {
          i += 1;
          continue;
        }
        if (text[i] === close) {
          i += 1;
          return;
        }
        fail();
      }
    }
    if (char === '"') {
      string();
      return;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      number();
      return;
    }
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return;
      }
    }
    fail();
  };
  try {
    value();
    space();
    if (i < text.length) fail();
    return null;
  } catch (problem) {
    return problem as { position: number; atEnd: boolean };
  }
}

function lineAt(text: string, position: number): number {
  return text.slice(0, position).split('\n').length;
}

/** The editor's text as data, or what is wrong with it and on which line. */
export function parsePinnedText(text: string): ParsedPin {
  if (!text.trim()) return { ok: false, line: null, message: 'Enter the data to pin.' };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (cause) {
    const located = locateDataError(text);
    let line: number | null = located ? lineAt(text, located.position) : null;
    if (line === null) {
      // The walk passed but the browser did not (a bad escape): read its words.
      const words = cause instanceof Error ? cause.message : '';
      const position = /position (\d+)/.exec(words);
      const lineWords = /line (\d+)/.exec(words);
      line = position ? lineAt(text, Number(position[1])) : lineWords ? Number(lineWords[1]) : null;
    }
    if (located?.atEnd) {
      return {
        ok: false,
        line,
        message: `The data ends too early on line ${line}. Check for a missing } or ].`,
      };
    }
    return {
      ok: false,
      line,
      message:
        line === null
          ? 'This is not valid data. Check for a missing comma, quote or bracket.'
          : `Line ${line} has something unexpected. Check for a missing comma, quote or bracket.`,
    };
  }
}

const TYPE_WORDS: Record<FieldType, string> = {
  text: 'text',
  number: 'a number',
  boolean: 'true or false',
  date: 'a date like "2026-11-03T09:00:00Z"',
  list: 'a list in [ ]',
  object: 'a set of fields in { }',
  media: 'a file',
};

function fits(type: FieldType, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  switch (type) {
    case 'text':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value));
    case 'list':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value);
    case 'media':
      return typeof value === 'string' || (typeof value === 'object' && !Array.isArray(value));
  }
}

/**
 * Checks pinned data against the fields the step says it gives. Data
 * that is not a set of fields cannot stand in for the step's result (an
 * error); a field left out or of another kind is allowed but worth a
 * word (warnings), since steps after this one read it.
 */
export function checkPinnedShape(
  node: Pick<GraphNode, 'type' | 'typeVersion' | 'config'>,
  value: unknown,
): { error: string | null; warnings: string[] } {
  const fields: OutputField[] = outputFieldsOf(node).filter(
    (field) => field.path !== 'error' && !field.path.startsWith('error.'),
  );
  if (fields.length === 0) return { error: null, warnings: [] };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      error: 'Pinned data must be a set of named fields, starting with { and ending with }.',
      warnings: [],
    };
  }
  const record = value as Record<string, unknown>;
  const top = fields.filter((field) => !field.path.includes('.'));
  const missing = top.filter((field) => !(field.path in record));
  const warnings: string[] = [];
  if (missing.length > 0) {
    const names = missing.map((field) => field.label);
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    warnings.push(`Steps after this one will find ${list} empty.`);
  }
  for (const field of top) {
    if (field.path in record && !fits(field.type, record[field.path])) {
      warnings.push(`${field.label} should be ${TYPE_WORDS[field.type]}.`);
    }
  }
  return { error: null, warnings };
}
