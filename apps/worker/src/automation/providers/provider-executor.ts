/**
 * Turns an `AutomationProvider` into an executor, so every outside app gets
 * the same dry run, simulation and failure handling (Modules 12 and 13 only
 * write the provider):
 *
 * 1. `build` the request from the resolved settings.
 * 2. Dry run (a test that does not send for real): return
 *    `{ dryRun: true, wouldSend: describe(req) }`; nothing is sent or simulated.
 * 3. AUTOMATION_SIMULATION: log the summary, apply any `[simulate:...]`
 *    marker in the resolved settings, else `simulate()`.
 * 4. Otherwise `send()` with the decrypted credentials and the run's
 *    idempotency key.
 *
 * A failed result becomes a `StepFailure`: a refused connection is
 * `notConnected` (and the connection is flagged for a reconnect), a
 * retryable one `retryable`, anything else `permanent`.
 */
import { connectionKindInfo, type NodeType, redact } from '@postgear/automation';
import type { AutomationDryRunOutput } from '@postgear/scheduling';
import { simulatedOutcome } from '../../lib/simulation-markers';
import { connectionValues } from '../connection';
import type { ExecContext, Executor } from '../executors/types';
import { StepFailure } from '../failures';
import type { AutomationProvider, ProviderBuildContext, ProviderResult } from './types';

function textsIn(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => textsIn(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).flatMap((item) => textsIn(item, depth + 1));
  }
  return [];
}

/** Waits, heartbeating every second, until done or aborted. */
async function wait(seconds: number, ctx: ExecContext<unknown>): Promise<void> {
  const end = Date.now() + seconds * 1_000;
  while (Date.now() < end && !ctx.signal.aborted) {
    ctx.heartbeat();
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, end - Date.now())));
  }
}

/** What a `[simulate:...]` marker forces, as a provider result; null to carry on. */
async function markerResult(
  app: string,
  ctx: ExecContext<unknown>,
): Promise<ProviderResult | null> {
  const outcome = simulatedOutcome(textsIn(ctx.config).join('\n'), ctx.attempt);
  if (!outcome) return null;

  switch (outcome.kind) {
    case 'retryable':
      return outcome.status === 429
        ? {
            ok: false,
            retryable: true,
            code: 'rate_limited',
            message: `${app} asked PostGear to slow down (simulated).`,
          }
        : {
            ok: false,
            retryable: true,
            code: 'unavailable',
            message: `${app} is not answering right now (simulated).`,
          };
    case 'connectionBroken':
      return {
        ok: false,
        retryable: false,
        connectionBroken: true,
        code: 'connection_refused',
        message: `${app} refused the connection. Reconnect it on the Connections page (simulated).`,
      };
    case 'permanent':
      return {
        ok: false,
        retryable: false,
        code: 'rejected',
        message: `${app} refused what this step sent (simulated).`,
      };
    case 'slow':
      await wait(outcome.seconds, ctx);
      return null;
  }
}

function buildContext(ctx: ExecContext<unknown>): ProviderBuildContext {
  return {
    run: { id: ctx.run.id, automationName: ctx.run.automationName, mode: ctx.run.mode },
    node: { key: ctx.node.key, name: ctx.node.name, type: ctx.node.type },
    scope: ctx.scope,
    timeZone: ctx.timeZone,
    connection: ctx.connection ? { id: ctx.connection.id, name: ctx.connection.name } : null,
    idempotencyKey: ctx.idempotencyKey,
  };
}

export function providerExecutor<Req, C = Record<string, unknown>>(
  type: NodeType,
  provider: AutomationProvider<Req, C>,
): Executor<C> {
  return {
    type,
    async run(ctx) {
      const app = provider.kind ? connectionKindInfo(provider.kind).title : ctx.definition.title;
      const secrets = connectionValues(ctx.connection?.credentials);
      const req = provider.build(ctx.config, buildContext(ctx as ExecContext<unknown>));
      const summary = String(redact(provider.describe(req), { connectionValues: secrets }).value);

      if (ctx.dryRun) {
        const output: AutomationDryRunOutput = { dryRun: true, wouldSend: summary };
        return { output, status: 'dryRun' };
      }

      let result: ProviderResult;
      if (ctx.simulation) {
        ctx.log.info('automation.simulated_send', {
          runId: ctx.run.id,
          nodeKey: ctx.node.key,
          type,
          summary,
        });
        result =
          (await markerResult(app, ctx as ExecContext<unknown>)) ?? (await provider.simulate(req));
      } else {
        result = await provider.send(req, ctx.connection?.credentials ?? null, {
          idempotencyKey: ctx.idempotencyKey,
          signal: ctx.signal,
          heartbeat: ctx.heartbeat,
        });
      }

      if (result.ok) {
        return { output: result.output };
      }

      if (result.connectionBroken) {
        if (ctx.connection) {
          await ctx.deps.store.markConnectionBroken(
            ctx.run.organizationId,
            ctx.connection.id,
            result.message,
          );
        }
        throw new StepFailure('notConnected', result.message, result.code, result.details);
      }
      throw new StepFailure(
        result.retryable ? 'retryable' : 'permanent',
        result.message,
        result.code,
        result.details,
      );
    },
  };
}
