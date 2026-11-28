'use client';

/**
 * The emote's crop (Sprint 13, Module 14): a dashed square over the video.
 * Drag it to move, drag its corner to resize; it always stays square and
 * inside the picture. Arrow keys move it (Shift for bigger steps), plus and
 * minus resize it. Positions are the light copy's pixels (`frame`), the same
 * numbers the export reads; the box is laid over a container with the
 * frame's shape, so percentages map one to one.
 *
 * Under 112 source pixels a muted line warns "This will look soft."
 * After a keyboard step a polite status says the new size and place
 * (`cropSaid`), since the box moving is only seen (Module 16).
 */
import type { EmoteCrop, EmoteFrame } from '@postgear/video-engine';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';
import { clampCrop, isSoft, SOFT_NOTE } from './emote-model';

export interface CropBoxProps {
  frame: EmoteFrame;
  crop: EmoteCrop;
  onChange: (crop: EmoteCrop) => void;
  disabled?: boolean;
}

type Drag = { mode: 'move' | 'resize'; x: number; y: number; start: EmoteCrop; scale: number };

/** "200 pixels square, 20 from the left, 0 from the top.": read out after a keyboard step. */
export function cropSaid(crop: EmoteCrop): string {
  return `${crop.size} pixels square, ${crop.x} from the left, ${crop.y} from the top.`;
}

export function CropBox({ frame, crop, onChange, disabled }: CropBoxProps) {
  const layer = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [said, setSaid] = useState('');

  const begin = (mode: Drag['mode']) => (event: PointerEvent<HTMLElement>) => {
    if (disabled || event.button !== 0) return;
    const width = layer.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      x: event.clientX,
      y: event.clientY,
      start: crop,
      scale: frame.width / width,
    };
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.x) * current.scale;
    const dy = (event.clientY - current.y) * current.scale;
    if (current.mode === 'move') {
      onChange(
        clampCrop({ ...current.start, x: current.start.x + dx, y: current.start.y + dy }, frame),
      );
      return;
    }
    // The corner keeps the box square: the larger of the two pulls wins.
    const grow = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const side = Math.min(
      current.start.size + grow,
      frame.width - current.start.x,
      frame.height - current.start.y,
    );
    onChange(clampCrop({ ...current.start, size: side }, frame));
  };

  const end = (event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 20 : 4;
    const moves: Record<string, [number, number, number]> = {
      ArrowLeft: [-step, 0, 0],
      ArrowRight: [step, 0, 0],
      ArrowUp: [0, -step, 0],
      ArrowDown: [0, step, 0],
      '+': [0, 0, step],
      '=': [0, 0, step],
      '-': [0, 0, -step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    const next = clampCrop(
      { x: crop.x + delta[0], y: crop.y + delta[1], size: crop.size + delta[2] },
      frame,
    );
    onChange(next);
    setSaid(cropSaid(next));
  };

  const percent = (value: number, of: number) => `${(value / of) * 100}%`;

  return (
    <div
      ref={layer}
      className="pointer-events-none absolute inset-0"
      data-testid="emote-crop-layer"
    >
      <button
        type="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Crop Box"
        aria-description={`${crop.size} pixels square. Arrow keys move it, plus and minus resize it.`}
        className="pointer-events-auto absolute cursor-move touch-none bg-transparent p-0 border-2 border-dashed border-actionSecondary outline-none focus-visible:border-solid"
        style={{
          left: percent(crop.x, frame.width),
          top: percent(crop.y, frame.height),
          width: percent(crop.size, frame.width),
          height: percent(crop.size, frame.height),
        }}
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        data-testid="emote-crop-box"
      >
        <span
          aria-hidden="true"
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize touch-none rounded-sm border-2 border-outline bg-actionSecondary"
          onPointerDown={begin('resize')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </button>
      <span role="status" className="sr-only" data-testid="emote-crop-said">
        {said}
      </span>
    </div>
  );
}

/** The line under the video: the crop's size, and the soft warning under 112 source pixels. */
export function CropNote({ crop }: { crop: EmoteCrop }) {
  return (
    <p className="m-0 font-sans text-sm text-ink type-muted" data-testid="emote-crop-note">
      {`Crop: ${crop.size} px square.`}
      {isSoft(crop) ? ` ${SOFT_NOTE}` : null}
    </p>
  );
}
