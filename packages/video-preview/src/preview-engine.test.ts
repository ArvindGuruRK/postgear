import type { ClipDocument, Segment } from '@postgear/video-engine';
import { PreviewEngine, type PreviewEngineOptions } from './preview-engine';
import {
  CENTRED_VERTICAL_CROP,
  clipOf,
  FakeFrames,
  type FakeVideo,
  fakeVideoFactory,
  part,
} from './testing';

const URL_A = 'https://storage.example/proxy.mp4?sig=a';
const URL_B = 'https://storage.example/proxy.mp4?sig=b';

interface Setup {
  engine: PreviewEngine;
  v0: FakeVideo;
  v1: FakeVideo;
  frames: FakeFrames;
  log: string[];
}

function setup(
  segments: Segment[] | ClipDocument,
  options: { frameCallback?: boolean; settle?: boolean } & Partial<PreviewEngineOptions> = {},
): Setup {
  const { frameCallback, settle = true, ...engineOptions } = options;
  const factory = fakeVideoFactory({ frameCallback });
  const frames = new FakeFrames();
  const engine = new PreviewEngine({
    createVideo: factory.create,
    frames,
    document: Array.isArray(segments) ? clipOf(segments) : segments,
    source: { url: URL_A, fps: 30 },
    ...engineOptions,
  });
  const [v0, v1] = factory.videos as [FakeVideo, FakeVideo];
  v0.loadMetadata();
  v1.loadMetadata();
  if (settle) {
    v0.finishSeek();
    v1.finishSeek();
  }
  return { engine, v0, v1, frames, log: factory.log };
}

function after(log: string[], mark: number): string[] {
  return log.slice(mark);
}

// jsdom has no 2D canvas: each canvas gets a context that records its draws.
const contexts: Array<{ drawImage: jest.Mock; canvas: HTMLCanvasElement }> = [];

beforeEach(() => {
  contexts.length = 0;
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const context = { drawImage: jest.fn(), canvas: this };
    contexts.push(context);
    return context as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PreviewEngine: the store', () => {
  it('starts idle, becomes ready on the first seek, and notifies only on change', () => {
    const factory = fakeVideoFactory();
    const engine = new PreviewEngine({
      createVideo: factory.create,
      frames: new FakeFrames(),
      document: clipOf([part('a', 10_000, 14_000)]),
      source: { url: URL_A },
    });
    const listener = jest.fn();
    engine.subscribe(listener);
    const first = engine.getSnapshot();
    expect(first).toMatchObject({
      currentMs: 0,
      durationMs: 4000,
      playing: false,
      ready: false,
      error: null,
      stats: null,
    });
    expect(engine.getSnapshot()).toBe(first);

    const [v0] = factory.videos as [FakeVideo];
    v0.loadMetadata();
    // The seek asked for before the metadata is made now.
    expect(v0.mediaMs).toBe(10_000);
    v0.finishSeek();
    expect(engine.getSnapshot().ready).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    // Nothing changed: same object, no call.
    engine.pause();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('plays, follows the frame callbacks and pauses in place', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 14_000)]);
    const mark = log.length;
    engine.play();
    expect(engine.getSnapshot().playing).toBe(true);
    expect(after(log, mark)).toEqual(['v0:play']);
    expect(v0.el.preservesPitch).toBe(true);

    v0.presentFrame(11_000);
    expect(engine.getSnapshot().currentMs).toBe(1000);
    v0.presentFrame(12_500);
    expect(engine.getSnapshot().currentMs).toBe(2500);

    v0.advanceTo(12_600);
    engine.pause();
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 2600 });
    expect(v0.pendingFrameCallbacks).toBe(0);

    engine.toggle();
    expect(engine.getSnapshot().playing).toBe(true);
    engine.toggle();
    expect(engine.getSnapshot().playing).toBe(false);
  });

  it('stops at the end and plays again from the start', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 12_000)]);
    engine.play();
    v0.presentFrame(12_000);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 2000 });

    const mark = log.length;
    engine.play();
    expect(after(log, mark)).toEqual(['v0:seek 10000']);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: true, currentMs: 0 });
    v0.finishSeek();
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: false });
  });
});

