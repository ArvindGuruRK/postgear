/**
 * The seam between the field kit (`fields/`) and the builder that hosts it
 * (the step panel, the Expanded view, the issues list), Module 06.
 *
 * The kit never imports the builder's reducer: `SchemaForm` reports edits
 * through `onChange(path, value)` and the panel turns them into reducer
 * actions (coalesced for undo). The builder never reaches into a field: it
 * finds one by its `data-field-path` attribute to focus it, and inserts data
 * through `insertDataAtLastField`.
 */
import type {
  AutomationGraph,
  FormTab,
  GraphNode,
  NodeDefinition,
  RunScope,
  ValidationIssue,
} from '@postgear/automation';
import type { Channel } from '@/types/channel';
import type { Connection } from '@/types/workflows';

/** What every field may need from the workspace and the workflow around it. */
export interface FieldContext {
  orgId: string;
  automationId: string;
  /** The workspace's connections (never credentials). */
  connections: readonly Connection[];
  /** The workspace's channels. */
  channels: readonly Channel[];
  /** Workspace admins may connect apps; members are told to ask one. */
  canManage: boolean;
  /**
   * Data for sample values on chips, Insert Data and the Input pane: pinned
   * data, else the last test run (Module 08), else `sampleScope` (Module 02).
   */
  scope: RunScope;
  /** Where each step's data in `scope` came from, for the "Pinned", "Last test 14:02", "Sample" labels. */
  scopeSource: Readonly<Record<string, DataSource>>;
  /** The browser's IANA zone, the default for the schedule builder. */
  timeZone: string;
}

export type DataSource =
  | { kind: 'pinned'; at: string }
  | { kind: 'lastTest'; at: string }
  | { kind: 'sample' };

export interface SchemaFormProps {
  definition: NodeDefinition;
  node: GraphNode;
  /** The graph as it is now (Insert Data lists this step's upstream steps from it). */
  graph: AutomationGraph;
  tab: FormTab;
  /** One edit at a dotted config path ('' replaces the whole config). */
  onChange: (path: string, value: unknown) => void;
  /** This step's validation issues: inline errors by `field`, red chips by `token`. */
  issues: readonly ValidationIssue[];
  context: FieldContext;
}

/**
 * Every field's outer element carries `data-field-path="<config path>"`, so
 * focus-the-field can do `panel.querySelector('[data-field-path="message"]')`,
 * scroll it into view and focus its first focusable element.
 */
export const FIELD_PATH_ATTRIBUTE = 'data-field-path';

/**
 * Drag to map: an Input pane row sets this type on `dataTransfer` with the
 * token path (`nodes.<key>.output.post.url`, `trigger.post.url`) as the
 * value; a chip input that accepts data inserts a chip at the drop caret.
 */
export const DATA_DRAG_MIME = 'application/x-postgear-data';

/**
 * Click to map: chip inputs register themselves when focused; an Input pane
 * row calls this to insert a chip at the last focused field's caret.
 * Returns false when no data field has been focused yet.
 */
export type InsertDataAtLastField = (tokenPath: string) => boolean;
