/**
 * `npm run clips:fonts:build`: the render's fonts folder and its manifest
 * (Module 11).
 *
 * libass cannot read the Studio's WOFF2 files and draws only the default
 * instance of a variable font, so this writes one static TTF twin per
 * family and weight (a variable family gets every hundred in its range),
 * plus the Noto Sans Tamil and Noto Sans Devanagari fallbacks kept in
 * `fonts-src/noto/`. Each twin gets its own internal family and PostScript
 * name (`assName`, `psName`), so libass matches it exactly and the render
 * can tell from its `fontselect:` lines that nothing fell back. The
 * conversion is fontTools (MIT) in `fonts_twin.py`; see the Decision Log.
 *
 * It writes:
 * - the twins, the Studio fonts' licences and `manifest.json` into the
 *   fonts folder (`CLIPS_FONTS_DIR`, default `<repo>/.cache/clips-fonts`,
 *   kept out of git; the worker image runs this same step);
 * - `packages/video-engine/src/render/fonts-manifest.ts`, the committed
 *   copy the web app and the tests read (no font file needed).
 *
 *   --out <folder>   the fonts folder (default: CLIPS_FONTS_DIR or the cache)
 *   --check          build into a temporary folder and fail if the committed manifest differs
 *
 * Python with fontTools and brotli is found at `CLIPS_FONTS_PYTHON`, else
 * `<repo>/.cache/clips-fonts-tools` (a venv: `python -m venv
 * .cache/clips-fonts-tools` then `pip install "fonttools[woff]"`), else
 * `python3` or `python` on the PATH. It is a build tool only: nothing at
 * render time runs Python.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  FONT_MANIFEST_FILE,
  FONT_MANIFEST_VERSION,
  type FontCoverage,
  type FontManifest,
  type FontManifestEntry,
  fontManifestSchema,
} from '@postgear/video-engine';
import { FONTS } from '../../design-engine/src/fonts';
import { runBuildTool } from '../src/run/runner';
import { ToolError } from '../src/run/types';

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');
const STARTED_IN = process.env.INIT_CWD ?? process.cwd();
const STUDIO_FONTS = path.join(REPO_ROOT, 'packages', 'design-engine', 'fonts');
const NOTO_DIR = path.join(PACKAGE_ROOT, 'fonts-src', 'noto');
const COMMITTED = path.join(
  REPO_ROOT,
  'packages',
  'video-engine',
  'src',
  'render',
  'fonts-manifest.ts',
);
const PY_HELPER = path.join(PACKAGE_ROOT, 'scripts', 'fonts_twin.py');

/** The script fallbacks: letters a Studio font lacks are drawn in these. */
const FALLBACKS = [
  {
    fontId: 'noto-sans-tamil',
    family: 'Noto Sans Tamil',
    faces: [
      { file: 'NotoSansTamil-Regular.ttf', weight: 400 },
      { file: 'NotoSansTamil-Bold.ttf', weight: 700 },
    ],
  },
  {
    fontId: 'noto-sans-devanagari',
    family: 'Noto Sans Devanagari',
    faces: [
      { file: 'NotoSansDevanagari-Regular.ttf', weight: 400 },
      { file: 'NotoSansDevanagari-Bold.ttf', weight: 700 },
    ],
  },
] as const;

interface Job {
  fontId: string;
  family: string;
  weight: number;
  fallback: boolean;
  reserved: string[];
  src: string;
  out: string;
  instance: boolean;
  assName: string;
  psName: string;
}

