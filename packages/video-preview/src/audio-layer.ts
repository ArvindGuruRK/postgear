/**
 * The preview's sound (Module 14, research 05 sections 2 and 3): sound
 * effects and music through Web Audio, beside the picture.
 *
 * - Each sound file is fetched once (CORS: the API and the bucket answer the
 *   web app's origin) and decoded once into an `AudioBuffer` by an
 *   `OfflineAudioContext`, so nothing waits for a gesture and the browser
 *   never warns about a context started too early. A buffer belongs to no
 *   context, so the live one plays it.
 * - The live `AudioContext` is made on the first Play (`wake`, called
 *   inside the click), which is the gesture the browser asks for.
 * - Each sound is an `AudioBufferSourceNode` started at the buffer offset
 *   the frame state names (`soundStart`: music loops, an effect stops at its
 *   file's end) through its own `GainNode`, whose straight ramps follow the
 *   item's volume, its fades and the clip's fade (`FrameState.sounds[].gain`).
 *   Every seek, part hand-over and Play starts every sound again in place;
 *   while playing, a sound that slipped more than `DRIFT_RESTART_MS` from the
 *   picture's clock is started again too.
 * - The video's own sound goes through the same graph
 *   (`createMediaElementSource`), because `<video>.volume` stops at 1 and
 *   Video Volume goes to 200%. Only an element with `crossOrigin` set is
 *   routed (a cross-origin one without CORS would go silent); any other keeps
 *   its own volume, at most 100%.
 * - An `AnalyserNode` on the mix feeds the level meter (`level()`): a hint,
 *   not a measurement.
 *
 * `destroy()` lets go of the live context and the routed videos only: the
 * decoded files belong to no context, so an engine made again around the
 * same layer (React StrictMode mounts twice) plays them at once.
 *
 * The preview does no loudness correction: it sums the gains, so the balance
 * matches the export and the overall level does not (the Audio tab says so).
 */
import type { FrameState, SoundState } from '@postgear/video-engine';
import { gainRamp, peakOf, soundDriftMs, soundStart, DRIFT_RESTART_MS } from './audio-model';
import type { AudioLayer, LayerUpdate } from './types';

/** One playing sound. */
interface Playing {
  refKey: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAtS: number;
  offsetS: number;
  loop: boolean;
  bufferS: number;
}

