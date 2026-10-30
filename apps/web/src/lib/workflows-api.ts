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
  ReviewAnswer,
  RunDetail,
  RunPage,
  RunSummary,
  VersionDetail,
  VersionSummary,
} from '@/types/workflows';
import { api } from './api';

const workflow = (id: string) => `/automations/${encodeURIComponent(id)}`;
const runPath = (runId: string) => `/automation-runs/${encodeURIComponent(runId)}`;

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
