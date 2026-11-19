/**
 * `YTDLP_SELF_UPDATE` (Module 20): keeps yt-dlp current without a new image.
 *
 * Off by default. When "true", at boot a worker that serves the `media` role
 * copies the yt-dlp it was given (`YTDLP_PATH`) into `<scratch root>/.yt-dlp/`,
 * runs that copy's own updater (`yt-dlp -U`), and uses the copy from then on.
 * The image's own file is never changed (the image may be read only), and a
 * failed update (no network, GitHub down) keeps the image's yt-dlp, so the
 * boot never stops over it.
 *
 * The trade-off: platforms change their pages often and an old yt-dlp stops
 * working within weeks, so a long-lived image goes stale; but the copy the
 * updater fetches was not checked by our build (yt-dlp only checks it against
 * the checksums of its own release). Leave it off where the image is rebuilt
 * on purpose with a pinned, checked yt-dlp; turn it on where a rebuild is slow.
 *
 * Skipped under `CLIPS_SIMULATION`: links are answered from recordings there,
 * nothing would use the new copy, and the boot stays offline.
 *
 * The folder name starts with a dot so the stale-scratch sweep at boot
 * (`clearStaleScratch`, which only removes job folders) never touches it.
 */
import { constants } from 'node:fs';
import { access, chmod, copyFile, mkdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { createRunTool, type RunTool, ToolError, type ToolPaths } from '@postgear/media-tools';

/** The copy's folder inside the scratch root. Hidden, so the job-folder sweep skips it. */
export const SELF_UPDATE_DIR = '.yt-dlp';
/** The updater downloads about 40 MB from GitHub. */
export const SELF_UPDATE_TIMEOUT_MS = 3 * 60_000;

export type SelfUpdateOutcome =
  /** The switch is off: nothing was done. */
  | 'off'
  /** Simulation, or this worker does not import links: nothing was done. */
  | 'skipped'
  /** The image's yt-dlp could not be found: it is used as configured. */
  | 'not-found'
  /** The copy is updated (or was already the newest) and is used from now on. */
  | 'updated'
  /** The updater failed: the image's yt-dlp is used. */
  | 'failed';

export interface SelfUpdateOptions {
  /** `YTDLP_SELF_UPDATE === 'true'`. */
  enabled: boolean;
  /** `CLIPS_SIMULATION === 'true'`. */
  simulation: boolean;
  /** Whether this worker serves the `media` role, the only one that starts yt-dlp. */
  importsLinks: boolean;
  paths: ToolPaths;
  /** The absolute scratch root (`CLIPS_SCRATCH_DIR`). */
  scratchRoot: string;
  /** Builds the run tool for the copy; tests pass a fake. */
  makeRunTool?: (paths: ToolPaths) => RunTool;
  /** Where a bare `YTDLP_PATH` name is looked up; defaults to this process's PATH. */
  searchPath?: string;
  platform?: NodeJS.Platform;
  log?: (line: string) => void;
  warn?: (line: string) => void;
}

export interface SelfUpdateResult {
  /** The paths every job uses from now on. */
  paths: ToolPaths;
  outcome: SelfUpdateOutcome;
}

/** "Updated yt-dlp to stable@2026.11.12 from yt-dlp/yt-dlp" or "yt-dlp is up to date (stable@2026.10.26 ...)". */
const VERSION_IN_UPDATER = /(\d{4}\.\d{2}\.\d{2}(?:\.\d+)?)/;

/**
 * Runs the updater when the switch asks for it and answers which yt-dlp the
 * worker should use. Never throws: every problem is a warning and the image's
 * yt-dlp.
 */
export async function selfUpdateYtDlp(options: SelfUpdateOptions): Promise<SelfUpdateResult> {
  const log = options.log ?? ((line: string) => console.log(line));
  const warn = options.warn ?? ((line: string) => console.warn(line));
  const unchanged = (outcome: SelfUpdateOutcome): SelfUpdateResult => ({
    paths: options.paths,
    outcome,
  });

  if (!options.enabled) return unchanged('off');
  if (options.simulation) {
    log(
      '[worker:clips] YTDLP_SELF_UPDATE is on, but CLIPS_SIMULATION=true: yt-dlp is not updated (links come from recordings).',
    );
    return unchanged('skipped');
  }
  if (!options.importsLinks) return unchanged('skipped');

  const platform = options.platform ?? process.platform;
  const source = await findProgram(
    options.paths.ytDlp,
    options.searchPath ?? process.env.PATH ?? '',
    platform,
  );
  if (!source) {
    warn(
      '[worker:clips] YTDLP_SELF_UPDATE is on, but yt-dlp was not found (YTDLP_PATH): it is not updated.',
    );
    return unchanged('not-found');
  }

  const dir = path.join(options.scratchRoot, SELF_UPDATE_DIR);
  const copy = path.join(dir, path.basename(source));
  try {
    await mkdir(dir, { recursive: true });
    // Start from the image's file every boot, so a failed update never leaves an older copy in use.
    if (path.resolve(copy) !== path.resolve(source)) {
      await copyFile(source, copy);
    }
    if (platform !== 'win32') await chmod(copy, 0o755);
  } catch {
    warn(
      '[worker:clips] YTDLP_SELF_UPDATE: could not copy yt-dlp into the scratch folder. Using the image copy.',
    );
    return unchanged('failed');
  }

  const updated: ToolPaths = { ...options.paths, ytDlp: copy };
  const runTool = (options.makeRunTool ?? createRunTool)(updated);
  try {
    const result = await runTool('yt-dlp', ['--ignore-config', '--update'], {
      cwd: dir,
      timeoutMs: SELF_UPDATE_TIMEOUT_MS,
    });
    const version = VERSION_IN_UPDATER.exec(`${result.stdout}\n${result.stderrTail}`)?.[1];
    log(
      `[worker:clips] YTDLP_SELF_UPDATE: yt-dlp ${version ?? '(version not read)'} from the scratch folder is used.`,
    );
    return { paths: updated, outcome: 'updated' };
  } catch (error) {
    const why =
      error instanceof ToolError
        ? error.timedOut
          ? 'it took too long'
          : `it exited with code ${error.exitCode ?? 'none'}`
        : 'it could not start';
    warn(
      `[worker:clips] YTDLP_SELF_UPDATE: the yt-dlp updater failed (${why}). Using the image copy.`,
    );
    return unchanged('failed');
  }
}

/**
 * An absolute path as given, or a bare name looked up on `searchPath` (with
 * `.exe` tried on Windows). Null when nothing runnable is there.
 */
export async function findProgram(
  program: string,
  searchPath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (path.isAbsolute(program)) {
    return (await isRunnable(program, platform)) ? program : null;
  }
  if (program.includes('/') || program.includes('\\')) return null;
  const delimiter = platform === 'win32' ? ';' : ':';
  const names =
    platform === 'win32' && !program.toLowerCase().endsWith('.exe')
      ? [`${program}.exe`, program]
      : [program];
  for (const folder of searchPath.split(delimiter)) {
    if (folder.trim().length === 0 || !path.isAbsolute(folder)) continue;
    for (const name of names) {
      const candidate = path.join(folder, name);
      if (await isRunnable(candidate, platform)) return candidate;
    }
  }
  return null;
}

async function isRunnable(file: string, platform: NodeJS.Platform): Promise<boolean> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  if (platform === 'win32') return true;
  return access(file, constants.X_OK).then(
    () => true,
    () => false,
  );
}