interface JobResult {
  out: string;
  unitsPerEm: number;
  winAscent: number;
  winDescent: number;
  coverage: FontCoverage;
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function outDir(argv: readonly string[]): string {
  const value = argValue(argv, '--out') ?? process.env.CLIPS_FONTS_DIR;
  return value ? path.resolve(STARTED_IN, value) : path.join(REPO_ROOT, '.cache', 'clips-fonts');
}

/** A short code for a font id: the twin's name says nothing of the family (no Reserved Font Name). */
function codeFor(fontId: string): string {
  return createHash('sha1').update(fontId).digest('hex').slice(0, 6);
}

/** Every hundred inside a variable face's range, within 100 to 900. */
function weightsOf(weight: number | readonly [number, number]): number[] {
  if (typeof weight === 'number') {
    return [weight];
  }
  const from = Math.max(100, Math.ceil(weight[0] / 100) * 100);
  const to = Math.min(900, Math.floor(weight[1] / 100) * 100);
  const out: number[] = [];
  for (let w = from; w <= to; w += 100) out.push(w);
  return out;
}

function jobsFor(dir: string): Job[] {
  const jobs: Job[] = [];
  const add = (
    fontId: string,
    family: string,
    weight: number,
    src: string,
    instance: boolean,
    fallback: boolean,
    reserved: string[],
  ) => {
    const code = codeFor(fontId);
    jobs.push({
      fontId,
      family,
      weight,
      fallback,
      reserved,
      src,
      out: path.join(dir, `${fontId}-${weight}.ttf`),
      instance,
      assName: `PGF ${code} ${weight}`,
      psName: `PGF-${code}-${weight}`,
    });
  };

  for (const font of Object.values(FONTS)) {
    const seen = new Set<number>();
    for (const face of font.faces) {
      const variable = Array.isArray(face.weight);
      for (const weight of weightsOf(face.weight)) {
        if (seen.has(weight)) continue;
        seen.add(weight);
        add(font.id, font.family, weight, path.join(STUDIO_FONTS, face.file), variable, false, [
          ...font.reservedNames,
        ]);
      }
    }
  }
  for (const fallback of FALLBACKS) {
    for (const face of fallback.faces) {
      add(
        fallback.fontId,
        fallback.family,
        face.weight,
        path.join(NOTO_DIR, face.file),
        false,
        true,
        [],
      );
    }
  }
  return jobs;
}

/** Python, through the process runner (an argument array, the minimal environment, a time limit). */
async function run(program: string, args: string[]): Promise<string> {
  try {
    const result = await runBuildTool('python', program, args, {
      cwd: REPO_ROOT,
      timeoutMs: 15 * 60_000,
      // fontTools finds its own modules through the venv; nothing else is passed on.
      env: process.env.PYTHONUTF8 ? { PYTHONUTF8: process.env.PYTHONUTF8 } : undefined,
    });
    return result.stdout;
  } catch (error) {
    const tail = error instanceof ToolError ? error.stderrTail.trim() : '';
    throw new Error(
      `${path.basename(program)} failed: ${tail || (error instanceof Error ? error.message : 'unknown')}`,
    );
  }
}

async function findPython(): Promise<string> {
  const venv = path.join(REPO_ROOT, '.cache', 'clips-fonts-tools');
  const candidates = [
    process.env.CLIPS_FONTS_PYTHON,
    path.join(venv, 'Scripts', 'python.exe'),
    path.join(venv, 'bin', 'python'),
    'python3',
    'python',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
    try {
      await run(candidate, [
        '-I',
        '-c',
        'import fontTools.ttLib, fontTools.varLib.instancer, brotli',
      ]);
      return candidate;
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    'Python with fontTools and brotli was not found. Run: python -m venv .cache/clips-fonts-tools, then .cache/clips-fonts-tools/Scripts/pip install "fonttools[woff]" (bin/pip on Linux and macOS), or set CLIPS_FONTS_PYTHON.',
  );
}

/** Splits the jobs into a few Python processes, run side by side. */
async function convert(python: string, jobs: Job[], work: string): Promise<JobResult[]> {
  const lanes = Math.max(1, Math.min(4, cpus().length));
  const chunks: Job[][] = Array.from({ length: lanes }, () => []);
  jobs.forEach((job, i) => {
    (chunks[i % lanes] as Job[]).push(job);
  });
  const results = await Promise.all(
    chunks
      .filter((chunk) => chunk.length > 0)
      .map(async (chunk, lane) => {
        const jobFile = path.join(work, `jobs-${lane}.json`);
        const resultFile = path.join(work, `results-${lane}.json`);
        await writeFile(
          jobFile,
          JSON.stringify(
            chunk.map((job) => ({
              src: job.src,
              out: job.out,
              weight: job.weight,
              instance: job.instance,
              assName: job.assName,
              psName: job.psName,
            })),
          ),
          'utf8',
        );
        await run(python, ['-I', PY_HELPER, jobFile, resultFile]);
        return JSON.parse(await readFile(resultFile, 'utf8')) as JobResult[];
      }),
  );
  return results.flat();
}

/** The code points every weight of a font id has. */
function intersect(a: FontCoverage, b: FontCoverage): FontCoverage {
  const out: FontCoverage = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const [a0, a1] = a[i] as [number, number];
    const [b0, b1] = b[j] as [number, number];
    const from = Math.max(a0, b0);
    const to = Math.min(a1, b1);
    if (from <= to) out.push([from, to]);
    if (a1 < b1) i += 1;
    else j += 1;
  }
  return out;
}

function manifestFrom(jobs: Job[], results: JobResult[]): FontManifest {
  const byOut = new Map(results.map((result) => [path.resolve(result.out), result]));
  const fonts: FontManifestEntry[] = [];
  const coverage: Record<string, FontCoverage> = {};
  for (const job of jobs) {
    const result = byOut.get(path.resolve(job.out));
    if (!result) {
      throw new Error(`No result for ${path.basename(job.out)}`);
    }
    for (const reserved of job.reserved) {
      const lower = reserved.toLowerCase();
      if (job.assName.toLowerCase().includes(lower) || job.psName.toLowerCase().includes(lower)) {
        throw new Error(`The twin name ${job.assName} carries the Reserved Font Name ${reserved}`);
      }
    }
    fonts.push({
      fontId: job.fontId,
      family: job.family,
      weight: job.weight,
      assName: job.assName,
      psName: job.psName,
      file: path.basename(job.out),
      unitsPerEm: result.unitsPerEm,
      winAscent: result.winAscent,
      winDescent: result.winDescent,
      fallback: job.fallback,
    });
    const previous = coverage[job.fontId];
    coverage[job.fontId] = previous ? intersect(previous, result.coverage) : result.coverage;
  }
  fonts.sort((a, b) => a.fontId.localeCompare(b.fontId, 'en') || a.weight - b.weight);
  const sortedCoverage: Record<string, FontCoverage> = {};
  for (const fontId of Object.keys(coverage).sort((a, b) => a.localeCompare(b, 'en'))) {
    sortedCoverage[fontId] = coverage[fontId] as FontCoverage;
  }
  return fontManifestSchema.parse({
    version: FONT_MANIFEST_VERSION,
    fonts,
    coverage: sortedCoverage,
  });
}

/** The committed TypeScript copy: one font per line, one coverage list per line. */
function committedSource(manifest: FontManifest): string {
  const fonts = manifest.fonts.map((entry) => `    ${JSON.stringify(entry)},`).join('\n');
  const coverage = Object.entries(manifest.coverage)
    .map(([fontId, ranges]) => `    ${JSON.stringify(fontId)}: ${JSON.stringify(ranges)},`)
    .join('\n');
  return `/**
 * GENERATED by \`npm run clips:fonts:build\` (packages/media-tools/scripts/fonts-build.ts).
 * Do not edit by hand: run the build, which writes this file and the twins it describes.
 *
 * The render's font manifest (see \`fonts.ts\`): one static TTF twin per family
 * and weight, with the numbers that turn a CSS size into an ASS one, and what
 * each font can draw. The web app and the tests read this copy; the worker
 * reads \`manifest.json\` in the fonts folder, written by the same run.
 */
import type { FontManifest } from './fonts';

export const FONT_MANIFEST: FontManifest = {
  version: ${manifest.version},
  fonts: [
${fonts}
  ],
  coverage: {
${coverage}
  },
};
`;
}

async function copyLicences(dir: string): Promise<void> {
  await copyFile(path.join(STUDIO_FONTS, 'OFL.txt'), path.join(dir, 'OFL.txt'));
  await copyFile(path.join(STUDIO_FONTS, 'LICENSES.md'), path.join(dir, 'LICENSES.md'));
  await copyFile(path.join(NOTO_DIR, 'OFL.txt'), path.join(dir, 'OFL-Noto.txt'));
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const work = await mkdtemp(path.join(tmpdir(), 'pg-fonts-'));
  try {
    const dir = check ? path.join(work, 'fonts') : outDir(argv);
    await mkdir(dir, { recursive: true });
    const python = await findPython();
    const jobs = jobsFor(dir);
    const missing = jobs.filter((job) => !existsSync(job.src));
    if (missing.length > 0) {
      throw new Error(`Font files not found: ${missing.map((job) => job.src).join(', ')}`);
    }
    process.stdout.write(`Converting ${jobs.length} twins with ${python}\n`);
    const started = Date.now();
    const results = await convert(python, jobs, work);
    const manifest = manifestFrom(jobs, results);
    const source = committedSource(manifest);

    if (check) {
      const committed = existsSync(COMMITTED) ? await readFile(COMMITTED, 'utf8') : '';
      if (committed !== source) {
        process.stderr.write(
          'The committed fonts-manifest.ts differs from a fresh build. Run npm run clips:fonts:build and commit it.\n',
        );
        return 1;
      }
      process.stdout.write('The committed font manifest matches a fresh build.\n');
      return 0;
    }

    await writeFile(
      path.join(dir, FONT_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    await copyLicences(dir);
    await writeFile(COMMITTED, source, 'utf8');
    const families = new Set(manifest.fonts.filter((f) => !f.fallback).map((f) => f.fontId)).size;
    process.stdout.write(
      `Wrote ${manifest.fonts.length} twins of ${families} families and 2 fallbacks in ${Math.round(
        (Date.now() - started) / 1000,
      )} s:\n  ${dir}\n  ${COMMITTED}\n`,
    );
    return 0;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The fonts could not be built: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
