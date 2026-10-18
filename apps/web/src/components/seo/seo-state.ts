/**
 * The SEO analyzer's state, as a pure reducer over the stream's events
 * (Sprint 7): the same shape as the AI studio's `generate-state.ts`, for
 * the same reasons.
 *
 * ## One transition per event
 *
 * An analysis is a sequence of events that each touch several fields: `crawl`
 * sets the facts strip *and* the crawl stage's detail; `done` sets the final
 * audit *and* the credits *and* closes every stage that never ran. With a
 * reducer each is one transition, testable without rendering, and the screen
 * can never show a stage still spinning next to a finished score.
 *
 * ## Partial results are kept
 *
 * An `error` mid-stream (the advice model rate-limited after the crawl and
 * the scores arrived) leaves the crawl facts and the four scores on screen.
 * The audit was saved as far as it got and the person can still read it;
 * only `start`, `reset` and a `delete` of the shown audit clear it.
 *
 * ## Loaded audits and live runs are one state
 *
 * A row clicked in the history arrives as a `load` of a finished
 * `SeoAuditDetail` and lands in the same fields a stream fills, so the hero,
 * the breakdown and the recommendations never know which way the audit got
 * here. `live` is the one difference: the stage tracker reads it, because a
 * tracker for a run that happened last week is noise.
 */
import type { AiCredits } from '@/types/ai';
import type {
  SeoAdvice,
  SeoAuditDetail,
  SeoAuditSummary,
  SeoCategoryScore,
  SeoCrawlSummary,
  SeoErrorKind,
  SeoGrade,
  SeoScores,
  SeoStage,
  SeoStreamEvent,
} from '@/types/seo';
import { SEO_STAGES } from '@/types/seo';

/** `StageTracker`'s vocabulary, named here so this module stays UI-free. */
export type TrackerStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface StageState {
  status: TrackerStatus;
  detail: string | null;
}

export type SeoPhase = 'idle' | 'running' | 'done' | 'error' | 'aborted';

export interface SeoError {
  kind: SeoErrorKind;
  message: string;
  retryable: boolean;
  /**
   * The request was refused before any event arrived (400, 402, 422, 429,
   * 503, a network failure) rather than failing mid-stream. The screen shows
   * the first on the form and the second next to whatever was produced.
   */
  beforeStream: boolean;
  /** The refusal is about the URL itself (400, 422) and belongs on the field. */
  onField: boolean;
}

/** What the `scores` event carries, kept together because they arrive together. */
export interface ScoreSnapshot {
  overallScore: number;
  grade: SeoGrade;
  scores: SeoScores;
}

export interface SeoState {
  phase: SeoPhase;
  /** The URL that is running or last ran; "Analyze again" sends it again. */
  url: string | null;
  /** The shown audit was produced by a stream in this session, not loaded. */
  live: boolean;
  stages: Record<SeoStage, StageState>;
  audit: SeoAuditSummary | null;
  crawl: SeoCrawlSummary | null;
  scores: ScoreSnapshot | null;
  categories: SeoCategoryScore[] | null;
  advice: SeoAdvice | null;
  previous: SeoAuditDetail['previous'];
  /** The complete audit, once `done` or loaded; what "Copy report" reads. */
  detail: SeoAuditDetail | null;
  error: SeoError | null;
  /** The latest balance the API sent on a terminal event. */
  credits: AiCredits | null;
}

export type SeoAction =
  | { type: 'start'; url: string }
  | { type: 'event'; event: SeoStreamEvent }
  | { type: 'abort' }
  | { type: 'fail'; message: string; status?: number }
  | { type: 'load'; audit: SeoAuditDetail }
  | { type: 'reset' }
  | { type: 'delete'; id: string };

export const STAGE_LABELS: Record<SeoStage, string> = {
  validate: 'Validate',
  crawl: 'Crawl',
  score: 'Score',
  advise: 'Advise',
};

function pendingStages(): Record<SeoStage, StageState> {
  return Object.fromEntries(
    SEO_STAGES.map((stage) => [stage, { status: 'pending', detail: null }]),
  ) as Record<SeoStage, StageState>;
}

function mapStages(
  stages: Record<SeoStage, StageState>,
  update: (stage: StageState, id: SeoStage) => StageState,
): Record<SeoStage, StageState> {
  return Object.fromEntries(SEO_STAGES.map((id) => [id, update(stages[id], id)])) as Record<
    SeoStage,
    StageState
  >;
}

export function initialSeoState(credits: AiCredits | null = null): SeoState {
  return {
    phase: 'idle',
    url: null,
    live: false,
    stages: pendingStages(),
    audit: null,
    crawl: null,
    scores: null,
    categories: null,
    advice: null,
    previous: null,
    detail: null,
    error: null,
    credits,
  };
}

/** What a refused request's status means, so the screen can word it. */
export function kindForStatus(status: number | undefined): SeoErrorKind {
  switch (status) {
    case 422:
      return 'unsafe_url';
    case 429:
      return 'busy';
    case 402:
      return 'out_of_credits';
    default:
      return 'unexpected';
  }
}

/**
 * A refusal worth retrying as-is: the gate was busy, or the network dropped.
 * A bad URL, an empty balance or an unconfigured service will refuse again.
 */
function retryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 429 || status >= 500;
}

