/**
 * The two guards every gateway route shares (Module 10):
 *
 * - **`bind`**: the call names `{ runId, nodeKey, organizationId }`; the run
 *   must exist in that workspace, be RUNNING (or WAITING, for a step after
 *   a review resumes), and the graph it runs (the pinned version for a live
 *   run, the snapshot for a test) must hold that step with one of the
 *   expected types. Anything else is the same 404, so a leaked token cannot
 *   write into a workspace without a live run, and cannot probe which ids
 *   exist.
 * - **`runEffect`**: the effect ledger. The key is `${runId}:${nodeKey}`.
 *   The first call inserts PENDING, does the work and stores DONE plus the
 *   result; a retry finding DONE gets the stored result without acting; a
 *   retry finding PENDING younger than two minutes answers 409
 *   `in_progress` (the worker retries); an older PENDING, or a FAILED one,
 *   is taken over and run again. Work that can be repeated must therefore
 *   be idempotent on its own (posts use a group derived from the key) or
 *   keep its progress with `save` (Email's recipients already sent).
 */
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type AutomationGraph, type GraphNode, upgradeGraph } from '@postgear/automation';
import { AutomationRunMode, type Prisma, prisma } from '@postgear/db';
import type { GatewayBinding } from './gateway.schema';

export const GATEWAY_NOT_AUTHORISED = 'This step could not be authorised.';
export const EFFECT_IN_PROGRESS = 'This step is already running. PostGear will try again shortly.';

/** A PENDING effect older than this is a crashed attempt and may run again. */
export const EFFECT_STALE_MS = 2 * 60 * 1000;

export type EffectStatus = 'PENDING' | 'DONE' | 'FAILED';

export interface BoundStep {
  run: {
    id: string;
    organizationId: string;
    automationId: string;
    automationName: string;
    mode: 'test' | 'live';
  };
  graph: AutomationGraph;
  node: GraphNode;
}

export interface EffectContext {
  /** What an earlier, unfinished attempt saved with `save` (null the first time). */
  previous: Prisma.JsonValue | null;
  /** Keeps progress across attempts (only while this attempt holds the effect). */
  save(progress: Prisma.InputJsonValue): Promise<void>;
}

const OPEN_FOR_STEPS = ['RUNNING', 'WAITING'] as const;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

@Injectable()
export class GatewayBindingService {
  private readonly logger = new Logger('AutomationGateway');

  /** The run and step the call acts for; 404 for anything that does not match. */
  async bind(binding: GatewayBinding, types: readonly string[]): Promise<BoundStep> {
    const run = await prisma.automationRun.findFirst({
      where: { id: binding.runId, organizationId: binding.organizationId },
      select: {
        id: true,
        organizationId: true,
        automationId: true,
        mode: true,
        status: true,
        graphSnapshot: true,
        automation: { select: { name: true } },
        version: { select: { graph: true } },
      },
    });

    const refuse = (reason: string): never => {
      this.logger.warn(
        JSON.stringify({
          event: 'automation.gateway_unbound',
          runId: binding.runId,
          nodeKey: binding.nodeKey,
          reason,
        }),
      );
      throw new NotFoundException(GATEWAY_NOT_AUTHORISED);
    };

    if (!run) return refuse('run_not_found');
    if (!(OPEN_FOR_STEPS as readonly string[]).includes(run.status)) return refuse('run_not_open');

    const stored =
      run.mode === AutomationRunMode.LIVE ? (run.version?.graph ?? null) : run.graphSnapshot;
    let graph: AutomationGraph;
    try {
      graph = upgradeGraph(stored);
    } catch {
      return refuse('graph_unreadable');
    }

    const node = graph.nodes.find((candidate) => candidate.key === binding.nodeKey);
    if (!node) return refuse('step_not_in_graph');
    if (!types.includes(node.type)) return refuse('step_type_mismatch');

    return {
      run: {
        id: run.id,
        organizationId: run.organizationId,
        automationId: run.automationId,
        automationName: run.automation.name,
        mode: run.mode === AutomationRunMode.LIVE ? 'live' : 'test',
      },
      graph,
      node,
    };
  }

  /** Runs `work` once per run and step; see the file header. */
  async runEffect<T extends Prisma.InputJsonValue>(
    binding: GatewayBinding,
    kind: string,
    work: (effect: EffectContext) => Promise<T>,
  ): Promise<T> {
    const key = `${binding.runId}:${binding.nodeKey}`;
    const claim = await this.claim(binding.organizationId, key, kind);

    if (claim.done) {
      return claim.result as T;
    }

    const effect: EffectContext = {
      previous: claim.previous,
      save: async (progress) => {
        await prisma.automationEffect.updateMany({
          where: { idempotencyKey: key, status: 'PENDING', organizationId: binding.organizationId },
          data: { result: progress },
        });
      },
    };

    let result: T;
    try {
      result = await work(effect);
    } catch (error) {
      await prisma.automationEffect
        .updateMany({
          where: { idempotencyKey: key, status: 'PENDING', organizationId: binding.organizationId },
          data: { status: 'FAILED' },
        })
        .catch(() => undefined);
      throw error;
    }

    await prisma.automationEffect.updateMany({
      where: { idempotencyKey: key, organizationId: binding.organizationId },
      data: { status: 'DONE', result },
    });
    return result;
  }

  private async claim(
    organizationId: string,
    key: string,
    kind: string,
  ): Promise<
    { done: true; result: Prisma.JsonValue } | { done: false; previous: Prisma.JsonValue | null }
  > {
    try {
      await prisma.automationEffect.create({
        data: { organizationId, idempotencyKey: key, kind, status: 'PENDING' },
      });
      return { done: false, previous: null };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const existing = await prisma.automationEffect.findUnique({
      where: { idempotencyKey: key },
      select: { organizationId: true, status: true, result: true, updatedAt: true },
    });
    if (!existing || existing.organizationId !== organizationId) {
      // Another workspace cannot hold this key (run ids are unique), but
      // never hand its result over if it somehow did.
      throw new NotFoundException(GATEWAY_NOT_AUTHORISED);
    }

    if (existing.status === 'DONE') {
      return { done: true, result: existing.result };
    }

    const stale = Date.now() - existing.updatedAt.getTime() >= EFFECT_STALE_MS;
    if (existing.status === 'PENDING' && !stale) {
      throw new ConflictException({ message: EFFECT_IN_PROGRESS, code: 'in_progress' });
    }

    // Take it over: only one caller wins the conditional write.
    const taken = await prisma.automationEffect.updateMany({
      where: {
        idempotencyKey: key,
        status: existing.status,
        updatedAt: existing.updatedAt,
      },
      data: { status: 'PENDING' },
    });
    if (taken.count !== 1) {
      throw new ConflictException({ message: EFFECT_IN_PROGRESS, code: 'in_progress' });
    }
    return { done: false, previous: existing.result };
  }
}
