import type { ConnectionKind } from '../catalog/types';
import type { AutomationGraph } from '../graph/schema';
import type { GraphIndex } from '../plan/build-index';

/**
 * Stable issue codes. The UI keys copy and focus on them, so a code never
 * changes meaning.
 */
export type IssueCode =
  | 'graph.no_trigger'
  | 'graph.many_triggers'
  | 'graph.unreachable'
  | 'graph.cycle'
  | 'graph.bad_port'
  | 'graph.needs_merge'
  | 'graph.too_many_nodes'
  | 'graph.too_many_edges'
  | 'graph.dead_end_output'
  | 'graph.check_failed'
  | 'node.unknown_type'
  | 'node.coming_soon'
  | 'node.not_runnable'
  | 'node.config_invalid'
  | 'node.required_missing'
  | 'node.connection_missing'
  | 'node.connection_broken'
  | 'node.channel_missing'
  | 'node.channel_wrong_platform'
  | 'node.filter_channel_missing'
  | 'node.duplicate_name'
  | 'node.disabled_output_used'
  | 'token.unknown_node'
  | 'token.not_upstream'
  | 'token.unknown_field'
  | 'token.bad_filter'
  | 'token.maybe_empty'
  | 'token.too_many'
  | 'condition.empty'
  | 'condition.missing_value'
  | 'condition.type_mismatch'
  | 'schedule.too_frequent_for_ai';

export interface ValidationIssue {
  /** Errors block tests and activation; warnings do not. */
  severity: 'error' | 'warning';
  code: IssueCode;
  /** Sentence case, plain words, no jargon. */
  message: string;
  nodeKey?: string;
  edgeId?: string;
  /** The config path to focus ("message", "cases.0.name"). */
  field?: string;
  /** `token.*`: the chip's text inside that field, so the UI paints that one chip red. */
  token?: string;
}

/** A saved connection as validation sees it: never its credentials. */
export interface ConnectionState {
  id: string;
  kind: ConnectionKind;
  name: string;
  status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'ERROR';
}

/** A workspace channel as validation sees it. */
export interface ChannelState {
  id: string;
  /** social-core provider identifier (`instagram`, `linkedin-page`). */
  provider: string;
  name: string;
  status: 'active' | 'disabled' | 'needsReconnect';
}

/**
 * What the pure package cannot know: the workspace's connections and
 * channels, and which step types the worker can run. The web app and the
 * API fill it; the worker passes the pinned version's.
 */
export interface ValidationContext {
  connections: readonly ConnectionState[];
  channels: readonly ChannelState[];
  /** The worker's `EXECUTABLE_TYPES`. Absent means "do not check". */
  availableTypes?: ReadonlySet<string>;
}

/** One rule: a small function in its own file, registered in `VALIDATION_RULES`. */
export type ValidationRule = (
  graph: AutomationGraph,
  index: GraphIndex,
  ctx: ValidationContext,
) => ValidationIssue[];
