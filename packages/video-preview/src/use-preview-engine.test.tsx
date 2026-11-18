import { render } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import type { PreviewEngine } from './preview-engine';
import { clipOf, FakeFrames, type FakeVideo, fakeVideoFactory, part } from './testing';
import { usePreviewEngine } from './use-preview-engine';

const doc = clipOf([part('a', 10_000, 14_000)]);

beforeEach(() => {
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({
  create,
  onEngine,
  url,
}: {
  create: () => HTMLVideoElement;
  onEngine: (engine: PreviewEngine | null) => void;
  url: string | null;
}) {
  const { engine, containerRef } = usePreviewEngine({
    document: doc,
    source: url ? { url } : null,
    createVideo: create,
    frames: new FakeFrames(),
  });
  useEffect(() => onEngine(engine), [engine, onEngine]);
  return <div data-testid="stage" ref={containerRef} />;
}

describe('usePreviewEngine', () => {
  it('makes one live engine under StrictMode, attached, and destroys it on unmount', () => {
    const factory = fakeVideoFactory();
    const seen: Array<PreviewEngine | null> = [];
    const onEngine = (engine: PreviewEngine | null) => {
      seen.push(engine);
    };
    const view = render(
      <StrictMode>
        <Harness create={factory.create} onEngine={onEngine} url="https://storage.example/a.mp4" />
      </StrictMode>,
    );

    const engines = seen.filter((engine): engine is PreviewEngine => engine !== null);
    const live = engines[engines.length - 1];
    if (!live) throw new Error('no engine was made');
    expect(live.isDestroyed).toBe(false);
    // StrictMode made a first engine and destroyed it, with all its listeners.
    expect(factory.videos).toHaveLength(4);
    const [first0, first1] = factory.videos as [FakeVideo, FakeVideo];
    expect(first0.totalListeners + first1.totalListeners).toBe(0);
    for (const engine of engines) {
      if (engine !== live) expect(engine.isDestroyed).toBe(true);
    }

    // The live engine drew its stage into the container and got the document and address.
    const stage = view.getByTestId('stage');
    expect(stage.querySelectorAll('[data-preview-stage]')).toHaveLength(1);
    expect(live.getSnapshot().durationMs).toBe(4000);
    expect(live.videos[0].getAttribute('src')).toBe('https://storage.example/a.mp4');

    view.unmount();
    expect(live.isDestroyed).toBe(true);
  });

  it('passes a new address to the same engine and reports a missing one', () => {
    const factory = fakeVideoFactory();
    let current: PreviewEngine | null = null;
    const onEngine = (engine: PreviewEngine | null) => {
      current = engine;
    };
    const view = render(
      <Harness create={factory.create} onEngine={onEngine} url="https://storage.example/a.mp4" />,
    );
    const engine = current as PreviewEngine | null;
    if (!engine) throw new Error('no engine');

    view.rerender(
      <Harness create={factory.create} onEngine={onEngine} url="https://storage.example/b.mp4" />,
    );
    expect(current).toBe(engine);
    expect(engine.videos[0].getAttribute('src')).toBe('https://storage.example/b.mp4');

    view.rerender(<Harness create={factory.create} onEngine={onEngine} url={null} />);
    expect(engine.getSnapshot().error?.code).toBe('missing_source');
    view.unmount();
  });
});
