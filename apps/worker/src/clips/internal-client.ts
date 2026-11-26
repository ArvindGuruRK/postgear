/**
 * The worker's calls to the API's `/internal/clips/*` routes (the contract's
 * `CLIP_INTERNAL_ROUTES`): charging an upload's import minutes, reversing a
 * job's charges, and turning a finished export into a Media row.
 *
 * The worker never holds the usage ledger or the Media library itself; the
 * API runs the same services the browser's requests do. Every route is
 * idempotent, so a retried activity simply calls again.
 *
 * Outcomes:
 * - 2xx: the parsed body.
 * - 402: a `ClipStepError` with the refusal's code, permanent.
 * - 401, 403, 404: permanent `tool_failed` and a loud log line (a token or
 *   address that does not match is a deployment mistake, not a hiccup).
 * - 408, 409, 429, 5xx, a timeout or a network error: retryable `tool_failed`.
 */
import {
  CLIP_INTERNAL_ROUTES,
  type ClipChargeImportAnswer,
  type ClipChargeImportBody,
  type ClipCheckStillsAnswer,
  type ClipCheckStillsBody,
  type ClipFinishExportAnswer,
  type ClipFinishExportBody,
  type ClipFinishSaveDownloadAnswer,
  type ClipPickMomentsAnswer,
  type ClipFinishSaveDownloadBody,
  type ClipReconcileAnswer,
  type ClipReverseAnswer,
  type ClipReverseBody,
  type ClipSettledAnswer,
  type ClipSettledBody,
} from '@postgear/scheduling';
import { ClipStepError } from './failures';

export const INTERNAL_CALL_TIMEOUT_MS = 30_000;

export interface ClipFollowSpeakerBody {
  organizationId: string;
}

/** Counts only, never a clip's words or boxes. */
export interface ClipFollowSpeakerAnswer {
  /** False when the run's setup did not ask to follow. */
  follow: boolean;
  marked: number;
  faces: { ready: number; running: number; failed: number };
  facesOff: boolean;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClipInternalClient {
  chargeImport(jobId: string, body: ClipChargeImportBody): Promise<ClipChargeImportAnswer>;
  reverseCharges(jobId: string, body: ClipReverseBody): Promise<ClipReverseAnswer>;
  /** Sprint 13, Module 05: the run's transcript read for moments (the API holds the model). */
  pickMoments(jobId: string, body: ClipReverseBody): Promise<ClipPickMomentsAnswer>;
  /** Module 06: Look For Action's check on stills (a run with the vision check on). */
  checkStills(jobId: string, body: ClipCheckStillsBody): Promise<ClipCheckStillsAnswer>;
  /** Module 08: Follow The Speaker for the run's clips (marks, faces for the best three). */
  followSpeaker(jobId: string, body: ClipFollowSpeakerBody): Promise<ClipFollowSpeakerAnswer>;
  finishExport(jobId: string, body: ClipFinishExportBody): Promise<ClipFinishExportAnswer>;
  /** Module 18: Save To Media's copy becomes a Media row. */
  finishSaveDownload(
    jobId: string,
    body: ClipFinishSaveDownloadBody,
  ): Promise<ClipFinishSaveDownloadAnswer>;
  /** After any job ends; starts the workspace's next waiting jobs. Best effort: never throws. */
  settled(jobId: string, body: ClipSettledBody): Promise<ClipSettledAnswer | null>;
  /** The maintenance pass (publishing role). */
  reconcile(): Promise<ClipReconcileAnswer>;
}

export interface ClipInternalClientConfig {
  apiUrl: string;
  token: string | undefined;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export function createClipInternalClient(config: ClipInternalClientConfig): ClipInternalClient {
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));
  const base = config.apiUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? INTERNAL_CALL_TIMEOUT_MS;

  async function call<T>(path: string, body: object): Promise<T> {
    if (!config.token) {
      console.error(
        JSON.stringify({
          event: 'clips.internal.not_configured',
          reason: 'AUTOMATION_INTERNAL_TOKEN is not set on the worker',
        }),
      );
      throw new ClipStepError('tool_failed', { retryable: false });
    }

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'x-postgear-internal': config.token, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ClipStepError('tool_failed', { retryable: true, cause: error });
    }

    const parsed = await readJson(response);
    if (response.ok) return (parsed ?? {}) as T;

    if (response.status === 402) {
      const code = typeof parsed?.code === 'string' ? parsed.code : 'tool_failed';
      throw new ClipStepError(code, { retryable: false });
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      console.error(
        JSON.stringify({ event: 'clips.internal.refused', path, status: response.status }),
      );
      throw new ClipStepError('tool_failed', { retryable: false });
    }
    if (response.status === 400 || response.status === 422) {
      // Our own body was refused: the same body will be refused again.
      console.error(
        JSON.stringify({ event: 'clips.internal.bad_request', path, status: response.status }),
      );
      throw new ClipStepError('tool_failed', { retryable: false });
    }
    throw new ClipStepError('tool_failed', { retryable: true });
  }

  return {
    chargeImport: (jobId, body) => call(CLIP_INTERNAL_ROUTES.chargeImport(jobId), body),
    reverseCharges: (jobId, body) => call(CLIP_INTERNAL_ROUTES.reverseCharges(jobId), body),
    pickMoments: (jobId, body) => call(CLIP_INTERNAL_ROUTES.pickMoments(jobId), body),
    checkStills: (jobId, body) => call(CLIP_INTERNAL_ROUTES.checkStills(jobId), body),
    followSpeaker: (jobId, body) => call(CLIP_INTERNAL_ROUTES.followSpeaker(jobId), body),
    finishExport: (jobId, body) => call(CLIP_INTERNAL_ROUTES.finishExport(jobId), body),
    finishSaveDownload: (jobId, body) => call(CLIP_INTERNAL_ROUTES.finishSaveDownload(jobId), body),
    async settled(jobId, body) {
      try {
        return await call<ClipSettledAnswer>(CLIP_INTERNAL_ROUTES.settled(jobId), body);
      } catch (error) {
        // The reconcile starts any job this missed, within two minutes.
        console.warn(
          JSON.stringify({
            event: 'clips.internal.settled_failed',
            jobId,
            code: error instanceof ClipStepError ? error.code : 'tool_failed',
          }),
        );
        return null;
      }
    },
    reconcile: () => call(CLIP_INTERNAL_ROUTES.reconcile, {}),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
