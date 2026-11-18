'use client';

/**
 * The handles over the clip (Module 11 section 5): select a text on the
 * stage, move it, scale it from a corner, widen its box from a side, turn
 * it, and type into it.
 *
 * - **Screen over canvas**: the layer covers the picture in screen pixels.
 *   Every pointer position is divided by the stage scale
 *   (`screenToCanvas`), and the maths in `transform-model.ts` is in canvas
 *   pixels, so a drag means the same at every stage size.
 * - **What can be picked** is what the picture shows at the playhead
 *   (`overlaysAt`, the `frameState` rule), hit-tested topmost first. A press
 *   on empty space clears the selection. Anything else is picked from its
 *   bar on the timeline.
 * - **A drag is a draft**, like a timeline drag: the stage shows it while it
 *   lasts and it is applied once on release, as one undo step. Escape during
 *   a drag puts the item back.
 * - **Snapping** (within 6 screen pixels) shows its guide lines; Alt turns it
 *   off for the drag. Turns snap to quarter turns within 5 degrees.
 * - A text's height is what the preview measured (`MeasuredHeights`, fed by
 *   the overlay layer); its width is its box.
 * - **Stickers** (Module 12) have a fixed shape: corner handles and the turn
 *   only, no side handles and no typing. Pictures sit under texts, so a
 *   press where a text covers a sticker picks the text.
 * - **A selected zoom** (Module 13) shows its focus dot (`zoom-focus-dot.tsx`).
 */
import { cn, TransformBox, type TransformPart } from '@postgear/ui';
import { type ClipDocument, findItem, type TextItem, updateItem } from '@postgear/video-engine';
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { EditorSelection } from './editor-state';
import { InPlaceText } from './in-place-text';
import type { PlaybackStore } from './playback';
import { useStageScale } from './stage';
import {
  CORNER_HANDLES,
  type CornerHandle,
  centreToTransform,
  drawingOrder,
  type Guides,
  hitTest,
  type ItemFrame,
  itemFrame,
  moveFrame,
  NO_GUIDES,
  overlaysAt,
  type Point,
  rotateAbout,
  type Size,
  SNAP_SCREEN_PX,
  type StageItem,
  scaleFromCorner,
  screenToCanvas,
  TEXT_HANDLES,
  widenFromSide,
} from './transform-model';
import { ZoomFocusDot } from './zoom-focus-dot';

/**
 * The heights of the texts on screen, in canvas pixels, as the preview's
 * overlay layer last measured them. A small store, so only the handles
 * re-render when one changes.
 */
export class MeasuredHeights {
  private heights: ReadonlyMap<string, number> = new Map();
  private readonly listeners = new Set<() => void>();

