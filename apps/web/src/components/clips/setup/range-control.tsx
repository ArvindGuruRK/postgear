'use client';

/**
 * The stretch of a video to use: two handles on a slider, the two times
 * under it. Clip Setup's Range, and Auto-Edit Video's range when a video is
 * longer than Auto-Edit takes at once (Module 10).
 */
import { Slider } from '@postgear/ui';
import { formatClipLength } from '@postgear/video-engine';

export function RangeControl({
  fromMs,
  toMs,
  durationMs,
  onChange,
  testId,
}: {
  fromMs: number;
  toMs: number;
  durationMs: number;
  onChange: (fromMs: number, toMs: number) => void;
  testId?: string;
}) {
  return (
    <>
      <Slider
        value={[fromMs, toMs]}
        min={0}
        max={Math.max(3_000, durationMs)}
        step={1_000}
        minStepsBetweenThumbs={3}
        thumbs={[
          { 'aria-label': 'Start', 'aria-valuetext': formatClipLength(fromMs) },
          { 'aria-label': 'End', 'aria-valuetext': formatClipLength(toMs) },
        ]}
        onValueChange={([from, to]) => {
          if (from !== undefined && to !== undefined) onChange(from, to);
        }}
        data-testid={testId}
      />
      <div className="flex justify-between font-sans text-xs tabular-nums text-ink type-muted">
        <span>{formatClipLength(fromMs)}</span>
        <span>{formatClipLength(toMs)}</span>
      </div>
    </>
  );
}
