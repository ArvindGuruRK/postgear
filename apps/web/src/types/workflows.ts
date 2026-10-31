/**
 * What the workflow and connection routes answer (Sprint 10). Hand-mirrored
 * from `apps/api/src/modules/automations`: Prisma types never reach the
 * browser. The graph itself is `AutomationGraph` from `@postgear/automation`,
 * the same shape the API validates.
 */
import type {
  AutomationGraph,
  ConnectionKind,
  ConnectionUse,
  NodeDefinition,
  PublishPlatformId,
  TemplateSummary,
} from '@postgear/automation';

export type AutomationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';

export type AutomationRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface AutomationListItem {
  id: string;
  name: string;
  status: AutomationStatus;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  lastRunAt: string | null;
  lastRunStatus: AutomationRunStatus | null;
  lastRunError: string | null;
  runs30d: number;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A step's pinned test data as the builder knows it: the API's stored,
 * redacted copy, listed on the workflow and returned by a pin.
 */
export interface PinnedStep {
  nodeKey: string;
  pinnedAt: string;
  output?: unknown;
}

export interface AutomationDetail extends Omit<AutomationListItem, 'runs30d'> {
  draftGraph: AutomationGraph;
  draftRevision: number;
  pinned: PinnedStep[];
  activeVersion: number | null;
}

/** `PATCH /automations/:id` answers this. */
export interface AutomationSaveResult {
  id: string;
  name: string;
  draftRevision: number;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

export type CatalogState = 'ready' | 'needsConnection' | 'comingSoon';

/** One step type as this workspace sees it (`GET /automations/catalog`). */
export interface CatalogEntry {
  type: string;
  typeVersion: number;
  category: NodeDefinition['category'];
  title: string;
  description: string;
  keywords: readonly string[];
  icon: string;
  family: NodeDefinition['family'];
  priority: NodeDefinition['priority'];
  sideEffect: NodeDefinition['sideEffect'];
  publishes: boolean;
  connection: ConnectionUse | null;
  credits: number;
  state: CatalogState;
  runnable: boolean;
  reason: string | null;
}

export interface WorkspaceCatalog {
  steps: CatalogEntry[];
  connectedPlatforms: PublishPlatformId[];
}

export type { TemplateSummary };

export type ConnectionStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'ERROR';

/** A connection as every response shows it: never its credentials. */
export interface Connection {
  id: string;
  provider: ConnectionKind;
  name: string;
  status: ConnectionStatus;
  /** "hooks.slack.com/...a9F2", or the header names for secret headers. */
  maskedHint: string;
  meta: Record<string, unknown> | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  usedBy: { id: string; name: string; live: boolean }[];
}

export interface ConnectionCheckResult {
  connection: Connection;
  message: string;
}

/**
 * `GET /automation-connections` (Module 13 adds the two flags). Callers that
 * only read `connections` keep working.
 */
export interface ConnectionList {
  connections: Connection[];
  /** `AUTOMATION_SIMULATION` is on: a simulated Google connection may be added. */
  simulation: boolean;
  /** A real Google client id and secret are configured, so Connect With Google works. */
  googleReady: boolean;
}

/* Google Sheets helpers (Module 13). */

/** `GET /automation-connections/:id/picker-token`: a short-lived access token only. */
export interface PickerToken {
  accessToken: string;
  expiresAt: string;
  /** The browser key for the Picker. */
  apiKey: string;
  /** The Google Cloud project number. */
  appId: string;
}

export interface SpreadsheetRef {
  id: string;
  name: string;
  url: string;
}

/** A tab of a spreadsheet: Google's numeric sheet id and its title. */
export interface SheetTabRef {
  id: number;
  title: string;
}

/** `GET /automation-connections/:id/google/spreadsheets/:spreadsheetId`. */
export interface SpreadsheetDetail {
  spreadsheet: SpreadsheetRef;
  tabs: SheetTabRef[];
}

/** `POST /automation-connections/:id/google/spreadsheets` (201). */
export interface CreatedSpreadsheet {
  spreadsheet: SpreadsheetRef;
  sheet: SheetTabRef;
}

/* Webhook trigger (Module 13). */

/** `GET /automations/:id/webhook`. The secret itself is never listed. */
export interface WebhookInfo {
  /** `${API_URL}/v1/automations/<id>/hook`. */
  url: string;
  secret: { last4: string; createdAt: string } | null;
  /** The last data received, redacted. */
  sample: unknown | null;
  sampleAt: string | null;
}

/** `POST /automations/:id/webhook/secret` (201): the only answer that holds the plain secret. */
export interface WebhookSecretResult {
  secret: string;
  last4: string;
  url: string;
}

/* Runs (Modules 07 and 08): mirrored from `runs/run-views.ts`. */

export type AutomationRunMode = 'TEST' | 'LIVE';

/**
 * `AutomationRunOptions` from `@postgear/scheduling`, declared here for the
 * reason `post.ts` gives: the browser bundle imports no server package.
 */
export interface RunOptions {
  scope: { kind: 'run' } | { kind: 'step'; nodeKey: string };
  sendForReal: string[];
  triggerData: 'last' | 'sample' | 'pinned';
  /** A Retry From Here run: the run it retried and the step it started at. */
  retry?: { of: string; fromNodeKey: string; ports: Record<string, string[]> };
}

export type AutomationStepStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'DRY_RUN'
  | 'HANDLED_ERROR'
  | 'FAILED'
  | 'SKIPPED'
  | 'WAITING'
  | 'CANCELLED';

/** One row of the run list, and the head of the detail. */
export interface RunSummary {
  id: string;
  automationId: string;
  mode: AutomationRunMode;
  status: AutomationRunStatus;
  triggerType: string;
  /** Test runs and retries: what the run covered. */
  options: RunOptions | null;
  startedById: string | null;
  stepCount: number;
  creditsUsed: number;
  /** One sentence. */
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  /** Module 08: the version a live run executed ("v3"); null for a test run. */
  version: number | null;
  /** Module 08: "Post published on Instagram"; null when the trigger says nothing more than its title. */
  triggerSummary: string | null;
}

/** `AutomationRunStep.error`. */
export interface RunStepError {
  message: string;
  code: string;
  retryable: boolean;
  details?: unknown;
}

/** One step of a run: its latest attempt. The `step` stream event has this shape too. */
export interface RunStep {
  id: string;
  nodeKey: string;
  nodeType: string;
  nodeName: string;
  status: AutomationStepStatus;
  attempt: number;
  attempts: number;
  input: unknown;
  output: unknown;
  truncated: boolean;
  error: RunStepError | null;
  /** Module 08: the output ports the step fired (`out`, `true`, `approved`, `error`, ...). */
  ports: string[];
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  updatedAt: string;
}

export interface RunDetail extends RunSummary {
  triggerPayload: unknown;
  /** The graph the run executed: a test run's draft snapshot, a live run's version. */
  graph: AutomationGraph | null;
  steps: RunStep[];
}

/** The `run` stream event. */
export interface RunEvent {
  id: string;
  status: AutomationRunStatus;
  error: string | null;
  stepCount: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunPage {
  runs: RunSummary[];
  nextCursor: string | null;
}

/**
 * A Manual Review step's output once answered: `{ decision, decidedById,
 * decidedAt, reviewedBy, reason?, editedText?, text, image }`. While it
 * waits, its `input` holds the resolved `{ text, image, instructions }`.
 */
export interface ReviewOutput {
  decision: 'approved' | 'rejected';
  decidedById?: string;
  decidedAt?: string;
  /** The reviewer's name, written by the API ("Approved by Priya, 09:14"). */
  reviewedBy?: string;
  reason?: string;
  editedText?: string;
  text?: string;
  image?: string;
}

export interface ReviewAnswer {
  nodeKey: string;
  decision: 'approved' | 'rejected';
  decidedAt: string;
}

/* Activation and versions (Module 09). */

export interface VersionSummary {
  version: number;
  note: string | null;
  triggerType: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  /** The version live runs use now. */
  active: boolean;
}

export interface VersionDetail extends VersionSummary {
  graph: AutomationGraph;
}

/** `POST /automations/:id/activate` answers this. */
export interface ActivationResult {
  automation: AutomationDetail;
  version: VersionSummary;
  /** "The schedule is not set up yet. PostGear will set it up within 15 minutes." */
  warnings: string[];
}
