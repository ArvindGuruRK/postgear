/**
 * Follow The Speaker's sums for the editor (Sprint 13, Module 08), pure so
 * they are tested without a browser.
 *
 * - **What is read**: the face file's pictures inside the stretches the clip
 *   plays, each widened by `FOLLOW_HANDLE_MS` (so a small trim outward is
 *   still followed), kept inside the file. People come from `linkPeople` as
 *   they are (NOT smoothed: the speaker choice reads the mouth's movement,
 *   which smoothing takes out); the path smooths them itself.
 * - **The plan**: `chooseSubjects` says who to follow when (or `many`, or
 *   `none`), `followPath` makes the speaker area's keyframes, `followBoth`
 *   Show Both's two. Everything is in the video's own time.
 * - **The pick** (many faces): stored in the document as an anchor (a time
 *   and the face's centre then, `layout.follow.personId`), not as a
 *   `linkPeople` id, because those ids follow first-seen order and change
 *   when a trim or a new face file changes the pictures read. The anchor is
 *   resolved to the person nearest it each time the plan is made.
 * - **The strip**: the subjects' stretches and the lost ones, mapped from the
 *   video's time to the clip's through the parts (a part played twice shows
 *   twice; a stretch cut out shows nowhere). A lost stretch a hand fix covers
 *   is `fixed`.
 *
 * The engine does the real work (`reframe/`); this file only joins it to the
 * document and the face file the editor holds.
 */
import {
  type CanvasSize,
  type ClipDocument,
  type CropKeyframe,
  canFollow,
  chooseSubjects,
  clipSourceRanges,
  disableFollow,
  documentRange,
  enableFollow,
  type FacePictureInput,
  type FollowMode,
  type FollowOverride,
  faceFileCovers,
  followAreasFor,
  followBoth,
  followPath,
  linkPeople,
  type Person,
  placeSegments,
  type Ratio,
  type Rect,
  SPEAKER_MANY_PEOPLE,
  type SpeechStretch,
  type SubjectSpan,
  setFollowOverrides,
} from '@postgear/video-engine';

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

export const FOLLOW_LABEL = 'Follow The Speaker';
export const SHOW_BOTH_LABEL = 'Show Both';
export const FOLLOW_HELP = 'The frame stays on whoever is talking.';
export const FOLLOW_OFF_NOTE = 'Finding faces is not available right now.';
export const FOLLOW_FINDING = 'Finding faces';
export const MANY_FACES = 'There are many faces here. Pick who to follow.';
export const NO_ONE_TO_FOLLOW = 'We could not find anyone to follow in this clip.';
export const FOLLOW_FAILED = 'We could not finish looking for faces. Try again.';
export const OWN_LAYOUT_BACK = 'Your own layout is back.';
export const FOLLOWING_NOTE = 'The frame follows the speaker. Turn it off to move it yourself.';
export const FOLLOW_ON_SENTENCE = 'Following the speaker.';
export const SHOW_BOTH_SENTENCE = 'Showing both people.';
export const FIX_BY_HAND = 'Fix By Hand';
export const CLEAR_FIX = 'Clear Fix';
export const FIX_NOTE = 'Drag the box onto the speaker, then press Done.';
export const FIXED_SENTENCE = 'You placed the frame by hand here.';
export const FIX_SAVED_SENTENCE = 'Frame placed by hand.';
export const FIX_CLEARED_SENTENCE = 'Hand fix cleared.';
export const PAST_FACES = 'The clip now plays past where we looked for faces.';
export const FOLLOW_AGAIN = 'Follow Again';

/** "We lost the speaker for 3 seconds here." (whole seconds, never fewer than one). */
export function lostSentence(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `We lost the speaker for ${seconds} ${seconds === 1 ? 'second' : 'seconds'} here.`;
}

/** A person's name in the picker and on the strip: "Person 1". */
export function personName(index: number): string {
  return `Person ${index + 1}`;
}

