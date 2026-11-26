import {
  type Bleep,
  bleepRanges,
  type ClipDocument,
  type FrameState,
  type Segment,
} from '@postgear/video-engine';
import { WebAudioLayer } from './audio-layer';
import {
  BLEEP_TONE_GAIN,
  type BleepRange,
  bleepGateAt,
  bleepPlan,
  bleepWindows,
} from './bleep-schedule';
import { PreviewEngine } from './preview-engine';
import { clipOf, FakeFrames, type FakeVideo, fakeVideoFactory, part } from './testing';

const bleep = (fromMs: number, toMs: number, mode: BleepRange['mode'] = 'bleep'): BleepRange => ({
  id: `b${fromMs}`,
  mode,
  fromMs,
  toMs,
});

describe('the bleep arithmetic', () => {
  it('joins ranges whose ramps would meet and keeps each at least one ramp long', () => {
    expect(bleepWindows([bleep(2_000, 2_100), bleep(1_000, 1_200), bleep(1_203, 1_300)])).toEqual([
      { fromMs: 1_000, toMs: 1_300 },
      { fromMs: 2_000, toMs: 2_100 },
    ]);
    expect(bleepWindows([bleep(500, 502), bleep(900, 800)])).toEqual([{ fromMs: 500, toMs: 505 }]);
  });

  it('reads the gate with the export ramps: down after the start, up after the end', () => {
    const ranges = [bleep(1_000, 1_500)];
    expect(bleepGateAt(ranges, 999)).toBe(1);
    expect(bleepGateAt(ranges, 1_002.5)).toBeCloseTo(0.5, 9);
    expect(bleepGateAt(ranges, 1_200)).toBe(0);
    expect(bleepGateAt(ranges, 1_503)).toBeCloseTo(0.6, 9);
    expect(bleepGateAt(ranges, 1_505)).toBe(1);
  });

  it('plans a range ahead of the playhead on the context clock', () => {
    // Playhead at 400 ms heard at context time 10 s: 1000 ms is at 10.6 s.
    const plan = bleepPlan([bleep(1_000, 1_500)], 400, 10);
    expect(plan.gate).toEqual([
      { kind: 'set', value: 1, atS: 10 },
      { kind: 'set', value: 1, atS: 10.6 },
      { kind: 'ramp', value: 0, atS: expect.closeTo(10.605, 9) },
      { kind: 'set', value: 0, atS: expect.closeTo(11.1, 9) },
      { kind: 'ramp', value: 1, atS: expect.closeTo(11.105, 9) },
    ]);
    expect(plan.tones).toHaveLength(1);
    expect(plan.tones[0]?.startS).toBeCloseTo(10.6, 9);
    expect(plan.tones[0]?.stopS).toBeCloseTo(11.105, 9);
    expect(plan.tones[0]?.gain.map((e) => [e.kind, e.value])).toEqual([
      ['set', 0],
      ['set', 0],
      ['ramp', BLEEP_TONE_GAIN],
      ['set', BLEEP_TONE_GAIN],
      ['ramp', 0],
    ]);
  });

  it('starts muted, with the tone sounding, from the middle of a range', () => {
    const plan = bleepPlan([bleep(1_000, 1_500)], 1_200, 3);
    expect(plan.gate).toEqual([
      { kind: 'set', value: 0, atS: 3 },
      { kind: 'set', value: 0, atS: expect.closeTo(3.3, 9) },
      { kind: 'ramp', value: 1, atS: expect.closeTo(3.305, 9) },
    ]);
    expect(plan.tones[0]?.startS).toBe(3);
    expect(plan.tones[0]?.gain[0]).toEqual({ kind: 'set', value: BLEEP_TONE_GAIN, atS: 3 });
  });

  it('mutes without a tone in mute mode, and leaves out what is already over', () => {
    const plan = bleepPlan([bleep(100, 200), bleep(1_000, 1_500, 'mute')], 600, 0);
    expect(plan.tones).toEqual([]);
    expect(plan.gate).toHaveLength(5);
    expect(plan.gate[0]).toEqual({ kind: 'set', value: 1, atS: 0 });
  });

  it('maps source bleeps to output time through cuts and speed', () => {
    const doc = {
      segments: [part('a', 10_000, 12_000), part('b', 20_000, 24_000, 2)] as Segment[],
      bleeps: [
        { id: 'x', source: 'src', from: 11_800, to: 12_500, mode: 'bleep' },
        { id: 'y', source: 'src', from: 21_000, to: 21_400, mode: 'mute' },
      ] as Bleep[],
    };
    expect(bleepRanges(doc)).toEqual([
      { id: 'x', mode: 'bleep', fromMs: 1_800, toMs: 2_000 },
      { id: 'y', mode: 'mute', fromMs: 2_500, toMs: 2_700 },
    ]);
  });
});

// ---- A small fake Web Audio graph: the gate, the tones, and when each is scheduled. ----

