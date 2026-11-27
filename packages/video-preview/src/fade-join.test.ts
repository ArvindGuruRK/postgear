/**
 * Sprint 13, Module 11: a montage's Fade join in the preview. The parts
 * overlap by 300 ms; the hand-over is made at the overlap's start, both
 * videos play through it, and the stage draws the other side's picture over
 * the areas at the join's share (a quick mix; Preview Export is exact).
 * Several captions tracks each show on their own parts.
 */
import {
  builtInCaptionStyle,
  type CaptionLook,
  type ClipDocument,
  captionLayout,
  createCaptionsTrack,
  createClipDocument,
  createMontage,
  captionsTracksOf,
  frameState,
  type Transcript,
  withCaptionsTrack,
} from '@postgear/video-engine';
import { DomOverlayLayer } from './dom-overlay-layer';
import { handoverMs, partAt, previewParts } from './parts';
import { PreviewEngine } from './preview-engine';
import { clipOf, FakeFrames, type FakeVideo, fakeVideoFactory, part } from './testing';

const URL = 'https://storage.example/main.mp4?sig=a';

/** Part a: 10..14 s of the video (clip 0..4 s); part b: 20..24 s, a Fade before it (clip 3.7..7.7 s). */
function faded(): ClipDocument {
  return {
    ...clipOf([part('a', 10_000, 14_000), part('b', 20_000, 24_000, 1, 0.5)]),
    joins: [{ beforeSegment: 'b', kind: 'fade', ms: 300 }],
  };
}

interface Recorded {
  canvas: HTMLCanvasElement;
  drawImage: jest.Mock;
}
const contexts: Recorded[] = [];

beforeEach(() => {
  contexts.length = 0;
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const context = { drawImage: jest.fn(), fillRect: jest.fn(), fillStyle: '', canvas: this };
    contexts.push(context);
    return context as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = '';
});

