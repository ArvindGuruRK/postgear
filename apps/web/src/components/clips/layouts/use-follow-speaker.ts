'use client';

/**
 * Follow The Speaker's state in the editor (Sprint 13, Module 08). It lives
 * in the editor, not in the Layouts tab, because three places read it: the
 * tab (the switches, the picker, the lost stretch and Fix By Hand), the Video
 * pane (the moving frame, the hand-fix box) and the timeline (the Speaker
 * strip), and because a clip made with the setup switch follows on first
 * open whatever tab it opens on.
 *
 * - **On**: faces are asked for if missing (`POST /clips/:clipId/faces`,
 *   free), with "Finding faces" while a job looks (polling as Detect Camera
 *   does), the face file is read once, and the path is worked out here and
 *   applied as ONE undo step through `onEdit`, on the document as it is then.
 * - **Off**: `disableFollow`, one undo step, and a toast.
 * - **Show Both**, the picker's pick, a hand fix and Clear Fix: one undo step
 *   each. The face file stays in memory for them; a clip opened already
 *   following reads it once, quietly, for the strip.
 * - **Follow on first open**: once per mount, when asked (`followOnOpen`),
 *   with the same flow, silent when it fails, one toast when it finds nobody
 *   ("Follow The Speaker was skipped: ..."), and skipped
 *   when the person changed the layout while the faces loaded.
 */
import {
  areaCropAt,
  type CanvasSize,
  type ClipDocument,
  disableFollow,
  type FacePictureInput,
  type FollowMode,
  type FollowOverride,
  followedAreaIds,
  isFollowing,
  type Person,
  type Rect,
} from '@postgear/video-engine';
import { toast } from '@postgear/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { ensureClipFaces, readClipFaces } from '@/lib/clips-api';
import { skipSentence } from '../editor/recipe-model';
import { readFaceFileBytes } from './detect-camera-model';
import {
  canShowBoth as canShowBothFor,
  clearOverride,
  type FaceData,
  FIX_CLEARED_SENTENCE,
  FIX_SAVED_SENTENCE,
  FOLLOW_FAILED,
  FOLLOW_ON_SENTENCE,
  type FollowPlan,
  facesCoverClip,
  followRanges,
  followShape,
  followWith,
  OWN_LAYOUT_BACK,
  overrideFor,
  placeOverride,
  pickAnchor,
  planFollow,
  SHOW_BOTH_SENTENCE,
  type SourceSpan,
  type SpeakerStretchModel,
  speakerStretches,
  UNKNOWN_FACE_ASSET_ID,
  withOverrides,
} from './follow-model';
import type { LayoutEdit } from './layouts-panel';

/** How often the job is asked about while it looks, and for how long at most. */
const POLL_MS = 1_000;
const POLL_LIMIT = 180;

export interface FollowSpeakerDeps {
  ensure: typeof ensureClipFaces;
  read: typeof readClipFaces;
  /** Fetches the face file from its address (the browser's own `fetch` by default). */
  loadFile: (url: string, signal: AbortSignal) => Promise<FacePictureInput[] | null>;
  wait: (ms: number) => Promise<void>;
  /** Shows a toast ("Your own layout is back."). */
  notify: (title: string) => void;
}

async function loadFaceFile(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'omit', signal });
  if (!response.ok || !response.body) return null;
  return readFaceFileBytes(response.body);
}

export const FOLLOW_DEPS: FollowSpeakerDeps = {
  ensure: ensureClipFaces,
  read: readClipFaces,
  loadFile: loadFaceFile,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  notify: (title) => {
    toast({ title });
  },
};

/** "Follow The Speaker was skipped: we could not find anyone to follow." */
export const FOLLOW_SKIPPED = skipSentence({ part: 'follow', reason: 'no_faces' });

export type FollowPhase =
  | { kind: 'idle' }
  | { kind: 'finding'; progress: number }
  | { kind: 'many'; people: Person[] }
  | { kind: 'none' }
  | { kind: 'failed'; message: string };

/** The stretch being fixed by hand: its time in the video, the area, and where its box starts. */
export interface FollowFixing {
  source: SourceSpan;
  areaId: string;
  rect: Rect;
}

