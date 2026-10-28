/**
 * What the Export and Send To Composer dialogs show (Sprint 9, DS-8.1 to
 * DS-8.3), as a pure reducer over the events `POST /studio/designs/:id/export`
 * and `.../send` stream.
 *
 * Both dialogs walk the same road: save what is on screen first (an image of
 * a slide the server has not got would be out of date before it exists),
 * ask, then follow the stream slide by slide. Send adds one step at the end,
 * the draft. A reducer makes every event one transition, tested without a
 * browser, so a dialog can never show "Rendering slide 3 of 7" beside a
 * finished export.
 *
 * Two behaviours worth knowing:
 *
 * - **What was saved stays saved.** A run that fails part way keeps the
 *   slides already in the media library, and the dialog says how many: they
 *   are real files, and the API keeps them for the same reason.
 * - **Late events are dropped.** An event that arrives once the run has
 *   ended belongs to a stream nobody is following any more.
 */
import type {
  DesignStatusView,
  ExportedSlideView,
  ExportImageFormat,
  StudioExportEvent,
} from '@/types/studio';

/** Which dialog: Export stops at the images, Send goes on to make a draft. */
export type RunMode = 'export' | 'send';

export type RunPhase =
  /** Nothing asked yet: choosing. */
  | 'idle'
  /** Saving what is on screen before anything is drawn. */
  | 'saving'
  /** Asked; waiting for the stream's first event. */
  | 'preparing'
  /** Drawing and saving the slides, one by one. */
  | 'rendering'
  /** Send only: the images are ready and the draft is being made. */
  | 'creating'
  /** Export only: every slide is in the media library. */
  | 'done'
  /** Send only: the draft exists. */
  | 'sent'
  | 'failed';

export type FailureKind =
  /** The latest changes could not be saved first, so nothing was asked. */
  | 'unsaved'
  /** The API said no before the stream opened, or the request broke some other way. */
  | 'refused'
  /** The connection dropped, or the stream ended without its last event. */
  | 'connection'
  /** The stream's own `error` event. */
  | 'stream';

export interface RunFailure {
  kind: FailureKind;
  /** Shown as it is: the API's own sentence, or one of the messages below. */
  message: string;
  /** The API's machine-readable reason, when it gave one. */
  code: string | null;
  /** Zero-based: the slide it stopped on, when it stopped on one. */
  slideIndex: number | null;
  /** Slides saved to the media library before it stopped. */
  savedCount: number;
  /** False when asking again unchanged cannot work: the design is gone or unreadable. */
  retryable: boolean;
}

export interface SavedSlide {
  /** Zero-based slide position. */
  index: number;
  media: ExportedSlideView;
}

export interface ExportWarning {
  /** Zero-based. */
  slideIndex: number;
  /** The engine's sentence, which names the slide ("Slide 2: ..."). */
  message: string;
}

/** The export a run made, or for Send the one it reused. */
export interface ExportResult {
  mediaIds: string[];
  status: DesignStatusView;
  /** The revision the images show. An export never changes a design's revision. */
  revision: number;
  reused: boolean;
}

export interface ExportState {
  mode: RunMode;
  phase: RunPhase;
  imageFormat: ExportImageFormat;
  /** How many slides the design has, from `start`; null before it, and for a reused export. */
  total: number | null;
  /** The export size in pixels, from `start`. */
  size: { width: number; height: number } | null;
  /** Zero-based: the slide being drawn right now. */
  current: number | null;
  /** The API's own "Rendering slide 3 of 7" for that slide. */
  label: string | null;
  /** The slides saved so far, in slide order. */
  saved: SavedSlide[];
  /** What the export found worth fixing, by slide. A warning never stops anything. */
  warnings: ExportWarning[];
  result: ExportResult | null;
  /** Send's draft, for the composer to open. */
  group: string | null;
  failure: RunFailure | null;
}