describe('PreviewEngine: the hand-over', () => {
  it('readies the back element on the next part and swaps at the join, in order', () => {
    const { engine, v0, v1, log } = setup([
      part('a', 10_000, 12_000),
      part('b', 40_000, 42_000),
      part('c', 70_000, 71_000),
    ]);
    // Set up: the front on A's start, the back on B's.
    expect(log).toEqual(['v0:seek 10000', 'v1:seek 40000', 'v0:seeked 10000', 'v1:seeked 40000']);

    engine.play();
    v0.presentFrame(11_000);
    expect(engine.getSnapshot().currentMs).toBe(1000);

    const mark = log.length;
    v0.presentFrame(12_000);
    // New front starts, old front pauses, then waits on C's start.
    expect(after(log, mark)).toEqual(['v1:play', 'v0:pause', 'v0:seek 70000']);
    expect(engine.videos[0]).toBe(v1.el);
    expect(engine.getSnapshot()).toMatchObject({
      currentMs: 2000,
      playing: true,
      buffering: false,
    });

    v1.presentFrame(41_000);
    expect(engine.getSnapshot().currentMs).toBe(3000);
    // The old front's callbacks no longer move the clock.
    v0.presentFrame(70_500);
    expect(engine.getSnapshot().currentMs).toBe(3000);

    v0.finishSeek();
    v1.presentFrame(42_000);
    expect(engine.videos[0]).toBe(v0.el);
    expect(engine.getSnapshot().currentMs).toBe(4000);
    v0.presentFrame(71_000);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 5000 });
  });

  it('does not swap between contiguous parts: one element plays through', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 12_000), part('b', 12_000, 14_000)]);
    // Nothing to wait on: the back element is never asked to seek.
    expect(log.filter((line) => line.startsWith('v1:'))).toEqual([]);

    engine.play();
    v0.presentFrame(12_000);
    v0.presentFrame(13_000);
    expect(engine.getSnapshot().currentMs).toBe(3000);
    expect(engine.videos[0]).toBe(v0.el);
    expect(log.some((line) => line === 'v1:play')).toBe(false);
  });

  it('maps media time to clip time across a speed change on one element', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 12_000), part('b', 12_000, 16_000, 2)]);
    engine.play();
    v0.presentFrame(11_000);
    expect(engine.getSnapshot().currentMs).toBe(1000);
    v0.presentFrame(14_000);
    // 2000 into the clip, then 2000 ms of video at 2x is 1000 ms.
    expect(engine.getSnapshot().currentMs).toBe(3000);
    expect(log).toContain('v0:rate 2');
    expect(v0.el.playbackRate).toBe(2);
  });

  it('maps media time to clip time across a speed change at a hand-over', () => {
    const { engine, v0, v1 } = setup([part('a', 10_000, 12_000), part('b', 40_000, 44_000, 0.5)]);
    engine.play();
    v0.presentFrame(12_000);
    expect(v1.el.playbackRate).toBe(0.5);
    v1.presentFrame(41_000);
    // 2000 into the clip, then 1000 ms of video at 0.5x is 2000 ms.
    expect(engine.getSnapshot().currentMs).toBe(4000);
    expect(engine.getSnapshot().durationMs).toBe(10_000);
  });

  it('holds the last frame and reports buffering when the next part is not ready', () => {
    const { engine, v0, v1, log } = setup([part('a', 10_000, 12_000), part('b', 40_000, 42_000)], {
      settle: false,
    });
    v0.finishSeek();
    engine.play();
    v0.presentFrame(11_500);

    const mark = log.length;
    v0.presentFrame(12_000);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: true, currentMs: 2000 });
    expect(after(log, mark)).toEqual(['v0:pause']);
    // No drift while held: the old front cannot move the clock.
    v0.presentFrame(12_300);
    expect(engine.getSnapshot().currentMs).toBe(2000);
    expect(v0.pendingFrameCallbacks).toBe(0);

    v1.finishSeek();
    expect(after(log, mark)).toEqual(['v0:pause', 'v1:seeked 40000', 'v1:play']);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: false });
    v1.presentFrame(41_000);
    expect(engine.getSnapshot().currentMs).toBe(3000);
  });

  it('reports a network stall as buffering', () => {
    const { engine, v0 } = setup([part('a', 10_000, 14_000)]);
    engine.play();
    v0.stall();
    expect(engine.getSnapshot().buffering).toBe(true);
    v0.el.dispatchEvent(new Event('playing'));
    expect(engine.getSnapshot().buffering).toBe(false);
  });
});