function setup(doc: ClipDocument = faded()) {
  const factory = fakeVideoFactory();
  const engine = new PreviewEngine({
    createVideo: factory.create,
    frames: new FakeFrames(),
    document: doc,
    source: { url: URL, fps: 30 },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  engine.attach(container);
  const [v0, v1] = factory.videos as [FakeVideo, FakeVideo];
  v0.loadMetadata(1280, 720);
  v1.loadMetadata(1280, 720);
  v0.finishSeek();
  v1.finishSeek();
  const mixCanvas = container.querySelector<HTMLCanvasElement>('[data-preview-layer="mix"]');
  const mixDraws = () =>
    contexts.find((context) => context.canvas === mixCanvas)?.drawImage.mock.calls ?? [];
  return { engine, v0, v1, mixCanvas, mixDraws, log: factory.log };
}

describe('the preview parts of a Fade join', () => {
  it('overlap, never continue on one element, and answer by the overlap middle', () => {
    // Even a part that carries straight on from the last is handed over at a Fade.
    const doc: ClipDocument = {
      ...clipOf([part('a', 10_000, 14_000), part('b', 14_000, 18_000)]),
      joins: [{ beforeSegment: 'b', kind: 'fade', ms: 300 }],
    };
    const parts = previewParts(doc);
    expect(parts.map((p) => [p.outStart, p.outEnd, p.overlapMs, p.continuesPrevious])).toEqual([
      [0, 4_000, 0, false],
      [3_700, 7_700, 300, false],
    ]);
    expect(partAt(parts, 3_849)?.id).toBe('a');
    expect(partAt(parts, 3_850)?.id).toBe('b');
    expect(handoverMs(parts, parts[0] as (typeof parts)[number])).toBe(3_700);
    expect(handoverMs(parts, parts[1] as (typeof parts)[number])).toBe(7_700);
  });
});

describe('PreviewEngine: a Fade join', () => {
  it('hands over at the overlap start and plays both videos through it, mixing the pictures', () => {
    const { engine, v0, v1, mixCanvas, mixDraws, log } = setup();
    expect(engine.getSnapshot().durationMs).toBe(7_700);
    engine.play();
    v0.presentFrame(12_000);
    expect(engine.getSnapshot().currentMs).toBe(2_000);
    expect(mixCanvas?.style.display).toBe('none');

    // 13.7 s of the video is the overlap's start: part b starts on v1, v0 plays on.
    const mark = log.length;
    v0.presentFrame(13_700);
    expect(log.slice(mark)).toEqual(['v1:play']);
    expect(v0.isPlaying && v1.isPlaying).toBe(true);
    expect(engine.videos[0]).toBe(v1.el);
    expect(engine.getSnapshot().currentMs).toBe(3_700);

    // A fifth of the way in: part a is the main picture (from v0), b drawn over it at 0.2.
    v1.presentFrame(20_060);
    expect(engine.getSnapshot().currentMs).toBe(3_760);
    expect(mixCanvas?.style.display).toBe('block');
    expect(Number(mixCanvas?.style.opacity)).toBeCloseTo(0.2, 3);
    expect(mixDraws().at(-1)?.[0]).toBe(v1.el);
    // The sounds cross: b (volume 0.5) at 0.2 of its gain, a at 0.8.
    expect(v1.el.volume).toBeCloseTo(0.1, 6);
    expect(v0.el.volume).toBeCloseTo(0.8, 6);

    // Past the middle: b is the main picture, a drawn over it at what is left of it.
    v1.presentFrame(20_240);
    expect(Number(mixCanvas?.style.opacity)).toBeCloseTo(0.2, 3);
    expect(mixDraws().at(-1)?.[0]).toBe(v0.el);
    expect(frameState(faded(), 3_940).segment.id).toBe('b');

    // The overlap's end: v0 pauses, the mix goes, b plays alone at its own volume.
    v1.presentFrame(20_300);
    expect(v0.isPlaying).toBe(false);
    expect(mixCanvas?.style.display).toBe('none');
    expect(v1.el.volume).toBeCloseTo(0.5, 6);
    v1.presentFrame(24_000);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 7_700 });
  });

  it('a pause inside the overlap stops the mix and shows one picture', () => {
    const { engine, v0, v1, mixCanvas } = setup();
    engine.play();
    v0.presentFrame(13_700);
    v1.presentFrame(20_100);
    expect(mixCanvas?.style.display).toBe('block');
    engine.pause();
    expect(v0.isPlaying || v1.isPlaying).toBe(false);
    expect(mixCanvas?.style.display).toBe('none');
    expect(engine.getSnapshot().currentMs).toBe(3_800);
  });

  it('a seek into the overlap second half shows the incoming part', () => {
    const { engine, v0, log } = setup();
    const mark = log.length;
    engine.seek(3_900);
    // b at 200 ms in: 20.2 s of the video (no join after it, so the back element stays).
    expect(log.slice(mark)).toEqual(['v0:seek 20200']);
    v0.finishSeek();
    expect(engine.getSnapshot().currentMs).toBe(3_900);
  });

  it('plays a montage made by the engine, cut or faded, to its own length', () => {
    const a = createClipDocument({
      videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4',
      fromMs: 10_000,
      toMs: 14_000,
      ratio: '9:16',
    });
    const b = createClipDocument({
      videoId: '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4',
      fromMs: 20_000,
      toMs: 24_000,
      ratio: '9:16',
    });
    const result = createMontage(
      [
        { id: 'c1', title: 'One', document: a },
        { id: 'c2', title: 'Two', document: b },
      ],
      { transition: 'fade' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { engine, v0, v1 } = setup(result.document);
    engine.play();
    v0.presentFrame(13_700);
    expect(v1.isPlaying).toBe(true);
    v1.presentFrame(24_000);
    expect(engine.getSnapshot()).toMatchObject({ playing: false, currentMs: 7_700 });
  });
});

describe('several captions tracks in the overlay layer', () => {
  const look = (id: string): CaptionLook => (builtInCaptionStyle(id) as { look: CaptionLook }).look;
  const VIDEO_A = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
  const VIDEO_B = '7a2d3c9f-4e5b-4c6d-8e7f-8091a2b3c4d5';
  const spoken = (texts: string[], from: number): Transcript => ({
    version: 1,
    language: 'en',
    model: 'test',
    source: 'listened',
    covered: [{ fromMs: 0, toMs: 60_000 }],
    words: texts.map((text, i) => ({
      i,
      start: from + i * 400,
      end: from + i * 400 + 320,
      text,
      sure: 1,
    })),
    nextIndex: texts.length,
  });
  const captioned = (videoId: string, fromMs: number, transcriptAssetId: string) =>
    withCaptionsTrack(
      createClipDocument({ videoId, fromMs, toMs: fromMs + 4_000, ratio: '9:16' }),
      createCaptionsTrack({
        transcriptAssetId,
        language: 'en',
        styleId: 'bold-pop',
        look: look('bold-pop'),
      }),
    );

  it('draws each track on its own video parts, from one list of layouts', () => {
    const result = createMontage(
      [
        {
          id: 'c1',
          title: 'One',
          document: captioned(VIDEO_A, 10_000, '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'),
        },
        {
          id: 'c2',
          title: 'Two',
          document: captioned(VIDEO_B, 0, '2b3c4d5e-6f70-4b8c-9dae-1f2a3b4c5d6e'),
        },
      ],
      { transition: 'cut' },
    );
    if (!result.ok) throw new Error(result.code);
    const doc = result.document;
    const [trackA, trackB] = captionsTracksOf(doc);
    const layouts = [
      captionLayout({
        doc,
        track: trackA as never,
        look: look('bold-pop'),
        transcript: spoken(['alpha', 'beta'], 10_000),
        wordTimed: true,
      }),
      captionLayout({
        doc,
        track: trackB as never,
        look: look('bold-pop'),
        transcript: spoken(['gamma', 'delta'], 0),
        wordTimed: true,
      }),
    ];
    const host = document.createElement('div');
    document.body.appendChild(host);
    const layer = new DomOverlayLayer({ fontFamily: (name) => `"${name}"` });
    layer.mount(host);
    layer.setCaptions(layouts);
    const shown = () =>
      [...host.querySelectorAll<HTMLElement>('[data-preview-layer="captions"]')]
        .filter((block) => block.style.visibility === 'visible')
        .map((block) => block.textContent);
    const update = { reason: 'seek' as const, playing: false, scrubbing: false };

    layer.update(frameState(doc, 100), update);
    expect(shown()).toEqual(['ALPHA BETA']);
    layer.update(frameState(doc, 4_100), update);
    expect(shown()).toEqual(['GAMMA DELTA']);
    layer.update(frameState(doc, 3_000), update);
    expect(shown()).toEqual([]);

    layer.setCaptions(layouts.slice(0, 1));
    expect(host.querySelectorAll('[data-preview-layer="captions"]')).toHaveLength(1);
    layer.setCaptions(null);
    expect(host.querySelectorAll('[data-preview-layer="captions"]')).toHaveLength(0);
  });
});
