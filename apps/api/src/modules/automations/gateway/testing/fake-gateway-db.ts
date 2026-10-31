/**
 * An in-memory stand-in for the two tables the step gateway reads and
 * writes (`AutomationRun` for the binding, `AutomationEffect` for the
 * ledger), with the behaviours `GatewayBindingService` relies on: the run is
 * found only within its workspace, a second insert of the same idempotency
 * key fails with Prisma's `P2002`, and `updateMany` honours every condition
 * it is given (status, `updatedAt`, workspace) so a takeover is a real
 * compare-and-set. Specs install it with `jest.mock('@postgear/db', ...)`.
 */
import {
  type AutomationGraph,
  GRAPH_SCHEMA_VERSION,
  getDefinition,
  type NodeType,
} from '@postgear/automation';

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
export const RUN = '33333333-3333-4333-8333-333333333333';
export const AUTOMATION = 'auto_1';

export interface FakeRun {
  id: string;
  organizationId: string;
  automationId: string;
  mode: 'TEST' | 'LIVE';
  status: string;
  graphSnapshot: unknown;
  automation: { name: string };
  version: { graph: unknown } | null;
}

export interface FakeEffect {
  id: string;
  organizationId: string;
  idempotencyKey: string;
  kind: string;
  status: string;
  result: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** A graph holding one step of each given type, keyed as given. */
export function graphWith(steps: Record<string, NodeType>): AutomationGraph {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: Object.entries(steps).map(([key, type]) => {
      const definition = getDefinition(type);
      if (!definition) throw new Error(`No definition for ${type}`);
      return {
        key,
        type,
        typeVersion: definition.typeVersion,
        name: key,
        position: { x: 0, y: 0 },
        config: structuredClone(definition.defaultConfig) as Record<string, unknown>,
      };
    }),
    edges: [],
    notes: [],
  };
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function matches(effect: FakeEffect, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const own = effect[key as keyof FakeEffect];
    if (value instanceof Date) return own instanceof Date && own.getTime() === value.getTime();
    return own === value;
  });
}

export class FakeGatewayDb {
  runs: FakeRun[] = [];
  effects: FakeEffect[] = [];
  /** The clock the effect rows are stamped with. */
  now = () => new Date();

  addRun(overrides: Partial<FakeRun> & { graph?: AutomationGraph } = {}): FakeRun {
    const { graph, ...rest } = overrides;
    const run: FakeRun = {
      id: RUN,
      organizationId: ORG,
      automationId: AUTOMATION,
      mode: 'TEST',
      status: 'RUNNING',
      graphSnapshot: graph ?? graphWith({ draft01: 'postgear.createDraft' }),
      automation: { name: 'AI Weekly Post' },
      version: null,
      ...rest,
    };
    this.runs.push(run);
    return run;
  }

  /** What `jest.mock('@postgear/db')` hands out as `prisma`. */
  readonly prisma = {
    automationRun: {
      findFirst: jest.fn(async (args: { where: { id: string; organizationId: string } }) => {
        const run = this.runs.find(
          (candidate) =>
            candidate.id === args.where.id &&
            candidate.organizationId === args.where.organizationId,
        );
        return run ? structuredClone(run) : null;
      }),
    },
    automationEffect: {
      create: jest.fn(
        async (args: {
          data: { organizationId: string; idempotencyKey: string; kind: string; status: string };
        }) => {
          if (this.effects.some((effect) => effect.idempotencyKey === args.data.idempotencyKey)) {
            throw uniqueViolation();
          }
          const at = this.now();
          const effect: FakeEffect = {
            id: `eff_${this.effects.length + 1}`,
            result: null,
            createdAt: at,
            updatedAt: at,
            ...args.data,
          };
          this.effects.push(effect);
          return { ...effect };
        },
      ),
      findUnique: jest.fn(async (args: { where: { idempotencyKey: string } }) => {
        const effect = this.effects.find(
          (candidate) => candidate.idempotencyKey === args.where.idempotencyKey,
        );
        return effect ? { ...effect } : null;
      }),
      updateMany: jest.fn(
        async (args: { where: Record<string, unknown>; data: Partial<FakeEffect> }) => {
          const hits = this.effects.filter((effect) => matches(effect, args.where));
          for (const effect of hits) Object.assign(effect, args.data, { updatedAt: this.now() });
          return { count: hits.length };
        },
      ),
    },
  };

  effect(key = `${RUN}:draft01`): FakeEffect | undefined {
    return this.effects.find((candidate) => candidate.idempotencyKey === key);
  }
}
