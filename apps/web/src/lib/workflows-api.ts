/**
 * The run, review, activation and version routes of a workflow (Sprint 10,
 * Modules 08 and 09), typed once so the builder's Test controls, the Runs
 * tab and the activation UI call them the same way. Every call throws
 * `ApiError` (with the API's `code`) on a refusal.
 */
import type {
  ActivationResult,
  AutomationDetail,
  AutomationRunMode,
  AutomationRunStatus,
  Connection,
  ConnectionList,
  CreatedSpreadsheet,
  PickerToken,
  ReviewAnswer,
  RunDetail,
  RunPage,
  RunSummary,
  SpreadsheetDetail,
  VersionDetail,
  VersionSummary,
  WebhookInfo,
  WebhookSecretResult,
} from '@/types/workflows';
import { api } from './api';

const workflow = (id: string) => `/automations/${encodeURIComponent(id)}`;
const runPath = (runId: string) => `/automation-runs/${encodeURIComponent(runId)}`;
const connectionPath = (id: string) => `/automation-connections/${encodeURIComponent(id)}`;

/* Runs */

export interface TestRunRequest {
  /** Steps with an outside effect this test sends for real (confirmed per step). */
  sendForReal?: string[];
  triggerData?: 'last' | 'sample' | 'pinned';
  /** Manual trigger fields. */
  inputs?: Record<string, unknown>;
}

/** The run routes answer `{ run }`. */
async function runOf<T>(request: Promise<{ run: T }>): Promise<T> {
  return (await request).run;
}

/**
 * Test Workflow. 429 `test_runs_throttled` when one person starts too many;
 * 422 `test_blocked` when the draft has errors the test cannot run past.
 */
export function startTestRun(automationId: string, body: TestRunRequest): Promise<RunSummary> {
  return runOf(api(`${workflow(automationId)}/test-runs`, { method: 'POST', body }));
}

/** Test Step: runs one step of the saved draft, the steps before it seeded. */
export function startStepTest(
  automationId: string,
  nodeKey: string,
  body: { sendForReal?: boolean } = {},
): Promise<RunSummary> {
  return runOf(
    api(`${workflow(automationId)}/steps/${encodeURIComponent(nodeKey)}/test`, {
      method: 'POST',
      body,
    }),
  );
}

/** Run Now (Module 09): a live run of an active Manual workflow. */
export function runNow(
  automationId: string,
  inputs: Record<string, unknown> = {},
): Promise<RunSummary> {
  return runOf(api(`${workflow(automationId)}/runs`, { method: 'POST', body: { inputs } }));
}

export interface RunListQuery {
  mode?: AutomationRunMode;
  status?: AutomationRunStatus;
  cursor?: string | null;
}

/** Newest first, 25 a page. */
export function listRuns(automationId: string, query: RunListQuery = {}): Promise<RunPage> {
  const params = new URLSearchParams();
  if (query.mode) params.set('mode', query.mode);
  if (query.status) params.set('status', query.status);
  if (query.cursor) params.set('cursor', query.cursor);
  const search = params.toString();
  return api(`${workflow(automationId)}/runs${search ? `?${search}` : ''}`);
}

export function getRun(runId: string): Promise<RunDetail> {
  return runOf(api<{ run: RunDetail }>(runPath(runId)));
}

/** The live progress stream (`step`, `run`, `error` events); GET, read with `lib/sse.ts`. */
export function runEventsPath(runId: string): string {
  return `${runPath(runId)}/events`;
}

/** 409 `run_finished` when it ended first. */
export function cancelRun(runId: string): Promise<RunSummary> {
  return runOf(api(`${runPath(runId)}/cancel`, { method: 'POST' }));
}

/**
 * Retry From Here (Module 08, P1): a new run of the same version and trigger
 * data, starting at `fromNodeKey`. 422 `retry_not_safe` or `retry_old_version`
 * say why it is refused.
 */
export function retryFromHere(runId: string, fromNodeKey: string): Promise<RunSummary> {
  return runOf(api(`${runPath(runId)}/retry`, { method: 'POST', body: { fromNodeKey } }));
}

export interface ReviewRequest {
  decision: 'approved' | 'rejected';
  /** Approvals only. */
  editedText?: string;
  /** Rejections only. */
  reason?: string;
}

/** 409 `review_answered` when someone answered first: refetch and show their answer. */
export async function answerReview(
  runId: string,
  nodeKey: string,
  body: ReviewRequest,
): Promise<ReviewAnswer> {
  const { review } = await api<{ review: ReviewAnswer }>(
    `${runPath(runId)}/reviews/${encodeURIComponent(nodeKey)}`,
    { method: 'POST', body },
  );
  return review;
}

/* Activation and versions (Module 09) */

export interface ActivateRequest {
  draftRevision: number;
  note?: string;
  acceptAutomaticPosting?: boolean;
}

/**
 * Admins only (403 for members). 409 `automation_conflict` on a stale
 * revision, 422 `activation_blocked` when the graph has errors, 422
 * `confirm_automatic_posting` without the tick, 422 `schedule_too_frequent`.
 */