export type ExportAction =
  /** JPEG or PNG. Ignored while a run is going. */
  | { type: 'choose'; imageFormat: ExportImageFormat }
  /** Export or Send was pressed: what is on screen is saved first. Clears the last run. */
  | { type: 'begin' }
  /** That save did not reach the server. */
  | { type: 'unsaved' }
  /** Saved; the request is on its way. */
  | { type: 'request' }
  | { type: 'event'; event: StudioExportEvent }
  /** An `ApiError` before the stream opened (status 0 for a throw that is not one). */
  | { type: 'refused'; message: string; status: number; code?: string | null }
  /** The connection dropped, or the stream ended without its last event. */
  | { type: 'lost' };

export const UNSAVED_MESSAGE =
  'Your latest changes are not saved yet, so the images would miss them. Wait until they are saved, then try again.';
export const LOST_EXPORT_MESSAGE = 'The connection was lost before the export finished.';
export const LOST_SEND_MESSAGE = 'The connection was lost before your draft was made.';
/** The draft may exist already: the request could have landed before the connection went. */
export const LOST_DRAFT_MESSAGE =
  'The connection was lost while your draft was being made. Look in the Queue under Drafts before you try again.';
export const UNEXPECTED_MESSAGE = 'Something went wrong. Please try again.';
export const SENT_MESSAGE = 'Your draft is ready. Opening the composer…';

/** Answers no retry can change: the design was deleted, or this version cannot read it. */
const FINAL_STATUSES = new Set([404, 422]);

export function initialExportState(mode: RunMode): ExportState {
  return {
    mode,
    phase: 'idle',
    // The composer's Instagram rule takes JPEG only, so JPEG is what a
    // person who never looks at the choice should get.
    imageFormat: 'jpeg',
    total: null,
    size: null,
    current: null,
    label: null,
    saved: [],
    warnings: [],
    result: null,
    group: null,
    failure: null,
  };
}

export function isImageFormat(value: string): value is ExportImageFormat {
  return value === 'jpeg' || value === 'png';
}

/** Something is happening that closing the dialog would stop. */
export function isRunning(state: Pick<ExportState, 'phase'>): boolean {
  return (
    state.phase === 'saving' ||
    state.phase === 'preparing' ||
    state.phase === 'rendering' ||
    state.phase === 'creating'
  );
}

export function exportReducer(state: ExportState, action: ExportAction): ExportState {
  switch (action.type) {
    case 'choose':
      return isRunning(state) || state.imageFormat === action.imageFormat
        ? state
        : { ...state, imageFormat: action.imageFormat };

    case 'begin':
      return { ...initialExportState(state.mode), imageFormat: state.imageFormat, phase: 'saving' };

    case 'unsaved':
      return state.phase === 'saving'
        ? fail(state, { kind: 'unsaved', message: UNSAVED_MESSAGE })
        : state;

    case 'request':
      return state.phase === 'saving' ? { ...state, phase: 'preparing' } : state;

    case 'event':
      return state.phase === 'preparing' ||
        state.phase === 'rendering' ||
        state.phase === 'creating'
        ? applyEvent(state, action.event)
        : state;

    case 'refused':
      return isRunning(state)
        ? fail(state, {
            kind: 'refused',
            message: action.message,
            code: action.code ?? null,
            retryable: !FINAL_STATUSES.has(action.status),
          })
        : state;

    case 'lost': {
      if (!isRunning(state)) return state;

      const message =
        state.phase === 'creating'
          ? LOST_DRAFT_MESSAGE
          : state.mode === 'send'
            ? LOST_SEND_MESSAGE
            : LOST_EXPORT_MESSAGE;
      const current = state.current;
      const stoppedOn =
        current !== null && !state.saved.some((slide) => slide.index === current) ? current : null;

      return fail(state, { kind: 'connection', message, slideIndex: stoppedOn });
    }
  }
}

