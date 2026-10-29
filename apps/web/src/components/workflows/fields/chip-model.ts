/**
 * The data chip editor's pure half (Module 06, blueprint 5.3): a field's
 * stored text to the editor's document and back, the words a chip shows,
 * its sample value and its formats in plain words.
 *
 * The stored text is the template Module 02 reads (`New post: {{
 * trigger.post.url }}`). The editor holds plain text, hard breaks for new
 * lines, and one inline `dataChip` node per data token carrying the token's
 * own text (`raw`), so an unchanged field is written back byte for byte.
 */
import {
  type AutomationGraph,
  applyFilter,
  buildIndex,
  type DataField,
  type FieldType,
  fallbackLabel,
  formatDate,
  formatToken,
  type GraphIndex,
  getDefinition,
  isTriggerType,
  lookupField,
  type OutputField,
  outputFieldsOf,
  parseTemplate,
  RUN_FIELDS,
  type RunScope,
  resolveValue,
  type Segment,
  sameSegments,
  serializeSegments,
  type TokenFilter,
  tokenSource,
  toText,
  upstreamOf,
  WORKSPACE_FIELDS,
} from '@postgear/automation';
import type { JSONContent } from '@tiptap/core';

export const CHIP_NODE = 'dataChip';

/** What a chip node holds. */
export interface ChipAttrs {
  /** The token's text as stored (`{{ trigger.post.url | upper }}`). */
  raw: string;
  /** Dotted token path (`trigger.post.url`). */
  path: string;
  filters: TokenFilter[];
}

// ---------------------------------------------------------------------------
// Text to document and back
// ---------------------------------------------------------------------------

function textNodes(value: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  value.split('\n').forEach((line, i) => {
    if (i > 0) nodes.push({ type: 'hardBreak' });
    // The editor refuses empty text nodes.
    if (line) nodes.push({ type: 'text', text: line });
  });
  return nodes;
}

export function chipNode(attrs: ChipAttrs): JSONContent {
  return { type: CHIP_NODE, attrs: { raw: attrs.raw, path: attrs.path, filters: attrs.filters } };
}

/** The editor document for a list of segments: one paragraph of text, breaks and chips. */
export function segmentsToDoc(segments: readonly Segment[]): JSONContent {
  const content: JSONContent[] = [];
  for (const segment of segments) {
    if (segment.kind === 'text') content.push(...textNodes(segment.value));
    else
      content.push(
        chipNode({
          path: segment.path,
          filters: segment.filters,
          raw: segment.raw ?? formatToken(segment),
        }),
      );
  }
  return {
    type: 'doc',
    content: [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }],
  };
}

export function templateToDoc(text: string): JSONContent {
  return segmentsToDoc(parseTemplate(text));
}

/** The segments a document holds; paragraphs (from a paste) join with new lines. */
export function docToSegments(doc: JSONContent): Segment[] {
  const segments: Segment[] = [];
  const addText = (value: string) => {
    const last = segments.at(-1);
    if (last?.kind === 'text') last.value += value;
    else segments.push({ kind: 'text', value });
  };
  (doc.content ?? []).forEach((block, i) => {
    if (i > 0) addText('\n');
    for (const node of block.content ?? []) {
      if (node.type === 'text') addText(node.text ?? '');
      else if (node.type === 'hardBreak') addText('\n');
      else if (node.type === CHIP_NODE) {
        const attrs = (node.attrs ?? {}) as Partial<ChipAttrs>;
        const filters = Array.isArray(attrs.filters) ? attrs.filters : [];
        const path = typeof attrs.path === 'string' ? attrs.path : '';
        if (!path) continue;
        segments.push({
          kind: 'token',
          path,
          filters,
          raw:
            typeof attrs.raw === 'string' && attrs.raw ? attrs.raw : formatToken({ path, filters }),
        });
      }
    }
  });
  return segments.filter((segment) => segment.kind === 'token' || segment.value !== '');
}

/**
 * The stored text for a document. When it still reads the same as
 * `previous`, `previous` comes back untouched (an exact round trip, even for
 * hand-typed odd spacing); otherwise the text pieces that did not change
 * keep their original spelling and the rest is written safely.
 */
export function docToTemplate(doc: JSONContent, previous?: string): string {
  const segments = docToSegments(doc);
  if (previous !== undefined) {
    const before = parseTemplate(previous);
    if (sameSegments(segments, before)) return previous;
    const originals = before.filter((segment) => segment.kind === 'text');
    let from = 0;
    for (const segment of segments) {
      if (segment.kind !== 'text') continue;
      const at = originals.findIndex(
        (original, i) => i >= from && original.kind === 'text' && original.value === segment.value,
      );
      if (at === -1) continue;
      segment.raw = originals[at].raw;
      from = at + 1;
    }
  }
  return serializeSegments(segments);
}

/** How many chips a document holds. */
export function chipCount(doc: JSONContent): number {
  return docToSegments(doc).filter((segment) => segment.kind === 'token').length;
}

// ---------------------------------------------------------------------------
// What a chip says
// ---------------------------------------------------------------------------

export interface ChipInfo {
  /** The source's name: the step's name, "Run" or "Workspace". */
  source: string;
  /** The field's plain-words label ("Post Link"). */
  field: string;
  /** The source's icon key. */
  icon: string;
  type?: FieldType;
  /** False when the data is gone or comes later: the chip turns red. */
  available: boolean;
  /** Why it is not available, in a sentence. */
  problem?: string;
}

