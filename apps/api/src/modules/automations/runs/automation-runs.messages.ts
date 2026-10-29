/**
 * User-facing strings for workflow runs (Sprint 10, Module 07): test runs,
 * step tests, run history, live progress, cancel and review. Sentence case,
 * plain words. The UI says Workflow and Step; the code says Automation and
 * node.
 */
import { AUTOMATION_MESSAGES } from '../automations.messages';

export const RUN_MESSAGES = {
  WORKFLOW_NOT_FOUND: AUTOMATION_MESSAGES.NOT_FOUND,
  STEP_NOT_FOUND: AUTOMATION_MESSAGES.STEP_NOT_FOUND,
  RUN_NOT_FOUND: 'Run not found',
  RUN_STEP_NOT_FOUND: 'This step has not run in this run yet.',

  // Starting a test
  TEST_BLOCKED: 'Fix the problems in this workflow before you test it.',
  STEP_TEST_BLOCKED: 'Fix the problems in this step before you test it.',
  NO_TRIGGER: 'Add a trigger to this workflow before you test it.',
  STEP_TURNED_OFF: 'Turn this step on to test it.',
  SEND_FOR_REAL_UNKNOWN: 'A step chosen to send for real is not in this workflow.',
  NO_PINNED_DATA: 'Pin data on the trigger first, or test with sample data.',
  NO_LAST_RUN: 'This workflow has no earlier run to take data from. Test with sample data instead.',
  INPUTS_NEED_MANUAL: 'Only a workflow started by a Manual trigger takes inputs.',
  UNKNOWN_INPUT: 'One of the inputs is not a field of the Manual trigger.',
  inputRequired: (label: string) => `Fill in ${label}.`,
  inputNotNumber: (label: string) => `${label} must be a number.`,
  inputNotChoice: (label: string) => `Choose one of the options for ${label}.`,
  TOO_MANY_TESTS: 'Too many test runs. Try again in a minute.',

  // Cancel and review
  ALREADY_FINISHED: 'This run has already finished.',
  ENGINE_UNAVAILABLE: 'PostGear could not reach the run engine. Try again in a moment.',
  NOT_WAITING: 'This step is not waiting for a review.',
  ALREADY_ANSWERED: 'This review was already answered.',
  REVIEW_NOT_SENT:
    'PostGear could not reach the run engine, so your decision was not saved. Try again in a moment.',

  // Live progress (sent as `error` events)
  STREAM_STOPPED: 'Live updates stopped. Open the run again to see where it is.',
  RUN_GONE: 'This run is no longer available.',
} as const;
