'use client';

/**
 * The editor's canvas (Sprint 9, DS-4.1, DS-4.3, DS-4.4): the slide on show,
 * drawn by the same renderer as the export, with a layer of hit areas over
 * it, one per element.
 *
 * - A click on a text element puts a cursor in it; typing is the renderer's
 *   own plain-text field, so pasted text arrives as words.
 * - Dragging moves an element inside its area only. While it moves, the
 *   area's outline and name show, and an edge it stops at lights up.
 * - Arrow keys nudge the selected element by 1% of its area (Shift: 5%),
 *   Delete hides an optional one, Enter starts typing, Escape lets go.
 * - Typing ends with Escape, which puts the words back as they were, or with
 *   Ctrl or Cmd and Enter, which keeps them (Sprint 9b). A cancel is a step
 *   of its own, so Undo can still bring the typed words back.
 * - Text still too long at its smallest size has a warning ring and says so.
 * - A selected element that looks other than its template draws it (what
 *   the Element tab's Reset Style clears) carries a Changed marker (9b).
 * - Zoom Out, Zoom In and Fit, also on minus, plus and 0 (9b). Fit is the
 *   canvas as it always was: the slide whole, as large as it fits. Past
 *   that, the slide scrolls inside the canvas. See `canvas-model.ts`.
 *
 * A drag is shown as a preview and becomes one undo step when it ends, so
 * neither the history nor the autosave sees every pointer move.
 */
import { ChevronLeftIcon } from '@animateicons/react/lucide/chevron-left-icon';
import { ChevronRightIcon } from '@animateicons/react/lucide/chevron-right-icon';
import { ScanIcon } from '@animateicons/react/lucide/scan-icon';
import { ZoomInIcon } from '@animateicons/react/lucide/zoom-in-icon';
import { ZoomOutIcon } from '@animateicons/react/lucide/zoom-out-icon';
import {
  type ClampReport,
  clampWithReport,
  type DesignDocument,
  dragToOffset,
  FORMATS,
  findLayout,
  isTypeable,
  NO_OFFSET,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  type Offset,
  type Rect,
  regionLabel,
  ScaledSlide,
  type SlotDef,
  type SlotId,
  slotFrame,
  slotPlacement,
  updateElement,
} from '@postgear/design-engine';
import { Button, cn, Kbd, MotionIcon, TooltipHint } from '@postgear/ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  endsTyping,
  isFitted,
  type ScrollAnchor,
  scrollAnchor,
  scrollToAnchor,
  type Zoom,
  zoomIn,
  zoomKeyOf,
  zoomLabel,
  zoomOut,
  zoomScale,
} from './canvas-model';
import { canResetElement } from './editor-panel-model';
import { type ApplyChange, nudge, slotAfterHiding, withOffset, withText } from './editor-state';
import { StudioPanel } from './studio-ui';

/** How far a pointer travels before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

/** Where focus goes once an element is hidden and none is left to take it. */
const CANVAS = 'canvas';

/** How long a nudge that hit an edge keeps the edge lit. */
const EDGE_FLASH_MS = 600;

type Edge = ClampReport['edge'];

interface Guide {
  /** The element's area, in percentages of the canvas. */
  region: Rect;
  label: string;
  edge: Edge;
}

interface Drag {
  slotId: SlotId;
  pointerId: number;
  startX: number;
  startY: number;
  /** The slide's size on screen when the drag began, in CSS pixels. */
  width: number;
  height: number;
  start: Offset;
  /** Where the drag has taken it so far. */
  offset: Offset;
  /** The element's box in its area before any nudge. */
  box: Rect;
  region: Rect;
  label: string;
  moved: boolean;
}

export interface EditorCanvasProps {
  document: DesignDocument;
  slideId: string;
  slideIndex: number;
  selected: SlotId | null;
  editing: SlotId | null;
  /** The elements on this slide still too long at their smallest size. */
  overflow: readonly SlotId[];
  resolveMedia: (mediaId: string) => string | null;
  onSelect: (slot: SlotId | null) => void;
  onEdit: (slot: SlotId | null) => void;
  onChange: ApplyChange;
  onOverflow: (slots: SlotId[]) => void;
  /** Opens the media picker for a picture element. */
  onPickImage: (slot: SlotId) => void;
  onShowSlide: (index: number) => void;
  className?: string;
}

