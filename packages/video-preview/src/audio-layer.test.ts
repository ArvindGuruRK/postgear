import type { FrameState, SoundState } from '@postgear/video-engine';
import { WebAudioLayer } from './audio-layer';
import { DRIFT_RESTART_MS, gainRamp, peakOf, soundDriftMs, soundStart } from './audio-model';

describe('the audio arithmetic', () => {
  it('starts music wrapped and an effect only inside its file', () => {
    expect(soundStart(3_500, 2, true)).toEqual({ offsetS: 1.5, durationS: null });
    expect(soundStart(500, 2, false)).toEqual({ offsetS: 0.5, durationS: 1.5 });
    expect(soundStart(2_000, 2, false)).toBeNull();
    expect(soundStart(100, 0, true)).toBeNull();
  });

  it('measures drift, across a loop wrap too', () => {
    // Started at offset 0.5 s at context time 10; at 11 s it should be at 1.5 s.
    expect(soundDriftMs(1_500, 0.5, 10, 11, 4, false)).toBeCloseTo(0, 9);
    expect(soundDriftMs(1_420, 0.5, 10, 11, 4, false)).toBeCloseTo(80, 9);
    // A 1 s loop: 1.98 s played is 0.98 s in; the picture says 0.02 s in (wrapped): 40 ms apart.
    expect(soundDriftMs(2_020, 0, 0, 1.98, 1, true)).toBeCloseTo(-40, 6);
  });

  it('ramps in a straight line to this frame gain, never below 0', () => {
    expect(gainRamp(0.2, 0.8, 5)).toEqual({ fromValue: 0.2, fromS: 5, toValue: 0.8, toS: 5.03 });
    expect(gainRamp(0.2, -1, 5).toValue).toBe(0);
    expect(gainRamp(0.2, Number.NaN, 5).toValue).toBe(0);
  });

  it('reads the loudest sample', () => {
    expect(peakOf([0.1, -0.7, 0.3])).toBeCloseTo(0.7, 12);
    expect(peakOf([])).toBe(0);
  });
});

// ---- A fake Web Audio graph: enough to see what starts, where, and at what gain. ----

class FakeParam {
  value = 1;
  events: Array<[string, number, number]> = [];
  cancelScheduledValues(at: number) {
    this.events.push(['cancel', 0, at]);
  }
  setValueAtTime(value: number, at: number) {
    this.events.push(['set', value, at]);
    this.value = value;
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.events.push(['ramp', value, at]);
    this.value = value;
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

class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  loop = false;
  started: Array<[number, number, number | undefined]> = [];
  stopped = false;
  onended: (() => void) | null = null;
  start(when: number, offset: number, duration?: number) {
    this.started.push([when, offset, duration]);
  }
  stop() {
    this.stopped = true;
  }
}

class FakeContext {
  currentTime = 0;
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  destination = new FakeNode();
  sources: FakeSource[] = [];
  routed: unknown[] = [];
  analyserData = new Float32Array([0.2, -1.3, 0.4]);
  createGain() {
    return new FakeGain();
  }
  createAnalyser() {
    const data = this.analyserData;
    return Object.assign(new FakeNode(), {
      fftSize: 3,
      getFloatTimeDomainData(target: Float32Array) {
        target.set(data);
      },
    });
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createMediaElementSource(el: unknown) {
    this.routed.push(el);
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

function state(sounds: SoundState[], at = 0): FrameState {
  return { outputMs: at, sounds } as unknown as FrameState;
}

function sound(overrides: Partial<SoundState> = {}): SoundState {
  return {
    id: 'fx',
    trackId: 'au',
    type: 'sfx',
    refKey: 'library:a',
    loop: false,
    gain: 0.5,
    fileMs: 0,
    ...overrides,
  };
}

async function flush() {
  for (let k = 0; k < 5; k += 1) await Promise.resolve();
}

describe('WebAudioLayer', () => {
  let ctx: FakeContext;
  let layer: WebAudioLayer;
  const fetched: string[] = [];

  beforeEach(async () => {
    ctx = new FakeContext();
    fetched.length = 0;
    layer = new WebAudioLayer({
      createContext: () => ctx as unknown as AudioContext,
      fetchBytes: async (url) => {
        fetched.push(url);
        return new ArrayBuffer(8);
      },
      decode: async () => ({ duration: url2duration() }) as unknown as AudioBuffer,
    });
    layer.setFiles([
      ['library:a', 'https://cdn.test/a.m4a'],
      ['asset:b', 'https://cdn.test/b.m4a'],
    ]);
    await flush();
  });

  let durations = [2, 4];
  function url2duration(): number {
    return durations.shift() ?? 1;
  }
  afterEach(() => {
    durations = [2, 4];
  });

  it('fetches and decodes each file once, ahead of Play', () => {
    expect(fetched).toEqual(['https://cdn.test/a.m4a', 'https://cdn.test/b.m4a']);
    expect(layer.hasBuffer('library:a')).toBe(true);
    layer.setFiles([['library:a', 'https://cdn.test/a-renewed.m4a']]);
    expect(fetched).toHaveLength(2);
  });

  it('plays nothing until the first Play wakes the context', () => {
    layer.update(state([sound()]), { reason: 'play', playing: true, scrubbing: false });
    expect(ctx.sources).toHaveLength(0);
    layer.wake();
    expect(ctx.state).toBe('running');
    layer.update(state([sound({ fileMs: 500 })]), {
      reason: 'play',
      playing: true,
      scrubbing: false,
    });
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0]?.started).toEqual([[0, 0.5, 1.5]]);
  });

  it('starts music looped and an effect for what is left of its file, each at its gain', () => {
    layer.wake();
    layer.update(
      state([
        sound({ fileMs: 500 }),
        sound({
          id: 'bed',
          type: 'music',
          refKey: 'asset:b',
          loop: true,
          fileMs: 9_000,
          gain: 0.2,
        }),
      ]),
      { reason: 'seek', playing: true, scrubbing: false },
    );
    const [fx, bed] = ctx.sources;
    expect(fx?.loop).toBe(false);
    expect(bed?.loop).toBe(true);
    expect(bed?.started).toEqual([[0, 1, undefined]]);
    const bedGain = bed?.connected[0] as FakeGain;
    expect(bedGain.gain.events.at(-1)).toEqual(['ramp', 0.2, 0.03]);
  });

  it('keeps a sound in step, ramps its gain, and starts it again when it drifts', () => {
    layer.wake();
    layer.update(state([sound({ fileMs: 0 })]), {
      reason: 'play',
      playing: true,
      scrubbing: false,
    });
    ctx.currentTime = 0.5;
    layer.update(state([sound({ fileMs: 500, gain: 0.25 })], 500), {
      reason: 'frame',
      playing: true,
      scrubbing: false,
    });
    expect(ctx.sources).toHaveLength(1);
    const gain = ctx.sources[0]?.connected[0] as FakeGain;
    expect(gain.gain.events.at(-1)).toEqual(['ramp', 0.25, 0.53]);
    ctx.currentTime = 1;
    layer.update(state([sound({ fileMs: 1_000 - DRIFT_RESTART_MS - 20 })], 1_000), {
      reason: 'frame',
      playing: true,
      scrubbing: false,
    });
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]?.stopped).toBe(true);
  });

