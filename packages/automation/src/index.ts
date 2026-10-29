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
// Conditions (If / Else, Filter, Paths)
export {
  type DescribeConditionOptions,
  describeCondition,
  describeRule,
} from './conditions/describe';
export {
  type ConditionResult,
  type EvaluateOptions,
  evaluateCondition,
  type RuleResult,
} from './conditions/evaluate';
export {
  type ConditionType,
  conditionTypeOf,
  OPERATORS,
  OPERATORS_BY_TYPE,
  type OperatorInfo,
  operatorFamily,
  operatorsFor,
} from './conditions/operators';
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
// Plain words for the activation dialog
export { describeWorkflow, type NodeRef, type RiskSummary, riskSummary } from './describe';
// Graph shape
export { rekeyGraph } from './graph/rekey';
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
export { certainBefore } from './plan/guaranteed';
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
// Secrets: hiding them in run data, refusing them in a saved graph
export {
  isSecretKey,
  SECRET_KEY_PATTERN,
  SECRET_VALUE_PATTERNS,
  secretShapeIn,
} from './redact/patterns';
export { HIDDEN, type Redacted, type RedactOptions, redact, utf8Bytes } from './redact/redact';
export {
  findSecretLikeValues,
  SECRET_REFUSED_MESSAGE,
  type SecretFinding,
} from './redact/secrets';
// Sample data for previews and Test Step
export { SAMPLE_RUN, sampleScope, stepSample, triggerSample } from './samples';
// Schedules
export {
  DAY_NAMES,
  type DescribeScheduleOptions,
  describeSchedule,
  ordinal,
  scheduleNotes,
  zoneWords,
} from './schedule/describe';
export { nextRuns, scheduleIntervalMinutes } from './schedule/next-runs';
export {
  HOURLY_STEPS,
  SCHEDULE_FREQUENCIES,
  type ScheduleConfig,
  type ScheduleFrequency,
  scheduleConfigSchema,
  TIME_OF_DAY_PATTERN,
  timeZoneSchema,
  WEEKDAYS,
  type Weekday,
} from './schedule/schema';
export {
  type CalendarSpecShape,
  LEAP_YEARS,
  type ScheduleSpecShape,
  type SpecDayOfWeek,
  type SpecMonth,
  type SpecRange,
  type SpecValue,
  toTemporalScheduleSpec,
} from './schedule/temporal-spec';
// Starter templates
export {
  type AutomationTemplate,
  getTemplate,
  type InstantiateOptions,
  instantiateTemplate,
  listTemplates,
  TEMPLATE_COLUMN,
  TEMPLATE_ROW,
  TEMPLATES,
  type TemplateCategory,
  type TemplateNeed,
  type TemplateSummary,
} from './templates';
// Time helpers the panels share (no `Date`, zone-aware)
export { parseIsoDate, toIsoString } from './time/calendar';
export { DEFAULT_DATE_PATTERN, formatDate } from './time/format';
export { isValidTimeZone, offsetMinutes, zonedTime, zonedToEpoch } from './time/zone';
// Data tokens (Insert Data chips)
export {
  availableData,
  type DataField,
  type DataGroup,
  lookupField,
  sourceFields,
  tokenLabeler,
} from './tokens/available';
export {
  applyFilter,
  FILTER_NAMES,
  type FilterInfo,
  isKnownFilter,
  TOKEN_FILTERS,
} from './tokens/filters';
export { fallbackLabel, humanise, RUN_FIELDS, WORKSPACE_FIELDS } from './tokens/labels';
export {
  formatToken,
  MAX_FIELD_DEPTH,
  MAX_TOKENS_PER_FIELD,
  nodeTokenPath,
  parseTemplate,
  type Segment,
  sameSegments,
  serializeSegments,
  singleToken,
  type TextSegment,
  TOKEN_ROOTS,
  type TokenFilter,
  type TokenRoot,
  type TokenSegment,
  type TokenSource,
  tokenSource,
  tokensIn,
} from './tokens/parse';
export {
  type Resolved,
  type ResolvedConfig,
  type ResolveOptions,
  resolveConfig,
  resolveTemplate,
} from './tokens/resolve';
export { renameNodesInConfig, renameNodesInText } from './tokens/rewrite';
export {
  isEmptyValue,
  type RunScope,
  resolveValue,
  toEpoch,
  toNumber,
  toText,
} from './tokens/values';

// Validation
export { VALIDATION_RULES } from './validate/rules';
export { aiScheduleLimit } from './validate/rules/schedule';
export type {
  ChannelState,
  ConnectionState,
  IssueCode,
  ValidationContext,
  ValidationIssue,
  ValidationRule,
} from './validate/types';
export { hasBlockingIssues, validateGraph } from './validate/validate-graph';
