/**
 * Request schemas for workflows (Sprint 10, Module 03).
 *
 * `.strict()` like every schema in this API. The graph itself is
 * `automationGraphSchema` from `@postgear/automation`, the one the web app
 * and the worker read too, so a draft the canvas can draw is exactly a draft
 * the API accepts. It refuses unknown keys, bad shapes and anything past the
 * hard caps (twice the step limits, so an over-full paste still saves and
 * shows its issue instead of losing work).
 *
 * What the schema cannot say (unknown step types, secrets) the service
 * checks before it writes.
 */

import { automationGraphSchema, isValidTimeZone } from '@postgear/automation';
import { AutomationStatus } from '@postgear/db';
import { z } from 'zod';
import { stripControlChars } from '../../../common/sanitize';
import { foldWhitespace, MAX_SEARCH_LENGTH } from '../../../common/search-terms';

export const MAX_AUTOMATION_NAME_LENGTH = 80;

export const DEFAULT_AUTOMATION_NAME = 'Untitled Workflow';

/** Workflows per page of the list. Workspaces have tens, so one page is the usual case. */
export const AUTOMATIONS_PAGE_SIZE = 50;

const nameText = z
  .string()
  // Room for padding that the cleanup removes; the real limit is after it.
  .max(MAX_AUTOMATION_NAME_LENGTH * 4)
  .transform((text) => foldWhitespace(stripControlChars(text)))
  .pipe(z.string().min(1).max(MAX_AUTOMATION_NAME_LENGTH));

const templateId = z.string().regex(/^[a-z0-9-]{1,64}$/);

const timeZone = z.string().max(64).refine(isValidTimeZone, 'Choose a time zone.');

export const createAutomationSchema = z
  .object({
    name: nameText.optional(),
    templateId: templateId.optional(),
    /** The browser's zone, for a template's Schedule and Add To Queue steps. */
    timeZone: timeZone.optional(),
  })
  .strict();

export const updateAutomationSchema = z
  .object({
    /** The revision the editor loaded; a different one is a 409. */
    draftRevision: z.number().int().min(1),
    name: nameText.optional(),
    draftGraph: automationGraphSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.draftGraph !== undefined,
    'Nothing to update',
  );

export const listAutomationsQuerySchema = z
  .object({
    search: z
      .string()
      .max(MAX_SEARCH_LENGTH)
      .transform((text) => foldWhitespace(stripControlChars(text)))
      .optional(),
    status: z.nativeEnum(AutomationStatus).optional(),
    /** The last id of the previous page. */
    cursor: z.string().uuid().optional(),
  })
  .strict();

export const pinDataSchema = z
  .object({ output: z.unknown() })
  .strict()
  .refine((value) => value.output !== undefined, 'Nothing to pin');

/** A version note typed in the activation dialog. */
export const MAX_VERSION_NOTE_LENGTH = 280;

/**
 * Turning a workflow on (Module 09): exactly the draft revision the admin
 * saw, an optional note for the version, and the tick that says posts may
 * go out with no one reviewing them.
 */
export const activateAutomationSchema = z
  .object({
    draftRevision: z.number().int().min(1),
    note: z
      .string()
      .max(MAX_VERSION_NOTE_LENGTH * 4)
      .transform((text) => foldWhitespace(stripControlChars(text)))
      .pipe(z.string().max(MAX_VERSION_NOTE_LENGTH))
      .optional(),
    acceptAutomaticPosting: z.boolean().optional(),
  })
  .strict();

/** Restore As Draft: checked against the revision the editor has, like a save. */
export const restoreVersionSchema = z.object({ draftRevision: z.number().int().min(1) }).strict();

export type ActivateAutomationInput = z.infer<typeof activateAutomationSchema>;
export type RestoreVersionInput = z.infer<typeof restoreVersionSchema>;
export type CreateAutomationInput = z.infer<typeof createAutomationSchema>;
export type UpdateAutomationInput = z.infer<typeof updateAutomationSchema>;
export type ListAutomationsQuery = z.infer<typeof listAutomationsQuerySchema>;
export type PinDataInput = z.infer<typeof pinDataSchema>;
