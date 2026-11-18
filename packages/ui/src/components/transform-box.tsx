'use client';

/**
 * `TransformBox`: the frame around a selected item on a canvas (Clips Module
 * 11; stickers reuse it in Module 12). A 2 px primary border, square handles
 * on the corners and sides, and a round turning handle above, all turned
 * with the item.
 *
 * It only draws and reports which part was pressed: the drag itself (move,
 * scale about the opposite corner, widen, turn with snapping) is the
 * caller's, in its own coordinates. Positions are screen pixels inside the
 * caller's positioned overlay.
 */
import { cn } from '../lib/utils';

export const TRANSFORM_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type TransformHandleName = (typeof TRANSFORM_HANDLES)[number];
/** What was pressed: a handle, the turning handle or the body. */
export type TransformPart = TransformHandleName | 'rotate' | 'body';

/** Where each handle sits on the box, as fractions across and down. */
const HANDLE_AT: Readonly<Record<TransformHandleName, [number, number]>> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

const CURSOR: Readonly<Record<TransformHandleName, string>> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** How far above the box the turning handle sits, screen pixels. */
export const ROTATE_HANDLE_OFFSET = 28;

export interface TransformBoxProps {
  /** The item's centre, screen pixels inside the overlay. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** Which square handles to show (a text: corners and the two sides; a sticker: corners). */
  handles?: readonly TransformHandleName[];
  /** Hide the turning handle. */
  noRotate?: boolean;
  onPartPointerDown?: (part: TransformPart, event: React.PointerEvent<HTMLElement>) => void;
  onBodyDoubleClick?: (event: React.MouseEvent<HTMLElement>) => void;
  className?: string;
}

export function TransformBox({
  x,
  y,
  width,
  height,
  rotation,
  handles = TRANSFORM_HANDLES,
  noRotate = false,
  onPartPointerDown,
  onBodyDoubleClick,
  className,
}: TransformBoxProps) {
  const down = (part: TransformPart) => (event: React.PointerEvent<HTMLElement>) => {
    // Only the main button (jsdom leaves `button` unset).
    if (event.button > 0) return;
    event.stopPropagation();
    onPartPointerDown?.(part, event);
  };
  return (
    <div
      data-transform-box=""
      className={cn('pointer-events-none absolute', className)}
      style={{
        left: x - width / 2,
        top: y - height / 2,
        width,
        height,
        transform: `rotate(${rotation}deg)`,
        transformOrigin: '50% 50%',
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only frame on a canvas; the keyboard moves and edits the selected item through the editor's own keys. */}
      <div
        data-part="body"
        onPointerDown={down('body')}
        onDoubleClick={onBodyDoubleClick}
        className="pointer-events-auto absolute inset-0 cursor-move border-2 border-actionPrimary"
      />
      {noRotate ? null : (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 w-0.5 -translate-x-1/2 bg-actionPrimary"
            style={{ top: -ROTATE_HANDLE_OFFSET, height: ROTATE_HANDLE_OFFSET }}
          />
          <span
            data-part="rotate"
            onPointerDown={down('rotate')}
            className="pointer-events-auto absolute left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-actionPrimary bg-secondary"
            style={{ top: -ROTATE_HANDLE_OFFSET }}
          />
        </>
      )}
      {handles.map((handle) => {
        const [fx, fy] = HANDLE_AT[handle];
        return (
          <span
            key={handle}
            data-part={handle}
            onPointerDown={down(handle)}
            className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-actionPrimary bg-secondary"
            style={{ left: `${fx * 100}%`, top: `${fy * 100}%`, cursor: CURSOR[handle] }}
          />
        );
      })}
    </div>
  );
}