  it('starts every sound again on a seek or a hand-over, and stops them all on silence', () => {
    layer.wake();
    layer.update(state([sound()]), { reason: 'play', playing: true, scrubbing: false });
    layer.update(state([sound({ fileMs: 300 })]), {
      reason: 'handover',
      playing: true,
      scrubbing: false,
    });
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]?.stopped).toBe(true);
    layer.silence();
    expect(ctx.sources[1]?.stopped).toBe(true);
    // A sound that left the frame state stops on the next frame.
    layer.update(state([sound()]), { reason: 'play', playing: true, scrubbing: false });
    layer.update(state([]), { reason: 'frame', playing: true, scrubbing: false });
    expect(ctx.sources[2]?.stopped).toBe(true);
  });

  it('routes only videos with crossOrigin set, and carries their gain up to 200%', () => {
    const corsVideo = { crossOrigin: 'anonymous', volume: 1 } as unknown as HTMLVideoElement;
    const plainVideo = { crossOrigin: null, volume: 1 } as unknown as HTMLVideoElement;
    layer.attachVideos([corsVideo, plainVideo]);
    expect(layer.videoGain(corsVideo, 1.5)).toBe(false);
    layer.wake();
    expect(ctx.routed).toEqual([corsVideo]);
    expect(layer.videoGain(corsVideo, 1.5)).toBe(true);
    expect(layer.videoGain(plainVideo, 1.5)).toBe(false);
  });

  it('starts the element after a cut silent and raises it over 15 ms', () => {
    const video = { crossOrigin: 'anonymous', volume: 1 } as unknown as HTMLVideoElement;
    layer.attachVideos([video]);
    expect(layer.cutFadeIn(video, 0.8)).toBe(false);
    layer.wake();
    ctx.currentTime = 4;
    expect(layer.cutFadeIn(video, 0.8)).toBe(true);
    const gain = (layer as unknown as { routed: Map<unknown, { gain: FakeGain }> }).routed.get(
      video,
    )?.gain.gain;
    expect(gain?.events.slice(-3)).toEqual([
      ['cancel', 0, 4],
      ['set', 0, 4],
      ['ramp', 0.8, 4.015],
    ]);
  });

  it('reads the meter from the mix', () => {
    expect(layer.level()).toBe(0);
    layer.wake();
    expect(layer.level()).toBeCloseTo(1.3, 6);
  });

  it('closes the context when destroyed, and keeps the decoded files for an engine made again', () => {
    layer.wake();
    layer.destroy();
    expect(ctx.state).toBe('closed');
    layer.update(state([sound()]), { reason: 'play', playing: true, scrubbing: false });
    expect(ctx.sources).toHaveLength(0);
    expect(layer.hasBuffer('library:a')).toBe(true);
    // StrictMode: the same layer under a second engine wakes a new context and plays.
    ctx = new FakeContext();
    layer.wake();
    layer.update(state([sound()]), { reason: 'play', playing: true, scrubbing: false });
    expect(ctx.sources).toHaveLength(1);
  });
});
