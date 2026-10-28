'use client';

/**
 * Export (Sprint 9, Screen 6; DS-8.1, DS-8.3 and DS-4.4's warning): every
 * slide drawn by the server at its exact size and saved to the media
 * library, in slide order.
 *
 * The person picks JPEG (what every platform takes) or PNG, presses Export
 * and watches it happen: "Rendering slide 3 of 7", a bar, and each saved
 * slide appearing as a thumbnail that opens the full image. What still
 * needs fixing is listed up front and never blocks. At the end: Download
 * All as one zip, the Media page, and Done.
 *
 * Sprint 9b: a Size choice, 1x or 2x (twice the pixels, the size shown when
 * the editor passes the format), and Download PDF beside Download All once
 * the export is done, which is when the API has a current export to print.
 * The zip also carries the caption as captions.txt, which the dialog says.
 *
 * What is on screen is saved first, so the images show the design the
 * person sees. The run lives in the dialog's content, so closing the dialog
 * (Cancel, Escape, the close button) ends the stream with it; while it runs,
 * a stray click beside the dialog does not close it.
 *
 * Send To Composer (`send-dialog.tsx`) walks the same road and borrows the
 * run and its pieces from here.
 */
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { FileArchiveIcon } from '@animateicons/react/lucide/file-archive-icon';
import { FileDownIcon } from '@animateicons/react/lucide/file-down-icon';
import { ImageIcon } from '@animateicons/react/lucide/image-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import type { FormatId } from '@postgear/design-engine';
import {
  Alert,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  MotionIcon,
  Progress,
  pressSm,
  RadioGroup,
  RadioGroupItem,
  Spinner,
} from '@postgear/ui';
import { CircleCheck, TriangleAlert } from 'lucide-react';
import {
  type Ref,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import { ApiError, downloadFile } from '@/lib/api';
import { streamEvents } from '@/lib/sse';
import type {
  DesignDownloadFormat,
  DesignStatusView,
  ExportImageFormat,
  ExportScale,
  StudioExportBody,
  StudioExportEvent,
} from '@/types/studio';
import { FOCUS } from './design-card';
import {
  DOWNLOAD_NOTE,
  type ExportState,
  exportReducer,
  formatDetail,
  initialExportState,
  isImageFormat,
  isRunning,
  pdfFileName,
  progressFraction,
  progressLabel,
  type RunMode,
  type RunPhase,
  runNote,
  type SlideSlot,
  type SlotStatus,
  savedLine,
  scaleChoices,
  scaleOf,
  slideSlots,
  UNEXPECTED_MESSAGE,
  warningLead,
  warningLines,
  zipFileName,
} from './export-model';
import { INSET } from './studio-ui';
import { CHOSEN } from './wizard-steps';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  title: string;
  /** Saves what is on screen; false when it could not be saved. */
  flush: () => Promise<boolean>;
  /** What still needs fixing, by slide id, in the engine's sentences. Shown, never blocking. */
  issues: ReadonlyMap<string, readonly string[]>;
  onExported: (result: { status: DesignStatusView; revision: number; mediaIds: string[] }) => void;
  /** The design's format, so the Size choice can show its pixels. Without it, it says them in words. */
  format?: FormatId;
}

export function ExportDialog(props: ExportDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted only while open: closing unmounts the run, which stops its stream. */}
      {props.open ? <ExportDialogContent {...props} /> : null}
    </Dialog>
  );
}

const FORMAT_CHOICES: ReadonlyArray<{ value: ExportImageFormat; title: string; hint: string }> = [
  { value: 'jpeg', title: 'JPEG', hint: 'The one every platform takes, Instagram included.' },
  {
    value: 'png',
    title: 'PNG',
    hint: 'Lossless, so the files are bigger. Instagram does not take PNG.',
  },
];

