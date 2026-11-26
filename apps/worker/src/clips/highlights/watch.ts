/**
 * Look For Action (Sprint 13, Module 06): the `watching` stage of a Find
 * Clips run whose setup asks for it. A Node activity cannot call the Python
 * service, so the run is cut in steps the workflow strings together:
 *
 * 1. `clipHighlights` gathers as before, keeps what it gathered in the run's
 *    state file (`watch-state-<job hex>.json.gz`) and answers the motion
 *    measure's input (only the stretches the stored motion track lacks; none
 *    when it is all there).
 * 2. `mediaPyMotion` (Python) measures how much the picture changes, two
 *    samples a second, into `motion-<job hex>.json.gz`.
 * 3. `clipHighlightsLook` lays the new values over the stored track, finds the
 *    bursts (`motionBursts`: cuts are not bursts, sound makes them stronger)
 *    and, when the run started with the vision check on, answers the stills
 *    to cut: four for each of the strongest twelve bursts.
 * 4. `mediaPyStills` (Python) cuts them (`still-<n>-<job hex>.jpg`).
 * 5. `clipHighlightsFinish` asks the API to check the stills (closed
 *    questions, one sentence back), turns the bursts into action candidates,
 *    scores, and deletes every file of steps 1 to 4 whatever happened. A
 *    failed or cancelled run deletes them in its bookkeeping (`allWatchKeys`).
 *
 * The motion measure failing is not the run failing: the run goes on without
 * action and Look For Action's charge is given back. The still check failing
 * leaves the bursts unchecked (a little lower score, no sentence). No speech,
 * AI answer or picture ever rides in a workflow payload or a log line.
 */
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import {
  MAX_MOTION_RANGES,
  MEDIA_CONTRACT_VERSION,
  type MediaPyMotionInput,
  type MediaPyStillsInput,
  motionFile,
} from '@postgear/media-contract';
import { CLIP_STILLS_PER_BURST, type ClipStillVerdict } from '@postgear/scheduling';
import {
  type ActionCandidate,
  burstStillMoments,
  CLIP_LENGTH_BOUNDS,
  type ClipSetup,
  isCurrentMotionTrack,
  MOTION_TUNING,
  type MotionBurst,
  mergeMotion,
  motionBursts,
  actionWindow,
  type SignalTrack,
  unmeasuredMotion,
} from '@postgear/video-engine';
import { ClipStepError } from '../failures';
import { deleteQuietly } from '../import/import.steps';
import { allWatchKeys, watchKeys } from '../keys';
import type { AssetRow, VideoLinkRow, VideoRow } from '../rows';
import { simulationHint } from '../transcribe/transcribe.run';
import {
  type Gathered,
  type HighlightsOutcome,
  type HighlightsRun,
  readRunSetup,
  scoreHighlights,
  storedSignals,
} from './highlights.run';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** `[simulate:action-fail]` fails the motion measure; `[simulate:stills-fail]` the stills. */
export const ACTION_FAIL_MARKER = '[simulate:action-fail]';
export const ACTION_SLOW_MARKER = '[simulate:action-slow]';
export const STILLS_FAIL_MARKER = '[simulate:stills-fail]';
/** Still width: enough for the model's low-detail look, small to send. */
export const STILL_WIDTH = 768;
/** A state file larger than this is not one a run wrote. */
const STATE_MAX_JSON_BYTES = 64 * 1024 * 1024;

const WATCH_STATE_VERSION = 1;

/** What a run keeps between its steps (private storage, deleted when the run ends). */
export interface WatchState {
  version: typeof WATCH_STATE_VERSION;
  gathered: Gathered;
  /** Set by the look step. */
  motion: SignalTrack | null;
  bursts: MotionBurst[];
  watched: boolean;
  /** Bursts whose stills were asked for, strongest first (0 without the vision check). */
  checked: number;
}

async function writeState(run: HighlightsRun, state: WatchState): Promise<void> {
  const key = watchKeys.state(run.organizationId, run.video.id, run.jobId);
  const file = path.join(run.dir, 'watch-state.json.gz');
  await writeFile(file, await gzipAsync(Buffer.from(JSON.stringify(state), 'utf8')));
  await run.privateStorage.putFile(key, file, 'application/gzip');
}

async function readState(run: HighlightsRun): Promise<WatchState> {
  const key = watchKeys.state(run.organizationId, run.video.id, run.jobId);
  const file = path.join(run.dir, 'watch-state-read.json.gz');
  await run.privateStorage.getToFile(key, file, run.signal);
  const json = await gunzipAsync(await readFile(file), { maxOutputLength: STATE_MAX_JSON_BYTES });
  const state = JSON.parse(json.toString('utf8')) as WatchState;
  if (state.version !== WATCH_STATE_VERSION) {
    throw new ClipStepError('highlights_failed', { retryable: false });
  }
  return state;
}

