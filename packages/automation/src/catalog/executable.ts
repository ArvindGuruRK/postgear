import type { NodeType } from './types';

/**
 * The step types the worker can run today. It does not decide what can be
 * added: every `ready` type can be placed on a draft, so the canvas works
 * before the run engine exists. A type missing here is reported as
 * `node.not_runnable` (through `ValidationContext.availableTypes`), which
 * blocks tests and activation but not saving.
 *
 * Each module that ships an executor adds its types here in the same
 * commit; a worker test (Module 07) checks this list and the executor
 * registry match exactly.
 *
 * Module 07: every trigger (its data passes through as `trigger`), the logic
 * steps (Delay and Manual Review are handled by the run workflow itself, not
 * an executor) and In-App Notification.
 */
export const EXECUTABLE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'trigger.postPublished',
  'trigger.postFailed',
  'trigger.schedule',
  'trigger.manual',
  'trigger.webhook',
  'logic.ifElse',
  'logic.switch',
  'logic.filter',
  'logic.delay',
  'logic.manualReview',
  'logic.setFields',
  'logic.merge',
  'notify.inApp',
]);
