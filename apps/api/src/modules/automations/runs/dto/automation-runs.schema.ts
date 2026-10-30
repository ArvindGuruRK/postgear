/**
 * Request schemas for workflow runs (Sprint 10, Module 07).
 *
 * `.strict()` like every schema in this API. The two test bodies are also
 * `.optional()`: Express 5 leaves `req.body` undefined when a POST carries
 * no body, and "Test Workflow" with no options is the usual call. The
 * service reads a missing body as `{}`.
 *
 * Manual trigger inputs are checked against the trigger's own fields by the
 * service (`manual-inputs.ts`); the schema only bounds their shape and size.
 */
import { GRAPH_HARD_CAPS, NODE_KEY_PATTERN } from '@postgear/automation';
import { AutomationRunMode, AutomationRunStatus } from '@postgear/db';
import { z } from 'zod';
import { stripControlChars } from '../../../../common/sanitize';

/** Runs per page of a workflow's run history. */
export const RUNS_PAGE_SIZE = 25;

/** A Manual field key, the same pattern the trigger's config schema uses. */
export const MANUAL_INPUT_KEY = /^[a-z][A-Za-z0-9_]{0,31}$/;

/** The Manual trigger holds at most 5 fields; room for a stale form, not for a flood. */
const MAX_INPUTS = 20;
const MAX_INPUT_TEXT = 2_000;

/** A reviewer's edited post text. The longest platform allows about 63,000 characters. */
export const MAX_EDITED_TEXT = 64_000;

/** A reviewer's reason for a rejection: a sentence or two. */
export const MAX_REVIEW_REASON = 500;

const nodeKey = z.string().regex(NODE_KEY_PATTERN);

const triggerData = z.enum(['last', 'sample', 'pinned']);

const manualInputs = z
  .record(
    z.string().regex(MANUAL_INPUT_KEY),
    z.union([z.string().max(MAX_INPUT_TEXT), z.number().finite()]),
  )
  .refine((inputs) => Object.keys(inputs).length <= MAX_INPUTS, 'Too many inputs');

const startTestRunBody = z
  .object({
    /** Steps with an outside effect that this test sends for real. */
    sendForReal: z.array(nodeKey).max(GRAPH_HARD_CAPS.nodes).optional(),
    /** Where the trigger's data comes from; pinned, else last, else sample when absent. */
    triggerData: triggerData.optional(),
    /** Manual trigger fields, laid over the chosen trigger data's `inputs`. */
    inputs: manualInputs.optional(),
  })
  .strict();

export const startTestRunSchema = startTestRunBody.optional();

const stepTestBody = z
  .object({
    /** Send this step for real when it has an outside effect. */
    sendForReal: z.boolean().optional(),
  })
  .strict();

export const stepTestSchema = stepTestBody.optional();

export const listRunsQuerySchema = z
  .object({
    mode: z.nativeEnum(AutomationRunMode).optional(),
    status: z.nativeEnum(AutomationRunStatus).optional(),
    /** The last id of the previous page. */
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const reviewDecisionSchema = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    /** P1: the reviewer's edit of the text, approvals only. */
    editedText: z.string().max(MAX_EDITED_TEXT).transform(stripControlChars).optional(),
    /** Module 08: why it was rejected, rejections only. */
    reason: z.string().max(MAX_REVIEW_REASON).transform(stripControlChars).optional(),
  })
  .strict()
  .refine(
    (value) => value.editedText === undefined || value.decision === 'approved',
    'Only an approval can carry edited text',
  )
  .refine(
    (value) => value.reason === undefined || value.decision === 'rejected',
    'Only a rejection can carry a reason',
  );

/** Retry From Here (Module 08): the failed step the new run starts at. */
export const retryRunSchema = z.object({ fromNodeKey: nodeKey }).strict();

const runNowBody = z
  .object({
    /** The Manual trigger's fields, checked against the live version's trigger. */
    inputs: manualInputs.optional(),
  })
  .strict();

/** Run Now (Module 09). Optional like the test bodies: no body means no inputs. */
export const runNowSchema = runNowBody.optional();

export type StartTestRunInput = z.infer<typeof startTestRunBody>;
export type StepTestInput = z.infer<typeof stepTestBody>;
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;
export type ReviewDecisionInput = z.infer<typeof reviewDecisionSchema>;
export type RetryRunInput = z.infer<typeof retryRunSchema>;
export type RunNowInput = z.infer<typeof runNowBody>;
