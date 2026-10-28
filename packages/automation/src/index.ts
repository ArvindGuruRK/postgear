/**
 * `@postgear/automation`: the Workflow Builder's engine core, the one
 * place that knows what a workflow is.
 *
 * The web app (canvas, step panels, live checks), the API (saving,
 * validation, activation) and the worker (running a pinned version) all
 * import it, so they agree on the graph shape, the step catalog, what
 * counts as a problem, and the order and branches a run takes. The UI says
 * "workflow" and "step"; the code says `Automation` and `node`, because
 * "workflow" already means a Temporal workflow everywhere else here.
 *
 * Deliberately **pure**: no Node built-ins, no Prisma, no Temporal, no
 * DOM, no clock and no randomness (callers pass ids and times in). The
 * worker's run workflow executes inside Temporal's sandbox, which allows
 * none of those and must replay identically, and keeping this package free
 * of them is what lets it import `planNext` there. Zod is the only
 * dependency.
 *
 * Import from the package root only; the folders are not a public API.
 */

// Catalog
export {
  AI_STEP_CREDITS,
  CONNECTION_KINDS,
  type ColourFamily,
  type ConnectionKind,
  type ConnectionKindInfo,
  type ConnectionUse,
  connectionKindInfo,
  describeNode,
  EXECUTABLE_TYPES,
  type FieldType,
  getDefinition,
  hasErrorBranch,
  ICON_KEYS,
  type IconKey,
  isNodeType,
  isTriggerType,
  listDefinitions,
  NODE_CATALOG,
  NODE_TYPES,
  type NodeCategory,
  type NodeDefinition,
  type NodeType,
  nodeTitle,
  type OutputField,
  outputFieldsOf,
  outputPortsOf,
  type PortSpec,
  PUBLISH_FAILURE_REASON_IDS,
  PUBLISH_FAILURE_REASONS,
  PUBLISH_PLATFORM_IDS,
  PUBLISH_PLATFORMS,
  type PublishFailureReasonId,
  type PublishPlatform,
  type PublishPlatformId,
  parseNodeConfig,
  platformById,
  type RequiredField,
  type SummaryContext,
} from './catalog';
// Config shapes shared by several steps (Module 02 adds their logic)
export {
  CONDITION_OPERATORS,
  type ConditionGroup,
  type ConditionOperator,
  type ConditionRule,
  conditionGroupSchema,
  conditionRuleSchema,
  emptyConditionGroup,
  MAX_CONDITION_RULES,
} from './conditions/schema';
// Graph shape
export {
  type AutomationGraph,
  automationGraphSchema,
  CASE_ID_PATTERN,
  edgeId,
  emptyGraph,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  graphEdgeSchema,
  graphNodeSchema,
  type InputPortId,
  isPortId,
  NODE_KEY_PATTERN,
  NOTE_COLOURS,
  type NoteColour,
  type OnErrorPolicy,
  onErrorPolicySchema,
  type PortId,
  portIdSchema,
  type StickyNote,
  stickyNoteSchema,
  uniqueNodeName,
  upgradeGraph,
} from './graph/schema';
// Limits
export { GRAPH_HARD_CAPS, LIMITS } from './limits';
// Order and branch planning
export { buildIndex, edgesFrom, type GraphIndex, type GraphInput } from './plan/build-index';
export {
  areExclusive,
  type BranchConditions,
  branchConditions,
  type ExclusiveGroup,
  exclusiveGroups,
} from './plan/exclusive';
export { topologicalOrder, upstreamOf } from './plan/order';
export {
  type PlanOutcome,
  type PlanResult,
  type PlanStepState,
  type PlanStepStatus,
  planNext,
  type RunPlanState,
  type SkippedStep,
  type SkipReason,
} from './plan/plan-next';
// Connecting steps
export { CONNECT_REASONS, type ConnectCheck, canConnect, type ProposedEdge } from './ports';
// The Schedule trigger's config shape (Module 02 adds its logic)
export {
  SCHEDULE_FREQUENCIES,
  type ScheduleConfig,
  type ScheduleFrequency,
  scheduleConfigSchema,
  TIME_OF_DAY_PATTERN,
  timeZoneSchema,
  WEEKDAYS,
  type Weekday,
} from './schedule/schema';

// Validation
export { VALIDATION_RULES } from './validate/rules';
export type {
  ChannelState,
  ConnectionState,
  IssueCode,
  ValidationContext,
  ValidationIssue,
  ValidationRule,
} from './validate/types';
export { hasBlockingIssues, validateGraph } from './validate/validate-graph';
