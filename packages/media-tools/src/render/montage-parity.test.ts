/**
 * Montage parity (Sprint 13, Module 11): a montage of parts from two videos
 * of different shapes and rates, through the real FFmpeg, joined by cuts
 * and by Fade joins (research 09 section 8).
 *
 * The videos: A is 1280 by 720 at 30 fps, its left half red and its right
 * half blue; B is a 720 by 720 square at 25 fps, green. The montage is 9:16
 * at 720p: a 2 s title card (Hook Bold on #111111), then A's middle (the
 * document's centred crop), B (its own cover fit, a `layoutOverride`), and
 * A again panning from its left edge to its right (a `layoutOverride` of
 * its own with a moving crop). Checked:
 *
 * - the cut montage lasts the plan's 8 s and the fade one 7.4 s (0.3 s
 *   shorter per join), within one frame, picture and sound, and both pass
 *   `verifyOutput`;
 * - frames picked by number show the right part before a join, a mix of
 *   the two parts inside it (at the weights `xfade` gives at that frame),
 *   and the next part after it;
 * - the panning part's red and blue edge is where `frameState` puts its
 *   own crop (within a few pixels): the part is cropped by its own path;
 * - the title card shows: the card's dark colour and the line's bright
 *   letters, not the video.
 *
 * It also measures the CPU time (`-benchmark`) of the cut and the fade
 * compile, for Module 15's cost lines.
 *
 * Everything is generated with lavfi sources in a temp folder, never
 * downloaded. Needs `ffmpeg` and `ffprobe` (FFMPEG_PATH / FFPROBE_PATH) and
 * the fonts folder (the title card's line); skipped with a message otherwise.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  buildRenderPlan,
  type ClipDocument,
  type ClipLayout,
  type CompiledFfmpeg,
  compileFfmpeg,
  expectedOutputOf,
  ffmpegArgsFor,
  frameState,
  type RenderContext,
  type RenderPlan,
  type Segment,
  verifyOutput,
} from '@postgear/video-engine';
import { toolPaths } from '../run/paths';
import { createRunTool } from '../run/runner';
import type { RunTool, ToolPaths } from '../run/types';
import { renderClip } from './execute';
import { copyFontsInto, defaultFontsDir, type FontsFolder, loadFontsFolder } from './fonts-folder';
import { readOutputFacts } from './output-facts';

function findTool(program: string): boolean {
  if (path.isAbsolute(program)) return existsSync(program);
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return dirs.some((dir) => existsSync(path.join(dir, program)));
}

function safeToolPaths(): ToolPaths | null {
  try {
    const paths = toolPaths(process.env);
    return findTool(paths.ffmpeg) && findTool(paths.ffprobe) ? paths : null;
  } catch {
    return null;
  }
}

const PATHS = safeToolPaths();
const FONTS_DIR = process.env.CLIPS_FONTS_DIR?.trim() || defaultFontsDir();
const HAS_FONTS = Boolean(FONTS_DIR && existsSync(path.join(FONTS_DIR, 'manifest.json')));
const describeReal = PATHS && HAS_FONTS ? describe : describe.skip;
if (!PATHS || !HAS_FONTS) {
  console.warn('Montage parity tests skipped: FFmpeg or the fonts folder is not here.');
}

const VIDEO_A = '6f1c2b8e-3d4a-4b5c-9d6e-7f8091a2b3c4';
const VIDEO_B = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const FPS = 30;
const FRAME_MS = 1000 / FPS;
const CARD_MS = 2_000;
const A_W = 1280;
const A_H = 720;
/** A 9:16 crop of a 16:9 picture's width. */
const NARROW = 0.31640625;
const RED: RGB = [208, 0, 0];
const BLUE: RGB = [0, 0, 208];
const GREEN: RGB = [0, 192, 0];
const CARD: RGB = [0x11, 0x11, 0x11];

type RGB = [number, number, number];