// ---------------------------------------------------------------------------
// The face data the editor holds
// ---------------------------------------------------------------------------

/** How far past each played stretch the pictures are read, so a small trim outward stays followed. */
export const FOLLOW_HANDLE_MS = 2_000;

/**
 * Stands in for the face file's asset id while the faces answer does not
 * carry one (the document only records which file a path came from).
 */
export const UNKNOWN_FACE_ASSET_ID = '00000000-0000-0000-0000-000000000000';

/** The face file and what the faces answer says beside it (Module 08). */
export interface FaceData {
  frames: readonly FacePictureInput[];
  /** The stretch of the video the file covers, ms of the video. */
  meta: { fromMs: number; toMs: number };
  /** Scene cuts inside the stretch, ms of the video. */
  sceneCutsMs: readonly number[];
  /** Where someone talks, ms of the video; null when the video was never listened to. */
  speech: readonly SpeechStretch[] | null;
  assetId: string;
}

export interface SourceSpan {
  from: number;
  to: number;
}

/** Whether the clip's shape can follow (Vertical, Portrait, Square: never a wide one). */
export function followShape(ratio: Ratio): boolean {
  return canFollow(ratio);
}

/** The played stretches, each widened by the handle, merged and kept inside the file. */
export function followRanges(
  doc: Pick<ClipDocument, 'segments'>,
  meta: FaceData['meta'],
): SourceSpan[] {
  const out: SourceSpan[] = [];
  for (const range of clipSourceRanges(doc)) {
    const from = Math.max(meta.fromMs, range.fromMs - FOLLOW_HANDLE_MS);
    const to = Math.min(meta.toMs, range.toMs + FOLLOW_HANDLE_MS);
    if (!(to > from)) continue;
    const last = out[out.length - 1];
    if (last && from <= last.to) last.to = Math.max(last.to, to);
    else out.push({ from, to });
  }
  return out;
}

/** The pictures the path is made from: those inside `followRanges`. */
export function picturesToFollow(
  doc: Pick<ClipDocument, 'segments'>,
  data: Pick<FaceData, 'frames' | 'meta'>,
): FacePictureInput[] {
  const ranges = followRanges(doc, data.meta);
  return data.frames.filter((frame) => ranges.some((r) => frame.t >= r.from && frame.t < r.to));
}

/** Whether the face file still covers everything the clip plays (false after a trim outward). */
export function facesCoverClip(
  doc: Pick<ClipDocument, 'segments'>,
  meta: FaceData['meta'],
): boolean {
  // Module 10: a brand intro or outro plays another video, so it needs no faces from this one.
  const own = doc.segments.filter((s) => s.role !== 'intro' && s.role !== 'outro');
  const range = documentRange({ segments: own.length > 0 ? own : doc.segments });
  return range === null || faceFileCovers(meta, range.fromMs, range.toMs);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type FollowPlan =
  | { kind: 'none' }
  /** More people than the speaker choice handles: the picker asks whom to follow. */
  | { kind: 'many'; people: Person[] }
  | {
      kind: 'ready';
      mode: FollowMode;
      /** The people seen, in the order they first appear (their strip colours). */
      people: Person[];
      /** Who is followed when (who talks, in Show Both). Empty when unknown. */
      spans: SubjectSpan[];
      /** Stretches with nobody to follow, ms of the video. */
      lost: SourceSpan[];
      /** `[speaker]` or `[top, bottom]`, as `enableFollow` takes them. */
      paths: CropKeyframe[][];
    };

export interface FollowOptions {
  mode: FollowMode;
  /** The many-faces pick as stored in the document (`pickAnchor`), or null. */
  pick?: string | null;
  /** Hand fixes (speaker mode only). */
  overrides?: readonly FollowOverride[];
}

function mergeSpans(ranges: readonly SourceSpan[]): SourceSpan[] {
  const out: SourceSpan[] = [];
  for (const r of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) last.to = Math.max(last.to, r.to);
    else if (r.to > r.from) out.push({ ...r });
  }
  return out;
}

