/**
 * What an executor is: the code that runs one step type.
 *
 * The activity has already loaded the run, parsed the step's settings,
 * resolved its data tokens, decided whether it is a dry run and loaded its
 * connection; the executor only does the step's own work and says which
 * output the run continues through. It never writes the step's row (the
 * activity does, redacted) and throws `StepFailure` to fail.
 */
import type {
  AutomationGraph,
  GraphNode,
  NodeDefinition,
  NodeType,
  PortId,
  RunScope,
} from '@postgear/automation';
import type { GatewayClient } from '../gateway-client';
import type { PriorOutput, RunStore, StoredConnection } from '../run-store';

export interface ExecLog {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ExecRun {
  id: string;
  organizationId: string;
  automationId: string;
  automationName: string;
  mode: 'test' | 'live';
  /** ISO. */
  startedAt: string;
}

export interface ExecDeps {
  /** Writes PostGear data (In-App Notification); tests pass the memory store. */
  store: RunStore;
  /** The API's internal step gateway (posts, AI, email; Module 10). Call it through `callGateway`. */
  gateway: GatewayClient;
  now(): Date;
}

export interface ExecContext<C = Record<string, unknown>> {
  run: ExecRun;
  graph: AutomationGraph;
  node: GraphNode;
  definition: NodeDefinition;
  /** The settings with every data token filled in. */
  config: C;
  /** The settings as saved, tokens unresolved, parsed by the type's schema (conditions read these). */
  rawConfig: Record<string, unknown>;
  scope: RunScope;
  /** Earlier steps' outputs and how they finished, by step key. */
  priors: Readonly<Record<string, PriorOutput>>;
  timeZone: string;
  /** True when the step must not leave PostGear (a test run, not sent for real). */
  dryRun: boolean;
  /** True under AUTOMATION_SIMULATION: providers use `simulate()`, not `send()`. */
  simulation: boolean;
  /** WEBHOOK_ALLOW_PRIVATE_URLS: pass to `safeHttpRequest` as `allowPrivate`. Absent means false. */
  allowPrivateUrls?: boolean;
  /** `${runId}:${nodeKey}`, for every provider that accepts one. */
  idempotencyKey: string;
  /** The step's connection, decrypted; null when it has none or it is not usable. */
  connection: StoredConnection | null;
  /** Temporal's attempt number, 1 for the first. */
  attempt: number;
  /** Cancelled when the run is cancelled or the attempt times out. */
  signal: AbortSignal;
  /** Long waits call this so a dead worker is noticed (slow steps). */
  heartbeat(): void;
  deps: ExecDeps;
  log: ExecLog;
}

export interface ExecResult {
  output: unknown;
  /** Ports the run continues through; omitted means `['out']`, `[]` ends the branch. */
  ports?: PortId[];
  /** `dryRun` stores DRY_RUN; `handledError` when the executor itself chose to carry on. */
  status?: 'succeeded' | 'dryRun' | 'handledError';
  /** AI credits the step used (net of refunds); added to the run's total with the step's row. */
  credits?: number;
}

export interface Executor<C = Record<string, unknown>> {
  type: NodeType;
  run(ctx: ExecContext<C>): Promise<ExecResult>;
}

/** Executors by step type. */
export type ExecutorRegistry = ReadonlyMap<string, Executor>;