function fullscreen(id: string, crop: ClipLayout['areas'][number]['crop']): ClipLayout {
  return {
    kind: 'fullscreen',
    areas: [{ id, name: 'Video', frame: { x: 0, y: 0, w: 1, h: 1 }, crop, fit: 'cover' }],
  };
}

function part(
  id: string,
  source: string,
  sourceIn: number,
  sourceOut: number,
  layoutOverride?: ClipLayout,
): Segment {
  return {
    id,
    source,
    sourceIn,
    sourceOut,
    speed: 1,
    volume: 1,
    ...(layoutOverride ? { layoutOverride } : {}),
  };
}

function montage(fade: boolean): ClipDocument {
  return {
    schemaVersion: 2,
    canvas: { ratio: '9:16', width: 1080, height: 1920, fps: FPS, background: '#000000' },
    sources: [
      { id: 'srcA', videoId: VIDEO_A },
      { id: 'srcB', videoId: VIDEO_B },
    ],
    segments: [
      part('p1', 'srcA', 1_000, 3_000),
      part(
        'p2',
        'srcB',
        1_000,
        3_000,
        fullscreen('b', [{ at: 0, rect: { x: 0, y: 0, w: 1, h: 1 } }]),
      ),
      part(
        'p3',
        'srcA',
        5_000,
        7_000,
        fullscreen('pan', [
          { at: 5_000, rect: { x: 0, y: 0, w: NARROW, h: 1 } },
          { at: 7_000, rect: { x: 1 - NARROW, y: 0, w: NARROW, h: 1 } },
        ]),
      ),
    ],
    layout: fullscreen('main', [{ at: 0, rect: { x: (1 - NARROW) / 2, y: 0, w: NARROW, h: 1 } }]),
    zooms: [],
    looks: { colour: 'none', strength: 0, vignette: 0 },
    fades: { inMs: 0, outMs: 0 },
    tracks: [],
    bleeps: [],
    cards: {
      opening: {
        text: 'Best Of The Week',
        background: '#111111',
        colour: '#FFFFFF',
        logo: null,
        look: 'hook-bold',
        durationMs: CARD_MS,
      },
    },
    ...(fade
      ? {
          joins: [
            { beforeSegment: 'p2', kind: 'fade' as const, ms: 300 as const },
            { beforeSegment: 'p3', kind: 'fade' as const, ms: 300 as const },
          ],
        }
      : {}),
  };
}

const SOURCES = {
  srcA: { width: A_W, height: A_H, fps: 30 },
  srcB: { width: 720, height: 720, fps: 25 },
};