/** A video element routed through the graph. */
interface RoutedVideo {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

type BufferState = AudioBuffer | 'loading' | 'failed';

export interface WebAudioLayerOptions {
  /** Makes the live context on the first Play (tests pass a fake; null when the browser has none). */
  createContext?: () => AudioContext | null;
  /** Decodes a file into a buffer (tests pass a fake). */
  decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  /** Fetches a file's bytes. */
  fetchBytes?: (url: string) => Promise<ArrayBuffer>;
}

function defaultContext(): AudioContext | null {
  const Ctor =
    typeof window !== 'undefined'
      ? (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

function defaultDecode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  if (typeof OfflineAudioContext === 'undefined') {
    return Promise.reject(new Error('This browser cannot decode sound'));
  }
  // The rate the export mixes at; a buffer of another rate is resampled when it plays.
  return new OfflineAudioContext(2, 1, 48_000).decodeAudioData(bytes);
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Sound file answered ${response.status}`);
  return response.arrayBuffer();
}

export class WebAudioLayer implements AudioLayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meterData: Float32Array<ArrayBuffer> | null = null;
  private readonly files = new Map<string, string>();
  private readonly buffers = new Map<string, BufferState>();
  private readonly playing = new Map<string, Playing>();
  private readonly routed = new Map<HTMLVideoElement, RoutedVideo>();
  private elements: HTMLVideoElement[] = [];
  private readonly createContext: () => AudioContext | null;
  private readonly decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
  private readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;

  constructor(options: WebAudioLayerOptions = {}) {
    this.createContext = options.createContext ?? defaultContext;
    this.decode = options.decode ?? defaultDecode;
    this.fetchBytes = options.fetchBytes ?? defaultFetch;
  }

  /**
   * The address of each sound file the clip plays, by `soundRefKey`. A new
   * address for a known key (a signed address renewed) keeps its buffer;
   * every file is fetched and decoded ahead, so Play finds it ready.
   */
  setFiles(files: Iterable<readonly [string, string]>): void {
    for (const [key, url] of files) {
      if (!url) continue;
      this.files.set(key, url);
      if (!this.buffers.has(key)) void this.load(key);
    }
  }

  /** Whether a sound's file is decoded (for tests and the editor's waiting state). */
  hasBuffer(refKey: string): boolean {
    const buffer = this.buffers.get(refKey);
    return buffer !== undefined && typeof buffer !== 'string';
  }

  /** The engine's two video elements; routed through the graph on the first Play. */
  attachVideos(elements: readonly HTMLVideoElement[]): void {
    this.elements = [...elements];
    if (this.ctx) this.routeVideos();
  }

  /** Called inside the Play click: makes or resumes the live context. */
  wake(): void {
    if (!this.ctx) {
      let made: AudioContext | null = null;
      try {
        made = this.createContext();
      } catch {
        made = null;
      }
      if (!made) return;
      this.ctx = made;
      this.master = made.createGain();
      this.analyser = made.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser);
      this.analyser.connect(made.destination);
      this.routeVideos();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  /**
   * Sets the video's own gain (the part's volume times the clip's fade) on a
   * routed element; false when the element is not routed, and the engine
   * then uses the element's own volume.
   */
  videoGain(el: HTMLVideoElement, gain: number): boolean {
    const routed = this.routed.get(el);
    if (!routed || !this.ctx) return false;
    this.ramp(routed.gain, gain);
    return true;
  }

  update(state: FrameState, update: LayerUpdate): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    const restart = update.reason !== 'frame';
    const wanted = new Map<string, SoundState>(state.sounds.map((sound) => [sound.id, sound]));

    for (const [id, playing] of this.playing) {
      const sound = wanted.get(id);
      if (restart || !sound || sound.refKey !== playing.refKey) this.stop(id);
    }

    for (const sound of state.sounds) {
      const buffer = this.buffers.get(sound.refKey);
      if (buffer === undefined) {
        void this.load(sound.refKey);
        continue;
      }
      if (typeof buffer === 'string') continue;
      const playing = this.playing.get(sound.id);
      if (playing) {
        const drift = soundDriftMs(
          sound.fileMs,
          playing.offsetS,
          playing.startedAtS,
          now,
          playing.bufferS,
          sound.loop,
        );
        if (Math.abs(drift) <= DRIFT_RESTART_MS) {
          this.ramp(playing.gain, sound.gain);
          continue;
        }
        this.stop(sound.id);
      }
      this.start(sound, buffer, now);
    }
  }

  /** Playback stopped: every sound stops (the video's routing stays). */
  silence(): void {
    for (const id of [...this.playing.keys()]) this.stop(id);
  }

  /** The mix's loudest sample just now (0 when silent or before the first Play). */
  level(): number {
    if (!this.analyser || !this.ctx || this.ctx.state !== 'running') return 0;
    if (!this.meterData || this.meterData.length !== this.analyser.fftSize) {
      this.meterData = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    }
    this.analyser.getFloatTimeDomainData(this.meterData);
    return peakOf(this.meterData);
  }

  /** The engine is gone: the context closes and the videos let go; the decoded files stay. */
  destroy(): void {
    this.silence();
    for (const routed of this.routed.values()) {
      routed.source.disconnect();
      routed.gain.disconnect();
    }
    this.routed.clear();
    this.elements = [];
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.analyser = null;
    this.meterData = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  // ------------------------------------------------------------------ inside

  private routeVideos(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    for (const el of this.elements) {
      if (this.routed.has(el) || !el.crossOrigin) continue;
      try {
        const source = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        gain.gain.value = Math.min(1, el.volume);
        source.connect(gain);
        gain.connect(this.master);
        this.routed.set(el, { source, gain });
      } catch {
        // Already routed by another graph, or refused: it keeps its own volume.
      }
    }
  }

  private async load(refKey: string): Promise<void> {
    const url = this.files.get(refKey);
    if (!url || this.buffers.has(refKey)) return;
    this.buffers.set(refKey, 'loading');
    try {
      const bytes = await this.fetchBytes(url);
      const buffer = await this.decode(bytes);
      this.buffers.set(refKey, buffer);
    } catch {
      this.buffers.set(refKey, 'failed');
    }
  }

  private start(sound: SoundState, buffer: AudioBuffer, now: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const where = soundStart(sound.fileMs, buffer.duration, sound.loop);
    if (!where) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = sound.loop;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(this.master);
    if (where.durationS === null) source.start(now, where.offsetS);
    else source.start(now, where.offsetS, where.durationS);
    this.ramp(gain, sound.gain);
    const playing: Playing = {
      refKey: sound.refKey,
      source,
      gain,
      startedAtS: now,
      offsetS: where.offsetS,
      loop: sound.loop,
      bufferS: buffer.duration,
    };
    source.onended = () => {
      if (this.playing.get(sound.id) === playing) {
        // An effect that reached its file's end: keep the entry, so it is not started again.
        gain.disconnect();
      }
    };
    this.playing.set(sound.id, playing);
  }

  private stop(id: string): void {
    const playing = this.playing.get(id);
    if (!playing) return;
    this.playing.delete(id);
    playing.source.onended = null;
    try {
      playing.source.stop();
    } catch {
      // Already ended.
    }
    playing.source.disconnect();
    playing.gain.disconnect();
  }

  private ramp(node: GainNode, target: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const ramp = gainRamp(node.gain.value, target, ctx.currentTime);
    node.gain.cancelScheduledValues(ramp.fromS);
    node.gain.setValueAtTime(ramp.fromValue, ramp.fromS);
    node.gain.linearRampToValueAtTime(ramp.toValue, ramp.toS);
  }
}
