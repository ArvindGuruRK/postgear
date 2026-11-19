#!/usr/bin/env node
/**
 * The worker image's health command (Sprint 12, Module 20). The image runs it
 * at the end of its build (with --render) and as its HEALTHCHECK.
 *
 *   node /app/bin/healthcheck.js [--render] [--quiet]
 *
 * 1. The Clips doctor (the same code as `npm run clips:doctor` and the
 *    worker's boot): FFmpeg's version, a filter graph read from a file
 *    (`-/filter_complex`), libass, libharfbuzz and libx264; ffprobe; yt-dlp's
 *    version and Deno. In the image every one of them must be OK, link tools
 *    included.
 * 2. The fonts: `manifest.json` in CLIPS_FONTS_DIR must be the manifest the
 *    export compiler was built with (`FONT_MANIFEST` in @postgear/video-engine),
 *    every file it names must be a TrueType or OpenType font, and every folder
 *    fontconfig reads (FONTCONFIG_FILE) must hold at least one font.
 * 3. With --render: one frame of text drawn by libass from a Studio twin and
 *    the Tamil fallback, through the runner, and libass's `fontselect:` lines
 *    checked the way an export checks them: a font outside the plan fails.
 *
 * Exits 0 when healthy and 1 when not, with one line per check.
 */

const { mkdtemp, open, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  copyFontsInto,
  createRunTool,
  formatDoctorReport,
  loadFontsFolder,
  runDoctor,
  toolPaths,
  unexpectedFont,
} = require('@postgear/media-tools');
const { FONT_MANIFEST } = require('@postgear/video-engine');

const args = new Set(process.argv.slice(2));
const quiet = args.has('--quiet');
const lines = [];
const say = (line) => {
  lines.push(line);
};

/** JSON with sorted keys, so two equal manifests compare equal whatever their key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** TrueType (00 01 00 00 or "true") or OpenType ("OTTO"). */
async function isFontFile(file) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await handle.read(head, 0, 4, 0);
    if (bytesRead < 4) return false;
    const tag = head.toString('latin1');
    return head.readUInt32BE(0) === 0x00010000 || tag === 'true' || tag === 'OTTO';
  } finally {
    await handle.close();
  }
}

async function checkDoctor(runTool, paths) {
  const tempDir = process.env.CLIPS_SCRATCH_DIR || os.tmpdir();
  const report = await runDoctor(runTool, paths, { tempDir });
  for (const line of formatDoctorReport(report)) say(line);
  const failing = [];
  if (!report.ok) failing.push('FFmpeg or ffprobe');
  if (!report.ytDlp.ok) failing.push('yt-dlp');
  if (!report.jsRuntime.ok) failing.push('Deno');
  return failing;
}

async function checkFonts() {
  const dir = process.env.CLIPS_FONTS_DIR;
  if (!dir) return { failing: ['CLIPS_FONTS_DIR is not set'], folder: null };
  const folder = await loadFontsFolder(dir).catch((error) => {
    say(`[FAIL] Fonts manifest: ${error.message}`);
    return null;
  });
  if (!folder) return { failing: [`no readable manifest.json in ${dir}`], folder: null };

  const failing = [];
  if (canonical(folder.manifest) !== canonical(FONT_MANIFEST)) {
    failing.push('manifest.json differs from the manifest the export compiler was built with');
  }
  let bad = 0;
  for (const entry of folder.manifest.fonts) {
    const file = path.join(folder.dir, entry.file);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || info.size === 0 || !(await isFontFile(file))) {
      bad += 1;
      say(
        `[FAIL] Font file ${entry.file} (${entry.family} ${entry.weight}) is missing or not a font`,
      );
    }
  }
  if (bad > 0) failing.push(`${bad} font files`);
  const families = new Set(folder.manifest.fonts.map((entry) => entry.fontId)).size;
  say(
    `${bad === 0 && failing.length === 0 ? '[OK]  ' : '[FAIL]'} Fonts: ${folder.manifest.fonts.length} files of ${families} families in ${folder.dir}`,
  );

  const config = process.env.FONTCONFIG_FILE;
  if (config) {
    const text = await readFile(config, 'utf8').catch(() => null);
    if (text === null) {
      failing.push(`FONTCONFIG_FILE ${config} cannot be read`);
    } else {
      for (const match of text.matchAll(/<dir>([^<]+)<\/dir>/g)) {
        const fontDir = match[1].trim();
        const names = await readdir(fontDir).catch(() => []);
        const fonts = names.filter((name) => /\.(ttf|otf)$/i.test(name));
        say(
          `${fonts.length > 0 ? '[OK]  ' : '[FAIL]'} Fallback fonts: ${fonts.join(', ') || 'none'} in ${fontDir}`,
        );
        if (fonts.length === 0) failing.push(`no fallback font in ${fontDir}`);
      }
    }
  }
  return { failing, folder };
}

