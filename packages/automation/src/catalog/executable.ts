import type { NodeType } from './types';

/**
 * The step types the worker can run today. It does not decide what can be
 * added: every `ready` type can be placed on a draft, so the canvas works
 * before the run engine exists. A type missing here is reported as
 * `node.not_runnable` (through `ValidationContext.availableTypes`), which
 * blocks tests and activation but not saving.
 *
 * A worker test checks this list and the executor registry (plus the two
 * blocking types the run workflow handles) match exactly.
 *
 * - Module 07: every trigger (its data passes through as `trigger`), the
 *   logic steps (Delay and Manual Review are handled by the run workflow
 *   itself) and In-App Notification.
 * - Module 10: the PostGear steps, through the API's step gateway.
 * - Module 11: the AI steps (Generate Video stays Coming Soon).
 * - Module 12: Slack, Teams, Discord and Email.
 * - Module 13: Google Sheets and HTTP Request.
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
  'postgear.createDraft',
  'postgear.addToQueue',
  'postgear.publish',
  'postgear.getPost',
  'ai.generateText',
  'ai.generateImage',
  'ai.generateHashtags',
  'ai.rewriteInBrandVoice',
  'notify.slack',
  'notify.teams',
  'notify.discord',
  'notify.email',
  'data.googleSheetsAppendRow',
  'data.httpRequest',
]);