export function seoReducer(state: SeoState, action: SeoAction): SeoState {
  switch (action.type) {
    case 'start':
      return {
        ...initialSeoState(state.credits),
        phase: 'running',
        url: action.url,
        live: true,
      };

    case 'event':
      return state.phase === 'running' ? applyEvent(state, action.event) : state;

    case 'abort':
      if (state.phase !== 'running') {
        return state;
      }
      return {
        ...state,
        phase: 'aborted',
        stages: mapStages(state.stages, (stage) =>
          stage.status === 'active' ? { status: 'skipped', detail: 'Stopped' } : stage,
        ),
      };

    case 'fail': {
      const kind = kindForStatus(action.status);
      return {
        ...state,
        phase: 'error',
        error: {
          kind,
          message: action.message,
          retryable: retryableStatus(action.status) && action.status !== 503,
          beforeStream: true,
          onField: action.status === 400 || action.status === 422,
        },
        stages: mapStages(state.stages, (stage) =>
          stage.status === 'active' ? { ...stage, status: 'failed' } : stage,
        ),
      };
    }

    case 'load':
      return loadAudit(state, action.audit);

    case 'reset':
      return initialSeoState(state.credits);

    case 'delete':
      return state.audit?.id === action.id || state.detail?.id === action.id
        ? initialSeoState(state.credits)
        : state;
  }
}

function applyEvent(state: SeoState, event: SeoStreamEvent): SeoState {
  switch (event.type) {
    case 'stage': {
      const status: TrackerStatus = event.status === 'started' ? 'active' : event.status;
      const detail = event.detail ?? defaultDetail(state, event.stage, status);

      return {
        ...state,
        stages: { ...state.stages, [event.stage]: { status, detail } },
      };
    }

    case 'audit':
      return { ...state, audit: event.audit };

    case 'crawl':
      return { ...state, crawl: event.crawl };

    case 'scores':
      return {
        ...state,
        scores: { overallScore: event.overallScore, grade: event.grade, scores: event.scores },
        categories: event.categories,
      };

    case 'advice':
      return { ...state, advice: event.advice };

    case 'done':
      return {
        ...state,
        phase: 'done',
        audit: event.audit,
        detail: event.audit,
        crawl: event.audit.crawl ?? state.crawl,
        scores:
          event.audit.overallScore !== null && event.audit.grade !== null && event.audit.scores
            ? {
                overallScore: event.audit.overallScore,
                grade: event.audit.grade,
                scores: event.audit.scores,
              }
            : state.scores,
        categories: event.audit.categories.length > 0 ? event.audit.categories : state.categories,
        advice: event.audit.advice ?? state.advice,
        previous: event.audit.previous,
        credits: event.credits ?? state.credits,
        // Whatever never reported in did not run; the result is final.
        stages: mapStages(state.stages, (stage) =>
          stage.status === 'pending' || stage.status === 'active'
            ? { status: stage.status === 'active' ? 'done' : 'skipped', detail: stage.detail }
            : stage,
        ),
      };

    case 'error':
      return {
        ...state,
        phase: 'error',
        audit: event.audit ?? state.audit,
        error: {
          kind: event.kind,
          message: event.message,
          retryable: event.retryable,
          beforeStream: false,
          onField: false,
        },
        credits: event.credits ?? state.credits,
        stages: mapStages(state.stages, (stage) =>
          stage.status === 'active' ? { ...stage, status: 'failed' } : stage,
        ),
      };
  }
}

/** A detail for stages the API describes with status alone. */
function defaultDetail(state: SeoState, stage: SeoStage, status: TrackerStatus): string | null {
  if (stage === 'crawl' && status === 'done' && state.crawl) {
    return `${state.crawl.statusCode} · ${state.crawl.mode === 'browser' ? 'rendered' : 'HTML'} · ${state.crawl.responseTimeMs} ms`;
  }

  if (stage === 'score' && status === 'done' && state.scores) {
    return `${state.scores.overallScore} · grade ${state.scores.grade}`;
  }

  if (stage === 'advise' && status === 'skipped') {
    return 'Rule-based advice';
  }

  if (stage === 'advise' && status === 'done' && state.advice) {
    const count = state.advice.recommendations.length;
    return `${count} ${count === 1 ? 'recommendation' : 'recommendations'}`;
  }

  return null;
}

/**
 * An audit from the history: everything it holds goes where a stream would
 * have put it. A run that failed is an error with its reason; one still in
 * progress elsewhere (another tab) is shown as far as it got.
 */
function loadAudit(state: SeoState, audit: SeoAuditDetail): SeoState {
  const failed = audit.status === 'failed';

  return {
    ...initialSeoState(state.credits),
    phase: failed ? 'error' : 'done',
    url: audit.targetUrl,
    live: false,
    audit,
    detail: audit,
    crawl: audit.crawl,
    scores:
      audit.overallScore !== null && audit.grade !== null && audit.scores
        ? { overallScore: audit.overallScore, grade: audit.grade, scores: audit.scores }
        : null,
    categories: audit.categories.length > 0 ? audit.categories : null,
    advice: audit.advice,
    previous: audit.previous,
    error: failed
      ? {
          kind: 'unexpected',
          message: audit.failureReason ?? "This analysis didn't finish.",
          retryable: true,
          beforeStream: false,
          onField: false,
        }
      : null,
  };
}

/** True when there is something on screen worth keeping after an error or a stop. */
export function hasPartialResult(state: SeoState): boolean {
  return state.scores !== null || state.crawl !== null;
}
