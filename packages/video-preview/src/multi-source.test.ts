/**
 * Sprint 13, Module 10 (and Module 11's montage): a clip whose parts come
 * from more than one video. A brand kit's intro (video B) opens the clip,
 * the main video (A) plays in the middle, and its outro (video C) closes
 * it. Each element holds the address of the part it is placed on; the back
 * one loads the next part's video ahead of the join.
 *
 * The fakes run with `loadOnSrc`: setting `src` resets the element as a
 * browser does, so a seek waits for `loadMetadata()`.
 */
import { type ClipDocument, frameState } from '@postgear/video-engine';
import { PreviewEngine, type PreviewEngineOptions } from './preview-engine';
import {
  CENTRED_VERTICAL_CROP,
  clipOf,
  FakeFrames,
  type FakeVideo,
  fakeVideoFactory,
  fullFrameOverride,
  part,
  partFrom,
  TEST_VIDEO_ID,
} from './testing';
import type { AudioLayer, PreviewSource } from './types';

const URL_A = 'https://storage.example/main.mp4?sig=a';
const URL_B = 'https://storage.example/intro.mp4?sig=b';
const URL_C = 'https://storage.example/outro.mp4?sig=c';
const URL_C2 = 'https://storage.example/outro.mp4?sig=c2';

const INTRO_VIDEO_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OUTRO_VIDEO_ID = '1b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';

/** Intro 0..2000 (B 0..2000), main 2000..6000 (A 10000..14000), outro 6000..7500 (C 0..1500). */
function brandedClip(): ClipDocument {
  return clipOf(
    [
      partFrom('intro', 'i', 0, 2_000, {
        role: 'intro',
        layoutOverride: fullFrameOverride('intro-video'),
      }),
      partFrom('src', 'm', 10_000, 14_000),
      partFrom('outro', 'o', 0, 1_500, {
        role: 'outro',
        layoutOverride: fullFrameOverride('outro-video'),
      }),
    ],
    {
      sources: [
        { id: 'src', videoId: TEST_VIDEO_ID },
        { id: 'intro', videoId: INTRO_VIDEO_ID },
        { id: 'outro', videoId: OUTRO_VIDEO_ID },
      ],
    },
  );
}

const EXTRAS: Record<string, PreviewSource | null> = {
  intro: { url: URL_B, fps: 30 },
  outro: { url: URL_C, fps: 25 },
};

interface Setup {
  engine: PreviewEngine;
  v0: FakeVideo;
  v1: FakeVideo;
  frames: FakeFrames;
  log: string[];
}

/**
 * The engine on the branded clip, both elements loaded and settled: the
 * front (v0) on the intro's start in video B, the back (v1) on the main
 * part's start in video A.
 */
