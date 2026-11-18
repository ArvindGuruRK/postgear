'use client';

/**
 * The bench's light-copy player, drawn by `PreviewEngine` (Module 08): the
 * clip's document over the light copy, part by part, on canvases, the same
 * way the editor's stage draws it. A check that the engine plays a real
 * clip, and where the canvas cost spike is read: the engine is made with
 * `measure: true` and the line under the picture shows frames drawn against
 * frames presented (`data-testid="preview-stats"`, for the Playwright pass).
 *
 * Only this component and its small readouts subscribe to the clock, so the
 * bench page around it does not re-render on every frame.
 */
import { Alert, AlertDescription, Button } from '@postgear/ui';
import type { PlaybackStore } from '@/components/clips/editor/playback';
import { formatMoment } from './test-bench-model';

export function BenchPreview({
  store,
  containerRef,
  canvas,
}: {
  store: PlaybackStore;
  containerRef: (element: HTMLElement | null) => void;
  canvas: { width: number; height: number };
}) {
  const error = store.usePreviewError();
  return (
    <div className="flex flex-col gap-3">
      <div
        ref={containerRef}
        className="relative mx-auto h-[420px] max-w-full overflow-hidden rounded-sm border-2 border-ink bg-black"
        style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      />
      {error && (
        <Alert variant="danger">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <Transport store={store} />
      <Stats store={store} />
    </div>
  );
}

function Transport({ store }: { store: PlaybackStore }) {
  const playing = store.usePlaying();
  const buffering = store.useBuffering();
  const ready = store.useReady();
  const currentMs = store.useCurrentMs();
  const durationMs = store.useDurationMs();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" size="sm" onClick={() => store.stepFrames(-1)} disabled={!ready}>
        Previous Frame
      </Button>
      <Button size="sm" onClick={() => store.toggle()} disabled={!ready}>
        {playing ? 'Pause' : 'Play'}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => store.stepFrames(1)} disabled={!ready}>
        Next Frame
      </Button>
      <span className="font-sans text-sm text-ink tabular-nums">
        {formatMoment(currentMs)} / {formatMoment(durationMs)}
      </span>
      {buffering && <span className="font-sans text-sm text-ink type-muted">Loading...</span>}
    </div>
  );
}

function Stats({ store }: { store: PlaybackStore }) {
  const { stats } = store.useSnapshot();
  if (!stats) return null;
  return (
    <p className="m-0 font-sans text-sm text-ink type-muted" data-testid="preview-stats">
      Frames drawn {stats.framesDrawn} of{' '}
      {stats.framesPresented === null ? 'unknown' : stats.framesPresented} presented, about{' '}
      {stats.averageDrawMs} ms each (
      {stats.clock === 'video-frame' ? 'video frame' : 'animation frame'} clock).
    </p>
  );
}