/** Who to follow and the path, for the document as it is. Never changes it. */
export function planFollow(
  doc: ClipDocument,
  data: FaceData,
  videoSize: CanvasSize,
  options: FollowOptions,
): FollowPlan {
  const ranges = followRanges(doc, data.meta);
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (!first || !last) return { kind: 'none' };
  const fromMs = first.from;
  const toMs = last.to;
  const people = linkPeople(picturesToFollow(doc, data));
  const choice = chooseSubjects(people, {
    fromMs,
    toMs,
    speech: data.speech,
    pick: resolvePick(people, options.pick),
  });
  if (choice.kind === 'none') return { kind: 'none' };

  if (options.mode === 'both') {
    const areas = followAreasFor(doc, 'both', videoSize);
    const top = areas[0];
    const bottom = areas[1];
    if (!top || !bottom) return { kind: 'none' };
    const pair = followBoth(people, fromMs, toMs, data.sceneCutsMs, [top, bottom]);
    if (!pair) return { kind: 'none' };
    return {
      kind: 'ready',
      mode: 'both',
      people: choice.people,
      spans: choice.kind === 'spans' ? choice.spans : [],
      lost: mergeSpans([...pair[0].lost, ...pair[1].lost]),
      paths: [pair[0].keyframes, pair[1].keyframes],
    };
  }

  if (choice.kind === 'many') return { kind: 'many', people: choice.people };
  const area = followAreasFor(doc, 'speaker', videoSize)[0];
  if (!area) return { kind: 'none' };
  const path = followPath(people, choice.spans, data.sceneCutsMs, area, {
    overrides: options.overrides ?? [],
  });
  if (path.keyframes.length === 0) return { kind: 'none' };
  return {
    kind: 'ready',
    mode: 'speaker',
    people: choice.people,
    spans: choice.spans,
    lost: path.lost,
    paths: [path.keyframes],
  };
}

/** Whether Show Both is offered: two to four people (more go through the picker). */
export function canShowBoth(plan: FollowPlan | null): boolean {
  return (
    plan?.kind === 'ready' && plan.people.length >= 2 && plan.people.length <= SPEAKER_MANY_PEOPLE
  );
}

/** Follow The Speaker turned on (or its mode or path changed): the document and the plan. */
export function followWith(
  doc: ClipDocument,
  data: FaceData,
  videoSize: CanvasSize,
  options: FollowOptions,
): { doc: ClipDocument; plan: FollowPlan } {
  const overrides = options.mode === 'speaker' ? [...(options.overrides ?? [])] : [];
  const plan = planFollow(doc, data, videoSize, { ...options, overrides });
  if (plan.kind !== 'ready') return { doc, plan };
  const next = enableFollow(doc, {
    mode: plan.mode,
    faceAssetId: data.assetId,
    paths: plan.paths,
    overrides,
    personId: plan.mode === 'speaker' ? (options.pick ?? null) : null,
  });
  return { doc: next, plan };
}

/**
 * The hand fixes replaced, and the speaker's path worked out with them (for
 * the person the document says was picked, if any). Speaker mode only.
 */
export function withOverrides(
  doc: ClipDocument,
  data: FaceData,
  videoSize: CanvasSize,
  overrides: readonly FollowOverride[],
): ClipDocument {
  if (doc.layout.follow?.mode !== 'speaker') return doc;
  const pick = doc.layout.follow.personId ?? null;
  const plan = planFollow(doc, data, videoSize, { mode: 'speaker', pick, overrides });
  if (plan.kind !== 'ready') return doc;
  return setFollowOverrides(doc, overrides, plan.paths[0] ?? []);
}

function overlaps(a: SourceSpan, b: SourceSpan): boolean {
  return a.from < b.to && b.from < a.to;
}

