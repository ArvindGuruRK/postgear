'use client';

/**
 * The editor's timeline dock (Module 08 frame, Module 09 editing).
 *
 * - A `ResizeHandle` on its top edge: drag it or use the arrow keys; the
 *   height is kept in this browser.
 * - The tools row: Split At The Playhead and Remove (disabled with the
 *   reason in their tooltips), the playhead's `TimeField`, the quiet status
 *   line ("Getting more of the video", or why an edit was refused) and the
 *   Snapping switch (kept in this browser).
 * - The ruler in the clip's own time: press to jump, drag to scrub.
 * - Rows (blueprint section 7): Video (a bar per part, its filmstrip inside,
 *   the speed when not 1x, hatched where we do not hold the video sharp),
 *   the video's own sound under it, then Overlay, Zoom and Sound, with a
 *   second row of a kind when two of its bars overlap. Empty rows stay,
 *   slim, so people learn where things go. While Follow The Speaker is on
 *   (Sprint 13, Module 08), a thin Speaker strip sits under the Video row.
 * - Editing: drag a part's end to trim it, an item's body to move it, an
 *   item's end to resize it. Each drag works from the document as it was
 *   when it began (the engine's gesture reducers), shows the result live
 *   (the stage draws it, the playhead follows a trimmed edge) and is handed
 *   to the editor once on release, as one undo step. Escape cancels it. Edges
 *   snap within 8 px to the playhead, the clip's ends and other edges, with a
 *   guide line; Alt held or the switch off lets them move freely. Near the
 *   dock's sides the view scrolls along.
 * - Keyboard: Tab reaches every bar; selecting one says what it is; arrows
 *   move a selected item by a frame (Shift: a second); Enter opens its panel.
 *
 * Built from Module 07's pieces and the engine's `timeline/` maths, drawing
 * only what is in view. Only the playhead layer listens to the clock.
 */
import { ScissorsIcon } from '@animateicons/react/lucide/scissors-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  Button,
  Kbd,
  MotionIcon,
  Playhead,
  SpeakerStrip,
  TIMELINE_LABEL_WIDTH_PX,
  type TimelineTone,
  TimelineBar,
  TimelineBarChip,
  TimelineRow,
  TimeField,
  TimeRuler,
  Toggle,
  TooltipHint,
} from '@postgear/ui';
import {
  type ClipDocument,
  clampZoom,
  dragMoveItem,
  dragMoveZoom,
  dragResizeItemEnd,
  dragResizeItemStart,
  dragResizeZoomEnd,
  dragResizeZoomStart,
  dragTrimEnd,
  dragTrimStart,
  findItem,
  formatTimecode,
  type GestureResult,
  msToPx,
  outputDuration,
  pxPerMs as pxPerMsFor,
  placeSegments,
  removeHook,
  rulerTicks,
  type SourceRange,
  scrollToShow,
  snapPoints,
  visibleRange,
  windowsOfZoom,
  ZOOM_STEP,
  zoomBounds,
  zoomToAround,
} from '@postgear/video-engine';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ResizeHandle } from '@/components/workflows/panel/resize-handle';
import type { ClipFilmstrip, ClipWaveform } from '@/types/clips';
import type { SpeakerStretchModel } from '../layouts/follow-model';
import { Filmstrip } from '../timeline/filmstrip';
import {
  edgeFrameMs,
  brandPartLabel,
  brandPartName,
  hookPartLabel,
  isHookPart,
  itemLabel,
  nudgeItem,
  partHatch,
  partLabel,
  readSnapping,
  type TimelineBarModel,
  type TimelineRowKind,
  timelineRows,
  trimShiftMs,
  writeSnapping,
  zoomLabel,
} from '../timeline/timeline-model';
import { SoundShape } from '../panels/sound-rows';
import { Waveform } from '../timeline/waveform';
import {
  clampDockHeight,
  DOCK_MAX_PX,
  DOCK_MIN_PX,
  readDockHeight,
  writeDockHeight,
} from './clip-editor-model';
import type { EditorSelection } from './editor-state';
import type { PlaybackStore } from './playback';
import type { DockControls } from './transport-bar';

const LABEL_PX = TIMELINE_LABEL_WIDTH_PX;
/** The Video row is `tall` (56 px), 2 px border each side. */
const VIDEO_ROW_INNER_PX = 52;
/** A slim row (28 px), 2 px border each side. */
const SLIM_ROW_INNER_PX = 24;
/** Room after the clip's end at any zoom, so its end can be dragged outward. */
const TAIL_PX = 96;
/** How close to the dock's side a drag starts scrolling the view, and how fast it may go. */
const EDGE_SCROLL_PX = 40;
/**
 * How far a press travels before it is a drag. Below it a press on a bar or a
 * grip only selects: a hand never holds perfectly still, and a click must
 * never trim or snap anything.
 */
const DRAG_START_PX = 3;
const EDGE_SCROLL_MAX_PX = 28;

const ROW_TONES: Readonly<Record<TimelineRowKind, TimelineTone>> = Object.freeze({
  overlay: 'accent',
  zoom: 'success',
  sound: 'warning',
});

const ICON_BUTTON = 'h-8 w-8 shrink-0 px-0';

