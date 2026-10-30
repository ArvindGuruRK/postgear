/**
 * User-facing strings for workflows (Sprint 10). The UI says Workflow and
 * Step; the code says Automation and node. Sentence case, plain words.
 */
import { SECRET_REFUSED_MESSAGE } from '@postgear/automation';

export const AUTOMATION_MESSAGES = {
  NOT_FOUND: 'Workflow not found',
  DELETED: 'Workflow deleted',
  UNPINNED: 'Pinned data removed',
  TEMPLATE_NOT_FOUND: 'Template not found',
  STEP_NOT_FOUND: 'This step is not in the workflow.',
  CONFLICT: 'This workflow changed in another tab. Reload to see the latest version.',
  UNKNOWN_STEP: 'This workflow has a step PostGear does not know. Remove it and try again.',
  /** Shared with the web app, which warns before it saves. */
  SECRET_REFUSED: SECRET_REFUSED_MESSAGE,
  PINNED_TOO_LARGE: 'Pinned data can be at most 64 KB.',

  // Activation, pause, versions and delete (Module 09)
  ACTIVATION_BLOCKED: 'Fix the problems in this workflow before you turn it on.',
  CONFIRM_AUTOMATIC_POSTING: 'Confirm that posts will go out automatically.',
  SCHEDULE_NOT_SET_UP: 'The schedule is not set up yet. PostGear will set it up within 15 minutes.',
  NOT_TURNED_ON: 'This workflow has not been turned on yet.',
  NO_ACTIVE_VERSION: 'This workflow has no live version to go back to.',
  VERSION_NOT_FOUND: 'Version not found',
  DELETE_ACTIVE_ADMIN_ONLY: 'Only workspace admins can delete an active workflow.',
} as const;

/** Why a step in the catalog cannot be used as it is. */
export const CATALOG_REASONS = {
  connect: (app: string) => `Connect ${app} first.`,
  connectChannel: 'Connect a channel first.',
  notRunnable: (title: string) => `${title} cannot run yet in this version of PostGear.`,
} as const;
