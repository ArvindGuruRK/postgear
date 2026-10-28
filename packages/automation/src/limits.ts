/**
 * Every size and rate limit of the Workflow Builder, in one place.
 *
 * Constants for now: the API, the worker and the web app all read the same
 * numbers, and a later sprint maps them to plan entitlements. Nothing here is
 * enforced by this file alone; each limit names who enforces it.
 */
export const LIMITS = {
  /** Steps per workflow. `validateGraph` reports more as `graph.too_many_nodes`. */
  maxNodes: 50,
  /** Lines between steps per workflow. `validateGraph` reports more as `graph.too_many_edges`. */
  maxEdges: 120,
  /** Sticky notes per workflow. The graph schema refuses more. */
  maxNotes: 30,
  /** Step runs in one run, retries included. The run workflow fails the run past it. */
  maxStepExecutionsPerRun: 200,
  /** Steps of one run that may run at the same time. */
  maxParallelBranches: 4,
  /** A run, Manual Review waits included, ends after this many days. */
  runTimeoutDays: 30,
  /** A Manual Review expires after this many days. */
  reviewTimeoutDays: 7,
  /** Live runs of one workspace running at the same time; more wait their turn. */
  maxConcurrentRunsPerWorkspace: 10,
  /** Test runs one person may start per minute. */
  testRunsPerMinutePerUser: 3,
  /** Size cap of one step's stored input or output, after redaction. */
  stepIoCapBytes: 65_536,
  /** Size cap of the data a Webhook trigger accepts. */
  webhookBodyCapBytes: 262_144,
  /** A schedule in a workflow with AI steps may not run more often than this. */
  minScheduleMinutesWithAi: 60,
} as const;

/**
 * Hard caps of the graph schema, twice the limits above.
 *
 * The schema refuses anything past these so a request stays small, but they
 * sit above `LIMITS` on purpose: pasting a few steps too many must still save
 * the draft (and show the issue), never lose the user's work.
 */
export const GRAPH_HARD_CAPS = {
  nodes: LIMITS.maxNodes * 2,
  edges: LIMITS.maxEdges * 2,
  notes: LIMITS.maxNotes,
} as const;