describe('PreviewEngine: seeking and scrubbing', () => {
  it('seeks the front element to the moment and keeps playing after it', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 12_000), part('b', 40_000, 42_000)]);
    engine.seek(3000);
    expect(engine.getSnapshot().currentMs).toBe(3000);
    expect(log[log.length - 1]).toBe('v0:seek 41000');
    v0.finishSeek();

    engine.play();
    const mark = log.length;
    engine.seek(500);
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 500, buffering: true });
    expect(after(log, mark)).toEqual(['v0:pause', 'v0:seek 10500']);
    v0.finishSeek();
    expect(after(log, mark)).toEqual(['v0:pause', 'v0:seek 10500', 'v0:seeked 10500', 'v0:play']);
  });

  it('shows the last frame of a part, not the next one, at the very end', () => {
    const { engine, log } = setup([part('a', 10_000, 12_000)]);
    engine.seek(99_999);
    expect(engine.getSnapshot().currentMs).toBe(2000);
    expect(log[log.length - 1]).toBe('v0:seek 11999');
  });

  it('throttles scrubbing seeks to one per animation frame and mutes the sound', () => {
    const { engine, v0, frames, log } = setup([part('a', 10_000, 20_000)]);
    engine.setScrubbing(true);
    expect(engine.getSnapshot().scrubbing).toBe(true);
    expect(v0.el.muted).toBe(true);

    const mark = log.length;
    engine.seek(500);
    engine.seek(700);
    engine.seek(900);
    // The playhead follows at once; the video has not been asked yet.
    expect(engine.getSnapshot().currentMs).toBe(900);
    expect(after(log, mark)).toEqual([]);
    expect(frames.pending).toBe(1);

    frames.flush();
    expect(after(log, mark)).toEqual(['v0:seek 10900']);

    // Still seeking: the next frame waits rather than piling seeks up.
    engine.seek(1000);
    engine.seek(1100);
    frames.flush();
    expect(after(log, mark)).toEqual(['v0:seek 10900']);
    v0.finishSeek();
    frames.flush();
    expect(after(log, mark)).toEqual(['v0:seek 10900', 'v0:seeked 10900', 'v0:seek 11100']);
    // The seeked frame never pulls the playhead back while dragging.
    v0.finishSeek();
    expect(engine.getSnapshot().currentMs).toBe(1100);

    engine.seek(2000);
    engine.setScrubbing(false);
    expect(after(log, mark).slice(-1)).toEqual(['v0:seek 12000']);
    expect(engine.getSnapshot().scrubbing).toBe(false);
    expect(v0.el.muted).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('pauses for a drag and plays again when it ends', () => {
    const { engine, v0 } = setup([part('a', 10_000, 20_000)]);
    engine.play();
    engine.setScrubbing(true);
    expect(engine.getSnapshot().playing).toBe(false);
    engine.seek(4000);
    engine.setScrubbing(false);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: true });
    v0.finishSeek();
    expect(v0.isPlaying).toBe(true);
  });

  it('steps frames at the canvas frame rate', () => {
    const { engine, v0 } = setup([part('a', 10_000, 20_000)]);
    engine.play();
    engine.stepFrames(1);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 34 });
    v0.finishSeek();
    engine.stepFrames(3);
    expect(engine.getSnapshot().currentMs).toBe(134);
    engine.stepFrames(-10);
    expect(engine.getSnapshot().currentMs).toBe(0);
  });
});

