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
  ACTIVATION_LATER: 'Turning workflows on arrives in a later step of this sprint.',
} as const;

/** Why a step in the catalog cannot be used as it is. */
export const CATALOG_REASONS = {
  connect: (app: string) => `Connect ${app} first.`,
  connectChannel: 'Connect a channel first.',
  notRunnable: (title: string) => `${title} cannot run yet in this version of PostGear.`,
} as const;