/** The hand fixes with one for `span` (any fix it overlaps goes), in time order. */
export function placeOverride(
  overrides: readonly FollowOverride[],
  span: SourceSpan,
  rect: Rect,
): FollowOverride[] {
  return [
    ...overrides.filter((o) => !overlaps(o, span)),
    { from: span.from, to: span.to, rect: { ...rect } },
  ].sort((a, b) => a.from - b.from);
}

/** The hand fixes without any that overlap `span`. */
export function clearOverride(
  overrides: readonly FollowOverride[],
  span: SourceSpan,
): FollowOverride[] {
  return overrides.filter((o) => !overlaps(o, span));
}

/** The hand fix that covers `span`, if any. */
export function overrideFor(
  overrides: readonly FollowOverride[],
  span: SourceSpan,
): FollowOverride | null {
  return overrides.find((o) => overlaps(o, span)) ?? null;
}

/** A layout change made while following: following is turned off first, in the same undo step. */
export function unfollowFirst(
  change: (doc: ClipDocument) => ClipDocument,
): (doc: ClipDocument) => ClipDocument {
  return (doc) => change(disableFollow(doc));
}

// ---------------------------------------------------------------------------
// The strip
// ---------------------------------------------------------------------------

export type SpeakerStretchKind = 'person' | 'lost' | 'fixed';

export interface SpeakerStretchModel {
  key: string;
  kind: SpeakerStretchKind;
  /** The person's place in `plan.people` (their colour); null for lost and fixed stretches. */
  person: number | null;
  /** Where it shows on the timeline, ms of the clip. */
  fromMs: number;
  toMs: number;
  /** The stretch in the video's time (what a hand fix covers). */
  source: SourceSpan;
  /** What a screen reader hears. */
  label: string;
}

/** Where a stretch of the video plays in the clip: once per part that plays it, in clip ms. */
export function clipStretchesOf(
  doc: Pick<ClipDocument, 'segments'>,
  span: SourceSpan,
): Array<{ fromMs: number; toMs: number }> {
  const out: Array<{ fromMs: number; toMs: number }> = [];
  for (const { segment, outStart, outEnd } of placeSegments(doc)) {
    const from = Math.max(span.from, segment.sourceIn);
    const to = Math.min(span.to, segment.sourceOut);
    if (!(to > from)) continue;
    const fromMs = outStart + Math.round((from - segment.sourceIn) / segment.speed);
    const toMs = Math.min(outEnd, outStart + Math.round((to - segment.sourceIn) / segment.speed));
    if (toMs > fromMs) out.push({ fromMs, toMs });
  }
  return out;
}

