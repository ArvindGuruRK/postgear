/**
 * Every number the highlight scorer uses, in one place (Module 16 section 2;
 * the starting values are research 06 section 7's). None has been tuned on
 * real videos yet: the real-test plan records which proposals Arvind kept
 * and which moments he marked by hand, and one tuning round follows. A change
 * to any value here bumps `SIGNALS_ENGINE_VERSION` and the tuning name, so a
 * run always says which rules picked its clips.
 */
import type { SignalTrackName } from './types';

/** The tuning set's name, stored on each run's `params`. */
export const SIGNALS_TUNING = 'signals-v1';
/** `ClipHighlightRun.engineVersion`. */
export const SIGNALS_ENGINE_VERSION = 1;

export const TUNING = Object.freeze({
  /** Every track is scored on one grid: two samples a second. */
  rateHz: 2,

  // ---- Baseline ("how unusual is this moment for this video") --------------------
  /** The rolling median and spread look this far each side of a moment. */
  baselineHalfWindowSec: 150,
  /** The baseline is worked out this often and joined by straight lines between. */
  baselineEverySec: 10,
  /** Shorter videos use one baseline for the whole file. */
  wholeFileBelowSec: 600,
  /** Turns a median absolute deviation into a standard deviation for normal data. */
  madScale: 1.4826,
  /** Unusualness is clamped to 0 to this: only rises count, and one spike cannot drown the rest. */
  zMax: 6,
  /** The smallest spread each track is measured against, so a calm stretch does not make everything look loud. */
  zFloors: Object.freeze({
    loudness: 1, // LU
    scene: 2, // scdet score, 0 to 100
    chat: 0.2, // messages a second
    replayed: 0.05, // share, 0 to 1
  } satisfies Record<SignalTrackName, number>),

  // ---- Track preparation -------------------------------------------------------------
  /** Loudness below this is silence (FFmpeg reads digital silence as about -120). */
  loudnessFloorLufs: -70,
  /** Silence at least this long is a muted stretch: no data, never in the baseline. */
  silenceGapSec: 10,
  /** Chat is averaged over this many seconds before it is compared. */
  chatSmoothSec: 5,
  /** Viewers type after the moment: chat is moved this much earlier to meet the sound. */
  chatLagSec: 8,
  /** Below this many messages an hour, chat is left out (Lightor's floor). */
  chatMinPerHour: 500,

  // ---- Combining ---------------------------------------------------------------------
  /** Re-scaled to add to one over whichever tracks are present. Without chat: 0.7 sound, 0.3 picture. */
  weights: Object.freeze({
    loudness: 0.35,
    scene: 0.15,
    chat: 0.5,
    replayed: 0.4,
  } satisfies Record<SignalTrackName, number>),
  /** Two or more tracks at least this unusual within `agreementWithinSec` of each other ... */
  agreementZ: 2,
  agreementWithinSec: 5,
  /** ... multiply the moment's strength by this. */
  agreementBonus: 1.25,
  /** The combined strength is averaged over this many seconds before peaks are picked. */
  smoothSec: 3,

  // ---- Peaks ---------------------------------------------------------------------------
  /** The weakest moment that can become a clip. */
  peakMin: 2,
  /** Two picks are at least this far apart (research 06; Lightor's 120 s ranks whole highlights). */
  peakMinGapSec: 45,
  /** At most one clip for each this many seconds of video ... */
  secondsPerClip: 80,
  /** ... but always room for this many ... */
  minClipsCap: 3,
  /** ... and never more than this (CL-4.1). */
  maxClips: 20,

  // ---- Windows -------------------------------------------------------------------------
  /** Context before the moment. */
  leadInSec: 12,
  /** More context when chat is the strongest reason (it reacts to what led up to it). */
  chatLeadInSec: 20,
  /** After the moment, before the window grows with the moment itself. */
  tailSec: 8,
  /** The window's end grows while the strength stays above this. */
  extendAbove: 1,
  /** A window's start moves back to a scene cut this close, and its end forward to one. */
  snapCutWithinSec: 3,
  /** A scene score at or above this is a cut (scdet's own default threshold). */
  cutScore: 10,
  minClipSec: 15,
  maxClipSec: 60,

  // ---- Score and reasons ----------------------------------------------------------------
  /** score = 100 x (1 - exp(-strength / scoreScale)): 2 gives 55, 3 gives 70, 4 gives 80, 6 gives 91. */
  scoreScale: 2.5,
  /** Reasons look this far each side of the moment. */
  reasonWithinSec: 5,
  maxReasons: 3,
  /** A track this unusual gives its strong reason ("Chat exploded", "Loud reaction") ... */
  reasonStrongZ: 3,
  /** ... and this unusual its milder one ("Chat picked up", "Louder than usual"). */
  reasonZ: 2,
  /** "Sudden silence then noise": this much quieter than usual ... */
  silenceDropLu: 10,
  /** ... within this many seconds before the moment. */
  silenceBeforeSec: 6,
});

export type Tuning = typeof TUNING;