function setup(
  options: { doc?: ClipDocument; settle?: boolean } & Partial<PreviewEngineOptions> = {},
): Setup {
  const { doc = brandedClip(), settle = true, ...engineOptions } = options;
  const factory = fakeVideoFactory({ loadOnSrc: true });
  const frames = new FakeFrames();
  const engine = new PreviewEngine({
    createVideo: factory.create,
    frames,
    document: doc,
    source: { url: URL_A, fps: 30 },
    extraSources: EXTRAS,
    ...engineOptions,
  });
  const [v0, v1] = factory.videos as [FakeVideo, FakeVideo];
  if (settle) {
    v0.loadMetadata(1080, 1920);
    v1.loadMetadata(1280, 720);
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

describe('PreviewEngine: parts from more than one video', () => {
  it('loads each part its own video: the front on the intro, the back on the main part', () => {
    const { engine, v0, v1, log } = setup({ settle: false });
    // The main address goes to both, then the front moves to the intro's own video.
    expect(log).toEqual([`v0:src ${URL_A}`, `v1:src ${URL_A}`, `v0:src ${URL_B}`]);
    v0.loadMetadata(1080, 1920);
    v1.loadMetadata(1280, 720);
    expect(after(log, 3)).toEqual(['v0:seek 0', 'v1:seek 10000']);
    v0.finishSeek();
    v1.finishSeek();
    expect(engine.getSnapshot()).toMatchObject({
      ready: true,
      error: null,
      durationMs: 7_500,
      currentMs: 0,
    });
    expect(v0.el.getAttribute('src')).toBe(URL_B);
    expect(v1.el.getAttribute('src')).toBe(URL_A);
  });

  it('plays intro, main and outro in order, handing over between the videos', () => {
    const cutFadeIn = jest.fn(() => true);
    const audioLayer: AudioLayer = {
      update: jest.fn(),
      silence: jest.fn(),
      destroy: jest.fn(),
      cutFadeIn,
    };
    const { engine, v0, v1, log } = setup({ audioLayer });

    engine.play();
    v0.presentFrame(1_000);
    expect(engine.getSnapshot().currentMs).toBe(1_000);

    let mark = log.length;
    v0.presentFrame(2_000);
    // Main starts on v1; v0 pauses and loads the outro's video for the next join.
    expect(after(log, mark)).toEqual(['v1:play', 'v0:pause', `v0:src ${URL_C}`]);
    expect(engine.videos[0]).toBe(v1.el);
    expect(cutFadeIn).toHaveBeenLastCalledWith(v1.el, 1);
    expect(engine.getSnapshot()).toMatchObject({
      currentMs: 2_000,
      playing: true,
      buffering: false,
    });

    v1.presentFrame(12_000);
    expect(engine.getSnapshot().currentMs).toBe(4_000);

    // The outro's video arrives while main plays: its seek is made then.
    mark = log.length;
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    expect(after(log, mark)).toEqual(['v0:seek 0', 'v0:seeked 0']);

    mark = log.length;
    v1.presentFrame(14_000);
    expect(after(log, mark)).toEqual(['v0:play', 'v1:pause']);
    expect(engine.videos[0]).toBe(v0.el);
    expect(cutFadeIn).toHaveBeenCalledTimes(2);
    expect(cutFadeIn).toHaveBeenLastCalledWith(v0.el, 1);
    expect(engine.getSnapshot().currentMs).toBe(6_000);

    v0.presentFrame(750);
    expect(engine.getSnapshot().currentMs).toBe(6_750);
    v0.presentFrame(1_500);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 7_500 });
  });

  it('holds at the join while the next video is still loading, then hands over', () => {
    const { engine, v0, v1, log } = setup();
    engine.play();
    v0.presentFrame(2_000);
    v1.presentFrame(14_000);
    // The outro's video has not arrived: the last frame of main holds.
    expect(engine.getSnapshot()).toMatchObject({
      playing: true,
      buffering: true,
      currentMs: 6_000,
    });
    expect(engine.videos[0]).toBe(v1.el);

    const mark = log.length;
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    expect(after(log, mark)).toEqual(['v0:seek 0', 'v0:seeked 0', 'v0:play']);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, buffering: false });
    v0.presentFrame(500);
    expect(engine.getSnapshot().currentMs).toBe(6_500);
  });

  it('seeks into the outro and into the intro on their own videos, and back into main', () => {
    const { engine, v0, v1, log } = setup();

    let mark = log.length;
    engine.seek(6_500);
    expect(after(log, mark)).toEqual([`v0:src ${URL_C}`]);
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    expect(after(log, mark)).toEqual([`v0:src ${URL_C}`, 'v0:seek 500', 'v0:seeked 500']);
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 6_500, ready: true, error: null });

    mark = log.length;
    engine.seek(1_250);
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    // The back element still waits on main's start: nothing to redo there.
    expect(after(log, mark)).toEqual([`v0:src ${URL_B}`, 'v0:seek 1250', 'v0:seeked 1250']);
    expect(v1.el.getAttribute('src')).toBe(URL_A);

    // Playing on from the intro hands over to main as usual.
    engine.play();
    v0.presentFrame(2_000);
    expect(engine.videos[0]).toBe(v1.el);
    v1.presentFrame(11_000);
    expect(engine.getSnapshot().currentMs).toBe(3_000);

    // Into main from a pause: the front stays on video A, the back loads C.
    engine.pause();
    mark = log.length;
    engine.seek(4_500);
    expect(after(log, mark)).toEqual(['v1:seek 12500']);
    expect(v0.el.getAttribute('src')).toBe(URL_C);
  });

  it('scrubs across the videos, one seek a frame, and lands on the right one', () => {
    const { engine, v0, frames, log } = setup();
    engine.setScrubbing(true);
    expect(v0.el.muted).toBe(true);

    const mark = log.length;
    engine.seek(1_000);
    frames.flush();
    expect(after(log, mark)).toEqual(['v0:seek 1000']);
    v0.finishSeek();

    // Across into main: the front loads video A, the back the outro's video C.
    engine.seek(3_000);
    frames.flush();
    expect(after(log, mark).slice(-2)).toEqual([`v0:src ${URL_A}`, `v1:src ${URL_C}`]);
    v0.loadMetadata(1280, 720);
    expect(after(log, mark).slice(-1)).toEqual(['v0:seek 11000']);
    v0.finishSeek();

    // Across into the outro, then let go there.
    engine.seek(7_000);
    engine.setScrubbing(false);
    expect(after(log, mark).slice(-1)).toEqual([`v0:src ${URL_C}`]);
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 7_000, scrubbing: false });
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    expect(after(log, mark).slice(-2)).toEqual(['v0:seek 1000', 'v0:seeked 1000']);
    expect(engine.getSnapshot()).toMatchObject({ ready: true, error: null });
    expect(v0.el.muted).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('keeps an equal map without reloading, and reloads only a changed address', () => {
    const { engine, v0, v1, log } = setup();
    let mark = log.length;
    engine.setExtraSources({ intro: { url: URL_B, fps: 30 }, outro: { url: URL_C, fps: 25 } });
    expect(after(log, mark)).toEqual([]);

    // A fresh outro address while the playhead is in the intro: nothing on screen reloads.
    mark = log.length;
    engine.setExtraSources({ intro: { url: URL_B, fps: 30 }, outro: { url: URL_C2, fps: 25 } });
    expect(after(log, mark)).toEqual([]);
    expect(v0.el.getAttribute('src')).toBe(URL_B);
    expect(v1.el.getAttribute('src')).toBe(URL_A);

    // In the outro, a fresh address loads at the same moment.
    engine.seek(6_500);
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    expect(v0.el.getAttribute('src')).toBe(URL_C2);
    mark = log.length;
    engine.setExtraSources({ intro: { url: URL_B, fps: 30 }, outro: { url: URL_C, fps: 25 } });
    v0.loadMetadata(1080, 1920);
    v0.finishSeek();
    expect(after(log, mark)).toEqual([`v0:src ${URL_C}`, 'v0:seek 500', 'v0:seeked 500']);
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 6_500, ready: true });
  });
});