export interface FollowSpeakerController {
  /** The clip's shape can follow (Vertical, Portrait, Square). */
  shown: boolean;
  /** Finding faces can run right now (`ai.faces`). */
  available: boolean;
  following: boolean;
  mode: FollowMode | null;
  phase: FollowPhase;
  /** The switch shows on: following, finding faces, or asking whom to follow. */
  switchedOn: boolean;
  canShowBoth: boolean;
  /** The Speaker strip's stretches (empty when not following or not known yet). */
  stretches: SpeakerStretchModel[];
  selected: SpeakerStretchModel | null;
  fixing: FollowFixing | null;
  /** False when the clip now plays past the face file (a trim outward): Follow Again. */
  covered: boolean;
  turnOn: () => void;
  turnOff: () => void;
  setShowBoth: (on: boolean) => void;
  pick: (personId: string) => void;
  select: (key: string | null) => void;
  startFix: () => void;
  finishFix: (rect: Rect) => void;
  cancelFix: () => void;
  clearFix: () => void;
  followAgain: () => void;
}

export function useFollowSpeaker({
  clipId,
  document,
  videoSize,
  available,
  onEdit,
  followOnOpen = false,
  onReveal,
  onSeek,
  deps = FOLLOW_DEPS,
}: {
  clipId: string;
  document: ClipDocument;
  videoSize: CanvasSize;
  available: boolean;
  /** One undo step: the change and the sentence a screen reader hears. */
  onEdit: LayoutEdit;
  /** The clip asks to follow on its first open (`meta.followOnOpen`), and the editor is ready. */
  followOnOpen?: boolean;
  /** A lost stretch was chosen on the strip: show the Layouts tab. */
  onReveal?: () => void;
  /** Move the playhead (clip ms), to show the stretch being fixed. */
  onSeek?: (outputMs: number) => void;
  deps?: FollowSpeakerDeps;
}): FollowSpeakerController {
  const [phase, setPhase] = useState<FollowPhase>({ kind: 'idle' });
  const [data, setData] = useState<FaceData | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [fixing, setFixing] = useState<FollowFixing | null>(null);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef({ document, data, videoSize, onEdit, onReveal, onSeek, deps });
  latest.current = { document, data, videoSize, onEdit, onReveal, onSeek, deps };
  useEffect(() => () => abort.current?.abort(), []);

  const following = isFollowing(document);
  const follow = document.layout.follow;
  const mode = follow?.mode ?? null;
  const overrides = follow?.overrides;

  // ---- Loading the faces --------------------------------------------------------------

  /** The faces for the clip as it is: asked for first when `ensure`, polled while a job looks. */
  const load = useCallback(
    async (signal: AbortSignal, ensure: boolean, quiet: boolean): Promise<FaceData | null> => {
      const { deps: d } = latest.current;
      const started = ensure ? await d.ensure(clipId) : null;
      let read = await d.read(clipId, { signal, follow: true });
      for (let tries = 0; read.status === 'running' && tries < POLL_LIMIT; tries += 1) {
        if (!quiet) setPhase({ kind: 'finding', progress: read.job.progress });
        await d.wait(POLL_MS);
        if (signal.aborted) return null;
        read = await d.read(clipId, { signal, follow: true });
      }
      if (started?.status === 'running' && read.status === 'none') return null;
      if (read.status !== 'ready') return null;
      const frames = await d.loadFile(read.url, signal);
      if (signal.aborted || !frames) return null;
      return {
        frames,
        meta: { fromMs: read.meta.fromMs, toMs: read.meta.toMs },
        sceneCutsMs: read.sceneCutsMs ?? [],
        speech: read.speech ?? null,
        assetId: read.assetId ?? UNKNOWN_FACE_ASSET_ID,
      };
    },
    [clipId],
  );

  /**
   * Turns following on (or refreshes it): the faces, then the path on the
   * document as it is then, as one undo step. `silent`: no line when nobody
   * is found or it fails, and no picker.
   */
  const run = useCallback(
    async (options: {
      mode: FollowMode;
      silent: boolean;
      refresh: boolean;
      /**
       * The many-faces pick (an anchor, `pickAnchor`): null for none, left out
       * to keep the one the document holds.
       */
      pick?: string | null;
      /**
       * The layout (as JSON) the run started from: the first-open run steps
       * aside when the person changed the layout meanwhile (a recipe, a pick).
       */
      onlyIfLayout?: string;
    }) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const { signal } = controller;
      setPhase({ kind: 'finding', progress: 0 });
      const fail = (message: string) =>
        setPhase(options.silent ? { kind: 'idle' } : { kind: 'failed', message });
      try {
        const current = latest.current.data;
        const reuse =
          !options.refresh &&
          current !== null &&
          facesCoverClip(latest.current.document, current.meta);
        const faces = reuse ? current : await load(signal, true, false);
        if (signal.aborted) return;
        if (!faces) return fail(FOLLOW_FAILED);
        setData(faces);
        if (
          options.onlyIfLayout !== undefined &&
          JSON.stringify(latest.current.document.layout) !== options.onlyIfLayout
        ) {
          setPhase({ kind: 'idle' });
          return;
        }

        let outcome = 'none' as FollowPlan['kind'];
        let people: Person[] = [];
        latest.current.onEdit(
          (doc) => {
            const result = followWith(doc, faces, latest.current.videoSize, {
              mode: options.mode,
              pick:
                options.pick !== undefined ? options.pick : (doc.layout.follow?.personId ?? null),
              overrides: doc.layout.follow?.mode === 'speaker' ? doc.layout.follow.overrides : [],
            });
            outcome = result.plan.kind;
            if (result.plan.kind === 'many') people = result.plan.people;
            return result.doc;
          },
          options.mode === 'both' ? SHOW_BOTH_SENTENCE : FOLLOW_ON_SENTENCE,
        );
        if (outcome === 'many' && !options.silent) setPhase({ kind: 'many', people });
        else if (outcome === 'none' && !options.silent) setPhase({ kind: 'none' });
        else setPhase({ kind: 'idle' });
        // The first open asked to follow (Auto-Edit, Clip Setup) and nobody is
        // in the clip: say the part was skipped, once, as the recipes do (Module 16).
        if (outcome === 'none' && options.silent) latest.current.deps.notify(FOLLOW_SKIPPED);
      } catch (error) {
        if (signal.aborted) return;
        fail(error instanceof ApiError && error.message ? error.message : FOLLOW_FAILED);
      }
    },
    [load],
  );

  // A clip opened already following: read its faces once, quietly, for the strip and the fixes.
  // No "already ran" flag: a cancelled read (React runs effects twice in development, and the
  // editor remounts after the shape question) must be read again by the next run.
  useEffect(() => {
    if (!following || data) return;
    const controller = new AbortController();
    load(controller.signal, false, true)
      .then((faces) => {
        if (faces && !controller.signal.aborted) setData(faces);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [following, data, load]);

  // Follow on first open (Clip Setup's switch): once, silently.
  const openRan = useRef(false);
  const shapeFollows = followShape(document.canvas.ratio);
  useEffect(() => {
    if (!followOnOpen || openRan.current || !available || !shapeFollows) return;
    openRan.current = true;
    if (isFollowing(latest.current.document)) return;
    void run({
      mode: 'speaker',
      silent: true,
      refresh: false,
      onlyIfLayout: JSON.stringify(latest.current.document.layout),
    });
  }, [followOnOpen, available, shapeFollows, run]);

  // Not following any more (off, undo): nothing is being fixed or picked.
  useEffect(() => {
    if (following) return;
    setFixing(null);
    setSelectedKey(null);
  }, [following]);

  // ---- The plan for the strip -----------------------------------------------------------

  const cache = useRef<{ key: string; data: FaceData | null; plan: FollowPlan | null }>({
    key: '',
    data: null,
    plan: null,
  });
  let plan: FollowPlan | null = null;
  if (following && data && mode) {
    const own = follow?.saved;
    const key = JSON.stringify([
      followRanges(document, data.meta),
      mode,
      overrides,
      own?.areas.map((a) => a.frame),
      document.canvas.ratio,
      follow?.personId,
      videoSize,
    ]);
    if (cache.current.key !== key || cache.current.data !== data) {
      cache.current = {
        key,
        data,
        plan: planFollow(document, data, videoSize, {
          mode,
          pick: follow?.personId ?? null,
          overrides: overrides ?? [],
        }),
      };
    }
    plan = cache.current.plan;
  }
  const stretches = useMemo(
    () => (plan ? speakerStretches(document, plan, overrides ?? []) : []),
    [document, plan, overrides],
  );
  const selected = stretches.find((s) => s.key === selectedKey) ?? null;
  const covered = !following || !data || facesCoverClip(document, data.meta);

  // ---- Actions ---------------------------------------------------------------------------

  const turnOn = useCallback(() => {
    void run({ mode: 'speaker', silent: false, refresh: false, pick: null });
  }, [run]);

  const turnOff = useCallback(() => {
    abort.current?.abort();
    setPhase({ kind: 'idle' });
    setFixing(null);
    setSelectedKey(null);
    if (!isFollowing(latest.current.document)) return;
    latest.current.onEdit((doc) => disableFollow(doc), OWN_LAYOUT_BACK);
    latest.current.deps.notify(OWN_LAYOUT_BACK);
  }, []);

  const setShowBoth = useCallback(
    (on: boolean) => {
      setFixing(null);
      void run({ mode: on ? 'both' : 'speaker', silent: false, refresh: false, pick: null });
    },
    [run],
  );

  // The pick is stored in the document (as an anchor), so undo, a reload and a fix all keep it.
  const pick = useCallback(
    (personId: string) => {
      const faces = latest.current.data;
      const person = phase.kind === 'many' ? phase.people.find((p) => p.id === personId) : null;
      const anchor = faces && person ? pickAnchor(latest.current.document, faces, person) : null;
      if (!anchor) return;
      void run({ mode: 'speaker', silent: false, refresh: false, pick: anchor });
    },
    [run, phase],
  );

  const select = useCallback((key: string | null) => {
    setSelectedKey(key);
    setFixing(null);
    if (key && !key.startsWith('person:')) latest.current.onReveal?.();
  }, []);

  const startFix = useCallback(() => {
    if (!selected || selected.kind === 'person') return;
    const doc = latest.current.document;
    if (doc.layout.follow?.mode !== 'speaker') return;
    const areaId = followedAreaIds(doc)[0];
    const area = doc.layout.areas.find((a) => a.id === areaId);
    if (!areaId || !area) return;
    const fixed = overrideFor(doc.layout.follow.overrides, selected.source);
    setFixing({
      source: selected.source,
      areaId,
      rect: fixed ? { ...fixed.rect } : areaCropAt(area, selected.source.from),
    });
    latest.current.onSeek?.(selected.fromMs);
  }, [selected]);

  const finishFix = useCallback(
    (rect: Rect) => {
      const current = fixing;
      const faces = latest.current.data;
      setFixing(null);
      if (!current || !faces) return;
      latest.current.onEdit((doc) => {
        const own: FollowOverride[] = doc.layout.follow?.overrides ?? [];
        return withOverrides(
          doc,
          faces,
          latest.current.videoSize,
          placeOverride(own, current.source, rect),
        );
      }, FIX_SAVED_SENTENCE);
    },
    [fixing],
  );

  const cancelFix = useCallback(() => setFixing(null), []);

  const clearFix = useCallback(() => {
    const faces = latest.current.data;
    if (!selected || !faces) return;
    setFixing(null);
    latest.current.onEdit((doc) => {
      const own = doc.layout.follow?.overrides ?? [];
      return withOverrides(
        doc,
        faces,
        latest.current.videoSize,
        clearOverride(own, selected.source),
      );
    }, FIX_CLEARED_SENTENCE);
  }, [selected]);

  const followAgain = useCallback(() => {
    const now = latest.current.document.layout.follow?.mode ?? 'speaker';
    void run({ mode: now, silent: false, refresh: true });
  }, [run]);

  const picking = phase.kind === 'many';
  return {
    shown: shapeFollows,
    available,
    following,
    mode,
    phase,
    switchedOn: following || phase.kind === 'finding' || picking,
    canShowBoth: following && canShowBothFor(plan),
    stretches,
    selected,
    fixing,
    covered,
    turnOn,
    turnOff,
    setShowBoth,
    pick,
    select,
    startFix,
    finishFix,
    cancelFix,
    clearFix,
    followAgain,
  };
}
