/**
 * Triggers inside a run: the trigger already happened (a post was
 * published, the schedule fired, someone clicked Run Now), so its step only
 * hands the trigger's data on. That data becomes `{{ trigger.* }}` for every
 * later step. The Manual trigger's data is `{ inputs: { ... } }`, the
 * fields the person filled in.
 */
import type { NodeType } from '@postgear/automation';
import type { Executor } from './types';

export const TRIGGER_TYPES = [
  'trigger.postPublished',
  'trigger.postFailed',
  'trigger.schedule',
  'trigger.manual',
  'trigger.webhook',
] as const satisfies readonly NodeType[];

function passThrough(type: NodeType): Executor {
  return {
    type,
    async run(ctx) {
      return { output: ctx.scope.trigger ?? {} };
    },
  };
}

export const TRIGGER_EXECUTORS: Executor[] = TRIGGER_TYPES.map(passThrough);