/** One frame of Latin and Tamil text through libass, with the fonts an export would copy. */
async function checkRender(runTool, folder) {
  const main = folder.manifest.fonts.find((entry) => !entry.fallback && entry.weight === 400);
  const tamil = folder.manifest.fonts.find(
    (entry) => entry.fontId === 'noto-sans-tamil' && entry.weight === 400,
  );
  if (!main || !tamil) return ['no 400 weight twin or Tamil fallback in the manifest'];

  const dir = await mkdtemp(path.join(process.env.CLIPS_SCRATCH_DIR || os.tmpdir(), 'health-'));
  try {
    const missing = await copyFontsInto(folder, [main.file, tamil.file], dir, 'fonts');
    if (missing.length > 0) return [`could not copy ${missing.join(', ')}`];
    const style = (name, entry) =>
      `Style: ${name},${entry.assName},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1`;
    const ass = [
      '[Script Info]',
      'ScriptType: v4.00+',
      'PlayResX: 320',
      'PlayResY: 180',
      '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      style('Main', main),
      style('Tamil', tamil),
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:00.00,0:00:01.00,Main,,0,0,0,,PostGear 2026',
      // "Vanakkam" in Tamil: a conjunct that needs HarfBuzz to join.
      'Dialogue: 0,0:00:00.00,0:00:01.00,Tamil,,0,0,40,,வணக்கம்',
      '',
    ].join('\n');
    await writeFile(path.join(dir, 'text.ass'), ass, 'utf8');

    const expected = new Set([main.psName, tamil.psName]);
    const chosen = new Set();
    let unexpected = null;
    await runTool(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostdin',
        '-loglevel',
        'info',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=320x180:r=10:d=0.5',
        '-vf',
        'ass=filename=text.ass:fontsdir=fonts',
        '-frames:v',
        '2',
        '-f',
        'null',
        '-',
      ],
      {
        cwd: dir,
        timeoutMs: 60_000,
        onStderrLine: (line) => {
          const picked = /fontselect: \(.*\) -> ([^,\s]+),/.exec(line);
          if (picked) chosen.add(picked[1]);
          const wrong = unexpectedFont(line, expected);
          if (wrong !== null && unexpected === null) unexpected = wrong;
        },
      },
    );
    if (unexpected !== null) return [`libass drew text in ${unexpected}, a font outside the plan`];
    for (const name of expected) {
      if (!chosen.has(name)) return [`libass never chose ${name}`];
    }
    say(`[OK]   Text render: libass drew ${[...chosen].join(' and ')} from the fonts folder`);
    return [];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const paths = toolPaths(process.env);
  const runTool = createRunTool(paths);
  const failing = [...(await checkDoctor(runTool, paths))];
  const fonts = await checkFonts();
  failing.push(...fonts.failing);
  if (args.has('--render') && fonts.folder) {
    failing.push(...(await checkRender(runTool, fonts.folder)));
  }
  if (failing.length > 0) {
    say(`Worker image is NOT healthy: ${failing.join('; ')}.`);
  } else {
    say('Worker image is healthy.');
  }
  if (!quiet || failing.length > 0) {
    for (const line of lines) process.stdout.write(`${line}\n`);
  }
  return failing.length === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    process.stderr.write(
      `The health check could not run: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  },
);