describe('PreviewEngine: another video that cannot play', () => {
  it('reports missing_source for a part whose video has no address, and clears it away from it', () => {
    const { engine, v0, v1 } = setup({ extraSources: { intro: { url: URL_B }, outro: null } });
    expect(engine.getSnapshot().error).toBeNull();

    engine.seek(6_500);
    expect(engine.getSnapshot()).toMatchObject({
      currentMs: 6_500,
      playing: false,
      ready: false,
      error: { code: 'missing_source' },
    });
    // Play is refused there.
    engine.play();
    expect(engine.getSnapshot().playing).toBe(false);

    // Back into main: the error goes, and the picture comes back from video A.
    engine.seek(3_000);
    expect(engine.getSnapshot().error).toBeNull();
    v0.loadMetadata(1280, 720);
    v0.finishSeek();
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 3_000, ready: true });
    expect(v1.el.getAttribute('src')).toBe(URL_A);
  });

  it('stops at the join into a part with no address, and plays it once it has one', () => {
    const { engine, v0, v1 } = setup({ extraSources: { intro: { url: URL_B }, outro: null } });
    engine.play();
    v0.presentFrame(2_000);
    v1.presentFrame(14_000);
    expect(engine.getSnapshot()).toMatchObject({
      playing: false,
      buffering: false,
      currentMs: 6_000,
      error: { code: 'missing_source' },
    });
    expect(v1.isPlaying).toBe(false);

    engine.setExtraSources({ intro: { url: URL_B }, outro: { url: URL_C } });
    expect(engine.getSnapshot().error).toBeNull();
    const front = engine.videos[0];
    expect(front.getAttribute('src')).toBe(URL_C);
    const fake = front === v0.el ? v0 : v1;
    fake.loadMetadata(1080, 1920);
    fake.finishSeek();
    expect(engine.getSnapshot()).toMatchObject({ currentMs: 6_000, ready: true, error: null });
  });

  it('names an expired address of another video', () => {
    const { engine } = setup({
      extraSources: { intro: { url: URL_B }, outro: { url: URL_C, expiresAt: Date.now() - 1_000 } },
    });
    engine.seek(7_000);
    expect(engine.getSnapshot().error?.code).toBe('source_expired');
    engine.setExtraSources({
      intro: { url: URL_B },
      outro: { url: URL_C2, expiresAt: Date.now() + 60_000 },
    });
    expect(engine.getSnapshot().error).toBeNull();
  });

  it('remembers a failed load ahead of the join and reports it when the playhead gets there', () => {
    const { engine, v0, v1 } = setup();
    engine.play();
    v0.presentFrame(2_000);
    // v0 now loads the outro, which fails while main plays: main carries on.
    v0.fail(4);
    expect(engine.getSnapshot()).toMatchObject({ playing: true, error: null });
    v1.presentFrame(13_000);
    expect(engine.getSnapshot().currentMs).toBe(5_000);

    v1.presentFrame(14_000);
    expect(engine.getSnapshot()).toMatchObject({
      playing: false,
      currentMs: 6_000,
      error: { code: 'unsupported' },
    });

    // The same address again is a retry.
    engine.setExtraSources({ ...EXTRAS });
    expect(engine.getSnapshot().error).toBeNull();
  });

  it('reports an expired address that failed on screen as expired', () => {
    const expiresAt = Date.now() + 60_000;
    const { engine, v0 } = setup({
      extraSources: { intro: { url: URL_B, expiresAt }, outro: { url: URL_C } },
    });
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

describe('PreviewEngine: sound across the videos', () => {
  it('mutes a bleep in the main part on whichever element plays it', () => {
    const doc = brandedClip();
    // Main's 11000..11500 is the clip's 3000..3500.
    doc.bleeps = [
      { id: 'b1', source: 'src', from: 11_000, to: 11_500, mode: 'mute' },
    ] as ClipDocument['bleeps'];
    const setBleeps = jest.fn();
    const { engine, v0, v1 } = setup({ doc });
    engine.play();
    v0.presentFrame(2_000);
    expect(engine.videos[0]).toBe(v1.el);
    v1.presentFrame(11_200);
    expect(v1.el.volume).toBe(0);
    v1.presentFrame(12_000);
    expect(v1.el.volume).toBe(1);

    const layered = setup({
      doc,
      audioLayer: { update: jest.fn(), silence: jest.fn(), destroy: jest.fn(), setBleeps },
    });
    expect(setBleeps).toHaveBeenLastCalledWith([
      expect.objectContaining({ fromMs: 3_000, toMs: 3_500, mode: 'mute' }),
    ]);
    layered.engine.destroy();
  });

  it('hands the layer both elements once, whatever videos they load', () => {
    const attachVideos = jest.fn();
    const { engine, v0, v1 } = setup({
      audioLayer: { update: jest.fn(), silence: jest.fn(), destroy: jest.fn(), attachVideos },
    });
    engine.play();
    v0.presentFrame(2_000);
    v1.presentFrame(14_000);
    expect(attachVideos).toHaveBeenCalledTimes(1);
    expect(attachVideos).toHaveBeenCalledWith([v0.el, v1.el]);
  });
});

describe('PreviewEngine: each part draws its own picture', () => {
  it('reads each video at its own size, and a part with its own layout draws that layout', () => {
    const container = document.createElement('div');
    const doc = brandedClip();
    const { engine, v0, v1 } = setup({ doc });
    engine.attach(container);

    // The intro's own layout: its whole 1080 by 1920 picture, one area.
    const introState = frameState(doc, 500, {
      sources: { intro: { width: 1080, height: 1920, fps: 30 } },
    });
    expect(introState.areas.map((area) => area.id)).toEqual(['intro-video']);
    const introCanvas = container.querySelector(
      'canvas[data-area-id="intro-video"]',
    ) as HTMLCanvasElement | null;
    expect(introCanvas).not.toBeNull();
    const intro = contexts.find((context) => context.canvas === introCanvas);
    const [video, sx, sy, sw, sh] = intro?.drawImage.mock.calls.at(-1) ?? [];
    expect(video).toBe(v0.el);
    expect([sx, sy, sw, sh]).toEqual([0, 0, 1080, 1920]);

    // Main: the clip's own layout on video A's 1280 by 720.
    engine.play();
    v0.presentFrame(2_000);
    v1.presentFrame(11_000);
    const mainCanvas = container.querySelector(
      'canvas[data-area-id="main"]',
    ) as HTMLCanvasElement | null;
    const main = contexts.find((context) => context.canvas === mainCanvas);
    const [mainVideo, mx, , mw, mh] = main?.drawImage.mock.calls.at(-1) ?? [];
    expect(mainVideo).toBe(v1.el);
    expect(mx).toBeCloseTo(CENTRED_VERTICAL_CROP.x * 1280, 5);
    expect(mw).toBeCloseTo(CENTRED_VERTICAL_CROP.w * 1280, 5);
    expect(mh).toBe(720);
    engine.destroy();
  });
});

describe('PreviewEngine: one video, with extra sources around', () => {
  it('plays a single-video clip exactly as before when the map names other ids', () => {
    const factory = fakeVideoFactory();
    const engine = new PreviewEngine({
      createVideo: factory.create,
      frames: new FakeFrames(),
      document: clipOf([part('a', 10_000, 12_000), part('b', 40_000, 42_000)]),
      source: { url: URL_A, fps: 30 },
      extraSources: { elsewhere: { url: URL_B } },
    });
    const [v0, v1] = factory.videos as [FakeVideo, FakeVideo];
    v0.loadMetadata();
    v1.loadMetadata();
    v0.finishSeek();
    v1.finishSeek();
    expect(factory.log).toEqual([
      'v0:seek 10000',
      'v1:seek 40000',
      'v0:seeked 10000',
      'v1:seeked 40000',
    ]);
    engine.play();
    const mark = factory.log.length;
    v0.presentFrame(12_000);
    expect(after(factory.log, mark)).toEqual(['v1:play', 'v0:pause']);
    expect(v0.el.getAttribute('src')).toBe(URL_A);
    expect(v1.el.getAttribute('src')).toBe(URL_A);
  });
});