/** The forced states for the simulated visual steps, from the video's title. */
function visualHint(
  video: Pick<VideoRow, 'title'>,
  link: VideoLinkRow | null,
  step: 'motion' | 'stills',
): MediaPyMotionInput['simulation'] {
  const sample = simulationHint(video, link).sample;
  const title = video.title;
  const force =
    step === 'motion'
      ? title.includes(ACTION_FAIL_MARKER)
        ? 'fail'
        : title.includes(ACTION_SLOW_MARKER)
          ? 'slow'
          : null
      : title.includes(STILLS_FAIL_MARKER)
        ? 'fail'
        : null;
  return { sample, force };
}

function newestKey(assets: readonly AssetRow[], kind: AssetRow['kind']): string | null {
  return assets.filter((row) => row.kind === kind).at(-1)?.key ?? null;
}

/**
 * Step 1's end: keeps what was gathered and answers the motion measure's
 * input, or null when the stored motion track already covers the stretch
 * (or there is no light copy to measure).
 */
export async function startWatching(
  run: HighlightsRun,
  gathered: Gathered,
  setup: ClipSetup,
): Promise<{ motion: MediaPyMotionInput | null }> {
  const durationMs = run.video.durationMs ?? 0;
  await run.progress.report({ stage: 'watching', progress: 90 });
  await writeState(run, {
    version: WATCH_STATE_VERSION,
    gathered,
    motion: null,
    bursts: [],
    watched: false,
    checked: 0,
  });
  const assets = await run.rows.videoAssets(run.organizationId, run.video.id);
  const proxyKey = newestKey(assets, 'PROXY');
  if (!proxyKey) return { motion: null };
  const stored = await storedSignals(run, assets);
  const storedMotion = stored?.tracks.find((track) => track.name === 'motion') ?? null;
  const range = { fromMs: setup.range.fromMs, toMs: Math.min(setup.range.toMs, durationMs) };
  let ranges = unmeasuredMotion(storedMotion, range, durationMs);
  if (ranges.length === 0) return { motion: null };
  // Many small gaps: measure the whole stretch once instead.
  if (ranges.length > MAX_MOTION_RANGES) ranges = [range];
  return {
    motion: {
      version: MEDIA_CONTRACT_VERSION,
      jobId: run.jobId,
      orgId: run.organizationId,
      videoId: run.video.id,
      proxyKey,
      durationMs,
      ranges,
      sampleFps: 2,
      simulation: run.simulated ? visualHint(run.video, run.link, 'motion') : null,
    },
  };
}

/** The values of the motion file the Python step wrote; null when it does not read. */
async function readMotionFile(
  run: HighlightsRun,
  key: string,
): Promise<ReadonlyArray<number | null> | null> {
  const file = path.join(run.dir, 'motion.json.gz');
  await run.privateStorage.getToFile(key, file, run.signal);
  try {
    const json = await gunzipAsync(await readFile(file), { maxOutputLength: STATE_MAX_JSON_BYTES });
    const parsed = motionFile.safeParse(JSON.parse(json.toString('utf8')));
    return parsed.success ? parsed.data.values : null;
  } catch {
    return null;
  }
}

/**
 * Step 3: the motion track (new values over the stored ones), the bursts of
 * the chosen stretch, and the stills to cut when the vision check is on.
 */
export async function lookForAction(
  run: HighlightsRun,
  measure: { motionKey: string | null; motionFailed: boolean },
): Promise<{ stills: MediaPyStillsInput | null }> {
  const durationMs = run.video.durationMs ?? 0;
  const chosen = readRunSetup(run.run.params);
  if (!chosen?.setup.action) throw new ClipStepError('highlights_failed', { retryable: false });
  await run.progress.report({ stage: 'watching', progress: 93 });
  const state = await readState(run);
  const assets = await run.rows.videoAssets(run.organizationId, run.video.id);
  const stored = await storedSignals(run, assets);
  const storedMotion = stored?.tracks.find((track) => track.name === 'motion') ?? null;

  let motion: SignalTrack | null = null;
  if (!measure.motionFailed) {
    const values = measure.motionKey ? await readMotionFile(run, measure.motionKey) : null;
    if (values) motion = mergeMotion(storedMotion, values, durationMs);
    else if (!measure.motionKey && isCurrentMotionTrack(storedMotion)) motion = storedMotion;
  }
  const track = (name: string) => state.gathered.tracks.find((one) => one.name === name) ?? null;
  const range = {
    fromMs: chosen.setup.range.fromMs,
    toMs: Math.min(chosen.setup.range.toMs, durationMs),
  };
  const bursts = motion
    ? motionBursts(motion, track('scene'), track('loudness'), { durationMs, range })
    : [];

  const checked = chosen.actionVision ? Math.min(bursts.length, MOTION_TUNING.maxChecked) : 0;
  // A motion track only joins the stored file when this run measured something new.
  const measuredNow = motion !== null && measure.motionKey !== null;
  await writeState(run, {
    ...state,
    motion: measuredNow ? motion : null,
    bursts,
    watched: motion !== null,
    checked,
  });
  const proxyKey = newestKey(assets, 'PROXY');
  if (checked === 0 || !proxyKey) return { stills: null };
  return {
    stills: {
      version: MEDIA_CONTRACT_VERSION,
      jobId: run.jobId,
      orgId: run.organizationId,
      videoId: run.video.id,
      proxyKey,
      durationMs,
      momentsMs: bursts.slice(0, checked).flatMap((burst) => burstStillMoments(burst, durationMs)),
      width: STILL_WIDTH,
      simulation: run.simulated ? visualHint(run.video, run.link, 'stills') : null,
    },
  };
}

