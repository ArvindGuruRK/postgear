'use client';

/**
 * The selected zoom's focus dot (Module 13 section 6): a ring with a cross
 * where the zoom closes in, over the clip.
 *
 * - **Drag** it to move the focus; it snaps to the clip's centre lines
 *   (within 6 screen pixels, Alt turns snapping off) and shows them. While it
 *   is dragged the stage plays the zoom at its full amount (the middle of
 *   its first bar), so the user sees what it closes in on. Let go: one undo
 *   step. Escape puts it back.
 * - **Keys**: the arrows move it a hundredth of the clip (Shift: a tenth);
 *   the presses while the dot keeps the keyboard focus are one undo step.
 * - The dot sits on the focus whatever the zoom: the focus is the one point
 *   a zoom leaves where it is.
 */
import { cn } from '@postgear/ui';
import { type ClipDocument, updateZoom } from '@postgear/video-engine';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';
import { fullZoomMoment } from '../panels/effects-model';
import type { PlaybackStore } from './playback';
import {
  type Guides,
  NO_GUIDES,
  type Point,
  type Size,
  SNAP_SCREEN_PX,
  screenToCanvas,
} from './transform-model';

/** One arrow press, and one with Shift, as a share of the clip's width or height. */
export const FOCUS_STEP = 0.01;
export const FOCUS_STEP_BIG = 0.1;

/** The dot's size on screen, in px. */
const DOT_PX = 28;

const unit = (value: number) => Math.min(1, Math.max(0, value));

/**
 * The focus a point on the canvas stands for, kept on the clip, snapped to
 * the centre lines within `threshold` canvas pixels; and the lines it
 * snapped to.
 */
export function focusAt(
  point: Point,
  canvas: Size,
  threshold: number,
  snap: boolean,
): { focus: { x: number; y: number }; guides: Guides } {
  let x = unit(point.x / canvas.width);
  let y = unit(point.y / canvas.height);
  const lines: { x: number[]; y: number[] } = { x: [], y: [] };
  if (snap && Math.abs(point.x - canvas.width / 2) <= threshold) {
    x = 0.5;
    lines.x.push(canvas.width / 2);
  }
  if (snap && Math.abs(point.y - canvas.height / 2) <= threshold) {
    y = 0.5;
    lines.y.push(canvas.height / 2);
  }
  return { focus: { x, y }, guides: lines.x.length + lines.y.length > 0 ? lines : NO_GUIDES };
}

/** "40% across, 60% down". */
export function focusText(focus: { x: number; y: number }): string {
  return `${Math.round(focus.x * 100)}% across, ${Math.round(focus.y * 100)}% down`;
}

interface FocusDrag {
  pointerId: number;
  start: ClipDocument;
  origin: Point;
  scale: number;
  canvas: Size;
  seekMs: number | null;
  next: ClipDocument | null;
  key: string;
}

let serial = 0;