export interface TimelineDockProps {
  /** The document as it is now (a drag shows its own result on top). */
  document: ClipDocument;
  selection: EditorSelection;
  playback: PlaybackStore;
  filmstrip: ClipFilmstrip | null;
  waveform: ClipWaveform | null;
  fps: number;
  /** The stretch held sharp, in the video's time; past it a part is hatched. */
  held: SourceRange | null;
  /** The whole video's length, so a trim can bring video back up to its ends. */
  videoDurationMs: number;
  /** "Getting more of the video" shows. */
  gettingMore: boolean;
  /** A sentence about the last refused edit, shown in the tools row for a moment. */
  notice: string | null;
  /** Why Split At The Playhead is off right now, or null; read at the playhead. */
  splitProblemAt: (playheadMs: number) => string | null;
  /** Why Remove is off right now (nothing selected says so too), or null. */
  removeProblem: string | null;
  controlRef: RefObject<DockControls | null>;
  onSelect: (selection: EditorSelection) => void;
  /** Enter on a bar: open the panel that edits it. */
  onOpen: (selection: NonNullable<EditorSelection>) => void;
  /** A finished drag or nudge: `next` replaces `start`, as one undo step. */
  onCommit: (
    start: ClipDocument,
    next: ClipDocument,
    options?: { select?: EditorSelection; coalesceKey?: string },
  ) => void;
  /** A drag's live result for the stage (null when it ends), and where the playhead should show it. */
  onDraft: (draft: { doc: ClipDocument; seekMs: number | null } | null) => void;
  onSplit: () => void;
  onRemove: () => void;
  onAnnounce: (words: string) => void;
  /**
   * Sprint 13: the clip's caption pages as a read-only row (null for a clip
   * without captions). Pressing one jumps there and opens the Captions tab,
   * where captions are edited: they follow the words, so they have no handles.
   */
  captionBars?: ReadonlyArray<{ key: string; startMs: number; endMs: number; text: string }> | null;
  onCaptions?: (ms: number) => void;
  /** A sticker bar's tiny picture (Module 12), by item id; null for none. */
  stickerPicture?: (itemId: string) => string | null;
  /**
   * A sound bar's shape (Module 14), by item id: its peaks, the share of the
   * bar its file fills (an effect stretched past its end is silent there),
   * and its name; null while unknown.
   */
  soundShape?: (
    itemId: string,
  ) => { peaks: readonly number[]; fill: number; name: string | null } | null;
  /**
   * Module 08: Follow The Speaker's strip under the Video row (clip ms), or
   * null when not following. Pressing a lost or fixed stretch selects it.
   */
  speaker?: {
    stretches: readonly SpeakerStretchModel[];
    selectedKey: string | null;
    onSelect: (key: string) => void;
  } | null;
  /**
   * Module 09: the hook's own delete on its bar. Left out, the dock removes
   * it itself (`removeHook`, one undo step).
   */
  onRemoveHook?: () => void;
}

export function TimelineDock(props: TimelineDockProps) {
  const [height, setHeight] = useState<number | null>(null);
  // Read after the first paint: the server never knows this browser's choice.
  useEffect(() => setHeight(readDockHeight()), []);
  const shownHeight = height ?? clampDockHeight(Number.NaN);

  const resize = (next: number) => {
    const value = clampDockHeight(next);
    setHeight(value);
    writeDockHeight(value);
  };

  const [snapping, setSnapping] = useState(true);
  useEffect(() => setSnapping(readSnapping()), []);
  const changeSnapping = (on: boolean) => {
    setSnapping(on);
    writeSnapping(on);
  };
  const [dragNeedsMore, setDragNeedsMore] = useState(false);

  return (
    <section
      aria-label="Timeline"
      data-testid="clip-timeline-dock"
      className="flex shrink-0 flex-col rounded-card border-2 border-outline bg-chrome shadow-surfaceSm"
      style={{ height: shownHeight }}
    >
      <ResizeHandle
        label="Resize Timeline"
        value={shownHeight}
        min={DOCK_MIN_PX}
        max={DOCK_MAX_PX}
        step={16}
        grows="up"
        onChange={resize}
        valueText={`${shownHeight} pixels`}
        // The strip is 8 px; its pointer area reaches 16 px up into the stage's
        // empty padding so it is 24 px tall (WCAG 2.5.8), never over the tools row.
        className="-mt-1 mb-0 before:absolute before:inset-x-0 before:-top-4 before:bottom-0"
      />
      <ToolsRow
        playback={props.playback}
        document={props.document}
        fps={props.fps}
        snapping={snapping}
        onSnapping={changeSnapping}
        status={props.notice ?? (props.gettingMore || dragNeedsMore ? GETTING_MORE : null)}
        splitProblemAt={props.splitProblemAt}
        removeProblem={props.removeProblem}
        onSplit={props.onSplit}
        onRemove={props.onRemove}
      />
      <EditingTimeline {...props} snapping={snapping} onDragNeedsMore={setDragNeedsMore} />
    </section>
  );
}

export const GETTING_MORE = 'Getting more of the video';

// ---------------------------------------------------------------------------
// The tools row
// ---------------------------------------------------------------------------

function ToolsRow({
  playback,
  document,
  fps,
  snapping,
  onSnapping,
  status,
  splitProblemAt,
  removeProblem,
  onSplit,
  onRemove,
}: {
  playback: PlaybackStore;
  document: ClipDocument;
  fps: number;
  snapping: boolean;
  onSnapping: (on: boolean) => void;
  status: string | null;
  splitProblemAt: (playheadMs: number) => string | null;
  removeProblem: string | null;
  onSplit: () => void;
  onRemove: () => void;
}) {
  const switchId = useId();
  return (
    <div data-testid="clip-timeline-tools" className="flex shrink-0 items-center gap-1 px-2 pb-1.5">
      <SplitButton
        playback={playback}
        document={document}
        problemAt={splitProblemAt}
        onSplit={onSplit}
      />
      <TooltipHint
        label={<ToolLabel name="Remove" reason={removeProblem} />}
        shortcut={removeProblem ? undefined : <Kbd>Delete</Kbd>}
        disabled={removeProblem !== null}
      >
        <Button
          variant="ghost"
          size="sm"
          aria-label="Remove"
          data-testid="clip-timeline-remove"
          className={ICON_BUTTON}
          disabled={removeProblem !== null}
          onClick={onRemove}
        >
          <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <PlayheadField playback={playback} fps={fps} />
      <p
        aria-live="polite"
        data-testid="clip-timeline-status"
        className="m-0 min-w-0 flex-1 truncate px-2 font-sans text-xs text-ink type-muted"
      >
        {status ?? ''}
      </p>
      <label htmlFor={switchId} className="font-sans text-xs text-ink type-muted">
        Snapping
      </label>
      <Toggle
        id={switchId}
        checked={snapping}
        onCheckedChange={onSnapping}
        data-testid="clip-timeline-snapping"
        className="ml-1.5 scale-90"
      />
    </div>
  );
}

