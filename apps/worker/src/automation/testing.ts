/**
 * Helpers for the run engine's tests: graphs in a line or two, a memory
 * store with one run, and the activities built on it. Not used by
 * production code.
 */
import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  type NodeType,
  type PortId,
} from '@postgear/automation';
import type { AutomationRunOptions } from '@postgear/scheduling';
import type { Client } from '@temporalio/client';
import { createAutomationActivities } from '../activities/automation.activities';
import type { ActivityDeps } from '../activities/deps';
import type { ExecutorRegistry } from './executors/types';
import type { GatewayClient } from './gateway-client';
import { MemoryRunStore, type SeedRun } from './memory-run-store';

export const ORG = 'org_test';
export const OTHER_ORG = 'org_other';
export const AUTOMATION_ID = 'auto_1';
export const RUN_ID = 'run_1';
export const NOW = new Date('2026-11-03T09:00:00.000Z');

type NodeOverrides = Partial<Omit<GraphNode, 'key' | 'type' | 'config'>> & {
  config?: Record<string, unknown>;
};

/** A step with its type's default settings, named after its key unless told otherwise. */
export function step(key: string, type: NodeType, overrides: NodeOverrides = {}): GraphNode {
  const definition = getDefinition(type);
  if (!definition) throw new Error(`No definition for ${type}`);
  const defaults = structuredClone(definition.defaultConfig) as Record<string, unknown>;
  const { config, ...rest } = overrides;
  return {
    key,
    type,
    typeVersion: definition.typeVersion,
    name: key,
    position: { x: 0, y: 0 },
    config: { ...defaults, ...config },
    ...rest,
  };
}

export function line(source: string, target: string, sourcePort: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

export function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

/** One condition rule group. */
export function rules(
  ...list: { left: string; operator: string; right?: string }[]
): Record<string, unknown> {
  return {
    match: 'all',
    rules: list.map((rule, i) => ({ id: `r${i + 1}`, ...rule })),
  };
}

export function testOptions(overrides: Partial<AutomationRunOptions> = {}): AutomationRunOptions {
  return { scope: { kind: 'run' }, sendForReal: [], triggerData: 'sample', ...overrides };
}

export interface Harness {
  store: MemoryRunStore;
  activities: ReturnType<typeof createAutomationActivities>;
  /** Set to change the attempt the next activity call reports. */
  attempt: { value: number };
  clock: { now: Date };
  ref: { runId: string; organizationId: string };
  stepRef(nodeKey: string): { runId: string; organizationId: string; nodeKey: string };
}

/** A memory store holding one RUNNING test run of `graph`, and the activities on it. */
export function harness(
  graph: AutomationGraph,
  run: Partial<SeedRun> = {},
  options: {
    simulation?: boolean;
    executors?: ExecutorRegistry;
    /** The step gateway the executors call (posts, AI, email). */
    gateway?: GatewayClient;
    /** What `deps.temporalClient()` returns (the auto-pause deletes a schedule through it). */
    temporalClient?: () => Promise<Client>;
  } = {},
): Harness {
  const store = new MemoryRunStore();
  store.addRun({
    id: RUN_ID,
    organizationId: ORG,
    automationId: AUTOMATION_ID,
    automationName: 'Publishing Report',
    mode: 'TEST',
    status: 'RUNNING',
    startedAt: NOW,
    options: testOptions(),
    graph,
    ...run,
  });
  const attempt = { value: 1 };
  const clock = { now: NOW };
  store.now = () => clock.now;
  const deps = {
    env: { AUTOMATION_SIMULATION: options.simulation ? 'true' : 'false' },
    temporalClient:
      options.temporalClient ??
      (async () => {
        throw new Error('No Temporal client in this test.');
      }),
  } as unknown as ActivityDeps;
  const activities = createAutomationActivities(deps, {
    store,
    now: () => clock.now,
    attempt: () => attempt.value,
    ...(options.executors ? { executors: options.executors } : {}),
    ...(options.gateway ? { gateway: options.gateway } : {}),
  });
  const ref = { runId: run.id ?? RUN_ID, organizationId: run.organizationId ?? ORG };
  return { store, activities, attempt, clock, ref, stepRef: (nodeKey) => ({ ...ref, nodeKey }) };
}