describe('PreviewEngine: changing the document and the address', () => {
  it('moves the playhead to the new end when the clip gets shorter', () => {
    const { engine } = setup([part('a', 10_000, 14_000)]);
    engine.seek(3500);
    engine.setDocument(clipOf([part('a', 10_000, 12_000)]));
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 2000, durationMs: 2000 });
  });

  it('keeps playing through an edit that leaves the playing part alone', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 12_000), part('b', 40_000, 42_000)]);
    engine.play();
    v0.presentFrame(11_000);
    const mark = log.length;
    // A new crop, and a part added after: the part playing is unchanged.
    const edited = clipOf([part('a', 10_000, 12_000), part('c', 50_000, 52_000)]);
    edited.layout.areas[0] = {
      ...(edited.layout.areas[0] as ClipDocument['layout']['areas'][number]),
      crop: [{ at: 0, rect: { x: 0, y: 0, w: 0.3, h: 1 } }],
    };
    engine.setDocument(edited);
    // The back element moves to the new next part; the front never stops.
    expect(after(log, mark)).toEqual(['v1:seek 50000']);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, currentMs: 1000 });
  });

  it('seeks again when the playing part itself changed', () => {
    const { engine, v0, log } = setup([part('a', 10_000, 14_000)]);
    engine.play();
    v0.presentFrame(11_000);
    const mark = log.length;
    engine.setDocument(clipOf([part('a', 20_000, 24_000)]));
    expect(after(log, mark)).toEqual(['v0:pause', 'v0:seek 21000']);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: true });
  });

  it('swaps the address at the current moment and carries on playing', () => {
    const { engine, v0, v1, log } = setup([part('a', 10_000, 14_000)]);
    engine.seek(1500);
    v0.finishSeek();
    engine.play();
    v0.presentFrame(11_600);

    engine.setSource({ url: URL_B, fps: 30 });
    expect(v0.el.getAttribute('src')).toBe(URL_B);
    expect(v1.el.getAttribute('src')).toBe(URL_B);
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 1600, ready: false, playing: true });

    const mark = log.length;
    v0.loadMetadata();
    expect(after(log, mark)).toEqual(['v0:seek 11600']);
    v0.finishSeek();
    expect(engine.getSnapshot()).toMatchObject({ ready: true, playing: true, buffering: false });
    expect(v0.isPlaying).toBe(true);
  });
});

describe('PreviewEngine: errors are reported, never thrown', () => {
  it('reports a decode failure and stops', () => {
    const { engine, v0 } = setup([part('a', 10_000, 14_000)]);
    engine.play();
    expect(() => v0.fail(3)).not.toThrow();
    expect(engine.getSnapshot()).toMatchObject({
      playing: false,
      error: { code: 'decode' },
    });
    // Play is refused until a new address (or the same one again) is given.
    engine.play();
    expect(engine.getSnapshot().playing).toBe(false);
    engine.setSource({ url: URL_A });
    expect(engine.getSnapshot().error).toBeNull();
  });

  it('ignores an aborted load', () => {
    const { engine, v0 } = setup([part('a', 10_000, 14_000)]);
    v0.fail(1);
    expect(engine.getSnapshot().error).toBeNull();
  });

  it('names a missing address and an expired one', () => {
    const { engine, v0 } = setup([part('a', 10_000, 14_000)]);
    engine.setSource(null);
    expect(engine.getSnapshot().error?.code).toBe('missing_source');

    engine.setSource({ url: URL_B, expiresAt: Date.now() - 1000 });
    expect(engine.getSnapshot().error?.code).toBe('source_expired');

    // Expired while loading: the browser says "not supported", the engine says expired.
    engine.setSource({ url: URL_A, expiresAt: Date.now() + 60_000 });
    expect(engine.getSnapshot().error).toBeNull();
    const realNow = Date.now;
    Date.now = () => realNow() + 120_000;
    try {
      v0.fail(4);
    } finally {
      Date.now = realNow;
    }
    expect(engine.getSnapshot().error?.code).toBe('source_expired');
  });
});