const GONE = 'This data is no longer available.';
const LATER = 'This data comes from a step that runs later.';

const indexes = new WeakMap<AutomationGraph, GraphIndex>();
function indexOf(graph: AutomationGraph): GraphIndex {
  let index = indexes.get(graph);
  if (!index) {
    index = buildIndex(graph);
    indexes.set(graph, index);
  }
  return index;
}

function labelIn(fields: readonly OutputField[], field: string, path: string): string {
  return fields.find((candidate) => candidate.path === field)?.label ?? fallbackLabel(path);
}

/**
 * The source, label and state of a chip for the field of step `nodeKey`.
 * Run and Workspace data is always there; a step's data must come from a
 * step that is still in the graph, runs before this one, and declares the
 * field.
 */
export function chipInfo(
  graph: AutomationGraph,
  nodeKey: string | undefined,
  path: string,
): ChipInfo {
  const source = tokenSource(path);
  const fieldOf = (fields: readonly OutputField[], title: string, icon: string): ChipInfo => {
    const found = lookupField(fields, source.field);
    return {
      source: title,
      field: labelIn(fields, source.field, path),
      icon,
      type: found.type,
      available: found.known,
      ...(found.known ? {} : { problem: GONE }),
    };
  };

  switch (source.root) {
    case 'run':
      return fieldOf(RUN_FIELDS, 'Run', 'run');
    case 'workspace':
      return fieldOf(WORKSPACE_FIELDS, 'Workspace', 'workspace');
    case 'trigger': {
      const trigger = graph.nodes.find((node) => isTriggerType(node.type));
      if (!trigger) {
        return {
          source: 'Trigger',
          field: fallbackLabel(path),
          icon: 'manual',
          available: false,
          problem: GONE,
        };
      }
      const def = getDefinition(trigger.type, trigger.typeVersion);
      return fieldOf(outputFieldsOf(trigger), trigger.name, def?.icon ?? 'manual');
    }
    case 'nodes': {
      const node = graph.nodes.find((candidate) => candidate.key === source.nodeKey);
      if (!node || !source.wellFormed) {
        return {
          source: 'Removed Step',
          field: fallbackLabel(path),
          icon: 'manual',
          available: false,
          problem: GONE,
        };
      }
      const def = getDefinition(node.type, node.typeVersion);
      const info = fieldOf(outputFieldsOf(node), node.name, def?.icon ?? 'manual');
      if (nodeKey && info.available && !upstreamOf(indexOf(graph), nodeKey).includes(node.key)) {
        return { ...info, available: false, problem: LATER };
      }
      return info;
    }
    default:
      return {
        source: 'Data',
        field: fallbackLabel(path),
        icon: 'manual',
        available: false,
        problem: GONE,
      };
  }
}

/** What a screen reader says for a chip: "data: Post Published, Post Link". */
export function chipName(info: Pick<ChipInfo, 'source' | 'field'>): string {
  return `data: ${info.source}, ${info.field}`;
}

// ---------------------------------------------------------------------------
// Sample values and formats
// ---------------------------------------------------------------------------

/** The chip's value in `scope` with its formats applied, or undefined when there is none. */
export function chipValue(
  path: string,
  filters: readonly TokenFilter[],
  scope: RunScope | undefined,
  timeZone?: string,
): unknown {
  if (!scope) return undefined;
  let value = resolveValue(path, scope);
  for (const filter of filters) value = applyFilter(value, filter, { timeZone });
  return value;
}

/** A value as one short line for previews: "(empty)" for nothing. */
export function previewText(value: unknown, max = 80): string {
  const text = toText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '(empty)';
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/** A fixed day the date format examples are written for: 3 November 2026, 09:00 UTC. */
const EXAMPLE_DAY = Date.UTC(2026, 10, 3, 9, 0);

/** One format in plain words: "Shorten to 200 characters", "Date as 2026-11-03". */
export function filterWords(filter: TokenFilter): string {
  switch (filter.name) {
    case 'truncate':
      return `Shorten to ${typeof filter.arg === 'number' ? filter.arg : 200} characters`;
    case 'upper':
      return 'Upper case';
    case 'lower':
      return 'Lower case';
    case 'trim':
      return 'Trim spaces';
    case 'date': {
      const pattern = typeof filter.arg === 'string' ? filter.arg : undefined;
      return `Date as ${formatDate(EXAMPLE_DAY, pattern ?? 'yyyy-MM-dd', 'UTC')}`;
    }
    case 'default':
      return `If empty use "${filter.arg ?? ''}"`;
    case 'json':
      return 'As raw data for other apps';
    case 'join': {
      const separator = typeof filter.arg === 'string' ? filter.arg : ', ';
      if (separator === ', ' || separator === ',') return 'Join a list with commas';
      if (separator === ' ') return 'Join a list with spaces';
      if (separator === '\n') return 'Join a list, one per line';
      return `Join a list with "${separator}"`;
    }
    case 'first':
      return 'First item of a list';
    case 'count':
      return 'Count the items';
    case 'urlencode':
      return 'Safe to put in a link';
    default:
      return `Unknown format "${filter.name}"`;
  }
}

/** A data field's sample as a short line for Insert Data rows. */
export function fieldSample(field: Pick<DataField, 'sample'>): string | undefined {
  if (field.sample === undefined) return undefined;
  const text = previewText(field.sample, 40);
  return text === '(empty)' ? undefined : text;
}