export function ZoomFocusDot({
  document,
  shown,
  zoomId,
  scale,
  layer,
  playback,
  onGuides,
  onDraft,
  onCommit,
}: {
  /** The store's document: a drag begins on it. */
  document: ClipDocument;
  /** What the stage draws (the dot follows a drag's draft). */
  shown: ClipDocument;
  zoomId: string;
  /** Screen pixels per canvas pixel. */
  scale: number;
  /** The handle layer, whose corner is the canvas's. */
  layer: RefObject<HTMLDivElement | null>;
  playback: PlaybackStore;
  onGuides: (guides: Guides) => void;
  onDraft: (draft: { doc: ClipDocument; seekMs: number | null } | null) => void;
  onCommit: (start: ClipDocument, next: ClipDocument, options?: { coalesceKey?: string }) => void;
}) {
  const describedBy = useId();
  const drag = useRef<FocusDrag | null>(null);
  const latest = useRef({ document, onDraft, onCommit, onGuides });
  latest.current = { document, onDraft, onCommit, onGuides };
  const keysKey = useRef<string | null>(null);

  // Escape during a drag puts the focus back, ahead of the editor's own Escape.
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (!drag.current || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      drag.current = null;
      latest.current.onGuides(NO_GUIDES);
      latest.current.onDraft(null);
    };
    window.addEventListener('keydown', cancel, true);
    return () => {
      window.removeEventListener('keydown', cancel, true);
      // Gone mid-drag (the zoom was removed): nothing is left drafted.
      if (drag.current) latest.current.onDraft(null);
      drag.current = null;
    };
  }, []);

  const zoom = shown.zooms.find((candidate) => candidate.id === zoomId);
  if (!zoom) return null;
  const canvas = shown.canvas;

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button > 0) return;
    // Not a press on the clip: the layer below would clear the selection.
    event.stopPropagation();
    event.preventDefault();
    const rect = layer.current?.getBoundingClientRect();
    if (!rect || !(scale > 0)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    playback.pause();
    serial += 1;
    drag.current = {
      pointerId: event.pointerId,
      start: document,
      origin: { x: rect.left, y: rect.top },
      scale,
      canvas: document.canvas,
      seekMs: fullZoomMoment(document, zoomId),
      next: null,
      key: `focus:${zoomId}:${serial}`,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const g = drag.current;
    if (!g || event.pointerId !== g.pointerId) return;
    const point = screenToCanvas({ x: event.clientX, y: event.clientY }, g.origin, g.scale);
    const { focus, guides } = focusAt(point, g.canvas, SNAP_SCREEN_PX / g.scale, !event.altKey);
    const result = updateZoom(g.start, zoomId, { focus });
    if (!result.ok) return;
    g.next = result.doc;
    latest.current.onGuides(guides);
    latest.current.onDraft({ doc: result.doc, seekMs: g.seekMs });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const g = drag.current;
    if (!g || event.pointerId !== g.pointerId) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    latest.current.onGuides(NO_GUIDES);
    if (g.next && g.next !== g.start) {
      latest.current.onCommit(g.start, g.next, { coalesceKey: g.key });
    }
    latest.current.onDraft(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? FOCUS_STEP_BIG : FOCUS_STEP;
    const delta =
      event.key === 'ArrowLeft'
        ? { x: -step, y: 0 }
        : event.key === 'ArrowRight'
          ? { x: step, y: 0 }
          : event.key === 'ArrowUp'
            ? { x: 0, y: -step }
            : event.key === 'ArrowDown'
              ? { x: 0, y: step }
              : null;
    if (!delta) return;
    // The arrows move the dot, not the playhead or a bar.
    event.preventDefault();
    event.stopPropagation();
    const doc = latest.current.document;
    const current = doc.zooms.find((candidate) => candidate.id === zoomId);
    if (!current) return;
    const result = updateZoom(doc, zoomId, {
      focus: { x: unit(current.focus.x + delta.x), y: unit(current.focus.y + delta.y) },
    });
    if (!result.ok || result.doc === doc) return;
    keysKey.current ??= `focus-keys:${zoomId}:${++serial}`;
    latest.current.onCommit(doc, result.doc, { coalesceKey: keysKey.current });
  };

  return (
    <button
      type="button"
      aria-label="Zoom Focus"
      aria-describedby={describedBy}
      data-testid="clip-zoom-focus"
      className={cn(
        'absolute flex cursor-grab touch-none items-center justify-center rounded-full',
        'border-2 border-white bg-black/25 ring-2 ring-black active:cursor-grabbing',
        'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
      )}
      style={{
        left: zoom.focus.x * canvas.width * scale - DOT_PX / 2,
        top: zoom.focus.y * canvas.height * scale - DOT_PX / 2,
        width: DOT_PX,
        height: DOT_PX,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onBlur={() => {
        keysKey.current = null;
      }}
    >
      <span aria-hidden="true" className="absolute h-3.5 w-0.5 bg-white shadow-[0_0_0_1px_black]" />
      <span aria-hidden="true" className="absolute h-0.5 w-3.5 bg-white shadow-[0_0_0_1px_black]" />
      <span id={describedBy} className="sr-only">
        {`${focusText(zoom.focus)}. Drag it, or move it with the arrow keys.`}
      </span>
    </button>
  );
}