describe('PreviewEngine: the fallback clock', () => {
  it('reads currentTime on each animation frame when the frame callback is missing', () => {
    const { engine, v0, frames } = setup([part('a', 10_000, 12_000), part('b', 40_000, 42_000)], {
      frameCallback: false,
      measure: true,
    });
    engine.play();
    expect(frames.pending).toBe(1);
    v0.advanceTo(11_000);
    frames.flush();
    expect(engine.getSnapshot().currentMs).toBe(1000);
    expect(frames.pending).toBe(1);
    expect(engine.getSnapshot().stats?.clock).toBe('animation-frame');
    expect(engine.getSnapshot().stats?.framesPresented).toBeNull();

    // The hand-over works the same on this clock.
    v0.advanceTo(12_010);
    frames.flush();
    expect(engine.videos[0]).not.toBe(v0.el);
    expect(engine.getSnapshot().currentMs).toBe(2000);

    engine.pause();
    expect(frames.pending).toBe(0);
  });
});

describe('PreviewEngine: drawing', () => {
  it('builds the stage and draws each area from its crop on seeked and on every frame', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { engine, v0 } = setup([part('a', 10_000, 14_000)], { settle: false, measure: true });
    engine.attach(container);

    const stage = container.querySelector('[data-preview-stage]');
    expect(stage).not.toBeNull();
    for (const layer of ['looks', 'zoom', 'base', 'areas', 'overlays', 'media']) {
      expect(container.querySelector(`[data-preview-layer="${layer}"]`)).not.toBeNull();
    }
    // The videos live in the stage, invisible, never display: none.
    expect(container.querySelectorAll('[data-preview-layer="media"] video')).toHaveLength(2);

    const canvas = container.querySelector('canvas[data-area-id="main"]') as HTMLCanvasElement;
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1920);
    expect(canvas.style.width).toBe('100%');

    v0.finishSeek();
    const area = contexts.find((context) => context.canvas === canvas);
    expect(area?.drawImage).toHaveBeenCalledTimes(1);
    const [video, sx, sy, sw, sh, dx, dy, dw, dh] = area?.drawImage.mock.calls[0] ?? [];
    expect(video).toBe(v0.el);
    expect(sx).toBeCloseTo(CENTRED_VERTICAL_CROP.x * 1280, 5);
    expect(sy).toBe(0);
    expect(sw).toBeCloseTo(CENTRED_VERTICAL_CROP.w * 1280, 5);
    expect(sh).toBe(720);
    expect([dx, dy, dw, dh]).toEqual([0, 0, 1080, 1920]);

    engine.play();
    v0.presentFrame(11_000);
    v0.presentFrame(11_100, 2);
    expect(area?.drawImage).toHaveBeenCalledTimes(3);
    expect(engine.getSnapshot().stats).toMatchObject({
      clock: 'video-frame',
      framesDrawn: 2,
      framesPresented: 4,
    });
    engine.destroy();
    container.remove();
  });

  it('rounds areas with a radius and draws the blurred base small', () => {
    const container = document.createElement('div');
    const doc = clipOf([part('a', 10_000, 14_000)], {
      kind: 'blurred',
      areas: [
        {
          id: 'cam',
          name: 'Camera',
          frame: { x: 0.1, y: 0.1, w: 0.5, h: 0.25 },
          crop: [{ at: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
          fit: 'cover',
          radius: 54,
        },
      ],
    });
    const { engine } = setup(doc);
    engine.attach(container);

    const area = container.querySelector('canvas[data-area-id="cam"]') as HTMLCanvasElement;
    expect(area.width).toBe(540);
    expect(area.height).toBe(480);
    expect(area.style.left).toBe('10%');
    // 54 px of 540 wide and of 480 high.
    expect(area.style.borderRadius).toBe('10% / 11.25%');

    const blur = container.querySelector('canvas[data-preview-blur]') as HTMLCanvasElement;
    expect(blur.style.display).toBe('block');
    expect([blur.width, blur.height]).toEqual([108, 192]);
    expect(blur.style.filter).toContain('blur(');
    const blurContext = contexts.find((context) => context.canvas === blur);
    expect(blurContext?.drawImage).toHaveBeenCalled();
    engine.destroy();
  });

  it('removes the canvas of an area that left the layout', () => {
    const container = document.createElement('div');
    const twoAreas = clipOf([part('a', 10_000, 14_000)], {
      kind: 'split',
      areas: [
        {
          id: 'top',
          name: 'Camera',
          frame: { x: 0, y: 0, w: 1, h: 0.5 },
          crop: [{ at: 0, rect: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
          fit: 'cover',
        },
        {
          id: 'bottom',
          name: 'Content',
          frame: { x: 0, y: 0.5, w: 1, h: 0.5 },
          crop: [{ at: 0, rect: { x: 0.25, y: 0, w: 0.5, h: 1 } }],
          fit: 'cover',
        },
      ],
    });
    const { engine } = setup(twoAreas);
    engine.attach(container);
    expect(container.querySelectorAll('canvas[data-area-id]')).toHaveLength(2);
    engine.setDocument(clipOf([part('a', 10_000, 14_000)]));
    expect(
      Array.from(container.querySelectorAll('canvas[data-area-id]')).map(
        (canvas) => (canvas as HTMLCanvasElement).dataset.areaId,
      ),
    ).toEqual(['main']);
    engine.destroy();
  });
});

describe('PreviewEngine: the picture listener', () => {
  it('hands over the front video on each drawn picture, and now when one shows', () => {
    const { engine, v0 } = setup([part('a', 10_000, 14_000)], { settle: false });
    const early = jest.fn();
    const stopEarly = engine.onPicture(early);
    // Nothing is showing until the first seek lands.
    expect(early).not.toHaveBeenCalled();
    v0.finishSeek();
    expect(early).toHaveBeenCalledTimes(1);
    expect(early).toHaveBeenLastCalledWith(v0.el);

    const late = jest.fn();
    engine.onPicture(late);
    expect(late).toHaveBeenCalledTimes(1);

    engine.play();
    v0.presentFrame(11_000);
    expect(early).toHaveBeenCalledTimes(2);
    expect(late).toHaveBeenCalledTimes(2);

    stopEarly();
    v0.presentFrame(11_100);
    expect(early).toHaveBeenCalledTimes(2);
    expect(late).toHaveBeenCalledTimes(3);
    engine.destroy();
  });

  it('keeps drawing when a listener throws, and is silent after destroy', () => {
    const container = document.createElement('div');
    const { engine, v0 } = setup([part('a', 10_000, 14_000)]);
    engine.attach(container);
    const broken = jest.fn(() => {
      throw new Error('pane gone');
    });
    const fine = jest.fn();
    engine.onPicture(broken);
    engine.onPicture(fine);
    engine.play();
    expect(() => v0.presentFrame(11_000)).not.toThrow();
    expect(fine).toHaveBeenCalledTimes(2);
    expect(engine.getSnapshot().error).toBeNull();

    engine.destroy();
    const after = jest.fn();
    expect(engine.onPicture(after)).toEqual(expect.any(Function));
    v0.presentFrame(11_100);
    expect(after).not.toHaveBeenCalled();
    expect(fine).toHaveBeenCalledTimes(2);
  });
});

describe('PreviewEngine: destroy', () => {
  it('removes every listener, element and frame callback', () => {
    const container = document.createElement('div');
    const { engine, v0, v1, frames } = setup([
      part('a', 10_000, 12_000),
      part('b', 40_000, 42_000),
    ]);
    engine.attach(container);
    engine.play();
    engine.setScrubbing(true);
    engine.seek(100);
    expect(v0.totalListeners).toBeGreaterThan(0);
    const listener = jest.fn();
    engine.subscribe(listener);

    engine.destroy();
    expect(v0.totalListeners).toBe(0);
    expect(v1.totalListeners).toBe(0);
    expect(v0.pendingFrameCallbacks).toBe(0);
    expect(frames.pending).toBe(0);
    expect(container.childElementCount).toBe(0);
    expect(v0.el.isConnected).toBe(false);
    expect(v0.el.hasAttribute('src')).toBe(false);
    expect(engine.isDestroyed).toBe(true);

    // Nothing happens after.
    engine.play();
    engine.seek(500);
    v0.presentFrame(11_000);
    expect(listener).not.toHaveBeenCalled();
  });
});
