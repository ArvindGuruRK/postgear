'use client';

/**
 * The video page's timeline (Module 07, section 3): the ruler, the
 * filmstrip, the sound's shape, every clip already cut from the video as a
 * line, the marked range as a band with two handles and its length, and the
 * playhead.
 *
 * - **Maths** comes from the engine's `timeline/` (scale, ruler, visible),
 *   so the editor's timeline in Module 09 behaves the same.
 * - **Drawing only what shows**: the canvases cover the visible width and
 *   sit where the view is scrolled to; the ruler asks only for the ticks in
 *   view. A six hour video scrolls as lightly as a short one.
 * - **Moving around**: click the ruler or a row to seek, drag on the ruler to
 *   scrub, drag the playhead, scroll sideways, zoom with the buttons, + and -,
 *   or Ctrl (Cmd) and the wheel. Zooming from the buttons and keys keeps the
 *   playhead still; the wheel keeps the time under the pointer still. On
 *   open it fits the whole video. While playing, the view follows the
 *   playhead.
 *
 * Only the playhead layer listens to the clock, so the rest of the timeline
 * is not drawn again 60 times a second.
 */
import { MinusIcon } from '@animateicons/react/lucide/minus-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { ScanIcon } from '@animateicons/react/lucide/scan-icon';
import {
  Button,
  MotionIcon,
  Playhead,
  TIMELINE_LABEL_WIDTH_PX,
  TimelineBar,
  TimelineBarChip,
  TimelineRow,
  TimeRuler,
  TooltipHint,
} from '@postgear/ui';
import {
  clampZoom,
  formatTimecode,
  msToPx,
  pxPerMs as pxPerMsFor,
  rulerTicks,
  scrollToShow,
  visibleRange,
  ZOOM_STEP,
  zoomBounds,
  zoomToAround,
} from '@postgear/video-engine';
import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ClipFilmstrip, ClipSummary, ClipWaveform } from '@/types/clips';
import { Filmstrip } from '../timeline/filmstrip';
import { Waveform } from '../timeline/waveform';
import { type SourcePlayerStore, usePlayerSnapshot } from './source-player';
import {
  checkRange,
  clipLengthLabel,
  dragMarkEdge,
  type MarkedRange,
  moveMark,
} from './video-page-model';

const LABEL_PX = TIMELINE_LABEL_WIDTH_PX;
/** The Video row is `tall` (56 px), Sound the default (40 px); 2 px border each side. */
const VIDEO_ROW_INNER_PX = 52;
const SOUND_ROW_INNER_PX = 36;

export interface TimelineControls {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
}

