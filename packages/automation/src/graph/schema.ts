/**
 * The shape of a workflow graph: steps (nodes), the lines between them
 * (edges) and sticky notes. One Zod schema, used by the API's Zod pipe on
 * save, by the web app before it sends, and by the worker when it loads a
 * pinned version.
 *
 * ## What the schema checks, and what it leaves to `validateGraph`
 *
 * The schema refuses what can never be saved: unknown keys (so a secret
 * cannot ride along in an extra field), malformed ids, duplicate keys, lines
 * pointing at steps that do not exist, and sizes past `GRAPH_HARD_CAPS`.
 * Everything a user can get wrong while drawing (no trigger, a loop, a
 * missing Slack connection, too many steps) is a `validateGraph` issue
 * instead, because drafts may be unfinished and must still save.
 *
 * ## Stable keys (the first TriForms lesson)
 *
 * A node's `key` is made by the client once (nanoid, 10 characters) and
 * never changes or gets reused. Data tokens point at keys, never at names
 * or database ids, so renaming a step or activating a new version cannot
 * break them. Step config (`config`) is validated per type by the catalog,
 * not here.
 */
import { z } from 'zod';
import { GRAPH_HARD_CAPS } from '../limits';

/** The graph format this code writes. Bump it with a step in `upgradeGraph`. */
export const GRAPH_SCHEMA_VERSION = 1;

/** Node keys: what nanoid makes, and safe to use inside a data token path. */
export const NODE_KEY_PATTERN = /^[A-Za-z0-9_-]{4,32}$/;

/** A `case:<id>` port of a Paths step; the id is made by the client and never changes. */
export const CASE_ID_PATTERN = /^[A-Za-z0-9_-]{1,21}$/;

/** Named handles a line leaves from. `case:<id>` belongs to a Paths step. */
export type PortId =
  | 'out'
  | 'true'
  | 'false'
  | 'approved'
  | 'rejected'
  | 'fallback'
  | 'error'
  | `case:${string}`;

const PORT_PATTERN = /^(out|true|false|approved|rejected|fallback|error|case:[A-Za-z0-9_-]{1,21})$/;

export function isPortId(value: unknown): value is PortId {
  return typeof value === 'string' && PORT_PATTERN.test(value);
}

export const portIdSchema = z.custom<PortId>(isPortId, 'This is not a known output.');

/** The one input handle. Triggers have none. */
export type InputPortId = 'in';

const positionSchema = z
  .object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  })
  .strict();

/**
 * What happens when a step fails (n8n's On Error, Make's error routes).
 *
 * - `stop` (the default when absent): the step fails and its branch stops.
 * - `continue`: the step is recorded as failed, the run goes on, and its
 *   output is `{ error: { message, code } }`.
 * - `branch`: the step gets an `error` output and the error flows down it.
 *
 * `retries` come on top of the automatic retries of transient errors.
 */
export const onErrorPolicySchema = z
  .object({
    mode: z.enum(['stop', 'continue', 'branch']),
    retries: z
      .object({
        max: z.number().int().min(0).max(5),
        waitSeconds: z.number().int().min(5).max(600),
      })
      .strict()
      .optional(),
  })
  .strict();

export type OnErrorPolicy = z.infer<typeof onErrorPolicySchema>;

export const graphNodeSchema = z
  .object({
    key: z.string().regex(NODE_KEY_PATTERN, 'This step id is not valid.'),
    /** A catalog type id such as `notify.slack`; unknown ids are a validation issue, not a parse error. */
    type: z.string().regex(/^[a-z]+\.[A-Za-z0-9]+$/, 'This step type is not valid.'),
    typeVersion: z.number().int().min(1),
    name: z.string().trim().min(1, 'Give this step a name.').max(60),
    position: positionSchema,
    /** Validated per type by the catalog's `configSchema`. Never holds a secret. */
    config: z.record(z.unknown()),
    disabled: z.boolean().optional(),
    onError: onErrorPolicySchema.optional(),
    /** A short note shown under the step. */
    notes: z.string().max(280).optional(),
  })
  .strict();

export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z
  .object({
    id: z.string().min(1).max(120),
    source: z.string().regex(NODE_KEY_PATTERN),
    sourcePort: portIdSchema,
    target: z.string().regex(NODE_KEY_PATTERN),
    targetPort: z.literal('in'),
  })
  .strict();

