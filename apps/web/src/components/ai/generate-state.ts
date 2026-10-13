/**
 * The generate screen's state, as a pure reducer over the stream's events.
 *
 * ## Why a reducer and not a `useState` per field
 *
 * A generation is a sequence of events that each touch a few fields at once:
 * `stage research done` sets the stage *and* its detail; `done` sets the
 * result *and* the credits *and* closes every stage that never ran. With a
 * reducer every event is one transition, testable without rendering, and the
 * screen can never show a stage still spinning next to a finished result.
 *
 * ## Partial results are kept
 *
 * An `error` event mid-stream (the image model rate-limited, say) arrives
 * after the hook and the parts have already been shown. They stay: what was
 * produced was paid for, and the person can still copy it or open it in the
 * composer. Only `start` and `reset` clear them.
 *
 * ## Stages are not the result
 *
 * The tracker reads `stages`; the result card reads `category`/`hook`/
 * `parts`/`sources`. They are updated independently because the API emits
 * them independently (`stage hook done` and `hook` are two events), and the
 * screen must look right between any two of them.
 */
import type { ProviderRules } from '@postgear/social-core/composer';
import type {
  AiCredits,
  AiErrorKind,
  GeneratedPart,
  GenerateRequestBody,
  GenerateResult,
  GenerateStage,
  GenerateStreamEvent,
  PostFormat,
  ResearchSource,
} from '@/types/ai';
import { GENERATE_STAGES } from '@/types/ai';
import type { Channel, ProviderSummary } from '@/types/channel';

/** The tracker's vocabulary — `StageTracker`'s statuses, named here so this module stays UI-free. */
export type TrackerStatus = 'pending' | 'active' | 'done' | 'skipped' | 'failed';

export interface StageState {
  status: TrackerStatus;
  detail: string | null;
}

export type GeneratePhase = 'idle' | 'running' | 'done' | 'error' | 'aborted';

export interface GenerateError {
  kind: AiErrorKind;
  message: string;
  retryable: boolean;
  /**
   * The request was refused before any event arrived (402, 422, 503, a
   * network failure) rather than failing mid-stream. The screen shows the
   * first as an alert on the form and the second next to whatever was
   * produced.
   */
  beforeStream: boolean;
}

export interface GenerateState {
  phase: GeneratePhase;
  /** The request that is running or last ran; "Regenerate" sends it again. */
  request: GenerateRequestBody | null;
  stages: Record<GenerateStage, StageState>;
  category: string | null;
  hook: string | null;
  parts: GeneratedPart[] | null;
  /** Null until the research event; an empty list is "searched, found nothing". */
  sources: ResearchSource[] | null;
  result: GenerateResult | null;
  error: GenerateError | null;
  /** The latest balance the API sent on a terminal event. */
  credits: AiCredits | null;
}

export type GenerateAction =
  | { type: 'start'; request: GenerateRequestBody }
  | { type: 'event'; event: GenerateStreamEvent }
  | { type: 'abort' }
  | { type: 'fail'; message: string; status?: number }
  | { type: 'reset' };

export const STAGE_LABELS: Record<GenerateStage, string> = {
  research: 'Research',
  classify: 'Classify',
  hook: 'Hook',
  content: 'Write',
  image: 'Image',
};

export const FORMAT_OPTIONS: readonly { value: PostFormat; label: string; hint: string }[] = [
  { value: 'one_short', label: 'Short post', hint: 'One post, up to 280 characters.' },
  { value: 'one_long', label: 'Long post', hint: 'One post of 800 to 1,500 characters.' },
  {
    value: 'thread_short',
    label: 'Short thread',
    hint: '3 to 5 parts, each up to 280 characters.',
  },
  {
    value: 'thread_long',
    label: 'Long thread',
    hint: '3 to 6 longer parts, each within the limit.',
  },
];

function pendingStages(): Record<GenerateStage, StageState> {
  return Object.fromEntries(
    GENERATE_STAGES.map((stage) => [stage, { status: 'pending', detail: null }]),
  ) as Record<GenerateStage, StageState>;
}

export function initialGenerateState(credits: AiCredits | null = null): GenerateState {
  return {
    phase: 'idle',
    request: null,
    stages: pendingStages(),
    category: null,
    hook: null,
    parts: null,
    sources: null,
    result: null,
    error: null,
    credits,
  };
}

/** What a refused request's status means, so the screen can word it. */
function kindForStatus(status: number | undefined): AiErrorKind {
  switch (status) {
    case 402:
      return 'out_of_credits';
    case 503:
      return 'not_configured';
    default:
      return 'unexpected';
  }
}

function mapStages(
  stages: Record<GenerateStage, StageState>,
  update: (stage: StageState, id: GenerateStage) => StageState,
): Record<GenerateStage, StageState> {
  return Object.fromEntries(GENERATE_STAGES.map((id) => [id, update(stages[id], id)])) as Record<
    GenerateStage,
    StageState
  >;
}