function applyEvent(state: ExportState, event: StudioExportEvent): ExportState {
  switch (event.type) {
    case 'start':
      return {
        ...state,
        phase: 'rendering',
        total: event.slides,
        size: { width: event.width, height: event.height },
        imageFormat: event.imageFormat,
        current: null,
        label: null,
      };

    case 'warning': {
      if (state.warnings.some((warning) => warning.message === event.message)) return state;

      // A stable sort: two warnings on one slide keep the order they came in.
      const warnings = [
        ...state.warnings,
        { slideIndex: event.slideIndex, message: event.message },
      ].sort((a, b) => a.slideIndex - b.slideIndex);
      return { ...state, warnings };
    }

    case 'slide':
      return {
        ...state,
        phase: state.phase === 'preparing' ? 'rendering' : state.phase,
        total: event.total,
        current: event.index,
        label: event.label || renderingLabel(event.index, event.total),
      };

    case 'saved': {
      const saved = [
        ...state.saved.filter((slide) => slide.index !== event.index),
        { index: event.index, media: event.media },
      ].sort((a, b) => a.index - b.index);
      // The slide just saved is no longer being drawn; the next one says so itself.
      const finished = state.current === event.index;

      return {
        ...state,
        phase: state.phase === 'preparing' ? 'rendering' : state.phase,
        total: event.total,
        saved,
        current: finished ? null : state.current,
        label: finished ? null : state.label,
      };
    }

    case 'done':
      return {
        ...state,
        phase: state.mode === 'send' ? 'creating' : 'done',
        current: null,
        label: null,
        result: {
          mediaIds: event.mediaIds,
          status: event.status,
          revision: event.revision,
          reused: event.reused,
        },
      };

    case 'sent':
      return state.mode === 'send'
        ? { ...state, phase: 'sent', group: event.group, current: null, label: null }
        : state;

    case 'error':
      return fail(state, {
        kind: 'stream',
        message: event.message,
        code: event.code,
        slideIndex: event.slideIndex,
        // The API's own list of what it saved is the one to trust.
        savedCount: event.savedMediaIds.length,
      });
  }
}

function fail(
  state: ExportState,
  failure: Pick<RunFailure, 'kind' | 'message'> & Partial<RunFailure>,
): ExportState {
  return {
    ...state,
    phase: 'failed',
    current: null,
    label: null,
    failure: {
      kind: failure.kind,
      message: failure.message,
      code: failure.code ?? null,
      slideIndex: failure.slideIndex ?? null,
      savedCount: failure.savedCount ?? state.saved.length,
      retryable: failure.retryable ?? true,
    },
  };
}

// ---------------------------------------------------------------------------
// What the dialogs read
// ---------------------------------------------------------------------------

export function renderingLabel(index: number, total: number): string {
  return `Rendering slide ${index + 1} of ${total}`;
}

/** How far along the bar is, from 0 to 1: the slides saved so far. */
export function progressFraction(state: ExportState): number {
  switch (state.phase) {
    case 'rendering':
      return state.total ? Math.min(1, state.saved.length / state.total) : 0;
    case 'creating':
    case 'done':
    case 'sent':
      return 1;
    default:
      return 0;
  }
}

/** The line above the progress bar. */
export function progressLabel(state: ExportState): string {
  switch (state.phase) {
    case 'saving':
      return 'Saving your latest changes';
    case 'preparing':
      return 'Getting ready';
    case 'rendering':
      if (state.label) return state.label;
      if (state.total === null) return 'Getting ready';
      return state.saved.length >= state.total
        ? 'Finishing up'
        : renderingLabel(state.saved.length, state.total);
    case 'creating':
      return 'Creating your draft';
    case 'done':
      return doneLine(state.result?.mediaIds.length ?? state.saved.length);
    case 'sent':
      return SENT_MESSAGE;
    default:
      return '';
  }
}

/** "1080 x 1350, JPEG": what the images are, once the stream has said. */
export function formatDetail(state: ExportState): string | null {
  if (!state.size) return null;
  return `${state.size.width} x ${state.size.height}, ${state.imageFormat === 'png' ? 'PNG' : 'JPEG'}`;
}

/** "Saved 7 images to your media library." */
export function doneLine(count: number): string {
  return `Saved ${count} ${count === 1 ? 'image' : 'images'} to your media library.`;
}

/**
 * What a failed run left in the media library, in one sentence; null when it
 * failed before anything was drawn.
 */