describeReal('a montage drawn by FFmpeg', () => {
  let dir: string;
  let runTool: RunTool;
  let fonts: FontsFolder;

  async function ffmpeg(args: string[]): Promise<void> {
    await runTool('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], {
      cwd: dir,
      timeoutMs: 300_000,
    });
  }

  function context(): RenderContext {
    const asset = (file: string, size: { width: number; height: number; fps: number }) => ({
      file,
      sourceOffsetMs: 0,
      durationMs: 10_000,
      ...size,
      hasAudio: true,
    });
    return {
      quality: '720p',
      proof: false,
      watermark: false,
      assets: {
        sources: { srcA: asset('a.mp4', SOURCES.srcA), srcB: asset('b.mp4', SOURCES.srcB) },
        fonts: { dir: 'fonts', manifest: fonts.manifest },
      },
    };
  }

  /** The output frame `n` (decoded in order, picked by number): `w` by `h` RGB at (`x`, `y`). */
  async function framePixels(
    file: string,
    n: number,
    box: { x: number; y: number; w: number; h: number },
    name: string,
  ): Promise<Buffer> {
    await ffmpeg([
      '-i',
      file,
      '-vf',
      `select=eq(n\\,${n}),crop=${box.w}:${box.h}:${box.x}:${box.y}`,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      name,
    ]);
    return readFileSync(path.join(dir, name));
  }

  /** The mean colour of a box of frame `n`. */
  async function colourAt(
    file: string,
    n: number,
    box: { x: number; y: number; w: number; h: number },
  ): Promise<RGB> {
    const bytes = await framePixels(file, n, box, `${file}-${n}-${box.x}-${box.y}.rgb`);
    const sum: RGB = [0, 0, 0];
    const count = bytes.length / 3;
    for (let p = 0; p < bytes.length; p += 3) {
      sum[0] += bytes[p] ?? 0;
      sum[1] += bytes[p + 1] ?? 0;
      sum[2] += bytes[p + 2] ?? 0;
    }
    return [sum[0] / count, sum[1] / count, sum[2] / count];
  }

  const near = (seen: RGB, want: RGB, slack = 30) =>
    seen.every((value, k) => Math.abs(value - (want[k] ?? 0)) <= slack);
  const mix = (a: RGB, b: RGB, p: number): RGB => [
    a[0] * (1 - p) + b[0] * p,
    a[1] * (1 - p) + b[1] * p,
    a[2] * (1 - p) + b[2] * p,
  ];

  /** Where the red half of video A turns blue on the middle row of frame `n`, in output pixels. */
  async function redBlueEdge(file: string, n: number, width: number, y: number): Promise<number> {
    const bytes = await framePixels(file, n, { x: 0, y, w: width, h: 2 }, `${file}-${n}-row.rgb`);
    // The first column whose blue is above its red, from the left.
    for (let x = 0; x < width; x += 1) {
      const r = bytes[x * 3] ?? 0;
      const b = bytes[x * 3 + 2] ?? 0;
      if (b > r) return x;
    }
    return width;
  }

  /** Where `frameState` puts A's red and blue edge at a clip moment, in output pixels. */
  function expectedEdge(doc: ClipDocument, plan: RenderPlan, bodyMs: number): number {
    const state = frameState(doc, bodyMs, { sources: SOURCES });
    const crop = state.areas[0]?.visibleCrop as { x: number; w: number };
    const cropX = crop.x * A_W;
    const cropW = crop.w * A_W;
    return ((A_W / 2 - cropX) / cropW) * plan.output.width;
  }

  /** User and system CPU seconds of one run of a compiled command in its folder (`-benchmark`). */
  async function cpuOnce(compiled: CompiledFfmpeg, cwd: string): Promise<number> {
    const args = ffmpegArgsFor(compiled, 'bench.mp4');
    const level = args.indexOf('-loglevel');
    args[level + 1] = 'info';
    let line = '';
    await runTool('ffmpeg', ['-benchmark', ...args], {
      cwd,
      timeoutMs: 300_000,
      onStderrLine: (text) => {
        if (text.includes('bench: utime=')) line = text;
      },
    });
    const utime = Number(/utime=([\d.]+)s/.exec(line)?.[1] ?? Number.NaN);
    const stime = Number(/stime=([\d.]+)s/.exec(line)?.[1] ?? Number.NaN);
    return utime + stime;
  }

  /** Each montage renders in its own folder (its graph, ASS and crop files), so both can be run again. */
  async function render(fade: boolean) {
    const doc = montage(fade);
    const plan = buildRenderPlan(doc, context());
    const compiled = compileFfmpeg(plan);
    const folder = fade ? 'fade' : 'cut';
    const scratch = path.join(dir, folder);
    mkdirSync(scratch);
    copyFileSync(path.join(dir, 'a.mp4'), path.join(scratch, 'a.mp4'));
    copyFileSync(path.join(dir, 'b.mp4'), path.join(scratch, 'b.mp4'));
    expect(
      await copyFontsInto(
        fonts,
        compiled.fonts?.files ?? [],
        scratch,
        compiled.fonts?.dir ?? 'fonts',
      ),
    ).toEqual([]);
    await renderClip({ runTool, scratchDir: scratch, compiled, outFile: `${folder}.mp4` });
    commands[folder] = { compiled, cwd: scratch };
    return { doc, plan, compiled, file: `${folder}/${folder}.mp4` };
  }

  async function audioSeconds(file: string): Promise<number> {
    const probe = await runTool(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        'a:0',
        '-show_entries',
        'stream=duration',
        '-of',
        'csv=p=0',
        file,
      ],
      { cwd: dir, timeoutMs: 60_000 },
    );
    return Number(probe.stdout.trim());
  }

  /** The output frame that shows clip moment `bodyMs` (the card plays first). */
  const frameOf = (bodyMs: number) => Math.round((CARD_MS + bodyMs) / FRAME_MS);
  const bodyOf = (n: number) => n * FRAME_MS - CARD_MS;
  const left = { x: 40, y: 600, w: 60, h: 60 };
  const middle = { x: 330, y: 600, w: 60, h: 60 };
  const cpu: Record<string, number> = {};
  const commands: Record<string, { compiled: CompiledFfmpeg; cwd: string }> = {};

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'pg-montage-parity-'));
    runTool = createRunTool(PATHS as ToolPaths);
    const loaded = await loadFontsFolder(path.resolve(FONTS_DIR as string));
    if (!loaded) throw new Error('The fonts folder could not be read');
    fonts = loaded;
    const video = (picture: string, fps: number, tone: number, file: string) =>
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        picture,
        '-f',
        'lavfi',
        '-t',
        '10',
        '-i',
        `sine=frequency=${tone}:sample_rate=48000`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-g',
        String(fps),
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-t',
        '10',
        file,
      ]);
    await video(
      `color=c=0xD00000:s=${A_W}x${A_H}:r=30:d=10,drawbox=x=${A_W / 2}:y=0:w=${A_W / 2}:h=${A_H}:color=0x0000D0:t=fill`,
      30,
      440,
      'a.mp4',
    );
    await video('color=c=0x00C000:s=720x720:r=25:d=10', 25, 880, 'b.mp4');
  }, 300_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (Object.keys(cpu).length > 0) {
      console.log(
        `Montage compile CPU (8 s and 7.4 s of 720p): cut ${cpu.cut?.toFixed(2)} s, fade ${cpu.fade?.toFixed(2)} s, ratio ${((cpu.fade ?? 0) / (cpu.cut ?? 1)).toFixed(2)}`,
      );
    }
  });

  it('renders the cut montage to its exact length, each part in its own frame', async () => {
    const { doc, plan, file } = await render(false);
    expect(plan.output.durationMs).toBe(8_000);
    const facts = await readOutputFacts(runTool, path.join(dir, file));
    expect(verifyOutput(facts, expectedOutputOf(plan))).toEqual([]);
    expect(Math.abs((facts.durationMs ?? 0) - 8_000)).toBeLessThanOrEqual(FRAME_MS);
    expect(Math.abs((await audioSeconds(file)) - 8)).toBeLessThan(1 / 30 + 0.025);

    // The title card: its dark colour and the line's bright letters, not the video.
    expect(near(await colourAt(file, 30, { x: 20, y: 20, w: 40, h: 40 }), CARD, 12)).toBe(true);
    const line = Math.round((plan.cards?.opening?.text?.geometry.cy ?? 0) * plan.scale);
    const band = await framePixels(
      file,
      30,
      { x: 0, y: line - 30, w: 720, h: 60 },
      'card-band.rgb',
    );
    let bright = 0;
    for (let p = 0; p + 2 < band.length; p += 3) {
      if ((band[p] ?? 0) > 200 && (band[p + 1] ?? 0) > 200 && (band[p + 2] ?? 0) > 200) bright += 1;
    }
    expect(bright).toBeGreaterThan(1_000);

    // Part 1 (A's middle: red left, blue right), part 2 (B, green), part 3 (A's own pan).
    expect(near(await colourAt(file, frameOf(1_000), left), RED)).toBe(true);
    expect(near(await colourAt(file, frameOf(1_000), { x: 620, y: 600, w: 60, h: 60 }), BLUE)).toBe(
      true,
    );
    expect(near(await colourAt(file, frameOf(3_000), middle), GREEN)).toBe(true);
    expect(near(await colourAt(file, frameOf(1_966), left), RED)).toBe(true);
    expect(near(await colourAt(file, frameOf(2_033), left), GREEN)).toBe(true);
    // The pan: early in its part all red, and its edge where its own crop puts it.
    expect(near(await colourAt(file, frameOf(4_200), middle), RED)).toBe(true);
    for (const n of [frameOf(4_800), frameOf(5_000), frameOf(5_300)]) {
      const edge = await redBlueEdge(file, n, plan.output.width, 640);
      expect(Math.abs(edge - expectedEdge(doc, plan, bodyOf(n)))).toBeLessThanOrEqual(4);
    }
  }, 600_000);

  it('renders the fade montage 0.3 s shorter per join, mixing the parts inside each join', async () => {
    const { doc, plan, compiled, file } = await render(true);
    expect(plan.output.durationMs).toBe(7_400);
    expect(compiled.filterComplexScript).toContain(
      'xfade=transition=fade:duration=0.300:offset=1.700',
    );
    expect(compiled.filterComplexScript).toContain(
      'xfade=transition=fade:duration=0.300:offset=3.400',
    );
    const facts = await readOutputFacts(runTool, path.join(dir, file));
    expect(verifyOutput(facts, expectedOutputOf(plan))).toEqual([]);
    expect(Math.abs((facts.durationMs ?? 0) - 7_400)).toBeLessThanOrEqual(FRAME_MS);
    expect(Math.abs((await audioSeconds(file)) - 7.4)).toBeLessThan(1 / 30 + 0.025);

    // The title card still opens it.
    expect(near(await colourAt(file, 30, { x: 20, y: 20, w: 40, h: 40 }), CARD, 12)).toBe(true);

    // Join 1 (1.7 to 2.0 s of the clip): A's red before, a mix inside, B's green after.
    expect(near(await colourAt(file, frameOf(1_500), left), RED)).toBe(true);
    for (const n of [frameOf(1_766), frameOf(1_866), frameOf(1_933)]) {
      const p = (bodyOf(n) - 1_700) / 300;
      expect(near(await colourAt(file, n, left), mix(RED, GREEN, p), 24)).toBe(true);
    }
    expect(near(await colourAt(file, frameOf(2_100), left), GREEN)).toBe(true);

    // Join 2 (3.4 to 3.7 s): B's green, a mix with the pan's red start, then red.
    expect(near(await colourAt(file, frameOf(3_300), middle), GREEN)).toBe(true);
    const n2 = frameOf(3_533);
    expect(
      near(await colourAt(file, n2, middle), mix(GREEN, RED, (bodyOf(n2) - 3_400) / 300), 24),
    ).toBe(true);
    expect(near(await colourAt(file, frameOf(3_800), middle), RED)).toBe(true);

    // The pan after the join: its own crop, on the clip's clock with the overlaps taken off.
    for (const n of [frameOf(4_200), frameOf(4_400), frameOf(4_700)]) {
      const edge = await redBlueEdge(file, n, plan.output.width, 640);
      expect(Math.abs(edge - expectedEdge(doc, plan, bodyOf(n)))).toBeLessThanOrEqual(4);
    }
  }, 600_000);

  it('measures the CPU time of the cut and the fade compile (Module 15)', async () => {
    const cut = commands.cut;
    const fade = commands.fade;
    if (!cut || !fade) throw new Error('Both montages must render first');
    // Alternating, the least of two each: the machine's other work weighs on both alike.
    const runs: Record<'cut' | 'fade', number[]> = { cut: [], fade: [] };
    for (let k = 0; k < 2; k += 1) {
      runs.cut.push(await cpuOnce(cut.compiled, cut.cwd));
      runs.fade.push(await cpuOnce(fade.compiled, fade.cwd));
    }
    cpu.cut = Math.min(...runs.cut);
    cpu.fade = Math.min(...runs.fade);
    expect(cpu.cut).toBeGreaterThan(0);
    expect(cpu.fade).toBeGreaterThan(0);
  }, 900_000);
});