function ExportDialogContent({
  onOpenChange,
  designId,
  title,
  flush,
  issues,
  onExported,
  format,
}: ExportDialogProps) {
  const { activeOrgId } = useWorkspace();
  const { state, run, choose, chooseScale } = useStudioRun('export');
  const [download, setDownload] = useState<{
    busy: DesignDownloadFormat | null;
    error: string | null;
  }>({
    busy: null,
    error: null,
  });
  const progressRef = useRef<HTMLElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  // The latest callbacks, for a stream that outlives the render that started it.
  const handlers = useRef({ flush, onExported });

  useLayoutEffect(() => {
    handlers.current = { flush, onExported };
  });

  useRunFocus(state.phase, progressRef, outcomeRef);

  const running = isRunning(state);
  const failed = state.phase === 'failed';
  const lines = warningLines(issues, state.warnings);

  function exportSlides() {
    setDownload({ busy: null, error: null });
    void run({
      path: `/studio/designs/${encodeURIComponent(designId)}/export`,
      body: { imageFormat: state.imageFormat, scale: state.scale } satisfies StudioExportBody,
      flush: () => handlers.current.flush(),
      onEvent: (event) => {
        if (event.type === 'done') {
          handlers.current.onExported({
            status: event.status,
            revision: event.revision,
            mediaIds: event.mediaIds,
          });
        }
      },
    });
  }

  /** Download All (the zip) or Download PDF: both need the export just made, which the API checks. */
  async function downloadAs(kind: DesignDownloadFormat) {
    if (download.busy) return;
    setDownload({ busy: kind, error: null });

    const path = `/studio/designs/${encodeURIComponent(designId)}/download`;
    try {
      await (kind === 'pdf'
        ? downloadFile(`${path}?format=pdf`, pdfFileName(title))
        : downloadFile(path, zipFileName(title)));
      setDownload({ busy: null, error: null });
    } catch (cause) {
      setDownload({
        busy: null,
        error:
          cause instanceof ApiError
            ? cause.message
            : 'The download could not start. Please try again.',
      });
    }
  }

  return (
    <DialogContent
      className="max-h-[90vh] max-w-xl overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
      onInteractOutside={(event) => {
        if (running) event.preventDefault();
      }}
    >
      <DialogHeader>
        <DialogTitle>Export Slides</DialogTitle>
        <DialogDescription>
          Each slide is saved to your media library as an image, in slide order.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-5 flex flex-col gap-5">
        <WarningList lead={warningLead(state)} lines={lines} />

        {failed ? <RunFailureAlert state={state} alertRef={outcomeRef} /> : null}

        {state.phase === 'done' ? (
          <Alert
            ref={outcomeRef}
            tabIndex={-1}
            role="status"
            variant="success"
            className="outline-none"
          >
            <CircleCheck aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0 break-words">{progressLabel(state)}</span>
          </Alert>
        ) : null}

        <RunPanel state={state} panelRef={progressRef} />

        {state.phase === 'idle' || failed ? (
          <>
            <ChoiceTiles
              label="Image format"
              choices={FORMAT_CHOICES}
              value={state.imageFormat}
              onChange={(next) => {
                if (isImageFormat(next)) choose(next);
              }}
            />
            <ChoiceTiles
              label="Size"
              choices={scaleChoices(format ?? null).map((choice) => ({
                ...choice,
                value: String(choice.value),
              }))}
              value={String(state.scale)}
              onChange={(next) => {
                const scale = scaleOf(next);
                if (scale) chooseScale(scale);
              }}
            />
          </>
        ) : null}

        {state.phase === 'done' ? (
          <p className="m-0 font-sans text-xs text-ink type-muted">{DOWNLOAD_NOTE}</p>
        ) : null}

        {download.error ? (
          <Alert variant="danger">
            <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0 break-words">{download.error}</span>
          </Alert>
        ) : null}
      </div>

      <DialogFooter
        // Four buttons when done: two even rows of two, or one column on a
        // phone, instead of a ragged wrap.
        className={cn('flex-wrap', state.phase === 'done' && 'grid grid-cols-1 sm:grid-cols-2')}
      >
        {state.phase === 'done' ? (
          <>
            {/* Busy, not disabled: a disabled button drops the keyboard user's focus. */}
            <DownloadButton
              kind="zip"
              busy={download.busy}
              onDownload={(kind) => void downloadAs(kind)}
            />
            <DownloadButton
              kind="pdf"
              busy={download.busy}
              onDownload={(kind) => void downloadAs(kind)}
            />
            {/* The footer's buttons are the default size; the link matches them. */}
            <ActionLink href={`/${activeOrgId}/media`} className="h-11 px-6 text-sm">
              <MotionIcon icon={ImageIcon} className="h-4 w-4" />
              Open Media
            </ActionLink>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              {failed ? 'Close' : 'Cancel'}
            </Button>
            {state.failure?.retryable === false ? null : (
              // Stays where it is, disabled, while the run goes: removed, it
              // would leave Cancel under the pointer for a double click's
              // second click, which would stop the export it just started.
              <Button onClick={exportSlides} disabled={running}>
                {failed ? (
                  <MotionIcon key="again" icon={RotateCcwIcon} className="h-4 w-4" />
                ) : (
                  <MotionIcon key="export" icon={DownloadIcon} className="h-4 w-4" />
                )}
                {running ? 'Exporting…' : failed ? 'Try Again' : 'Export'}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// The run, and the pieces Send To Composer shares
// ---------------------------------------------------------------------------

export interface RunRequest {
  /** The API path that streams the run. */
  path: string;
  body: unknown;
  /** Saves what is on screen; false when it could not be saved. */
  flush: () => Promise<boolean>;
  /** Every event, once the dialog's state has taken it. */
  onEvent?: (event: StudioExportEvent) => void;
}

/**
 * One export or send at a time, streamed into `exportReducer`.
 *
 * Unmounting (the dialog closing) aborts the stream, which the API takes as
 * "stop": the slides already saved stay in the library, and Send makes no
 * draft. A stream that closes without its last event is reported as a lost
 * connection rather than left spinning: the API always ends with one.
 */
export function useStudioRun(mode: RunMode) {
  const [state, dispatch] = useReducer(exportReducer, mode, initialExportState);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(async ({ path, body, flush, onEvent }: RunRequest) => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    dispatch({ type: 'begin' });

    try {
      const saved = await flush().catch(() => false);
      if (current.signal.aborted) return;
      if (!saved) {
        dispatch({ type: 'unsaved' });
        return;
      }

      dispatch({ type: 'request' });
      await streamEvents<StudioExportEvent>(path, body, {
        signal: current.signal,
        onEvent: (event) => {
          if (current.signal.aborted) return;
          dispatch({ type: 'event', event });
          onEvent?.(event);
        },
      });

      // A no-op after the stream's last event; without one, the connection went.
      if (!current.signal.aborted) dispatch({ type: 'lost' });
    } catch (cause) {
      if (current.signal.aborted) return;

      if (cause instanceof ApiError) {
        dispatch({
          type: 'refused',
          message: cause.message,
          status: cause.status,
          code: cause.code,
        });
      } else if (cause instanceof TypeError) {
        // What `fetch` throws when the connection drops.
        dispatch({ type: 'lost' });
      } else {
        dispatch({ type: 'refused', message: UNEXPECTED_MESSAGE, status: 0 });
      }
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }, []);

  const choose = useCallback(
    (imageFormat: ExportImageFormat) => dispatch({ type: 'choose', imageFormat }),
    [],
  );

  const chooseScale = useCallback((scale: ExportScale) => dispatch({ type: 'scale', scale }), []);

  return { state, run, choose, chooseScale };
}

/**
 * Keeps keyboard focus somewhere useful as the dialog changes under it: on
 * the progress once a run starts (the button that started it is gone), and
 * on what happened once it ends.
 */
export function useRunFocus(
  phase: RunPhase,
  progress: RefObject<HTMLElement | null>,
  outcome: RefObject<HTMLElement | null>,
) {
  const previous = useRef(phase);

  useEffect(() => {
    const before = previous.current;
    previous.current = phase;
    if (before === phase) return;

    if (isRunning({ phase }) && !isRunning({ phase: before })) {
      progress.current?.focus();
    } else if (phase === 'done' || phase === 'sent' || phase === 'failed') {
      outcome.current?.focus();
    }
  }, [phase, progress, outcome]);
}

/**
 * What still needs fixing (DS-4.4), in slide order, with a sentence saying
 * the run can still go ahead: a warning, never a gate.
 */
export function WarningList({ lead, lines }: { lead: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;

  return (
    // Polite: a list that grows while slides render must not interrupt the progress.
    <Alert variant="warning" role="status">
      <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
      <div className="flex min-w-0 flex-col gap-2">
        <span className="break-words">{lead}</span>
        <ul className="m-0 flex list-disc flex-col gap-1 ps-5">
          {lines.map((line) => (
            <li key={line} className="break-words">
              {line}
            </li>
          ))}
        </ul>
      </div>
    </Alert>
  );
}

/** Why a run stopped, in the API's words where it had some, and what it left saved. */
export function RunFailureAlert({
  state,
  alertRef,
}: {
  state: ExportState;
  alertRef?: Ref<HTMLDivElement>;
}) {
  if (!state.failure) return null;
  const saved = savedLine(state);

  return (
    <Alert ref={alertRef} tabIndex={-1} variant="danger" className="outline-none">
      <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="break-words">{state.failure.message}</span>
        {saved ? <span>{saved}</span> : null}
      </div>
    </Alert>
  );
}

/**
 * The run as it happens: what it is doing now, the bar, and one place per
 * slide that fills with the saved image. Once it ends, the places stay (a
 * saved slide opens its image) until the dialog closes.
 */
export function RunPanel({ state, panelRef }: { state: ExportState; panelRef?: Ref<HTMLElement> }) {
  const labelId = useId();
  const running = isRunning(state);
  const slots = slideSlots(state);
  if (!running && slots.length === 0) return null;

  const detail = formatDetail(state);
  const note = runNote(state);
  const anySaved = slots.some((slot) => slot.status === 'saved');

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label={running ? 'Progress' : 'Slides'}
      // No aria-busy: it would hold back the live line inside until the run ends.
      className={cn(INSET, 'flex flex-col gap-3 p-4 outline-none')}
    >
      {running ? (
        <>
          <div className="flex items-center gap-2">
            <Spinner
              size="sm"
              role="presentation"
              aria-hidden="true"
              className="shrink-0 motion-reduce:animate-none"
            />
            <p id={labelId} aria-live="polite" className="m-0 min-w-0 font-sans text-sm text-ink">
              {progressLabel(state)}
            </p>
          </div>
          <Progress value={progressFraction(state) * 100} aria-labelledby={labelId} />
        </>
      ) : null}

      {slots.length > 0 ? <SlideStrip slots={slots} size={state.size} /> : null}

      {detail || (anySaved && !running) || note ? (
        <div className="flex flex-col gap-1 font-sans text-xs text-ink type-muted">
          {anySaved && !running ? (
            <p className="m-0">Select an image to open it full size in a new tab.</p>
          ) : null}
          {detail ? <p className="m-0">{detail}</p> : null}
          {note ? <p className="m-0">{note}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

const SLOT_WORDS: Record<SlotStatus, string> = {
  saved: 'saved',
  rendering: 'rendering',
  waiting: 'waiting',
  failed: 'stopped here',
  missed: 'not saved',
};

/** One small place per slide, in order, drawn at the slides' own shape. */
function SlideStrip({ slots, size }: { slots: SlideSlot[]; size: ExportState['size'] }) {
  const ratio = size ? `${size.width} / ${size.height}` : '1 / 1';

  return (
    <ol className="m-0 grid list-none grid-cols-5 gap-2 p-0 sm:grid-cols-7">
      {slots.map((slot) => (
        <li key={slot.index} className="min-w-0" style={{ aspectRatio: ratio }}>
          <SlotTile slot={slot} />
        </li>
      ))}
    </ol>
  );
}

/**
 * A saved slide is its thumbnail and a link to the full image (DS-8.3); the
 * others show their number, and say what became of them by shape and in
 * words as well as colour: a spinner while drawing, a warning sign where the
 * run stopped, a struck-through number for one never drawn.
 */
function SlotTile({ slot }: { slot: SlideSlot }) {
  const number = slot.index + 1;

  if (slot.status === 'saved' && slot.media) {
    const { media } = slot;

    return (
      <a
        href={media.url}
        download={media.name}
        // Media is served from another origin (the API, or object storage),
        // where browsers ignore `download` and open the image instead, so the
        // words promise what happens: the image, full size, in a new tab that
        // keeps the dialog and the editor where they are.
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${media.name} full size, in a new tab`}
        title={media.name}
        className={cn(
          'block h-full w-full overflow-hidden rounded-md border-2 border-outline bg-secondary',
          pressSm,
          FOCUS,
        )}
      >
        {/* biome-ignore lint/performance/noImgElement: an exported slide served from media storage, as the media tile shows it */}
        <img src={media.thumbnailUrl ?? media.url} alt="" className="h-full w-full object-cover" />
      </a>
    );
  }

  return (
    <span
      className={cn(
        'flex h-full w-full items-center justify-center rounded-md border-2 border-outline font-sans text-xs',
        slot.status === 'failed'
          ? 'bg-actionDanger text-onActionLight'
          : 'border-dashed text-ink type-muted',
      )}
    >
      {slot.status === 'rendering' ? (
        <Spinner
          size="sm"
          role="presentation"
          aria-hidden="true"
          className="motion-reduce:animate-none"
        />
      ) : slot.status === 'failed' ? (
        <TriangleAlert aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
      ) : (
        <span aria-hidden="true" className={cn(slot.status === 'missed' && 'line-through')}>
          {number}
        </span>
      )}
      <span className="sr-only">{`Slide ${number}, ${SLOT_WORDS[slot.status]}`}</span>
    </span>
  );
}

/** Download All or Download PDF; busy while either one is on its way. */
function DownloadButton({
  kind,
  busy,
  onDownload,
}: {
  kind: DesignDownloadFormat;
  busy: DesignDownloadFormat | null;
  onDownload: (kind: DesignDownloadFormat) => void;
}) {
  const mine = busy === kind;

  return (
    <Button
      variant="secondary"
      aria-disabled={busy !== null || undefined}
      onClick={() => {
        if (busy === null) onDownload(kind);
      }}
    >
      {mine ? (
        <Spinner
          size="sm"
          role="presentation"
          aria-hidden="true"
          className="motion-reduce:animate-none"
        />
      ) : (
        <MotionIcon icon={kind === 'pdf' ? FileDownIcon : FileArchiveIcon} className="h-4 w-4" />
      )}
      {mine ? 'Downloading…' : kind === 'pdf' ? 'Download PDF' : 'Download All'}
    </Button>
  );
}

/**
 * One choice of a few (the image format, the size), as tiles with radio
 * semantics: the whole tile is the label, the radio inside keeps the
 * keyboard behaviour (arrow keys move the choice), and the tiles press and
 * wear the ring as the wizard's do.
 */
function ChoiceTiles({
  label,
  choices,
  value,
  onChange,
}: {
  /** A form label: sentence case. */
  label: string;
  choices: ReadonlyArray<{ value: string; title: string; hint: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();

  return (
    <div className="flex flex-col gap-2">
      {/* Names a group of radios, not one control, so `Label`'s classes rather than `Label`. */}
      <p id={`${id}-label`} className="m-0 font-sans text-sm font-bold text-ink">
        {label}
      </p>
      <RadioGroup
        value={value}
        onValueChange={onChange}
        aria-labelledby={`${id}-label`}
        className="grid gap-3 sm:grid-cols-2"
      >
        {choices.map((choice) => {
          const itemId = `${id}-${choice.value}`;

          return (
            <label
              key={choice.value}
              htmlFor={itemId}
              className={cn(
                'relative flex cursor-pointer flex-col gap-1 rounded-md border-2 border-outline bg-secondary p-4 pe-12',
                pressSm,
                value === choice.value && cn(CHOSEN, 'ring-offset-secondary'),
              )}
            >
              <span id={`${itemId}-title`} className="type-ui text-sm text-ink">
                {choice.title}
              </span>
              <span id={`${itemId}-hint`} className="font-sans text-xs text-ink type-muted">
                {choice.hint}
              </span>
              <RadioGroupItem
                id={itemId}
                value={choice.value}
                aria-labelledby={`${itemId}-title`}
                aria-describedby={`${itemId}-hint`}
                className="absolute end-4 top-4"
              />
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