export function generateReducer(state: GenerateState, action: GenerateAction): GenerateState {
  switch (action.type) {
    case 'start':
      return {
        ...initialGenerateState(state.credits),
        phase: 'running',
        request: action.request,
        stages: mapStages(pendingStages(), (stage, id) =>
          // The engine says so too, but a tracker that shows "Image · pending"
          // for a post nobody asked an image for is wrong from the first frame.
          id === 'image' && !action.request.withImage
            ? { status: 'skipped', detail: 'No image requested' }
            : stage,
        ),
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

    case 'fail':
      return {
        ...state,
        phase: 'error',
        error: {
          kind: kindForStatus(action.status),
          message: action.message,
          retryable: action.status !== 402 && action.status !== 503,
          beforeStream: true,
        },
        stages: mapStages(state.stages, (stage) =>
          stage.status === 'active' ? { ...stage, status: 'failed' } : stage,
        ),
      };

    case 'reset':
      return initialGenerateState(state.credits);
  }
}

function applyEvent(state: GenerateState, event: GenerateStreamEvent): GenerateState {
  switch (event.type) {
    case 'stage': {
      const status: TrackerStatus = event.status === 'started' ? 'active' : event.status;
      const detail = event.detail ?? defaultDetail(state, event.stage, status);

      return {
        ...state,
        stages: { ...state.stages, [event.stage]: { status, detail } },
      };
    }

    case 'research':
      return { ...state, sources: event.sources };

    case 'category':
      return { ...state, category: event.category };

    case 'hook':
      return { ...state, hook: event.hook };

    case 'content':
      return { ...state, parts: event.parts };

    case 'image':
      return {
        ...state,
        parts: (state.parts ?? []).map((part, index) =>
          index === event.index ? { ...part, image: event.image } : part,
        ),
      };

    case 'done':
      return {
        ...state,
        phase: 'done',
        result: event.result,
        category: event.result.category,
        hook: event.result.hook,
        parts: event.result.parts,
        sources: event.result.researched ? event.result.sources : state.sources,
        credits: event.credits,
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
        error: {
          kind: event.kind,
          message: event.message,
          retryable: event.retryable,
          beforeStream: false,
        },
        credits: event.credits,
        stages: mapStages(state.stages, (stage) =>
          stage.status === 'active' ? { ...stage, status: 'failed' } : stage,
        ),
      };
  }
}

/** A detail for stages the API describes with status alone. */
function defaultDetail(
  state: GenerateState,
  stage: GenerateStage,
  status: TrackerStatus,
): string | null {
  if (stage === 'research' && status === 'done' && state.sources) {
    const count = state.sources.length;
    return `${count} ${count === 1 ? 'source' : 'sources'} found`;
  }

  if (stage === 'research' && status === 'skipped') {
    return 'Written without web research';
  }

  if (stage === 'image' && status === 'failed') {
    return 'Image credits refunded';
  }

  return null;
}

/** True when there is something on screen worth keeping after an error or a stop. */
export function hasPartialResult(state: GenerateState): boolean {
  return (state.parts !== null && state.parts.length > 0) || state.hook !== null;
}

/** What one generation will charge, from the API's own price list. */
export function generateCost(credits: Pick<AiCredits, 'costs'>, withImage: boolean): number {
  return credits.costs.generate_post + (withImage ? credits.costs.generate_image : 0);
}

export interface CharacterLimit {
  /** The platform that set the limit ("X"). */
  platform: string;
  maxLength: number;
  lengthMethod: ProviderRules['lengthMethod'];
}

/**
 * The strictest limit among the selected channels' platforms — the one the
 * API will hand the engine as `maxCharacters`, and the one the result's
 * counters measure against. Null when nothing is selected, or when the
 * providers list did not load.
 */
export function strictestLimit(
  selected: readonly string[],
  channels: readonly Channel[],
  providers: readonly ProviderSummary[],
): CharacterLimit | null {
  const byId = new Map(channels.map((channel) => [channel.id, channel]));
  const byIdentifier = new Map(providers.map((provider) => [provider.identifier, provider]));
  let strictest: CharacterLimit | null = null;

  for (const id of selected) {
    const channel = byId.get(id);
    const provider = channel ? byIdentifier.get(channel.providerIdentifier) : undefined;

    if (provider && (!strictest || provider.rules.maxLength < strictest.maxLength)) {
      strictest = {
        platform: provider.name,
        maxLength: provider.rules.maxLength,
        lengthMethod: provider.rules.lengthMethod,
      };
    }
  }

  return strictest;
}

/** The top of the next hour, the same default the composer starts a new post at. */
export function nextFullHour(now: Date): Date {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

/** The generated text as one block, for the clipboard. */
export function partsAsText(parts: readonly GeneratedPart[]): string {
  return parts.map((part) => part.text).join('\n\n');
}