/** The strip's stretches: the people first, then the lost and fixed ones over them. */
export function speakerStretches(
  doc: ClipDocument,
  plan: FollowPlan | null,
  overrides: readonly FollowOverride[] = [],
): SpeakerStretchModel[] {
  if (plan?.kind !== 'ready') return [];
  const out: SpeakerStretchModel[] = [];
  for (const span of plan.spans) {
    if (span.personId === null) continue;
    const person = plan.people.findIndex((p) => p.id === span.personId);
    if (person < 0) continue;
    const source = { from: span.from, to: span.to };
    clipStretchesOf(doc, source).forEach((place, i) => {
      out.push({
        key: `person:${span.from}:${i}`,
        kind: 'person',
        person,
        ...place,
        source,
        label: personName(person),
      });
    });
  }
  for (const lost of plan.lost) {
    const fixed = plan.mode === 'speaker' && overrideFor(overrides, lost) !== null;
    const source = { from: lost.from, to: lost.to };
    clipStretchesOf(doc, source).forEach((place, i) => {
      out.push({
        key: `lost:${lost.from}:${i}`,
        kind: fixed ? 'fixed' : 'lost',
        person: null,
        ...place,
        source,
        label: fixed ? FIXED_SENTENCE : lostSentence(lost.to - lost.from),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The pick
// ---------------------------------------------------------------------------

/** How far from the anchor's time a box may be and still count, ms. */
export const PICK_REACH_MS = 1_000;
/** How far (in picture fractions) a face's centre may be from the anchor's. */
export const PICK_MAX_DISTANCE = 0.15;

const ANCHOR = /^person@(\d+):(\d(?:\.\d+)?),(\d(?:\.\d+)?)$/;

/**
 * The anchor stored for a person picked from the picker: their first box in
 * the stretch the clip plays, as `person@<ms>:<cx>,<cy>`. Null when they are
 * not seen in it.
 */
export function pickAnchor(
  doc: Pick<ClipDocument, 'segments'>,
  data: Pick<FaceData, 'meta'>,
  person: Person,
): string | null {
  const ranges = followRanges(doc, data.meta);
  const box = person.boxes.find((b) => ranges.some((r) => b.t >= r.from && b.t < r.to));
  if (!box) return null;
  const cx = (box.rect.x + box.rect.w / 2).toFixed(3);
  const cy = (box.rect.y + box.rect.h / 2).toFixed(3);
  return `person@${Math.round(box.t)}:${cx},${cy}`;
}

/**
 * The id of the person an anchor points at, or null: of each person's box
 * nearest the anchor's time, the one whose centre is nearest the anchor's
 * (within `PICK_MAX_DISTANCE`). A box within `PICK_REACH_MS` counts as at
 * the time; after a trim that cut the anchor's time away, the nearest in
 * time wins.
 */
export function resolvePick(
  people: readonly Person[],
  anchor: string | null | undefined,
): string | null {
  const match = anchor ? ANCHOR.exec(anchor) : null;
  if (!match) return null;
  const t = Number(match[1]);
  const cx = Number(match[2]);
  const cy = Number(match[3]);
  let best: { id: string; late: number; distance: number } | null = null;
  for (const person of people) {
    let nearest: { gap: number; distance: number } | null = null;
    for (const box of person.boxes) {
      const gap = Math.abs(box.t - t);
      if (nearest && gap >= nearest.gap) continue;
      const distance = Math.hypot(
        box.rect.x + box.rect.w / 2 - cx,
        box.rect.y + box.rect.h / 2 - cy,
      );
      nearest = { gap, distance };
    }
    if (!nearest || nearest.distance > PICK_MAX_DISTANCE) continue;
    const late = Math.max(0, nearest.gap - PICK_REACH_MS);
    if (!best || late < best.late || (late === best.late && nearest.distance < best.distance)) {
      best = { id: person.id, late, distance: nearest.distance };
    }
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// The picker's thumbnails
// ---------------------------------------------------------------------------

/** How far from the picture's time a face box may be and still be cut from it, ms. */
export const THUMB_REACH_MS = 400;

/**
 * The part of the picture to cut a person's thumbnail from, at `sourceMs`:
 * their nearest box within `THUMB_REACH_MS`, widened by half around its
 * centre and kept inside the picture. Null when they are not seen then (the
 * picker shows a numbered tile).
 */
export function thumbBox(person: Person, sourceMs: number): Rect | null {
  let best: { gap: number; rect: Rect } | null = null;
  for (const box of person.boxes) {
    const gap = Math.abs(box.t - sourceMs);
    if (gap <= THUMB_REACH_MS && (!best || gap < best.gap)) best = { gap, rect: box.rect };
  }
  if (!best) return null;
  const { x, y, w, h } = best.rect;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const nw = Math.min(1, w * 1.5);
  const nh = Math.min(1, h * 1.5);
  return {
    x: Math.min(1 - nw, Math.max(0, cx - nw / 2)),
    y: Math.min(1 - nh, Math.max(0, cy - nh / 2)),
    w: nw,
    h: nh,
  };
}