  set = (next: ReadonlyMap<string, number>): void => {
    this.heights = next;
    for (const listener of Array.from(this.listeners)) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ReadonlyMap<string, number> => this.heights;
}

const NONE: ReadonlyMap<string, number> = new Map();

/** A press moves less than this many screen pixels before it counts as a drag. */
const DRAG_START_PX = 3;
/** A text is easier to pick with this many screen pixels around it. */
const HIT_SLOP_PX = 4;

/** The ids on screen at a moment, as one string: the layer re-renders only when it changes. */
function shownKeyAt(doc: ClipDocument, ms: number): string {
  return overlaysAt(doc, ms)
    .map((item) => item.id)
    .join(' ');
}

const clampFraction = (value: number) => Math.min(1.5, Math.max(-0.5, value));

/** An item with its centre moved to (cx, cy) on the canvas. */
function withCentre<T extends StageItem>(item: T, cx: number, cy: number, canvas: Size): T {
  const { x, y } = centreToTransform(cx, cy, canvas);
  return { ...item, transform: { ...item.transform, x: clampFraction(x), y: clampFraction(y) } };
}

interface Gesture {
  pointerId: number;
  part: TransformPart;
  /** The document the drag began on: the release applies only onto it. */
  start: ClipDocument;
  item: StageItem;
  frame: ItemFrame;
  others: ItemFrame[];
  from: Point;
  origin: Point;
  scale: number;
  canvas: Size;
  moved: boolean;
  next: ClipDocument | null;
  key: string;
}

export interface TransformLayerProps {
  /** The store's document: a drag begins on it. */
  document: ClipDocument;
  /** What the stage draws (a draft while something is dragged). */
  shown: ClipDocument;
  selection: EditorSelection;
  playback: PlaybackStore;
  heights: MeasuredHeights;
  /** The text being typed into, or null. */
  editingId: string | null;
  fontFamily: (family: string) => string;
  onSelect: (selection: EditorSelection) => void;
  onCommit: (
    start: ClipDocument,
    next: ClipDocument,
    options?: { select?: EditorSelection; coalesceKey?: string },
  ) => void;
  onDraft: (draft: { doc: ClipDocument; seekMs: number | null } | null) => void;
  /** Start typing into a text. */
  onEdit: (itemId: string) => void;
  onTyping: (itemId: string, text: string) => void;
  onTypingDone: (itemId: string, text: string) => void;
  onEmoji: () => void;
}

let serial = 0;

export function TransformLayer({
  document,
  shown,
  selection,
  playback,
  heights,
  editingId,
  fontFamily,
  onSelect,
  onCommit,
  onDraft,
  onEdit,
  onTyping,
  onTypingDone,
  onEmoji,
}: TransformLayerProps) {
  const scale = useStageScale();
  const canvas = shown.canvas;
  const root = useRef<HTMLDivElement>(null);
  const measured = useSyncExternalStore(heights.subscribe, heights.getSnapshot, () => NONE);
  const shownKey = useSyncExternalStore(
    playback.subscribe,
    () => shownKeyAt(shown, playback.getCurrentMs()),
    () => '',
  );

  const items = useMemo(() => {
    const ids = new Set(shownKey === '' ? [] : shownKey.split(' '));
    const found: StageItem[] = [];
    for (const track of shown.tracks) {
      if (track.kind !== 'overlay') continue;
      for (const item of track.items) if (ids.has(item.id)) found.push(item);
    }
    return found;
  }, [shown, shownKey]);

  const frames = useMemo(
    () => drawingOrder(items).map((item) => itemFrame(item, canvas, measured.get(item.id))),
    [items, canvas, measured],
  );

  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [hover, setHover] = useState<string | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ document, frames, scale, canvas, onDraft, onCommit });
  latest.current = { document, frames, scale, canvas, onDraft, onCommit };

  const pointOf = (event: { clientX: number; clientY: number }): Point | null => {
    const element = root.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return screenToCanvas(
      { x: event.clientX, y: event.clientY },
      { x: rect.left, y: rect.top },
      scale,
    );
  };

  const begin = (part: TransformPart, itemId: string, event: ReactPointerEvent<HTMLElement>) => {
    const element = root.current;
    if (!element) return;
    const { document: doc, frames: now } = latest.current;
    const found = findItem(doc, itemId);
    const frame = now.find((candidate) => candidate.id === itemId);
    if (!found || (found.item.type !== 'text' && found.item.type !== 'sticker') || !frame) return;
    // A sticker has no sides to widen.
    if ((part === 'e' || part === 'w') && found.item.type !== 'text') return;
    const rect = element.getBoundingClientRect();
    const origin = { x: rect.left, y: rect.top };
    serial += 1;
    gesture.current = {
      pointerId: event.pointerId,
      part,
      start: doc,
      item: found.item,
      frame,
      others: now.filter((candidate) => candidate.id !== itemId),
      from: screenToCanvas({ x: event.clientX, y: event.clientY }, origin, scale),
      origin,
      scale,
      canvas,
      moved: false,
      next: null,
      key: `stage:${itemId}:${part}:${serial}`,
    };
    // No text selection or native drag while the pointer is down.
    event.preventDefault();
  };

  // One set of window listeners for the layer's life; each does nothing without a drag.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      const p = screenToCanvas({ x: event.clientX, y: event.clientY }, g.origin, g.scale);
      if (!g.moved) {
        const travelled = Math.hypot(p.x - g.from.x, p.y - g.from.y) * g.scale;
        if (travelled < DRAG_START_PX) return;
        g.moved = true;
      }
      const snap = !event.altKey;
      const t = g.item.transform;
      let next: StageItem = g.item;
      let lines: Guides = NO_GUIDES;
      switch (g.part) {
        case 'body': {
          const moved = moveFrame(
            g.frame,
            { x: p.x - g.from.x, y: p.y - g.from.y },
            g.canvas,
            g.others,
            { snap, threshold: SNAP_SCREEN_PX / g.scale },
          );
          next = withCentre(g.item, moved.cx, moved.cy, g.canvas);
          lines = moved.guides;
          break;
        }
        case 'rotate': {
          const rotation = rotateAbout(
            { x: g.frame.cx, y: g.frame.cy },
            t.rotation,
            g.from,
            p,
            snap,
          );
          next = { ...g.item, transform: { ...t, rotation } };
          break;
        }
        case 'e':
        case 'w': {
          if (g.item.type !== 'text') return;
          const widened = widenFromSide(g.frame, g.part, p, t.scale);
          next = {
            ...withCentre(g.item, widened.cx, widened.cy, g.canvas),
            widthPx: widened.widthPx,
          };
          break;
        }
        case 'nw':
        case 'ne':
        case 'se':
        case 'sw': {
          const scaled = scaleFromCorner(g.frame, g.part as CornerHandle, p, t.scale);
          const placed = withCentre(g.item, scaled.cx, scaled.cy, g.canvas);
          next = { ...placed, transform: { ...placed.transform, scale: scaled.scale } };
          break;
        }
        default:
          return;
      }
      const result = updateItem(g.start, g.item.id, () => next);
      if (!result.ok) return;
      g.next = result.doc;
      latest.current.onDraft({ doc: result.doc, seekMs: null });
      setGuides(lines);
    };

    const end = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      gesture.current = null;
      setGuides(NO_GUIDES);
      if (!g.moved) return;
      if (g.next && g.next !== g.start) {
        latest.current.onCommit(g.start, g.next, { coalesceKey: g.key });
      }
      latest.current.onDraft(null);
    };

    const cancel = (event: KeyboardEvent) => {
      const g = gesture.current;
      if (!g || event.key !== 'Escape') return;
      // Ahead of the editor's own Escape (which would clear the selection).
      event.preventDefault();
      event.stopImmediatePropagation();
      gesture.current = null;
      setGuides(NO_GUIDES);
      if (g.moved) latest.current.onDraft(null);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', cancel, true);
      gesture.current = null;
    };
  }, []);

  const hitAt = (event: { clientX: number; clientY: number }): string | null => {
    const p = pointOf(event);
    return p ? hitTest(frames, p, HIT_SLOP_PX / (scale > 0 ? scale : 1)) : null;
  };

  const selectedId = selection?.kind === 'item' ? selection.id : null;
  const selectedFrame = frames.find((frame) => frame.id === selectedId) ?? null;
  const selectedIsText = items.some((item) => item.id === selectedId && item.type === 'text');
  const hoverFrame =
    hover && hover !== selectedId ? (frames.find((frame) => frame.id === hover) ?? null) : null;
  const editing = editingId
    ? (items.find((item): item is TextItem => item.id === editingId && item.type === 'text') ??
      null)
    : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer picking on a canvas; the keyboard selects from the timeline bars and moves with the editor's own keys.
    <div
      ref={root}
      data-testid="clip-transform-layer"
      className={cn(
        'absolute inset-0 touch-none select-none',
        hover ? 'cursor-move' : 'cursor-default',
      )}
      onPointerDown={(event) => {
        if (event.button > 0) return;
        const hit = hitAt(event);
        if (!hit) {
          if (selection) onSelect(null);
          return;
        }
        if (hit !== selectedId) onSelect({ kind: 'item', id: hit });
        begin('body', hit, event);
      }}
      onPointerMove={(event) => {
        if (gesture.current) return;
        const hit = hitAt(event);
        if (hit !== hover) setHover(hit);
      }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(event) => {
        const hit = hitAt(event);
        if (hit) onEdit(hit);
      }}
    >
      {hoverFrame ? (
        <div
          aria-hidden="true"
          data-testid="clip-transform-hover"
          className="pointer-events-none absolute border border-actionPrimary/60"
          style={{
            left: (hoverFrame.cx - hoverFrame.width / 2) * scale,
            top: (hoverFrame.cy - hoverFrame.height / 2) * scale,
            width: hoverFrame.width * scale,
            height: hoverFrame.height * scale,
            transform: `rotate(${hoverFrame.rotation}deg)`,
          }}
        />
      ) : null}

      {guides.x.map((x) => (
        <div
          key={`x${x}`}
          aria-hidden="true"
          data-testid="clip-guide"
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-actionPrimary"
          style={{ left: x * scale }}
        />
      ))}
      {guides.y.map((y) => (
        <div
          key={`y${y}`}
          aria-hidden="true"
          data-testid="clip-guide"
          className="pointer-events-none absolute right-0 left-0 h-px bg-actionPrimary"
          style={{ top: y * scale }}
        />
      ))}

      {selectedFrame && selectedFrame.id !== editingId ? (
        <TransformBox
          x={selectedFrame.cx * scale}
          y={selectedFrame.cy * scale}
          width={selectedFrame.width * scale}
          height={selectedFrame.height * scale}
          rotation={selectedFrame.rotation}
          handles={selectedIsText ? TEXT_HANDLES : CORNER_HANDLES}
          onPartPointerDown={(part, event) => begin(part, selectedFrame.id, event)}
          onBodyDoubleClick={selectedIsText ? () => onEdit(selectedFrame.id) : undefined}
        />
      ) : null}

      {selection?.kind === 'zoom' ? (
        <ZoomFocusDot
          document={document}
          shown={shown}
          zoomId={selection.id}
          scale={scale}
          layer={root}
          playback={playback}
          onGuides={setGuides}
          onDraft={onDraft}
          onCommit={onCommit}
        />
      ) : null}

      {editing ? (
        <InPlaceText
          key={editing.id}
          item={editing}
          canvas={canvas}
          stageScale={scale}
          fontFamily={fontFamily}
          onInput={(text) => onTyping(editing.id, text)}
          onDone={(text) => onTypingDone(editing.id, text)}
          onEmoji={onEmoji}
        />
      ) : null}
    </div>
  );
}