type ParamCall = [string, number, number];

class FakeParam {
  value = 1;
  calls: ParamCall[] = [];
  cancelScheduledValues(at: number) {
    this.calls.push(['cancel', 0, at]);
  }
  setValueAtTime(value: number, at: number) {
    this.calls.push(['set', value, at]);
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.calls.push(['ramp', value, at]);
  }
}

class FakeNode {
  connected: unknown[] = [];
  connect(target: unknown) {
    this.connected.push(target);
    return target;
  }
  disconnect() {
    this.connected = [];
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeOscillator extends FakeNode {
  type = '';
  frequency = { value: 0 };
  onended: (() => void) | null = null;
  startAt: number | null = null;
  stopAt: number | null = null;
  stoppedNow = false;
  start(at: number) {
    this.startAt = at;
  }
  stop(at?: number) {
    if (at === undefined) this.stoppedNow = true;
    else this.stopAt = at;
  }
  /** Still able to sound: not stopped by hand, and still joined to the mix. */
  get live(): boolean {
    return !this.stoppedNow && (this.connected[0] as FakeGain | undefined)?.connected.length === 1;
  }
}

class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode();
  gains: FakeGain[] = [];
  oscillators: FakeOscillator[] = [];
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData() {} });
  }
  createOscillator() {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  createBufferSource() {
    throw new Error('no sounds in these tests');
  }
  createMediaElementSource() {
    return new FakeNode();
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** The gate is the gain node the master feeds from that is made right after the master. */
function gateOf(ctx: FakeContext): FakeParam {
  return (ctx.gains[1] as FakeGain).gain;
}

/** The calls made on a param since its last `cancel`. */
function lastPlan(param: FakeParam): ParamCall[] {
  const from = param.calls.map((c) => c[0]).lastIndexOf('cancel');
  return param.calls.slice(from + 1);
}

function frame(outputMs: number): FrameState {
  return { outputMs, sounds: [] } as unknown as FrameState;
}

describe('WebAudioLayer: bleeps', () => {
  let ctx: FakeContext;
  let layer: WebAudioLayer;

  beforeEach(() => {
    ctx = new FakeContext();
    layer = new WebAudioLayer({ createContext: () => ctx as unknown as AudioContext });
    layer.wake();
  });

  it('ramps the gate at the right context times for a range ahead of the playhead', () => {
    layer.setBleeps([bleep(1_000, 1_500)]);
    ctx.currentTime = 20;
    layer.update(frame(250), { reason: 'play', playing: true, scrubbing: false });
    const plan = lastPlan(gateOf(ctx));
    expect(plan.map(([kind, value]) => [kind, value])).toEqual([
      ['set', 1],
      ['set', 1],
      ['ramp', 0],
      ['set', 0],
      ['ramp', 1],
    ]);
    expect(plan.map(([, , at]) => at)).toEqual([
      20,
      expect.closeTo(20.75, 9),
      expect.closeTo(20.755, 9),
      expect.closeTo(21.25, 9),
      expect.closeTo(21.255, 9),
    ]);
    const [tone] = ctx.oscillators;
    expect(tone?.frequency.value).toBe(1_000);
    expect(tone?.startAt).toBeCloseTo(20.75, 9);
    expect(tone?.stopAt).toBeCloseTo(21.255, 9);
  });

  it('passes only the video sound through the gate', () => {
    const video = { crossOrigin: 'anonymous', volume: 1 } as unknown as HTMLVideoElement;
    layer.attachVideos([video]);
    const master = ctx.gains[0];
    const gate = ctx.gains[1];
    const routed = ctx.gains[2];
    expect(gate?.connected).toEqual([master]);
    expect(routed?.connected).toEqual([gate]);
    layer.setBleeps([bleep(0, 500)]);
    layer.update(frame(0), { reason: 'play', playing: true, scrubbing: false });
    // The tone goes to the mix, not through the gate.
    expect(ctx.oscillators[0]?.connected[0]).toBeInstanceOf(FakeGain);
    const toneGain = ctx.oscillators[0]?.connected[0] as FakeGain | undefined;
    expect(toneGain?.connected).toEqual([master]);
  });

  it('plays no tone in mute mode', () => {
    layer.setBleeps([bleep(1_000, 1_500, 'mute')]);
    layer.update(frame(0), { reason: 'play', playing: true, scrubbing: false });
    expect(ctx.oscillators).toHaveLength(0);
    expect(lastPlan(gateOf(ctx))).toHaveLength(5);
  });

  it('stops the tone and opens the gate on silence', () => {
    layer.setBleeps([bleep(0, 2_000)]);
    layer.update(frame(500), { reason: 'play', playing: true, scrubbing: false });
    expect(ctx.oscillators[0]?.live).toBe(true);
    ctx.currentTime = 0.3;
    layer.silence();
    expect(ctx.oscillators[0]?.live).toBe(false);
    expect(lastPlan(gateOf(ctx))).toEqual([['set', 1, 0.3]]);
  });

  it('plans again on a document change while playing, from where the playhead is now', () => {
    layer.setBleeps([bleep(1_000, 1_500)]);
    layer.update(frame(0), { reason: 'play', playing: true, scrubbing: false });
    ctx.currentTime = 0.4;
    layer.setBleeps([bleep(600, 900, 'mute')]);
    expect(ctx.oscillators[0]?.live).toBe(false);
    expect(ctx.oscillators).toHaveLength(1);
    expect(lastPlan(gateOf(ctx)).map(([, , at]) => at)).toEqual([
      0.4,
      expect.closeTo(0.6, 9),
      expect.closeTo(0.605, 9),
      expect.closeTo(0.9, 9),
      expect.closeTo(0.905, 9),
    ]);
  });

  it('keeps its plan on frames in step, and plans again when the picture drifts', () => {
    layer.setBleeps([bleep(1_000, 1_500)]);
    layer.update(frame(0), { reason: 'play', playing: true, scrubbing: false });
    ctx.currentTime = 0.5;
    layer.update(frame(520), { reason: 'frame', playing: true, scrubbing: false });
    expect(ctx.oscillators).toHaveLength(1);
    ctx.currentTime = 0.6;
    layer.update(frame(800), { reason: 'frame', playing: true, scrubbing: false });
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators[0]?.live).toBe(false);
    expect(ctx.oscillators[1]?.startAt).toBeCloseTo(0.8, 9);
  });

  it('lets go of every tone when destroyed', () => {
    layer.setBleeps([bleep(0, 2_000)]);
    layer.update(frame(0), { reason: 'play', playing: true, scrubbing: false });
    layer.destroy();
    expect(ctx.oscillators[0]?.live).toBe(false);
    expect(ctx.gains[1]?.connected).toEqual([]);
  });
});

// ---- The engine with the real layer. ----

function bleepedClip(mode: Bleep['mode'] = 'bleep'): ClipDocument {
  // Part a plays 10 s to 14 s of the video; the bleep is at 11.0 to 11.5 s, so 1.0 to 1.5 s of the clip.
  return {
    ...clipOf([part('a', 10_000, 14_000)]),
    bleeps: [{ id: 'w1', source: 'src', from: 11_000, to: 11_500, mode }],
  };
}

function engineSetup(crossOrigin: 'anonymous' | null = 'anonymous') {
  const ctx = new FakeContext();
  const layer = new WebAudioLayer({ createContext: () => ctx as unknown as AudioContext });
  const factory = fakeVideoFactory();
  const engine = new PreviewEngine({
    createVideo: factory.create,
    frames: new FakeFrames(),
    document: bleepedClip(),
    source: { url: 'https://storage.example/proxy.mp4?sig=a', fps: 30 },
    audioLayer: layer,
    crossOrigin,
  });
  const [v0, v1] = factory.videos as [FakeVideo, FakeVideo];
  v0.loadMetadata();
  v1.loadMetadata();
  v0.finishSeek();
  v1.finishSeek();
  return { ctx, engine, v0 };
}

describe('PreviewEngine: bleeps', () => {
  beforeEach(() => {
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(() => ({ drawImage: jest.fn() }) as unknown as CanvasRenderingContext2D);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('plans the bleep on Play and stops the tone on pause', () => {
    const { ctx, engine } = engineSetup();
    engine.play();
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0]?.startAt).toBeCloseTo(1, 9);
    expect(ctx.oscillators[0]?.live).toBe(true);
    engine.pause();
    expect(ctx.oscillators[0]?.live).toBe(false);
  });

  it('starts muted after a seek into the middle of a bleep', () => {
    const { ctx, engine, v0 } = engineSetup();
    engine.play();
    ctx.currentTime = 5;
    engine.seek(1_250);
    // The old plan's tone stops while the picture seeks.
    expect(ctx.oscillators[0]?.live).toBe(false);
    v0.finishSeek();
    expect(lastPlan(gateOf(ctx))[0]).toEqual(['set', 0, 5]);
    expect(ctx.oscillators[1]?.startAt).toBe(5);
    expect(ctx.oscillators[1]?.stopAt).toBeCloseTo(5.255, 9);
  });

  it('plans again on a document change: a mute has no tone', () => {
    const { ctx, engine } = engineSetup();
    engine.play();
    engine.setDocument(bleepedClip('mute'));
    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.oscillators[0]?.live).toBe(false);
    expect(lastPlan(gateOf(ctx))).toHaveLength(5);
  });

  it('mutes a video the layer does not carry through its own volume, frame by frame', () => {
    const { engine, v0 } = engineSetup(null);
    engine.play();
    v0.presentFrame(11_200);
    expect(engine.getSnapshot().currentMs).toBe(1_200);
    expect(v0.el.volume).toBe(0);
    v0.presentFrame(12_000);
    expect(v0.el.volume).toBe(1);
  });
});
