/**
 * `npm run clips:stills`: still pictures of an export (and, beside them, of
 * the video it came from) at the same moments, for a person to compare.
 *
 * The parity tests check numbers; this is the look by eye. By default it
 * takes five moments of the export (the start, a quarter, the middle, three
 * quarters and the last second) and writes them as PNG files into the
 * repository's `screenshots/` folder (kept out of git), numbered after the
 * pictures already there. With `--proxy` it also takes the matching moments
 * of the light copy: through the clip document's time map when `--doc` is
 * given, or `--proxy-offset-ms` plus the clip moment for a plain 1x clip.
 *
 *   --export <file>          the rendered clip (required)
 *   --proxy <file>           the video it was cut from (optional)
 *   --doc <file.json>        the clip document, to map clip moments to video moments
 *   --proxy-offset-ms <ms>   without --doc: the video moment the clip starts at (default 0)
 *   --at 0,5000,10000        clip moments in ms (default: the five above)
 *   --out <folder>           default: <repo>/screenshots
 *   --name <word>            part of each file name (default: stills)
 *
 * Relative paths are read from the folder the command was started in.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { type ClipDocument, clipDocumentSchema, toSource } from '@postgear/video-engine';
import { toolPaths } from '../src/run/paths';
import { createRunTool } from '../src/run/runner';
import type { RunTool } from '../src/run/types';

interface Options {
  exportFile: string;
  proxyFile: string | null;
  doc: ClipDocument | null;
  proxyOffsetMs: number;
  at: number[] | null;
  outDir: string;
  name: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const STARTED_IN = process.env.INIT_CWD ?? process.cwd();

function readOptions(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const exportArg = value('--export');
  if (!exportArg) {
    throw new Error('Pass the rendered clip with --export <file>');
  }
  const proxyArg = value('--proxy');
  const docArg = value('--doc');
  const doc = docArg
    ? clipDocumentSchema.parse(JSON.parse(readFileSync(path.resolve(STARTED_IN, docArg), 'utf8')))
    : null;
  const offset = Number(value('--proxy-offset-ms') ?? '0');
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('--proxy-offset-ms must be a whole number of milliseconds');
  }
  const atArg = value('--at');
  const at = atArg
    ? atArg.split(',').map((part) => {
        const ms = Number(part.trim());
        if (!Number.isInteger(ms) || ms < 0) {
          throw new Error(`--at takes whole milliseconds, not ${part}`);
        }
        return ms;
      })
    : null;
  const name = value('--name') ?? 'stills';
  if (!/^[A-Za-z0-9-]{1,40}$/.test(name)) {
    throw new Error('--name may hold letters, digits and - only');
  }
  return {
    exportFile: path.resolve(STARTED_IN, exportArg),
    proxyFile: proxyArg ? path.resolve(STARTED_IN, proxyArg) : null,
    doc,
    proxyOffsetMs: offset,
    at,
    outDir: path.resolve(STARTED_IN, value('--out') ?? path.join(REPO_ROOT, 'screenshots')),
    name,
  };
}

async function durationMs(runTool: RunTool, cwd: string, file: string): Promise<number> {
  const result = await runTool(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { cwd, timeoutMs: 30_000 },
  );
  const seconds = Number(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error('Could not read the length of the export');
  }
  return Math.round(seconds * 1000);
}

/** Start, a quarter, the middle, three quarters and the last second. */
function defaultMoments(lengthMs: number): number[] {
  const last = Math.max(0, lengthMs - 1000);
  return [
    0,
    Math.round(lengthMs / 4),
    Math.round(lengthMs / 2),
    Math.round((lengthMs * 3) / 4),
    last,
  ];
}

/** The next free number in the screenshots folder (`07-...png` makes the next one 08). */
function nextNumber(dir: string): number {
  if (!existsSync(dir)) {
    return 1;
  }
  let highest = 0;
  for (const file of readdirSync(dir)) {
    const match = /^(\d+)-/.exec(file);
    if (match) {
      highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

async function still(
  runTool: RunTool,
  cwd: string,
  file: string,
  atMs: number,
  out: string,
): Promise<void> {
  await runTool(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-loglevel',
      'error',
      '-ss',
      (atMs / 1000).toFixed(3),
      '-i',
      file,
      '-frames:v',
      '1',
      out,
    ],
    { cwd, timeoutMs: 60_000 },
  );
}

async function main(): Promise<number> {
  const options = readOptions(process.argv.slice(2));
  const runTool = createRunTool(toolPaths(process.env));
  await mkdir(options.outDir, { recursive: true });
  const cwd = options.outDir;

  const lengthMs = await durationMs(runTool, cwd, options.exportFile);
  const moments = (options.at ?? defaultMoments(lengthMs)).filter((ms) => ms < lengthMs);
  let number = nextNumber(options.outDir);

  for (const atMs of moments) {
    const prefix = String(number).padStart(2, '0');
    number += 1;
    const exportOut = path.join(options.outDir, `${prefix}-${options.name}-export-${atMs}ms.png`);
    await still(runTool, cwd, options.exportFile, atMs, exportOut);
    process.stdout.write(`${exportOut}\n`);

    if (options.proxyFile) {
      const videoMs = options.doc
        ? (toSource(options.doc, atMs)?.sourceMs ?? null)
        : options.proxyOffsetMs + atMs;
      if (videoMs === null) {
        continue;
      }
      const proxyOut = path.join(
        options.outDir,
        `${prefix}-${options.name}-video-${videoMs}ms.png`,
      );
      await still(runTool, cwd, options.proxyFile, videoMs, proxyOut);
      process.stdout.write(`${proxyOut}\n`);
    }
  }
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `The stills could not be made: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