export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const NOTE_COLOURS = ['yellow', 'blue', 'green', 'pink', 'violet'] as const;
export type NoteColour = (typeof NOTE_COLOURS)[number];

/** Display only: the engine and `validateGraph` ignore notes. */
export const stickyNoteSchema = z
  .object({
    id: z.string().regex(NODE_KEY_PATTERN),
    position: positionSchema,
    size: z
      .object({
        w: z.number().finite().min(80).max(2_000),
        h: z.number().finite().min(40).max(2_000),
      })
      .strict(),
    text: z.string().max(2_000),
    colour: z.enum(NOTE_COLOURS),
  })
  .strict();

export type StickyNote = z.infer<typeof stickyNoteSchema>;

/** The id every line carries, derived from its ends so a duplicate line cannot exist. */
export function edgeId(source: string, sourcePort: PortId, target: string): string {
  return `${source}:${sourcePort}->${target}`;
}

export const automationGraphSchema = z
  .object({
    schemaVersion: z.literal(GRAPH_SCHEMA_VERSION),
    nodes: z.array(graphNodeSchema).max(GRAPH_HARD_CAPS.nodes),
    edges: z.array(graphEdgeSchema).max(GRAPH_HARD_CAPS.edges),
    notes: z.array(stickyNoteSchema).max(GRAPH_HARD_CAPS.notes),
  })
  .strict()
  .superRefine((graph, issue) => {
    const keys = new Set<string>();
    graph.nodes.forEach((node, i) => {
      if (keys.has(node.key)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', i, 'key'],
          message: 'Two steps share the same id.',
        });
      }
      keys.add(node.key);
    });

    const edgeIds = new Set<string>();
    graph.edges.forEach((edge, i) => {
      if (edge.id !== edgeId(edge.source, edge.sourcePort, edge.target)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'id'],
          message: 'This line id does not match its ends.',
        });
      }
      if (edgeIds.has(edge.id)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i, 'id'],
          message: 'These steps are already connected.',
        });
      }
      edgeIds.add(edge.id);
      if (!keys.has(edge.source) || !keys.has(edge.target)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['edges', i],
          message: 'This line points at a step that does not exist.',
        });
      }
    });

    const noteIds = new Set<string>();
    graph.notes.forEach((note, i) => {
      if (noteIds.has(note.id)) {
        issue.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes', i, 'id'],
          message: 'Two notes share the same id.',
        });
      }
      noteIds.add(note.id);
    });
  });

export type AutomationGraph = z.infer<typeof automationGraphSchema>;

/** A new, blank workflow. */
export function emptyGraph(): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes: [], edges: [], notes: [] };
}

/**
 * Reads stored graph JSON of any known format version and returns it in the
 * current one, validated. Throws a `ZodError` when the data is not a graph,
 * and an `Error` when it comes from a newer PostGear than this code.
 *
 * Version 1 is the first format, so today this only validates. It exists
 * before the first row is saved (the Design Studio lesson): the day the
 * format changes, the step from 1 to 2 goes here and every stored draft and
 * version keeps opening.
 */
export function upgradeGraph(input: unknown): AutomationGraph {
  const version =
    typeof input === 'object' && input !== null && 'schemaVersion' in input
      ? (input as { schemaVersion: unknown }).schemaVersion
      : undefined;

  if (typeof version === 'number' && version > GRAPH_SCHEMA_VERSION) {
    throw new Error(
      `This workflow was saved by a newer version of PostGear (format ${version}). Reload the page.`,
    );
  }

  return automationGraphSchema.parse(input);
}

/**
 * A step name that no other step in the graph has, for new and pasted
 * steps: "Slack", then "Slack 2", "Slack 3". Names must be unique because
 * data chips show them.
 */
export function uniqueNodeName(base: string, graph: Pick<AutomationGraph, 'nodes'>): string {
  const taken = new Set(graph.nodes.map((node) => node.name.trim().toLowerCase()));
  const trimmed = base.trim().slice(0, 56) || 'Step';
  if (!taken.has(trimmed.toLowerCase())) return trimmed;
  for (let n = 2; ; n++) {
    const candidate = `${trimmed} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