export function savedLine(state: ExportState): string | null {
  const failure = state.failure;
  if (!failure || failure.kind === 'unsaved' || failure.kind === 'refused') return null;

  // The images were made (or reused) and only the draft failed.
  if (state.result) {
    const count = state.result.mediaIds.length;
    return count === 1
      ? 'The image is in your media library.'
      : `All ${count} images are in your media library.`;
  }

  const saved = failure.savedCount;
  if (saved === 0) return 'No slides were saved.';

  const verb = saved === 1 ? 'was' : 'were';
  return state.total !== null
    ? `${saved} of ${state.total} slides ${verb} saved to your media library.`
    : `${saved} ${saved === 1 ? 'slide' : 'slides'} ${verb} saved to your media library.`;
}

/** The line under the progress bar while it runs, or null. */
export function runNote(state: ExportState): string | null {
  if (state.phase === 'creating') {
    return state.result?.reused ? 'Using the images from your last export.' : null;
  }
  if (!isRunning(state)) return null;

  return state.mode === 'send'
    ? 'Closing this stops it before the draft is made. Slides already saved stay in your media library.'
    : 'Closing this stops the export. Slides already saved stay in your media library.';
}

/** The sentence above the list of things to fix: it never blocks (DS-4.4). */
export function warningLead(state: ExportState): string {
  if (state.mode === 'send') {
    return 'Some slides still need fixing. You can still send them as they are.';
  }
  return state.phase === 'done'
    ? 'Some slides still need fixing. The images were saved as they are.'
    : 'Some slides still need fixing. You can still export them as they are.';
}

export type SlotStatus =
  | 'saved'
  | 'rendering'
  | 'waiting'
  /** The slide the run stopped on. */
  | 'failed'
  /** Never drawn, because the run stopped first. */
  | 'missed';

export interface SlideSlot {
  /** Zero-based. */
  index: number;
  status: SlotStatus;
  media: ExportedSlideView | null;
}

/**
 * One place per slide, in order, for the strip of thumbnails. Empty until
 * the stream says how many slides there are, and for a reused export, which
 * draws nothing.
 */
export function slideSlots(state: ExportState): SlideSlot[] {
  if (state.total === null) return [];

  const saved = new Map(state.saved.map((slide) => [slide.index, slide.media]));
  const stopped = state.phase === 'failed';
  const failedAt = stopped ? (state.failure?.slideIndex ?? null) : null;

  return Array.from({ length: state.total }, (_, index): SlideSlot => {
    const media = saved.get(index) ?? null;
    if (media) return { index, status: 'saved', media };
    if (index === failedAt) return { index, status: 'failed', media: null };
    if (stopped) return { index, status: 'missed', media: null };
    if (state.phase === 'rendering' && index === state.current) {
      return { index, status: 'rendering', media: null };
    }
    return { index, status: 'waiting', media: null };
  });
}

/**
 * Everything worth fixing, as one list in slide order: what the editor knew
 * before the run (by slide id) and what the stream found while drawing. The
 * two speak the engine's sentences, so the same problem is listed once.
 */
export function warningLines(
  issues: ReadonlyMap<string, readonly string[]>,
  warnings: readonly ExportWarning[],
): string[] {
  const lines: Array<{ slide: number; text: string }> = [];
  const seen = new Set<string>();

  const add = (text: string, slide: number) => {
    if (seen.has(text)) return;
    seen.add(text);
    lines.push({ slide, text });
  };

  for (const sentences of issues.values()) {
    for (const text of sentences) add(text, slideNumberOf(text));
  }
  for (const warning of warnings) add(warning.message, warning.slideIndex + 1);

  // A stable sort keeps each slide's lines in the order they were found.
  return lines.sort((a, b) => a.slide - b.slide).map((line) => line.text);
}

/** "Slide 3: ..." is slide 3; a sentence that names no slide goes last. */
function slideNumberOf(text: string): number {
  const match = /^Slide (\d+)\b/.exec(text);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips.
const UNSAFE_FILE_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/**
 * What Download All saves the zip as when the API's own name does not come
 * through: the design's title made safe for every file system, as the API
 * makes it.
 */
export function zipFileName(title: string): string {
  const cleaned = title
    .replace(UNSAFE_FILE_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows drops a trailing dot or space, which would merge two names.
    .replace(/[. ]+$/g, '');
  const name = Array.from(cleaned).slice(0, 150).join('').trim();

  return `${name || 'Design'}.zip`;
}
