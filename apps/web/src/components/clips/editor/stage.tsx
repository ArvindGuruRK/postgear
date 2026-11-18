'use client';

/**
 * The stage (Module 08 section 5): the preview engine's picture in the
 * clip's own shape, scaled to fit, centred, with a thin border. It never
 * scrolls. A `ResizeObserver` keeps the scale, and the scale is shared
 * through `useStageScale()`: Module 11's handles divide pointer movement by
 * it.
 *
 * The engine draws into the inner box (`containerRef`), which has the clip's
 * shape at the stage's scale; everything it makes (the area canvases, the
 * overlay host, the two `<video>` elements) lives in there.
 *
 * Only `StageStatus` reads the clock-side flags (buffering, the error), so a
 * new frame never re-renders the stage itself.
 */
import { Button, cn, Spinner } from '@postgear/ui';
import type { CanvasSize } from '@postgear/video-engine';
import { MonitorX } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { CANNOT_PLAY_SENTENCE, fitScale } from './clip-editor-model';
import type { PlaybackStore } from './playback';

const StageScaleContext = createContext(1);

/** How many screen pixels one canvas pixel takes on the stage (1080 wide at 0.3 is 324 px). */
export function useStageScale(): number {
  return useContext(StageScaleContext);
}

/** The space kept around the clip inside the stage, in px. */
const STAGE_PADDING_PX = 24;

export function Stage({
  canvas,
  containerRef,
  playback,
  missing,
  onRetry,
  children,
}: {
  canvas: CanvasSize;
  containerRef: (element: HTMLElement | null) => void;
  playback: PlaybackStore;
  /** The sentence to show in place of the picture (no video to play), or null. */
  missing: string | null;
  /** Try Again when the video cannot be played. */
  onRetry: () => void;
  /** Drawn over the picture at the same scale (Module 11's handles). */
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () =>
      setSize((current) => {
        const width = Math.max(0, node.clientWidth - STAGE_PADDING_PX * 2);
        const height = Math.max(0, node.clientHeight - STAGE_PADDING_PX * 2);
        return current.width === width && current.height === height ? current : { width, height };
      });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = fitScale(canvas, size);
  const width = Math.floor(canvas.width * scale);
  const height = Math.floor(canvas.height * scale);

  return (
    <StageScaleContext.Provider value={scale}>
      <div
        ref={box}
        data-testid="clip-stage"
        className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden"
      >
        {missing ? (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <MonitorX className="h-8 w-8 text-ink" strokeWidth={2} aria-hidden="true" />
            <p className="m-0 font-sans text-sm text-ink">{missing}</p>
          </div>
        ) : (
          <div
            className={cn(
              'relative overflow-hidden border-2 border-outline bg-inset',
              scale === 0 && 'invisible',
            )}
            // Border-box: the 2 px border sits outside the picture's own size.
            style={{ width: width + 4, height: height + 4 }}
            data-ratio={`${canvas.width}:${canvas.height}`}
          >
            <div
              ref={containerRef}
              data-testid="clip-stage-picture"
              className="absolute inset-0"
              aria-label="Clip preview"
              role="img"
            />
            {children ? <div className="absolute inset-0">{children}</div> : null}
            <StageStatus playback={playback} onRetry={onRetry} />
          </div>
        )}
      </div>
    </StageScaleContext.Provider>
  );
}

/** Buffering and the video that cannot play, over the picture. */
function StageStatus({ playback, onRetry }: { playback: PlaybackStore; onRetry: () => void }) {
  const buffering = playback.useBuffering();
  const error = playback.usePreviewError();
  const ready = playback.useReady();

  if (error) {
    return (
      <div
        role="alert"
        className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-primary/90 p-4 text-center"
      >
        <p className="m-0 font-sans text-sm text-ink">{CANNOT_PLAY_SENTENCE}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try Again
        </Button>
      </div>
    );
  }

  if (buffering || !ready) {
    return (
      <div className="pointer-events-none absolute right-2 bottom-2">
        <Spinner size="sm" aria-label="Loading the video" className="motion-reduce:animate-none" />
      </div>
    );
  }
  return null;
}
