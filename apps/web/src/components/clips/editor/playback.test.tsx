import { PreviewEngine } from '@postgear/video-preview';
import {
  clipOf,
  FakeFrames,
  type FakeVideo,
  fakeVideoFactory,
  part,
} from '@postgear/video-preview/testing';
import { act, render, renderHook, screen } from '@testing-library/react';
import { PlaybackStore, usePlaybackStore } from './playback';

function makeEngine(segments = [part('a', 10_000, 14_000)]) {
  const factory = fakeVideoFactory();
  const frames = new FakeFrames();
  const engine = new PreviewEngine({
    createVideo: factory.create,
    frames,
    document: clipOf(segments),
    source: { url: 'https://storage.example/proxy.mp4', fps: 30 },
  });
  const [v0, v1] = factory.videos as [FakeVideo, FakeVideo];
  v0.loadMetadata();
  v1.loadMetadata();
  v0.finishSeek();
  v1.finishSeek();
  return { engine, v0, v1, frames };
}

describe('PlaybackStore', () => {
  it('reads idle with no engine, and every command is a no-op', () => {
    const store = new PlaybackStore();
    expect(store.getSnapshot()).toMatchObject({ currentMs: 0, playing: false, durationMs: 0 });
    expect(() => {
      store.play();
      store.seekMs(500);
      store.stepFrames(1);
      store.setScrubbing(true);
    }).not.toThrow();
  });

  it('passes commands to the engine and its changes to subscribers', () => {
    const { engine, v0 } = makeEngine();
    const store = new PlaybackStore(engine);
    const listener = jest.fn();
    store.subscribe(listener);

    store.play();
    expect(store.isPlaying()).toBe(true);
    v0.presentFrame(11_200);
    expect(store.getCurrentMs()).toBe(1200);
    expect(listener).toHaveBeenCalled();

    store.toggle();
    expect(store.isPlaying()).toBe(false);
    store.stepFrames(1);
    expect(store.getCurrentMs()).toBe(1234);
    store.seekMs(99_000);
    expect(store.getCurrentMs()).toBe(4000);
    engine.destroy();
  });

  it('re-renders a time reader on each frame and a play button only when playing changes', () => {
    const { engine, v0 } = makeEngine();
    const store = new PlaybackStore(engine);
    const renders = { time: 0, button: 0 };

    function TimeText() {
      renders.time += 1;
      return <span data-testid="time">{store.useCurrentMs()}</span>;
    }
    function PlayButton() {
      renders.button += 1;
      return <span data-testid="playing">{store.usePlaying() ? 'Pause' : 'Play'}</span>;
    }
    render(
      <>
        <TimeText />
        <PlayButton />
      </>,
    );
    const start = { ...renders };

    act(() => store.play());
    act(() => v0.presentFrame(10_500));
    act(() => v0.presentFrame(10_533));
    act(() => v0.presentFrame(10_567));
    expect(screen.getByTestId('time').textContent).toBe('567');
    expect(screen.getByTestId('playing').textContent).toBe('Pause');
    expect(renders.time - start.time).toBeGreaterThanOrEqual(3);
    // One render for playing turning true; the frames did not touch it.
    expect(renders.button - start.button).toBe(1);
    engine.destroy();
  });

  it('reports buffering and scrubbing', () => {
    const { engine } = makeEngine([part('a', 10_000, 12_000), part('b', 40_000, 42_000)]);
    const store = new PlaybackStore(engine);
    const buffering = renderHook(() => store.useBuffering());
    const scrubbing = renderHook(() => store.useScrubbing());

    act(() => store.play());
    act(() => store.seekMs(3000));
    expect(buffering.result.current).toBe(true);

    act(() => store.setScrubbing(true));
    expect(scrubbing.result.current).toBe(true);
    expect(buffering.result.current).toBe(false);
    act(() => store.setScrubbing(false));
    expect(scrubbing.result.current).toBe(false);
    engine.destroy();
  });

  it('follows the playhead to the new end when the clip gets shorter', () => {
    const { engine } = makeEngine();
    const store = new PlaybackStore(engine);
    const time = renderHook(() => store.useCurrentMs());
    act(() => store.seekMs(3500));
    expect(time.result.current).toBe(3500);
    act(() => engine.setDocument(clipOf([part('a', 10_000, 12_000)])));
    expect(time.result.current).toBe(2000);
    engine.destroy();
  });

  it('usePlaybackStore keeps one store and connects the engine when it arrives', () => {
    const { engine } = makeEngine();
    const hook = renderHook(({ current }) => usePlaybackStore(current), {
      initialProps: { current: null as PreviewEngine | null },
    });
    const store = hook.result.current;
    expect(store.getSnapshot().durationMs).toBe(0);
    hook.rerender({ current: engine });
    expect(hook.result.current).toBe(store);
    expect(store.getSnapshot().durationMs).toBe(4000);
    hook.unmount();
    expect(store.getSnapshot().durationMs).toBe(0);
    engine.destroy();
  });
});