/**
 * The bursts as the blend takes them. A checked burst the model found nothing
 * notable in is dropped; a notable one keeps its score and its sentence; an
 * unchecked one (no vision, or its call failed) counts a little less.
 */
export function actionCandidates(
  bursts: readonly MotionBurst[],
  verdicts: ReadonlyArray<ClipStillVerdict | null> | null,
  setup: Pick<ClipSetup, 'length' | 'range'>,
): ActionCandidate[] {
  const bounds = CLIP_LENGTH_BOUNDS[setup.length];
  const out: ActionCandidate[] = [];
  bursts.forEach((burst, index) => {
    const verdict = verdicts?.[index];
    if (verdict && !verdict.notable) return;
    const window = actionWindow(burst, bounds, setup.range);
    if (verdict?.notable) {
      out.push({
        ...window,
        peakMs: burst.peakMs,
        score: burst.score,
        reason: 'something_unexpected',
        seen: verdict.line || null,
      });
      return;
    }
    out.push({
      ...window,
      peakMs: burst.peakMs,
      score: Math.round(burst.score * MOTION_TUNING.unseenWeight),
      reason: 'sudden_movement',
      seen: null,
    });
  });
  return out;
}

/**
 * Step 5: the still check (when there are stills), the action candidates,
 * the scoring, and every watch file deleted. The stills go as soon as they
 * were looked at. A step that throws keeps the files for its retry; when the
 * run ends badly its bookkeeping deletes them (`closeHighlights`).
 */
export async function finishWatching(
  run: HighlightsRun,
  stillKeys: readonly string[] | null,
): Promise<HighlightsOutcome> {
  const watchFiles = allWatchKeys(run.organizationId, run.video.id, run.jobId);
  const durationMs = run.video.durationMs ?? 0;
  const chosen = readRunSetup(run.run.params);
  if (!chosen?.setup.action) throw new ClipStepError('highlights_failed', { retryable: false });
  await run.progress.report({ stage: 'watching', progress: 95 });
  const state = await readState(run);

  let verdicts: Array<ClipStillVerdict | null> | null = null;
  const usable = stillKeys && stillKeys.length === state.checked * CLIP_STILLS_PER_BURST;
  if (usable && state.checked > 0 && run.internal?.checkStills) {
    try {
      const answer = await run.internal.checkStills(run.jobId, {
        organizationId: run.organizationId,
        bursts: state.bursts.slice(0, state.checked).map((burst, index) => ({
          stillKeys: stillKeys.slice(
            index * CLIP_STILLS_PER_BURST,
            (index + 1) * CLIP_STILLS_PER_BURST,
          ),
          momentSec: burst.peakMs / 1000,
          spanSec: (burst.toMs + 2_000 - (burst.fromMs - 500)) / 1000,
          withSound: burst.withSound,
        })),
      });
      verdicts = answer.verdicts;
      // Looked at: the pictures go now, not when the run ends.
      await deleteQuietly(run.privateStorage, [...stillKeys]);
    } catch (error) {
      if (run.signal.aborted) throw new ClipStepError('cancelled', { retryable: false });
      // The still check is a bonus: the bursts stay, unchecked.
      console.warn(
        JSON.stringify({
          event: 'clips.highlights.stills_unchecked',
          jobId: run.jobId,
          reason: error instanceof Error ? error.name : 'unknown',
        }),
      );
    }
  }
  run.heartbeat();
  if (!state.watched && run.internal?.reverseCharges) {
    // The picture was never measured: Look For Action's minutes go back.
    await run.internal.reverseCharges(run.jobId, {
      organizationId: run.organizationId,
      step: 'action',
    });
  }
  const range = {
    fromMs: chosen.setup.range.fromMs,
    toMs: Math.min(chosen.setup.range.toMs, durationMs),
  };
  const candidates = actionCandidates(state.bursts, verdicts, {
    length: chosen.setup.length,
    range,
  });
  console.log(
    JSON.stringify({
      event: 'clips.highlights.watched',
      jobId: run.jobId,
      watched: state.watched,
      bursts: state.bursts.length,
      checked: state.checked,
      notable: verdicts?.filter((verdict) => verdict?.notable).length ?? 0,
      candidates: candidates.length,
    }),
  );
  const outcome = await scoreHighlights(run, state.gathered, {
    candidates,
    motion: state.motion,
    watched: state.watched,
  });
  await deleteQuietly(run.privateStorage, watchFiles);
  return outcome;
}