export function activateWorkflow(
  automationId: string,
  body: ActivateRequest,
): Promise<ActivationResult> {
  return api(`${workflow(automationId)}/activate`, { method: 'POST', body });
}

/** Admins only. Deletes the schedule; runs in progress finish. */
export async function pauseWorkflow(automationId: string): Promise<AutomationDetail> {
  const { automation } = await api<{ automation: AutomationDetail }>(
    `${workflow(automationId)}/pause`,
    { method: 'POST' },
  );
  return automation;
}

/** The draft becomes the active version again. 409 `no_active_version` when there is none. */
export async function discardChanges(automationId: string): Promise<AutomationDetail> {
  const { automation } = await api<{ automation: AutomationDetail }>(
    `${workflow(automationId)}/discard`,
    { method: 'POST' },
  );
  return automation;
}

export async function listVersions(automationId: string): Promise<VersionSummary[]> {
  const { versions } = await api<{ versions: VersionSummary[] }>(
    `${workflow(automationId)}/versions`,
  );
  return versions;
}

export async function getVersion(automationId: string, version: number): Promise<VersionDetail> {
  const { version: detail } = await api<{ version: VersionDetail }>(
    `${workflow(automationId)}/versions/${version}`,
  );
  return detail;
}

/** Copies a version's graph into the draft; never changes what is live. */
export async function restoreVersion(
  automationId: string,
  version: number,
  draftRevision: number,
): Promise<AutomationDetail> {
  const { automation } = await api<{ automation: AutomationDetail }>(
    `${workflow(automationId)}/versions/${version}/restore`,
    { method: 'POST', body: { draftRevision } },
  );
  return automation;
}

/* Connections (Module 13 adds the flags and Google) */

/**
 * The workspace's connections plus `simulation` and `googleReady`. An older
 * API without the flags reads as both off.
 */
export async function listConnections(): Promise<ConnectionList> {
  const result = await api<Partial<ConnectionList>>('/automation-connections');
  return {
    connections: result.connections ?? [],
    simulation: result.simulation === true,
    googleReady: result.googleReady === true,
  };
}

/**
 * Admins only, and only when `simulation` is on: a Google connection that
 * never calls Google. 422 `google_needs_oauth` otherwise.
 */
export async function addSimulatedGoogle(name: string): Promise<Connection> {
  const { connection } = await api<{ connection: Connection }>('/automation-connections', {
    method: 'POST',
    body: { provider: 'google', name, credentials: { simulated: true } },
  });
  return connection;
}

/** Refusal codes of the Google helpers below. */
export const GOOGLE_ERRORS = {
  /** 422: the connection is simulated, so there is no Picker (offer a sample spreadsheet). */
  simulated: 'simulated_connection',
  /** 422: Google refused the token; the connection now needs a reconnect. */
  disconnected: 'google_disconnected',
  /** 422: the spreadsheet is no longer reachable with `drive.file`. */
  unavailable: 'spreadsheet_unavailable',
  /** 502: Google did not answer. */
  down: 'google_unavailable',
  /** 422 on adding a simulated Google connection without simulation on. */
  needsOAuth: 'google_needs_oauth',
} as const;

/** Members: a short-lived access token for Google's Picker. 422 `simulated_connection`, `google_disconnected`. */
export function getPickerToken(connectionId: string): Promise<PickerToken> {
  return api(`${connectionPath(connectionId)}/picker-token`);
}

/** The picked spreadsheet's name, link and tabs. 422 `google_disconnected`, `spreadsheet_unavailable`; 502. */
export function getSpreadsheet(
  connectionId: string,
  spreadsheetId: string,
): Promise<SpreadsheetDetail> {
  return api(
    `${connectionPath(connectionId)}/google/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
  );
}

/** The first row of a tab; `[]` when it is empty. Same refusals as `getSpreadsheet`. */
export async function getSheetHeader(
  connectionId: string,
  spreadsheetId: string,
  sheet: string,
): Promise<string[]> {
  const { headers } = await api<{ headers: string[] }>(
    `${connectionPath(connectionId)}/google/spreadsheets/${encodeURIComponent(
      spreadsheetId,
    )}/header?${new URLSearchParams({ sheet })}`,
  );
  return headers;
}

/** Creates a spreadsheet PostGear may use, with `headers` (0 to 50) as its first row. */
export function createSpreadsheet(
  connectionId: string,
  body: { name: string; headers: string[] },
): Promise<CreatedSpreadsheet> {
  return api(`${connectionPath(connectionId)}/google/spreadsheets`, { method: 'POST', body });
}

/* Webhook trigger (Module 13) */

/** The link, the secret's last 4 characters and the last data received. */
export function getWebhook(automationId: string): Promise<WebhookInfo> {
  return api(`${workflow(automationId)}/webhook`);
}

/**
 * Admins only. Creates the first secret or regenerates it (the old one stops
 * working). The plain secret is in this answer only: show it once.
 */
export function createWebhookSecret(automationId: string): Promise<WebhookSecretResult> {
  return api(`${workflow(automationId)}/webhook/secret`, { method: 'POST' });
}