export function EditorCanvas({
  document,
  slideId,
  slideIndex,
  selected,
  editing,
  overflow,
  resolveMedia,
  onSelect,
  onEdit,
  onChange,
  onOverflow,
  onPickImage,
  onShowSlide,
  className,
}: EditorCanvasProps) {
  /** The canvas's room for the slide, which never scrolls, so Fit is measured from it. */
  const stage = useRef<HTMLDivElement>(null);
  /** Inside the stage: where a slide zoomed past Fit scrolls. */
  const scroller = useRef<HTMLDivElement>(null);
  /** The layer over the slide: exactly the slide's area on screen. */
  const layer = useRef<HTMLDivElement>(null);
  const size = useBoxSize(stage);
  const drag = useRef<Drag | null>(null);
  const refocus = useRef<SlotId | null>(null);
  const afterHide = useRef<SlotId | typeof CANVAS | null>(null);
  /** The point of the slide in the middle of the view as a zoom began, put back once it is done. */
  const zoomAnchor = useRef<ScrollAnchor | null>(null);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [preview, setPreview] = useState<{ slotId: SlotId; offset: Offset } | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [hovered, setHovered] = useState<SlotId | null>(null);
  /** What Delete hid, said in the live region; `id` makes the same words a new message. */
  const [hiddenNote, setHiddenNote] = useState<{ text: string; id: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spec = FORMATS[document.format];
  // The frame's 2px border on each side is outside the slide.
  const fit = size ? Math.min((size.width - 4) / spec.width, (size.height - 4) / spec.height) : 0;
  const scale = zoomScale(zoom, fit);
  const width = Math.max(0, Math.floor(spec.width * scale));
  const height = Math.round(spec.height * (width / spec.width));
  const fitted = isFitted(zoom, fit);
  const nextIn = fit > 0 ? zoomIn(zoom, fit) : null;
  const nextOut = fit > 0 ? zoomOut(zoom, fit) : null;

  const shown = useMemo(
    () => (preview ? withOffset(document, slideId, preview.slotId, preview.offset) : document),
    [document, preview, slideId],
  );
  const slide = shown.slides[slideIndex];
  const layout = slide ? findLayout(slide.layoutId) : null;
  const count = document.slides.length;

  useEffect(() => () => clearTimeout(flashTimer.current ?? undefined), []);

  // After typing ends with a key (Escape, Ctrl or Cmd and Enter, Enter on
  // one line), the element's hit area takes focus back, so a keyboard user
  // carries on from where they were.
  useLayoutEffect(() => {
    if (editing === null && refocus.current) {
      const slot = refocus.current;
      refocus.current = null;
      layer.current
        ?.querySelector<HTMLElement>(`[data-canvas-element="${slot}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [editing]);

  // Delete hides the focused element, and its hit area goes with it: focus
  // moves on to the next element on the slide, or to the canvas itself.
  useLayoutEffect(() => {
    const target = afterHide.current;
    if (target === null) return;
    afterHide.current = null;

    const element =
      target === CANVAS
        ? stage.current?.parentElement
        : layer.current?.querySelector<HTMLElement>(`[data-canvas-element="${target}"]`);
    element?.focus({ preventScroll: true });
  });

  // A zoom keeps the middle of the view where it was on the slide, the way
  // a zoom from the corner of an image viewer does not.
  useLayoutEffect(() => {
    const box = scroller.current;
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    if (!box || !anchor || width === 0) return;

    const { left, top } = scrollToAnchor(box, anchor);
    box.scrollTo({ left, top });
  }, [width]);

  function changeZoom(next: Zoom | null) {
    if (next === null || next === zoom) return;
    if (scroller.current) zoomAnchor.current = scrollAnchor(scroller.current);
    setZoom(next);
  }

  function flash(next: Guide) {
    setGuide(next);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setGuide(null), EDGE_FLASH_MS);
  }

  function frameOf(slot: SlotDef) {
    return layout && slide ? slotFrame(layout, slot, shown.format, slide.elements[slot.id]) : null;
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, slot: SlotDef) {
    if (event.button !== 0 || !slide || !layer.current) return;

    const frame = frameOf(slot);
    if (!frame) return;

    // No text selection or native drag; focus goes to the element itself.
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);

    const bounds = layer.current.getBoundingClientRect();
    const state = slide.elements[slot.id];
    const start = state?.offset ?? NO_OFFSET;
    drag.current = {
      slotId: slot.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: bounds.width,
      height: bounds.height,
      start,
      offset: start,
      box: slotPlacement(slot, state).box,
      region: frame.regionRect,
      label: regionLabel(frame.region),
      moved: false,
    };

    if (selected !== slot.id) onSelect(slot.id);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;

    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    current.moved = true;
    const report = clampWithReport(
      current.box,
      dragToOffset(current.region, current.start, {
        x: (dx / current.width) * 100,
        y: (dy / current.height) * 100,
      }),
    );

    current.offset = report.offset;
    setPreview({ slotId: current.slotId, offset: report.offset });
    setGuide({ region: current.region, label: current.label, edge: report.edge });
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>, slot: SlotDef, cancelled: boolean) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;

    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (current.moved) {
      if (!cancelled) {
        const { slotId, offset } = current;
        onChange((document) => withOffset(document, slideId, slotId, offset));
      }
      setPreview(null);
      setGuide(null);
      return;
    }

    // A click, not a drag: a text element takes a cursor (DS-4.1).
    if (!cancelled && isTypeable(slot)) onEdit(slot.id);
  }

  function activate(slot: SlotDef) {
    if (isTypeable(slot)) onEdit(slot.id);
    else if (slot.kind === 'image') onPickImage(slot.id);
    else onSelect(slot.id);
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Typing keeps its keys to itself (`EditableText`), so this is never a letter typed.
    const zoomKey = editing ? null : zoomKeyOf(event);
    if (zoomKey) {
      event.preventDefault();
      changeZoom(zoomKey === 'in' ? nextIn : zoomKey === 'out' ? nextOut : 'fit');
      return;
    }

    if (!selected || !slide || !layout || editing) return;
    const slot = layout.slots.find((entry) => entry.id === selected);
    if (!slot) return;

    const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
    const delta: Offset | null =
      event.key === 'ArrowLeft'
        ? { x: -step, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: step, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: -step }
            : event.key === 'ArrowDown'
              ? { x: 0, y: step }
              : null;

    if (delta) {
      event.preventDefault();
      const slotId = slot.id;
      onChange((latest) => nudge(latest, slideId, slotId, delta).document, {
        coalesceKey: `nudge:${slideId}:${slotId}`,
      });

      // The edge to light is read from the design on screen; the nudge itself
      // applies to the latest one, so a held key never moves from a stale spot.
      const { edge } = nudge(document, slideId, slotId, delta);
      const frame = frameOf(slot);
      if (frame && (edge.x || edge.y)) {
        flash({ region: frame.regionRect, label: regionLabel(frame.region), edge });
      }
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && slot.optional) {
      event.preventDefault();
      const slotId = slot.id;
      afterHide.current =
        slotAfterHiding(
          layout.slots.map((entry) => entry.id),
          (id) => id !== slotId && !slide.elements[id]?.hidden,
          slotId,
        ) ?? CANVAS;
      onChange((latest) => updateElement(latest, slideId, slotId, { hidden: true }));
      onSelect(null);
      setHiddenNote((current) => ({
        text: `${slot.label} hidden. Undo brings it back.`,
        id: (current?.id ?? 0) + 1,
      }));
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      onSelect(null);
    }
  }

  return (
    <StudioPanel
      role="region"
      aria-label="Slide canvas"
      // Focus lands here when Delete hid the last element left to take it.
      tabIndex={-1}
      className={cn(
        '@container flex min-h-0 flex-col gap-3 bg-inset bg-halftone p-3 sm:p-5',
        className,
      )}
      onKeyDown={onKeyDown}
      onKeyDownCapture={(event) => {
        // Typing ends with Escape, Ctrl or Cmd and Enter, or Enter on one
        // line: focus then returns to the element (see the layout effect
        // above). Enter's new line in a multi-line slot ends nothing, and a
        // click elsewhere keeps the focus it moved.
        if (!editing || !(event.target instanceof HTMLElement)) return;
        const multiline = event.target.getAttribute('aria-multiline') === 'true';
        const press = {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          isComposing: event.nativeEvent.isComposing,
          keyCode: event.keyCode,
        };
        if (endsTyping(press, multiline)) refocus.current = editing;
      }}
      onPointerDown={(event) => {
        const target = event.target as Element;
        // Zooming keeps the selection: it is how a person looks closer at it.
        if (target.closest('[data-canvas-element], [contenteditable], [data-keep-selection]')) {
          return;
        }
        // A press on the zoomed canvas's scroll bars is scrolling, not letting go.
        const box = scroller.current;
        if (box && target === box) {
          const bounds = box.getBoundingClientRect();
          const onBar =
            event.clientX - bounds.left >= box.clientWidth ||
            event.clientY - bounds.top >= box.clientHeight;
          if (onBar) return;
        }
        if (selected) onSelect(null);
      }}
    >
      <div ref={stage} className="relative min-h-0 flex-1">
        {/* `m-auto` centres a slide smaller than the view and, unlike centring
            with flex, lets one larger than it scroll to its every edge. */}
        <div
          ref={scroller}
          data-testid="canvas-scroller"
          className={cn(
            'absolute inset-0 flex overscroll-contain',
            fitted ? 'overflow-hidden' : 'overflow-auto',
          )}
        >
          {slide && layout && width > 0 ? (
            <div
              className="relative m-auto shrink-0 border-2 border-outline shadow-brutalMd"
              style={{ width: width + 4, height: height + 4 }}
            >
              <ScaledSlide
                // A fresh drawing per slide, so each one reports what overflows on it.
                key={slideId}
                width={width}
                design={shown}
                index={slideIndex}
                mode="edit"
                resolveMedia={resolveMedia}
                editing={editing}
                onTextInput={(slot, text) =>
                  onChange((document) => withText(document, slideId, slot, text), {
                    coalesceKey: `text:${slideId}:${slot}`,
                  })
                }
                onTextCommit={(slot, text) => {
                  // A step of its own: after Escape the words go back as they
                  // were, and Undo brings the typed ones back. A commit that
                  // only keeps what was typed changes nothing, so adds no step.
                  onChange((document) => withText(document, slideId, slot, text));
                  onEdit(null);
                }}
                onFit={onOverflow}
              />

              <div ref={layer} className="pointer-events-none absolute inset-0">
                {guide ? <AreaGuide guide={guide} /> : null}
                {!guide && hovered && hovered !== selected
                  ? (() => {
                      const slot = layout.slots.find((entry) => entry.id === hovered);
                      const frame = slot ? frameOf(slot) : null;
                      return frame ? <AreaOutline region={frame.regionRect} faint /> : null;
                    })()
                  : null}

                {layout.slots.map((slot) => {
                  const state = slide.elements[slot.id];
                  if (state?.hidden) return null;
                  const frame = frameOf(slot);
                  if (!frame) return null;

                  const isSelected = selected === slot.id;
                  const isEditing = editing === slot.id;
                  const tooLong = overflow.includes(slot.id);
                  // The same test as Reset Style in the Element tab, so the
                  // marker and the button that clears it always agree.
                  const changed = canResetElement(state);

                  return (
                    <button
                      key={slot.id}
                      type="button"
                      data-canvas-element={slot.id}
                      data-testid="canvas-element"
                      aria-label={[
                        slot.label,
                        tooLong ? 'too long for its space' : null,
                        changed ? 'changed from the template' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                      aria-pressed={isSelected}
                      tabIndex={isEditing ? -1 : 0}
                      style={{
                        left: `${frame.rect.x}%`,
                        top: `${frame.rect.y}%`,
                        width: `${frame.rect.w}%`,
                        height: `${frame.rect.h}%`,
                      }}
                      className={cn(
                        'pointer-events-auto absolute touch-none rounded-sm outline-none',
                        // The runtime names: `@theme inline` keeps the camelCase ones out of the page.
                        'focus-visible:shadow-[0_0_0_3px_var(--color-focus-ring)]',
                        isEditing ? 'pointer-events-none' : 'cursor-move',
                        // A thin halo under the outline, in the colour that reads on it,
                        // keeps it visible on a slide of the outline's own colour.
                        isSelected
                          ? 'outline-2 outline-offset-2 outline-solid outline-actionPrimary shadow-[0_0_0_1px_var(--color-on-action-primary)]'
                          : 'hover:outline-2 hover:outline-offset-2 hover:outline-dashed hover:outline-actionPrimary/70',
                        tooLong &&
                          !isSelected &&
                          'outline-2 outline-offset-2 outline-dashed outline-actionDanger',
                      )}
                      onPointerEnter={() => setHovered(slot.id)}
                      onPointerLeave={() =>
                        setHovered((current) => (current === slot.id ? null : current))
                      }
                      onPointerDown={(event) => startDrag(event, slot)}
                      onPointerMove={moveDrag}
                      onPointerUp={(event) => endDrag(event, slot, false)}
                      onPointerCancel={(event) => endDrag(event, slot, true)}
                      onClick={(event) => {
                        // Pointer clicks are handled on release; this is Enter or Space.
                        if (event.detail === 0) activate(slot);
                      }}
                      onDoubleClick={() => {
                        if (slot.kind === 'image') onPickImage(slot.id);
                      }}
                    >
                      {tooLong ? (
                        <span
                          aria-hidden="true"
                          className="absolute -top-3 end-0 rounded-sm border-2 border-outline bg-actionDanger px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none text-onActionLight"
                        >
                          Too Long
                        </span>
                      ) : null}
                      {/* Not while it moves, when the area's own name sits in the same corner. */}
                      {changed && isSelected && !isEditing && !guide ? (
                        <span
                          aria-hidden="true"
                          data-testid="changed-marker"
                          className={cn(
                            'absolute start-0 rounded-sm border-2 border-outline bg-actionPrimary px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none text-onActionPrimary',
                            // Below, when Too Long has the top.
                            tooLong ? '-bottom-3' : '-top-3',
                          )}
                        >
                          Changed
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* On a canvas wide enough for one row: the slide controls in the
          middle, as before zoom, and the zoom at the end. Narrower, the two
          groups share the middle, wrapping onto two rows on a phone. */}
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 @[40rem]:grid @[40rem]:grid-cols-[1fr_auto_1fr]">
        <span aria-hidden="true" className="hidden @[40rem]:block" />
        {count > 1 ? (
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              aria-label="Previous slide"
              className="w-9 px-0"
              disabled={slideIndex === 0}
              onClick={() => onShowSlide(slideIndex - 1)}
            >
              <MotionIcon icon={ChevronLeftIcon} className="h-4 w-4" />
            </Button>
            <span className="min-w-20 text-center font-sans text-xs font-bold tabular-nums text-ink">
              Slide {slideIndex + 1} of {count}
            </span>
            <Button
              variant="secondary"
              size="sm"
              aria-label="Next slide"
              className="w-9 px-0"
              disabled={slideIndex >= count - 1}
              onClick={() => onShowSlide(slideIndex + 1)}
            >
              <MotionIcon icon={ChevronRightIcon} className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <span aria-hidden="true" className="hidden @[40rem]:block" />
        )}
        <ZoomControls
          scale={scale}
          fitted={fitted}
          disabled={fit <= 0}
          canZoomIn={nextIn !== null}
          canZoomOut={nextOut !== null}
          onZoomIn={() => changeZoom(nextIn)}
          onZoomOut={() => changeZoom(nextOut)}
          onFit={() => changeZoom('fit')}
        />
      </div>

      <span role="status" className="sr-only">
        {hiddenNote ? <span key={hiddenNote.id}>{hiddenNote.text}</span> : null}
      </span>
    </StudioPanel>
  );
}

interface ZoomControlsProps {
  /** The scale on screen, as a share of the slide's real size. */
  scale: number;
  /** The slide is whole: there is nothing to zoom out to, and Fit would change nothing. */
  fitted: boolean;
  /** The canvas has not been measured yet. */
  disabled: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}

/** Zoom Out, the level, Zoom In and Fit. The same keys work anywhere on the canvas (`zoomKeyOf`). */
function ZoomControls({
  scale,
  fitted,
  disabled,
  canZoomIn,
  canZoomOut,
  onZoomIn,
  onZoomOut,
  onFit,
}: ZoomControlsProps) {
  const outOff = disabled || !canZoomOut;
  const inOff = disabled || !canZoomIn;
  const fitOff = disabled || fitted;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset is for form fields; these are buttons named as one group.
    <div
      role="group"
      aria-label="Zoom"
      data-keep-selection=""
      className="flex items-center justify-center gap-1 @[40rem]:justify-self-end"
    >
      <TooltipHint label="Zoom Out" side="top" disabled={outOff} shortcut={<Kbd>-</Kbd>}>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Zoom Out"
          className="w-9 px-0"
          disabled={outOff}
          onClick={onZoomOut}
        >
          <MotionIcon icon={ZoomOutIcon} className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <span
        role="status"
        className="min-w-12 text-center font-sans text-xs font-bold tabular-nums text-ink"
      >
        <span className="sr-only">Zoom </span>
        {disabled ? null : zoomLabel(scale)}
      </span>
      <TooltipHint label="Zoom In" side="top" disabled={inOff} shortcut={<Kbd>+</Kbd>}>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Zoom In"
          className="w-9 px-0"
          disabled={inOff}
          onClick={onZoomIn}
        >
          <MotionIcon icon={ZoomInIcon} className="h-4 w-4" />
        </Button>
      </TooltipHint>
      <TooltipHint label="Fit" side="top" disabled={fitOff} shortcut={<Kbd>0</Kbd>}>
        <Button variant="secondary" size="sm" disabled={fitOff} onClick={onFit}>
          <MotionIcon icon={ScanIcon} className="h-4 w-4" />
          Fit
        </Button>
      </TooltipHint>
    </div>
  );
}

/** An element's area while it is dragged or nudged: its outline, its name, and an edge it stopped at. */
function AreaGuide({ guide }: { guide: Guide }) {
  const { region, label, edge } = guide;

  return (
    <>
      <AreaOutline region={region} />
      <span
        className="absolute rounded-sm border-2 border-outline bg-actionPrimary px-1.5 py-0.5 font-sans text-[10px] font-bold leading-none text-onActionPrimary"
        style={{ left: `${region.x}%`, top: `${region.y}%`, transform: 'translateY(-110%)' }}
      >
        {label}
      </span>
      {edge.x ? (
        <span
          className="absolute w-1 bg-actionAccent"
          style={{
            left: edge.x === 'start' ? `${region.x}%` : `calc(${region.x + region.w}% - 4px)`,
            top: `${region.y}%`,
            height: `${region.h}%`,
          }}
        />
      ) : null}
      {edge.y ? (
        <span
          className="absolute h-1 bg-actionAccent"
          style={{
            top: edge.y === 'start' ? `${region.y}%` : `calc(${region.y + region.h}% - 4px)`,
            left: `${region.x}%`,
            width: `${region.w}%`,
          }}
        />
      ) : null}
    </>
  );
}

function AreaOutline({ region, faint = false }: { region: Rect; faint?: boolean }) {
  return (
    <span
      className={cn(
        'absolute rounded-sm border-2 border-dashed border-actionPrimary',
        faint && 'opacity-50',
      )}
      style={{
        left: `${region.x}%`,
        top: `${region.y}%`,
        width: `${region.w}%`,
        height: `${region.h}%`,
      }}
    />
  );
}

/** The box's inner size, kept current as the layout around it changes. */
function useBoxSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = () =>
      setSize((current) => {
        const width = Math.round(element.clientWidth);
        const height = Math.round(element.clientHeight);
        return current && current.width === width && current.height === height
          ? current
          : { width, height };
      });

    measure();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
