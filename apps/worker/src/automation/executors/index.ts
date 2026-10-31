/**
 * The executor registry: one executor per step type the worker runs as an
 * activity. Delay and Manual Review are not here; the run workflow handles
 * them (their definitions set `blocking`).
 *
 * A test checks that these types plus the blocking ones equal
 * `EXECUTABLE_TYPES` from `@postgear/automation` exactly, so the canvas
 * never offers a step the worker cannot run, and the worker never runs a
 * step the catalog calls not runnable. A module that ships an executor adds
 * it here and its type to `EXECUTABLE_TYPES` in the same change.
 */
import { AI_EXECUTORS } from './ai';
import { DATA_EXECUTORS } from './data';
import { inAppExecutor } from './in-app';
import { LOGIC_EXECUTORS } from './logic';
import { NOTIFY_EXECUTORS } from './notify';
import { POSTS_EXECUTORS } from './posts';
import { TRIGGER_EXECUTORS } from './triggers';
import type { Executor, ExecutorRegistry } from './types';

export type {
  ExecContext,
  ExecLog,
  ExecResult,
  ExecRun,
  Executor,
  ExecutorRegistry,
} from './types';

export function buildRegistry(executors: readonly Executor[]): ExecutorRegistry {
  const registry = new Map<string, Executor>();
  for (const executor of executors) {
    if (registry.has(executor.type)) {
      throw new Error(`Two executors for ${executor.type}`);
    }
    registry.set(executor.type, executor);
  }
  return registry;
}

export const EXECUTORS: ExecutorRegistry = buildRegistry([
  ...TRIGGER_EXECUTORS,
  ...LOGIC_EXECUTORS,
  inAppExecutor,
  ...POSTS_EXECUTORS,
  ...AI_EXECUTORS,
  ...NOTIFY_EXECUTORS,
  ...DATA_EXECUTORS,
]);