/** A tool's name, with the reason it is off under it. */
function ToolLabel({ name, reason }: { name: string; reason: string | null }) {
  return (
    <span className="flex flex-col">
      <span>{name}</span>
      {reason ? <span className="font-normal type-muted">{reason}</span> : null}
    </span>
  );
}

/** Reads the clock on its own, so a frame re-renders this button and nothing else. */
function SplitButton({
  playback,
  document,
  problemAt,
  onSplit,
}: {
  playback: PlaybackStore;
  document: ClipDocument;
  problemAt: (playheadMs: number) => string | null;
  onSplit: () => void;
}) {
  const currentMs = playback.useCurrentMs();
  // Re-read when the document changes, too.
  const problem = useMemo(() => {
    void document;
    return problemAt(currentMs);
  }, [currentMs, document, problemAt]);
  return (
    <TooltipHint
      label={<ToolLabel name="Split At The Playhead" reason={problem} />}
      shortcut={problem ? undefined : <Kbd>S</Kbd>}
      disabled={problem !== null}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label="Split At The Playhead"
        data-testid="clip-timeline-split"
        className={ICON_BUTTON}
        disabled={problem !== null}
        onClick={onSplit}
      >
        <MotionIcon icon={ScissorsIcon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}

function PlayheadField({ playback, fps }: { playback: PlaybackStore; fps: number }) {
  const currentMs = playback.useCurrentMs();
  const durationMs = playback.useDurationMs();
  return (
    <TimeField
      aria-label="Playhead Time"
      data-testid="clip-timeline-time"
      valueMs={Math.round(currentMs)}
      min={0}
      max={Math.max(0, durationMs)}
      fps={fps}
      onChange={(ms) => playback.seekMs(ms)}
      className="ml-1 w-24 tabular-nums"
    />
  );
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

type TrimEdge = 'start' | 'end';

/** A drag in progress: the document it began on and what it shows now. */
type DragView =
  | {
      kind: 'trim';
      segmentId: string;
      edge: TrimEdge;
      startDoc: ClipDocument;
      result: GestureResult;
      /** Where the edge is drawn, in the timeline's ms. */
      edgeMs: number;
      shiftMs: number;
      shiftFromIndex: number;
    }
  | {
      kind: 'zoom';
      mode: 'move' | 'start' | 'end';
      zoomId: string;
      startDoc: ClipDocument;
      result: GestureResult;
      edgeMs: number;
    }
  | {
      kind: 'item';
      mode: 'move' | 'start' | 'end';
      itemId: string;
      startDoc: ClipDocument;
      result: GestureResult;
      edgeMs: number;
    };

function EditingTimeline({
  document,
  selection,
  playback,
  filmstrip,
  waveform,
  fps,
  held,
  videoDurationMs,
  controlRef,
  snapping,
  onSelect,
  onOpen,
  onCommit,
  onDraft,
  onAnnounce,
  onDragNeedsMore,
  stickerPicture,
  soundShape,
  captionBars,
  onCaptions,
  speaker,
  onRemoveHook,
}: TimelineDockProps & { snapping: boolean; onDragNeedsMore: (needs: boolean) => void }) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const origin = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);
  const [scrollPx, setScrollPx] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const pendingScroll = useRef<number | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  const dragRef = useRef<DragView | null>(null);
  const stopDrag = useRef<((cancelled: boolean) => void) | null>(null);

  const shown = drag ? drag.result.doc : document;
  const parts = useMemo(() => placeSegments(shown), [shown]);
  const rows = useMemo(() => timelineRows(shown), [shown]);
  const durationMs = parts.length > 0 ? parts[parts.length - 1].outEnd : 0;
  // While dragging, the scale holds still: the clip's length is the one the drag began on.
  const layoutMs = drag ? outputDuration(drag.startDoc) : durationMs;
  const shiftMs = drag?.kind === 'trim' ? drag.shiftMs : 0;
  const shiftFrom = drag?.kind === 'trim' ? drag.shiftFromIndex : Number.POSITIVE_INFINITY;
  const extentMs = Math.max(layoutMs, durationMs + shiftMs);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => setWidthPx(Math.max(0, node.clientWidth - LABEL_PX - 16));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fitWidthPx = Math.max(1, widthPx - TAIL_PX);
  const bounds = useMemo(
    () => zoomBounds(Math.max(1, layoutMs), fitWidthPx, fps),
    [layoutMs, fitWidthPx, fps],
  );
  // On open (and until the person zooms) the whole clip fits.
  const currentZoom = zoom === null ? bounds.min : clampZoom(zoom, bounds);
  const scale = pxPerMsFor(currentZoom);
  const contentPx = Math.max(widthPx, Math.ceil(msToPx(extentMs, scale)) + TAIL_PX);
  const view = useMemo(
    () => ({ zoom: currentZoom, scrollPx, durationMs, widthPx: Math.max(1, widthPx), fps }),
    [currentZoom, scrollPx, durationMs, widthPx, fps],
  );
  const range = visibleRange(scrollPx, widthPx, scale);
  const visibleFrom = Math.max(0, range.fromMs);
  const visibleTo = range.toMs;

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || pendingScroll.current === null) return;
    node.scrollLeft = pendingScroll.current;
    setScrollPx(node.scrollLeft);
    pendingScroll.current = null;
  });

  const zoomTo = useCallback(
    (nextZoom: number, anchorMs: number) => {
      const next = zoomToAround(view, clampZoom(nextZoom, bounds), anchorMs);
      pendingScroll.current = next.scrollPx;
      setZoom(next.zoom);
    },
    [bounds, view],
  );

  const controls = useMemo<DockControls>(
    () => ({
      zoomIn: () => zoomTo(currentZoom * ZOOM_STEP, playback.getCurrentMs()),
      zoomOut: () => zoomTo(currentZoom / ZOOM_STEP, playback.getCurrentMs()),
      fit: () => {
        pendingScroll.current = 0;
        setZoom(null);
      },
    }),
    [currentZoom, playback, zoomTo],
  );

  useEffect(() => {
    controlRef.current = controls;
    return () => {
      if (controlRef.current === controls) controlRef.current = null;
    };
  }, [controlRef, controls]);

  // Ctrl (Cmd) and the wheel zoom around the time under the pointer. Not passive, so the page does not zoom too.
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const zoomNow = useRef(currentZoom);
  zoomNow.current = currentZoom;
  const scaleNow = useRef(scale);
  scaleNow.current = scale;
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const x = event.clientX - rect.left - LABEL_PX + node.scrollLeft;
      const anchorMs = Math.max(0, x / scaleNow.current);
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomRef.current(zoomNow.current * factor, anchorMs);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  /** The timeline's ms under a pointer, measured from the origin mark (it scrolls with the rows). */
  const msAt = (clientX: number) => {
    const left = origin.current?.getBoundingClientRect().left ?? 0;
    return (clientX - left) / scaleNow.current;
  };
  const clampToClip = (ms: number) => Math.max(0, Math.min(durationMs, ms));

  // ---- Pressing the ruler and the rows ------------------------------------------

  const scrubFromRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    playback.seekMs(clampToClip(msAt(event.clientX)));
    playback.setScrubbing(true);
    followPointer(
      event,
      (clientX) => playback.seekMs(clampToClip(msAt(clientX))),
      () => playback.setScrubbing(false),
    );
  };

  const pressTrack = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return;
    onSelect(null);
    playback.seekMs(clampToClip(msAt(event.clientX)));
  };

  // ---- Drags -------------------------------------------------------------------

  // A change from elsewhere (an undo, a reload) while dragging ends the drag unapplied.
  useEffect(() => {
    if (dragRef.current && dragRef.current.startDoc !== document) stopDrag.current?.(true);
  }, [document]);

  // Nothing outlives the dock: a drag in progress is dropped.
  useEffect(
    () => () => {
      stopDrag.current?.(true);
    },
    [],
  );

  const showDrag = (next: DragView | null) => {
    dragRef.current = next;
    setDrag(next);
    onDragNeedsMore(Boolean(next && next.kind === 'trim' && next.result.needsMoreVideo));
  };

  const beginTrim =
    (segmentId: string, edge: TrimEdge) => (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      const startDoc = document;
      const index = startDoc.segments.findIndex((segment) => segment.id === segmentId);
      if (index < 0) return;
      // The points are read once, with the playhead where it was when the drag began.
      const placedAtStart = placeSegments(startDoc).find((entry) => entry.segment.id === segmentId);
      if (!placedAtStart) return;
      // Where on the grip it was grabbed: the edge keeps that distance from the
      // pointer, so it moves by how far the pointer went and never jumps to it.
      const grabOffsetMs =
        msAt(event.clientX) - (edge === 'start' ? placedAtStart.outStart : placedAtStart.outEnd);
      // The points are read once, with the playhead where it was when the drag began.
      const playheadAtStart = playback.getCurrentMs();
      const points = snapPoints(startDoc, { playheadMs: playheadAtStart, exclude: [segmentId] });
      playback.pause();
      playback.setScrubbing(true);
      onSelect({ kind: 'segment', id: segmentId });

      const move = (clientX: number, alt: boolean) => {
        const pointerMs = msAt(clientX) - grabOffsetMs;
        const snap = snapping && !alt ? { points, pxPerMs: scaleNow.current } : undefined;
        const reducer = edge === 'start' ? dragTrimStart : dragTrimEnd;
        const result = reducer(startDoc, {
          segmentId,
          pointerMs,
          videoDurationMs,
          held: held ?? undefined,
          snap,
        });
        const shift = trimShiftMs(startDoc, result.doc, segmentId, edge);
        const placed = placeSegments(result.doc).find((entry) => entry.segment.id === segmentId);
        const edgeMs = placed
          ? edge === 'start'
            ? placed.outStart + shift
            : placed.outEnd
          : pointerMs;
        showDrag({
          kind: 'trim',
          segmentId,
          edge,
          startDoc,
          result,
          edgeMs,
          shiftMs: shift,
          shiftFromIndex: index,
        });
        onDraft({ doc: result.doc, seekMs: edgeFrameMs(result.doc, segmentId, edge, fps) });
      };

      stopDrag.current = followDrag(event, scroller.current, move, (cancelled) => {
        stopDrag.current = null;
        const last = dragRef.current;
        showDrag(null);
        onDraft(null);
        playback.setScrubbing(false);
        if (cancelled || !last || last.kind !== 'trim') return;
        const before = startDoc.segments[index];
        const after = last.result.doc.segments[index];
        // Let go where it began: nothing changed, so no undo step either.
        if (
          !after ||
          (after.sourceIn === before.sourceIn && after.sourceOut === before.sourceOut)
        ) {
          return;
        }
        onCommit(startDoc, last.result.doc, { select: { kind: 'segment', id: segmentId } });
        const placed = placeSegments(last.result.doc).find(
          (entry) => entry.segment.id === segmentId,
        );
        if (placed) {
          onAnnounce(
            `${partLabel(placed.index, placed.outStart, placed.outEnd, placed.segment.speed)}.`,
          );
        }
      });
    };

  const beginItem =
    (itemId: string, mode: 'move' | 'start' | 'end') =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      if (mode === 'move') event.stopPropagation();
      const startDoc = document;
      const grabbed = findItem(startDoc, itemId)?.item;
      if (!grabbed) return;
      const grabMs = msAt(event.clientX);
      // A resize keeps the grab's distance from the edge, as a trim does.
      const edgeOffsetMs =
        mode === 'start'
          ? grabMs - grabbed.start
          : mode === 'end'
            ? grabMs - (grabbed.start + grabbed.duration)
            : 0;
      const points = snapPoints(startDoc, {
        playheadMs: playback.getCurrentMs(),
        exclude: [itemId],
      });
      onSelect({ kind: 'item', id: itemId });

      const move = (clientX: number, alt: boolean) => {
        const pointerMs = msAt(clientX);
        const snap = snapping && !alt ? { points, pxPerMs: scaleNow.current } : undefined;
        const edgeMs = pointerMs - edgeOffsetMs;
        const result =
          mode === 'move'
            ? dragMoveItem(startDoc, { itemId, grabMs, pointerMs, snap })
            : (mode === 'start' ? dragResizeItemStart : dragResizeItemEnd)(startDoc, {
                itemId,
                pointerMs: edgeMs,
                snap,
              });
        const item = findItem(result.doc, itemId)?.item;
        const shownEdgeMs = item
          ? mode === 'end'
            ? item.start + item.duration
            : item.start
          : edgeMs;
        showDrag({ kind: 'item', mode, itemId, startDoc, result, edgeMs: shownEdgeMs });
        onDraft({ doc: result.doc, seekMs: null });
      };

      stopDrag.current = followDrag(event, scroller.current, move, (cancelled) => {
        stopDrag.current = null;
        const last = dragRef.current;
        showDrag(null);
        onDraft(null);
        if (cancelled || !last) return;
        const before = findItem(startDoc, itemId)?.item;
        const after = findItem(last.result.doc, itemId)?.item;
        // Let go where it began: nothing changed, so no undo step either.
        if (!before || !after) return;
        if (after.start === before.start && after.duration === before.duration) return;
        onCommit(startDoc, last.result.doc, { select: { kind: 'item', id: itemId } });
        const item = findItem(last.result.doc, itemId)?.item;
        if (item) onAnnounce(`${itemLabel(item)}.`);
      });
    };

  /** A zoom bar: move it, or drag an end (Module 13). The zoom keeps its moment of the video. */
  const beginZoom =
    (zoomId: string, piece: number, mode: 'move' | 'start' | 'end') =>
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      if (mode === 'move') event.stopPropagation();
      const startDoc = document;
      const bar = windowsOfZoom(startDoc, zoomId)[piece];
      if (!bar) return;
      const grabMs = msAt(event.clientX);
      const edgeOffsetMs =
        mode === 'start' ? grabMs - bar.startMs : mode === 'end' ? grabMs - bar.endMs : 0;
      const points = snapPoints(startDoc, { playheadMs: playback.getCurrentMs() });
      onSelect({ kind: 'zoom', id: zoomId });

      const move = (clientX: number, alt: boolean) => {
        const pointerMs = msAt(clientX);
        const snap = snapping && !alt ? { points, pxPerMs: scaleNow.current } : undefined;
        const edge = pointerMs - edgeOffsetMs;
        const result =
          mode === 'move'
            ? dragMoveZoom(startDoc, { zoomId, piece, grabMs, pointerMs, snap })
            : (mode === 'start' ? dragResizeZoomStart : dragResizeZoomEnd)(startDoc, {
                zoomId,
                piece,
                pointerMs: edge,
                snap,
              });
        const now = windowsOfZoom(result.doc, zoomId)[piece];
        const shownEdgeMs = now ? (mode === 'end' ? now.endMs : now.startMs) : edge;
        showDrag({ kind: 'zoom', mode, zoomId, startDoc, result, edgeMs: shownEdgeMs });
        onDraft({ doc: result.doc, seekMs: null });
      };

      stopDrag.current = followDrag(event, scroller.current, move, (cancelled) => {
        stopDrag.current = null;
        const last = dragRef.current;
        showDrag(null);
        onDraft(null);
        if (cancelled || !last) return;
        const before = startDoc.zooms.find((zoom) => zoom.id === zoomId);
        const after = last.result.doc.zooms.find((zoom) => zoom.id === zoomId);
        if (!before || !after || (after.from === before.from && after.to === before.to)) return;
        onCommit(startDoc, last.result.doc, { select: { kind: 'zoom', id: zoomId } });
        const shown = windowsOfZoom(last.result.doc, zoomId)[0];
        if (shown) onAnnounce(`${zoomLabel(after, shown.startMs, shown.endMs)}.`);
      });
    };

  // ---- Keys on a bar -------------------------------------------------------------

  const barKeys =
    (bar: NonNullable<EditorSelection>) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        onSelect(bar);
        onOpen(bar);
        return;
      }
      if (bar.kind !== 'item' && bar.kind !== 'zoom') return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      // An item's or a zoom's arrows move it; the window's arrows (the playhead) do not also run.
      event.preventDefault();
      const step = event.shiftKey ? 1000 : 1000 / (fps > 0 ? fps : 30);
      if (bar.kind === 'zoom') {
        const pointerMs = event.key === 'ArrowLeft' ? -step : step;
        const moved = dragMoveZoom(document, { zoomId: bar.id, grabMs: 0, pointerMs }).doc;
        if (moved === document) return;
        onCommit(document, moved, { select: bar, coalesceKey: `nudge:${bar.id}` });
        const zoom = moved.zooms.find((candidate) => candidate.id === bar.id);
        const shown = windowsOfZoom(moved, bar.id)[0];
        if (zoom && shown) onAnnounce(`${zoomLabel(zoom, shown.startMs, shown.endMs)}.`);
        return;
      }
      const next = nudgeItem(document, bar.id, event.key === 'ArrowLeft' ? -step : step);
      if (next === document) return;
      onCommit(document, next, { select: bar, coalesceKey: `nudge:${bar.id}` });
      const item = findItem(next, bar.id)?.item;
      if (item) onAnnounce(`${itemLabel(item)}.`);
    };

  const focusBar = (bar: NonNullable<EditorSelection>, label: string) => () => {
    if (dragRef.current) return;
    if (selection?.kind === bar.kind && selection.id === bar.id) return;
    onSelect(bar);
    onAnnounce(`${label}.`);
  };

  const isSelected = (bar: NonNullable<EditorSelection>) =>
    selection?.kind === bar.kind && selection.id === bar.id;

  // ---- Ruler ----------------------------------------------------------------------

  const ticks = useMemo(() => {
    if (!(scale > 0) || widthPx === 0) return [];
    const endMs = contentPx / scale;
    return rulerTicks(visibleFrom, Math.min(visibleTo, endMs), scale, { fps }).ticks.map(
      (tick) => ({
        px: msToPx(tick.ms, scale),
        label: tick.label || undefined,
        major: tick.major,
      }),
    );
  }, [contentPx, fps, scale, visibleFrom, visibleTo, widthPx]);

  const xOf = (ms: number) => msToPx(ms, scale);
  const guideMs = drag?.result.snappedTo ? drag.result.snappedTo.ms : null;

  return (
    <div
      ref={scroller}
      data-testid="clip-timeline"
      data-dragging={drag ? drag.kind : undefined}
      className="relative min-h-0 flex-1 overflow-x-auto overflow-y-auto bg-chrome px-2 pb-2 pg-scrollbar"
      onScroll={(event) => setScrollPx(event.currentTarget.scrollLeft)}
    >
      <div className="relative" style={{ width: LABEL_PX + contentPx }}>
        <div
          ref={origin}
          aria-hidden
          className="absolute top-0 h-0 w-0"
          style={{ left: LABEL_PX }}
        />
        <div className="flex">
          <div
            aria-hidden
            className="sticky left-0 z-10 shrink-0 bg-chrome"
            style={{ width: LABEL_PX }}
          />
          <TimeRuler ticks={ticks} widthPx={contentPx} onPointerDown={scrubFromRuler} />
        </div>
        <div className="flex flex-col gap-1.5 pt-2">
          <TimelineRow
            label="Video"
            tall
            widthPx={contentPx}
            className="bg-chrome"
            onTrackPointerDown={pressTrack}
          >
            {parts.map(({ segment, index, outStart, outEnd }) => {
              const shift = index >= shiftFrom ? shiftMs : 0;
              const start = outStart + shift;
              const end = outEnd + shift;
              const from = Math.max(start, visibleFrom);
              const to = Math.min(end, visibleTo);
              const visible = to > from;
              const speed = segment.speed;
              const hatch = partHatch(segment, outEnd - outStart, held);
              const bar = { kind: 'segment', id: segment.id } as const;
              const hook = isHookPart(segment);
              // Module 10: a brand kit's intro or outro, another video (no filmstrip of its own here).
              const brand = brandPartName(segment);
              const label = hook
                ? hookPartLabel(outStart, outEnd)
                : brand
                  ? brandPartLabel(brand, outStart, outEnd)
                  : partLabel(index, outStart, outEnd, speed);
              // The hook's delete sits at the end of its last part.
              const lastHook = hook && parts[index + 1]?.segment.role !== 'hook';
              return (
                <div key={segment.id} className="contents">
                  {visible && !brand ? (
                    <Filmstrip
                      strip={filmstrip}
                      fromMs={segment.sourceIn + (from - start) * speed}
                      toMs={segment.sourceIn + (to - start) * speed}
                      pxPerMs={scale / speed}
                      widthPx={Math.max(1, Math.round(msToPx(to - from, scale)))}
                      heightPx={VIDEO_ROW_INNER_PX}
                      className="pointer-events-none absolute top-0.5"
                      style={{ left: xOf(from) + 2 }}
                    />
                  ) : null}
                  <TimelineBar
                    aria-label={label}
                    data-testid="clip-part"
                    data-part-index={index}
                    data-hook={hook ? '' : undefined}
                    data-brand={brand ? brand.toLowerCase() : undefined}
                    leftPx={xOf(start)}
                    widthPx={Math.max(6, xOf(end - start))}
                    tone="primary"
                    selected={isSelected(bar)}
                    className="inset-y-0 bg-transparent"
                    hatchUntilPx={hatch.untilMs === undefined ? undefined : xOf(hatch.untilMs)}
                    hatchFromPx={hatch.fromMs === undefined ? undefined : xOf(hatch.fromMs)}
                    onBodyPointerDown={pressPart(bar, outStart, outEnd, label)}
                    resizable={!hook && !brand}
                    onStartGripPointerDown={beginTrim(segment.id, 'start')}
                    onEndGripPointerDown={beginTrim(segment.id, 'end')}
                    onKeyDown={barKeys(bar)}
                    onFocus={focusBar(bar, label)}
                  >
                    {hook ? (
                      <TimelineBarChip data-testid="clip-hook-label">Hook</TimelineBarChip>
                    ) : null}
                    {brand ? (
                      <TimelineBarChip data-testid="clip-brand-part-label">{brand}</TimelineBarChip>
                    ) : null}
                    {speed !== 1 ? <TimelineBarChip>{`${speed}x`}</TimelineBarChip> : null}
                  </TimelineBar>
                  {lastHook && visible ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label="Remove Hook"
                      title="Remove Hook"
                      className="absolute top-1 z-20 h-6 w-6 -translate-x-full px-0"
                      style={{ left: xOf(end) - 4 }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => {
                        if (onRemoveHook) {
                          onRemoveHook();
                          return;
                        }
                        onCommit(document, removeHook(document), { select: null });
                        onAnnounce('Hook removed.');
                      }}
                      data-testid="clip-hook-delete"
                    >
                      <MotionIcon icon={XIcon} className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </TimelineRow>
          {speaker && speaker.stretches.length > 0 ? (
            <SpeakerStrip
              className="bg-chrome"
              data-testid="clip-speaker-strip"
              widthPx={contentPx}
              onSelect={speaker.onSelect}
              stretches={speaker.stretches.map((stretch) => ({
                key: stretch.key,
                kind: stretch.kind,
                person: stretch.person,
                leftPx: xOf(stretch.fromMs),
                widthPx: xOf(stretch.toMs - stretch.fromMs),
                label: stretch.label,
                selected: stretch.key === speaker.selectedKey,
              }))}
            />
          ) : null}
          <TimelineRow
            label="Video Sound"
            slim
            widthPx={contentPx}
            className="bg-chrome"
            onTrackPointerDown={pressTrack}
          >
            {parts.map(({ segment, index, outStart, outEnd }) => {
              const shift = index >= shiftFrom ? shiftMs : 0;
              const start = outStart + shift;
              const from = Math.max(start, visibleFrom);
              const to = Math.min(outEnd + shift, visibleTo);
              // The waveform is the clip's own video: an intro or outro has none drawn here.
              if (!(to > from) || brandPartName(segment)) return null;
              return (
                <Waveform
                  key={segment.id}
                  waveform={waveform}
                  fromMs={segment.sourceIn + (from - start) * segment.speed}
                  toMs={segment.sourceIn + (to - start) * segment.speed}
                  pxPerMs={scale / segment.speed}
                  widthPx={Math.max(1, Math.round(msToPx(to - from, scale)))}
                  heightPx={SLIM_ROW_INNER_PX}
                  className="pointer-events-none absolute top-0.5 text-ink/60"
                  style={{ left: xOf(from) + 2 }}
                />
              );
            })}
          </TimelineRow>
          {rows.map((row) => (
            <TimelineRow
              key={row.key}
              label={row.label}
              slim={row.bars.length === 0}
              widthPx={contentPx}
              className="bg-chrome"
              data-testid={`clip-row-${row.kind}`}
              onTrackPointerDown={pressTrack}
            >
              {row.bars.map((bar) => (
                <ItemBar
                  key={bar.key}
                  bar={bar}
                  tone={ROW_TONES[row.kind]}
                  leftPx={xOf(bar.startMs)}
                  widthPx={Math.max(6, xOf(bar.endMs - bar.startMs))}
                  selected={isSelected(bar.selection)}
                  picture={
                    bar.selection.kind === 'item'
                      ? (stickerPicture?.(bar.selection.id) ?? null)
                      : null
                  }
                  shape={
                    bar.selection.kind === 'item' && row.kind === 'sound'
                      ? (soundShape?.(bar.selection.id) ?? null)
                      : null
                  }
                  onBody={
                    !bar.movable
                      ? (event) => {
                          if (event.button !== 0) return;
                          event.stopPropagation();
                          onSelect(bar.selection);
                        }
                      : bar.selection.kind === 'zoom'
                        ? beginZoom(bar.selection.id, bar.piece ?? 0, 'move')
                        : beginItem(bar.selection.id, 'move')
                  }
                  onStart={
                    !bar.movable
                      ? undefined
                      : bar.selection.kind === 'zoom'
                        ? beginZoom(bar.selection.id, bar.piece ?? 0, 'start')
                        : beginItem(bar.selection.id, 'start')
                  }
                  onEnd={
                    !bar.movable
                      ? undefined
                      : bar.selection.kind === 'zoom'
                        ? beginZoom(bar.selection.id, bar.piece ?? 0, 'end')
                        : beginItem(bar.selection.id, 'end')
                  }
                  onKeyDown={barKeys(bar.selection)}
                  onFocus={focusBar(bar.selection, bar.label)}
                />
              ))}
            </TimelineRow>
          ))}
          {captionBars ? (
            <TimelineRow
              label="Captions"
              slim={captionBars.length === 0}
              widthPx={contentPx}
              className="bg-chrome"
              data-testid="clip-row-captions"
              onTrackPointerDown={pressTrack}
            >
              {captionBars.map((bar) => (
                <button
                  key={bar.key}
                  type="button"
                  title={bar.text}
                  aria-label={`Captions, ${bar.text}`}
                  data-testid="clip-caption-bar"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => onCaptions?.(bar.startMs)}
                  className="absolute inset-y-1 cursor-pointer overflow-hidden truncate rounded-sm border-2 border-outline bg-secondary px-1 text-left font-sans text-[11px] font-bold text-ink"
                  style={{
                    left: xOf(bar.startMs),
                    width: Math.max(4, xOf(bar.endMs - bar.startMs) - 1),
                  }}
                >
                  {bar.text}
                </button>
              ))}
            </TimelineRow>
          ) : null}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{ left: LABEL_PX, width: contentPx }}
        >
          {guideMs !== null ? (
            <span
              aria-hidden
              data-testid="clip-snap-guide"
              className="absolute inset-y-0 w-px bg-actionPrimary"
              style={{ left: xOf(guideMs) }}
            />
          ) : null}
          {drag ? (
            <span
              aria-hidden
              data-testid="clip-drag-time"
              className="absolute top-6 z-30 -translate-x-1/2 rounded-md border-2 border-outline bg-secondary px-1.5 py-0.5 font-sans text-[11px] font-bold tabular-nums text-ink"
              style={{ left: xOf(drag.edgeMs) }}
            >
              {formatTimecode(Math.max(0, drag.edgeMs))}
            </span>
          ) : null}
          <PlayheadLayer
            playback={playback}
            scale={scale}
            durationMs={durationMs}
            view={view}
            scroller={scroller}
            shift={drag?.kind === 'trim' && drag.shiftMs > 0 ? drag : null}
          />
        </div>
      </div>
    </div>
  );

  /** A press on a part selects it and moves the playhead to where it landed. */
  function pressPart(
    bar: NonNullable<EditorSelection>,
    outStart: number,
    outEnd: number,
    label: string,
  ) {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || dragRef.current) return;
      event.stopPropagation();
      if (!isSelected(bar)) {
        onSelect(bar);
        onAnnounce(`${label}.`);
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      playback.seekMs(outStart + Math.max(0, Math.min(1, fraction)) * (outEnd - outStart));
    };
  }
}

function ItemBar({
  bar,
  tone,
  leftPx,
  widthPx,
  selected,
  picture,
  shape,
  onBody,
  onStart,
  onEnd,
  onKeyDown,
  onFocus,
}: {
  bar: TimelineBarModel;
  tone: TimelineTone;
  leftPx: number;
  widthPx: number;
  selected: boolean;
  /** A sticker's tiny picture, before its name. */
  picture: string | null;
  /** A sound's shape, drawn behind its name. */
  shape: { peaks: readonly number[]; fill: number; name: string | null } | null;
  onBody: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onEnd?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
}) {
  return (
    <TimelineBar
      aria-label={bar.label}
      data-testid={`clip-bar-${bar.selection.kind}`}
      leftPx={leftPx}
      widthPx={widthPx}
      tone={tone}
      selected={selected}
      movable={bar.movable}
      resizable={bar.movable}
      onBodyPointerDown={onBody}
      onStartGripPointerDown={onStart}
      onEndGripPointerDown={onEnd}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {picture ? (
        // biome-ignore lint/performance/noImgElement: a tiny remote sticker preview, drawn as it is.
        <img
          src={picture}
          alt=""
          draggable={false}
          decoding="async"
          data-testid="clip-bar-picture"
          className="pointer-events-none h-4 w-4 shrink-0 object-contain"
        />
      ) : null}
      {shape && shape.peaks.length > 1 ? (
        <SoundShape
          peaks={shape.peaks}
          fill={shape.fill}
          className="pointer-events-none absolute inset-1 h-[calc(100%-0.5rem)] w-[calc(100%-0.5rem)] opacity-40"
        />
      ) : null}
      <span className="relative truncate font-sans text-[11px] font-bold">
        {shape?.name ?? bar.name}
      </span>
    </TimelineBar>
  );
}

/** Follows a pointer from its press until it is let go, outside the element too. */
function followPointer(
  event: ReactPointerEvent,
  onMove: (clientX: number) => void,
  onEnd: () => void,
) {
  event.preventDefault();
  const pointerId = event.pointerId;
  const move = (next: PointerEvent) => {
    if (next.pointerId === pointerId) onMove(next.clientX);
  };
  const end = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

/**
 * Follows a drag until it is let go (or Escape, or the pointer is lost),
 * telling `onMove` where the pointer is and whether Alt is held. Nothing is
 * told until the pointer has gone `DRAG_START_PX` from the press, so a click
 * (or a hand that shakes a pixel) never edits. Near the
 * scroller's sides the view scrolls along, a little faster the further in,
 * and the drag is told again so the dragged edge keeps up. Answers the stop
 * function, for a drag ended from outside (`true`: cancelled).
 */
function followDrag(
  event: ReactPointerEvent,
  scroller: HTMLDivElement | null,
  onMove: (clientX: number, alt: boolean) => void,
  onEnd: (cancelled: boolean) => void,
): (cancelled: boolean) => void {
  event.preventDefault();
  const pointerId = event.pointerId;
  const downX = event.clientX;
  let live = false;
  let lastX = event.clientX;
  let lastAlt = event.altKey;
  let frame = 0;
  let done = false;

  const tick = () => {
    frame = 0;
    if (done || !scroller) return;
    const rect = scroller.getBoundingClientRect();
    const right = rect.right - EDGE_SCROLL_PX;
    const left = rect.left + LABEL_PX + EDGE_SCROLL_PX;
    let by = 0;
    if (lastX > right) by = Math.min(EDGE_SCROLL_MAX_PX, (lastX - right) * 0.5 + 2);
    else if (lastX < left) by = -Math.min(EDGE_SCROLL_MAX_PX, (left - lastX) * 0.5 + 2);
    if (by === 0) return;
    const before = scroller.scrollLeft;
    scroller.scrollLeft = before + by;
    // At the end of the view (or of what a drag can reach) it stops; the next move starts it again.
    if (scroller.scrollLeft === before) return;
    onMove(lastX, lastAlt);
    frame = requestAnimationFrame(tick);
  };

  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    lastX = next.clientX;
    lastAlt = next.altKey;
    if (!live) {
      if (Math.abs(lastX - downX) < DRAG_START_PX) return;
      live = true;
    }
    onMove(lastX, lastAlt);
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const keys = (next: KeyboardEvent) => {
    if (next.key === 'Escape') {
      next.preventDefault();
      next.stopPropagation();
      stop(true);
      return;
    }
    if (next.key === 'Alt' && next.altKey !== lastAlt) {
      // Alt pressed or let go without moving: snapping follows at once.
      next.preventDefault();
      lastAlt = next.altKey;
      if (live) onMove(lastX, lastAlt);
    }
  };
  const end = (next: PointerEvent) => {
    if (next.pointerId === pointerId) stop(next.type === 'pointercancel');
  };
  const lost = () => stop(true);

  function stop(cancelled: boolean) {
    if (done) return;
    done = true;
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('keydown', keys, true);
    window.removeEventListener('keyup', keys, true);
    window.removeEventListener('blur', lost);
    onEnd(cancelled);
  }

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('keydown', keys, true);
  window.addEventListener('keyup', keys, true);
  window.addEventListener('blur', lost);
  return stop;
}

/** The only part that follows the clock: the playhead, and the view following it while playing. */
function PlayheadLayer({
  playback,
  scale,
  durationMs,
  view,
  scroller,
  shift,
}: {
  playback: PlaybackStore;
  scale: number;
  durationMs: number;
  view: { zoom: number; scrollPx: number; durationMs: number; widthPx: number; fps: number };
  scroller: RefObject<HTMLDivElement | null>;
  /** While a start edge is trimmed inward, the parts from the dragged one on are drawn shifted. */
  shift: { shiftMs: number; shiftFromIndex: number; result: GestureResult } | null;
}) {
  const currentMs = playback.useCurrentMs();
  const playing = playback.usePlaying();

  useEffect(() => {
    if (!playing) return;
    const node = scroller.current;
    if (!node) return;
    const next = scrollToShow({ ...view, scrollPx: node.scrollLeft }, currentMs);
    if (Math.abs(next - node.scrollLeft) > 1) node.scrollLeft = next;
  }, [currentMs, playing, scroller, view]);

  let drawnMs = currentMs;
  if (shift) {
    const from = placeSegments(shift.result.doc)[shift.shiftFromIndex]?.outStart;
    if (from !== undefined && currentMs >= from) drawnMs += shift.shiftMs;
  }

  return (
    <Playhead
      px={msToPx(drawnMs, scale)}
      valueMs={Math.round(currentMs)}
      maxMs={durationMs}
      valueText={formatTimecode(currentMs)}
      onDragStart={() => {
        playback.pause();
        playback.setScrubbing(true);
      }}
      onDrag={(px) => playback.seekMs(Math.max(0, Math.min(durationMs, px / scale)))}
      onDragEnd={() => playback.setScrubbing(false)}
      onStep={(direction, large) =>
        large ? playback.seekMs(currentMs + direction * 1000) : playback.stepFrames(direction)
      }
      onJump={(to) => playback.seekMs(to === 'start' ? 0 : durationMs)}
    />
  );
}