/** Follows a pointer from its press until it is let go, outside the element too. */
function followPointer(
  event: ReactPointerEvent,
  onMove: (deltaPx: number, clientX: number) => void,
  onEnd?: () => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const pointerId = event.pointerId;
  const move = (next: PointerEvent) => {
    if (next.pointerId === pointerId) onMove(next.clientX - startX, next.clientX);
  };
  const end = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

export function SourceTimeline({
  store,
  durationMs,
  fps,
  filmstrip,
  waveform,
  mark,
  onMarkChange,
  clips,
  selectedClipId,
  onSelectClip,
  controlRef,
}: {
  store: SourcePlayerStore;
  durationMs: number;
  fps: number;
  filmstrip: ClipFilmstrip | null;
  waveform: ClipWaveform | null;
  mark: MarkedRange;
  onMarkChange: (next: MarkedRange) => void;
  clips: readonly ClipSummary[];
  selectedClipId: string | null;
  onSelectClip: (clip: ClipSummary) => void;
  /** The page's + and - keys reach the zoom through this. */
  controlRef?: RefObject<TimelineControls | null>;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [widthPx, setWidthPx] = useState(0);
  const [scrollPx, setScrollPx] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const pendingScroll = useRef<number | null>(null);

  // The visible width (the scroller less the sticky labels), kept in step.
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => setWidthPx(Math.max(0, node.clientWidth - LABEL_PX));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const bounds = useMemo(
    () => zoomBounds(durationMs, Math.max(1, widthPx), fps),
    [durationMs, widthPx, fps],
  );
  // On open (and until the person zooms) the whole video fits.
  const currentZoom = zoom === null ? bounds.min : clampZoom(zoom, bounds);
  const scale = pxPerMsFor(currentZoom);
  const contentPx = Math.max(widthPx, Math.ceil(msToPx(durationMs, scale)));
  const view = useMemo(
    () => ({ zoom: currentZoom, scrollPx, durationMs, widthPx: Math.max(1, widthPx), fps }),
    [currentZoom, scrollPx, durationMs, widthPx, fps],
  );
  const range = visibleRange(scrollPx, widthPx, scale);
  const visibleFrom = Math.max(0, range.fromMs);
  const visibleTo = Math.min(durationMs, range.toMs);
  const canvasLeft = Math.min(scrollPx, Math.max(0, contentPx - widthPx));

  // A zoom asks for a scroll position that only exists once the new width is drawn.
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

  const controls = useMemo<TimelineControls>(
    () => ({
      zoomIn: () => zoomTo(currentZoom * ZOOM_STEP, store.getCurrentMs()),
      zoomOut: () => zoomTo(currentZoom / ZOOM_STEP, store.getCurrentMs()),
      fit: () => {
        pendingScroll.current = 0;
        setZoom(bounds.min);
      },
    }),
    [bounds.min, currentZoom, store, zoomTo],
  );

  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = controls;
    return () => {
      controlRef.current = null;
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

  const msAt = (clientX: number, track: HTMLElement) => {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(durationMs, (clientX - rect.left) / scale));
  };

  const seekFromTrack = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    store.seek(msAt(event.clientX, event.currentTarget));
  };

  // The ruler scrubs: press and drag.
  const scrubFromRuler = (event: ReactPointerEvent<HTMLDivElement>) => {
    const track = event.currentTarget;
    store.seek(msAt(event.clientX, track));
    followPointer(event, (_delta, clientX) => store.seek(msAt(clientX, track)));
  };

  const ticks = useMemo(() => {
    if (!(scale > 0) || widthPx === 0) return [];
    return rulerTicks(visibleFrom, visibleTo, scale, { fps })
      .ticks.filter((tick) => tick.ms <= durationMs)
      .map((tick) => ({
        px: msToPx(tick.ms, scale),
        label: tick.label || undefined,
        major: tick.major,
      }));
  }, [durationMs, fps, scale, visibleFrom, visibleTo, widthPx]);

  // The marked band: grips move one end, the body moves both.
  const markCheck = checkRange(mark);
  const startDrag = (edge: 'in' | 'out' | 'body') => (event: ReactPointerEvent<HTMLDivElement>) => {
    // The band's press is not also a seek on the row under it.
    event.stopPropagation();
    const startRange = mark;
    followPointer(event, (deltaPx) => {
      const deltaMs = deltaPx / scale;
      if (edge === 'body') onMarkChange(moveMark(startRange, deltaMs, durationMs));
      else if (edge === 'in' && startRange.inMs !== null)
        onMarkChange(dragMarkEdge(startRange, 'in', startRange.inMs + deltaMs, durationMs));
      else if (edge === 'out' && startRange.outMs !== null)
        onMarkChange(dragMarkEdge(startRange, 'out', startRange.outMs + deltaMs, durationMs));
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 font-sans text-sm text-ink type-muted" aria-live="polite">
          {mark.inMs !== null && mark.outMs !== null
            ? `Marked ${formatTimecode(mark.inMs)} to ${formatTimecode(mark.outMs)}`
            : mark.inMs !== null
              ? `Start at ${formatTimecode(mark.inMs)}. Press O to mark the end.`
              : 'Press I to mark a start and O to mark an end.'}
        </p>
        <div className="flex items-center gap-1">
          <TooltipHint label="Zoom Out" shortcut={['-']}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Zoom Out"
              disabled={currentZoom <= bounds.min}
              onClick={controls.zoomOut}
            >
              <MotionIcon icon={MinusIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
          <TooltipHint label="Zoom In" shortcut={['+']}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Zoom In"
              disabled={currentZoom >= bounds.max}
              onClick={controls.zoomIn}
            >
              <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
          <TooltipHint label="Show The Whole Video">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Show The Whole Video"
              disabled={currentZoom <= bounds.min}
              onClick={controls.fit}
            >
              <MotionIcon icon={ScanIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        </div>
      </div>

      <div
        ref={scroller}
        data-testid="source-timeline"
        className="relative overflow-x-auto overflow-y-hidden bg-chrome pb-2"
        onScroll={(event) => setScrollPx(event.currentTarget.scrollLeft)}
      >
        <div className="relative bg-chrome" style={{ width: LABEL_PX + contentPx }}>
          <div className="flex">
            <div
              aria-hidden
              className="sticky left-0 z-10 shrink-0 bg-chrome"
              style={{ width: LABEL_PX }}
            />
            <TimeRuler ticks={ticks} widthPx={contentPx} onPointerDown={scrubFromRuler} />
          </div>
          <div className="flex flex-col gap-2 pt-2">
            <TimelineRow label="Video" tall widthPx={contentPx} onTrackPointerDown={seekFromTrack}>
              <Filmstrip
                strip={filmstrip}
                fromMs={visibleFrom}
                toMs={visibleTo}
                pxPerMs={scale}
                widthPx={widthPx}
                heightPx={VIDEO_ROW_INNER_PX}
                className="absolute top-0.5 rounded-sm"
                style={{ left: canvasLeft + 2 }}
              />
              {mark.inMs !== null && mark.outMs !== null ? (
                <TimelineBar
                  aria-label={`Marked range, ${clipLengthLabel(mark.outMs - mark.inMs) ?? ''}`}
                  leftPx={msToPx(mark.inMs, scale)}
                  widthPx={Math.max(6, msToPx(mark.outMs - mark.inMs, scale))}
                  tone={markCheck.ok ? 'primary' : 'danger'}
                  movable
                  selected
                  className="inset-y-0 bg-actionPrimary/25"
                  onBodyPointerDown={startDrag('body')}
                  onStartGripPointerDown={startDrag('in')}
                  onEndGripPointerDown={startDrag('out')}
                >
                  <TimelineBarChip>{clipLengthLabel(mark.outMs - mark.inMs)}</TimelineBarChip>
                </TimelineBar>
              ) : mark.inMs !== null ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-actionPrimary"
                  style={{ left: msToPx(mark.inMs, scale) }}
                />
              ) : null}
            </TimelineRow>
            <TimelineRow label="Sound" widthPx={contentPx} onTrackPointerDown={seekFromTrack}>
              <Waveform
                waveform={waveform}
                fromMs={visibleFrom}
                toMs={visibleTo}
                pxPerMs={scale}
                widthPx={widthPx}
                heightPx={SOUND_ROW_INNER_PX}
                className="absolute top-0.5 opacity-70"
                style={{ left: canvasLeft + 2 }}
              />
            </TimelineRow>
            {clips.length > 0 ? (
              <TimelineRow
                label="Clips"
                slim
                widthPx={contentPx}
                onTrackPointerDown={seekFromTrack}
              >
                {clips.map((clip) =>
                  clip.range ? (
                    <TimelineBar
                      key={clip.id}
                      aria-label={clip.title}
                      leftPx={msToPx(clip.range.fromMs, scale)}
                      widthPx={Math.max(4, msToPx(clip.range.toMs - clip.range.fromMs, scale))}
                      tone={
                        clip.state === 'exported' || clip.state === 'scheduled'
                          ? 'success'
                          : 'accent'
                      }
                      resizable={false}
                      selected={clip.id === selectedClipId}
                      className="inset-y-1"
                      onBodyPointerDown={(event) => {
                        event.stopPropagation();
                        onSelectClip(clip);
                      }}
                    />
                  ) : null,
                )}
              </TimelineRow>
            ) : null}
          </div>
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: LABEL_PX, width: contentPx }}
          >
            <PlayheadLayer
              store={store}
              scale={scale}
              durationMs={durationMs}
              view={view}
              scroller={scroller}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The only part that follows the clock: the playhead, and the view following it while playing. */
function PlayheadLayer({
  store,
  scale,
  durationMs,
  view,
  scroller,
}: {
  store: SourcePlayerStore;
  scale: number;
  durationMs: number;
  view: { zoom: number; scrollPx: number; durationMs: number; widthPx: number; fps: number };
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const { currentMs, playing } = usePlayerSnapshot(store);

  useEffect(() => {
    if (!playing) return;
    const node = scroller.current;
    if (!node) return;
    const next = scrollToShow({ ...view, scrollPx: node.scrollLeft }, currentMs);
    if (Math.abs(next - node.scrollLeft) > 1) node.scrollLeft = next;
  }, [currentMs, playing, scroller, view]);

  return (
    <Playhead
      px={msToPx(currentMs, scale)}
      valueMs={Math.round(currentMs)}
      maxMs={durationMs}
      valueText={formatTimecode(currentMs)}
      onDragStart={() => store.pause()}
      onDrag={(px) => store.seek(px / scale)}
      onStep={(direction, large) => store.seek(currentMs + direction * (large ? 5000 : 1000))}
      onJump={(to) => store.seek(to === 'start' ? 0 : durationMs)}
    />
  );
}
