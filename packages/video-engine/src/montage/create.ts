/**
 * Montage (Sprint 13, Module 11): two to fifteen clips, from one video or
 * several, stitched into one clip document that opens in the editor and
 * exports like any other. Pure: the API builds it, the editor reads it.
 *
 * - **Sources** are the union of the clips' videos, one per video (two clips
 *   of the same video share it), with new ids (`src_1`...; a brand kit's
 *   intro or outro video keeps its readable `src_brand_` id), so nothing
 *   can collide.
 * - **Parts** play clip after clip. A hook belongs to its own clip and is
 *   dropped from every clip; the first clip keeps its brand intro and the
 *   last its brand outro and closing card; every other intro, outro and card
 *   is dropped. Every part gets a new id.
 * - **Framing travels with the parts.** Each clip was framed its own way, so
 *   each of its parts carries the clip's layout as its own `layoutOverride`
 *   (refitted to the montage's shape by `setCanvasRatio`'s rules; a followed
 *   layout keeps its motion). The montage's own `layout` is the first clip's.
 * - **Joins.** A Cut adds nothing; a Fade puts a join before each clip's first
 *   part but the first clip's. A Fade overlaps its two sides, so the montage
 *   is 0.3 s shorter per join (`joinOverlaps`, the one rule the time map, the
 *   compiler and the preview read).
 * - **Items** (texts, stickers, sounds) keep their place on their clip: each
 *   is put back on the part it started on, at the same offset into it, so a
 *   moment item stays on its moment through every join before it. A Whole
 *   Clip item covers its clip's stretch of the montage. An item that started
 *   on a dropped part (a hook, a dropped intro) is dropped, and none runs on
 *   into the next clip. Tracks are merged by place: the first overlay track
 *   of every clip becomes the montage's first overlay track, and so on, with
 *   brand logos on the logo track on top.
 * - **Zooms and bleeps** are in the video's own time, so they are copied with
 *   their source re-keyed and simply follow.
 * - **Captions**: one captions track per video, each naming its `source`
 *   when the montage plays more than one video, all in the first captioned
 *   clip's style, size and place. Two clips of one video with the same
 *   transcript share a track, their word edits merged (the earlier clip's
 *   win); a different transcript of a video that already has a track is left
 *   out.
 * - **Title card** (optional): `cards.opening`, Module 10's card shape.
 * - `meta.montage.parts` names each original clip and the part it starts at,
 *   for the timeline's dividers.
 *
 * Refused, rather than building a document the schema would not take:
 * fewer than 2 or more than 15 clips, clips of different shapes with no
 * shape chosen, longer than `MONTAGE_MAX_MS` after the joins, or more parts,
 * items, sounds, stickers, tracks, zooms, bleeps, videos or caption changes
 * than one document holds.
 */
import { CANVASES, type Ratio } from '../canvas';
import { BRAND_SOURCE_PREFIX, BRAND_TRACK_ID, brandSourceId } from '../brand/apply';
import { inFirstCaptionsLook } from '../captions/map';
import { CAPTIONS_TRACK_ID } from '../captions/track';
import { stripEmoji } from '../document/emoji';
import {
  CLIP_MIN_MS,
  ITEM_MIN_MS,
  JOIN_FADE_MS,
  MAX_BLEEPS,
  MAX_CAPTION_EDITS,
  MAX_ITEMS,
  MAX_SEGMENTS,
  MAX_SOUNDS,
  MAX_SOURCES,
  MAX_STICKERS,
  MAX_TRACKS,
  MAX_ZOOMS,
  MONTAGE_MAX_CLIPS,
  MONTAGE_MAX_MS,
  MONTAGE_MIN_CLIPS,
  MONTAGE_PART_TITLE_MAX,
} from '../document/limits';
import {
  type AudioItem,
  type AudioTrack,
  type Bleep,
  CARD_MS,
  CARD_TEXT_MAX,
  type CaptionsTrack,
  type ClipCanvas,
  type ClipCard,
  type ClipDocument,
  type ClipJoin,
  type ClipLayout,
  clipDocumentSchema,
  type OverlayItem,
  type OverlayTrack,
  type SavedLayout,
  type Segment,
  type Track,
  type Zoom,
} from '../document/schema';
import { copyTextStyle, HOOK_STYLE_IDS, type HookStyleId, textStylePreset } from '../document/text';
import { describeIssues } from '../document/upgrade';
import { hookTitleOf } from '../effects/hook';
import { rectAspect } from '../geometry';
import { refitCrop, setCanvasRatio, type VideoSize, videoAspectOf } from '../layout/edit';
import { outputDuration, type PlacedSegment, placeSegments, segmentAt } from '../time/time-map';

/** Why `createMontage` refused (each has a sentence in `CLIP_ERROR_MESSAGES`). */
export type MontageRefusal =
  | 'montage_too_few'
  | 'montage_too_many'
  | 'montage_shapes_differ'
  | 'montage_too_long'
  | 'montage_too_many_parts'
  | 'montage_video_removed';

export const MONTAGE_REFUSALS: readonly MontageRefusal[] = [
  'montage_too_few',
  'montage_too_many',
  'montage_shapes_differ',
  'montage_too_long',
  'montage_too_many_parts',
  'montage_video_removed',
];

/** One clip going into a montage, in play order. */
export interface MontageClip {
  /** The clip's id (the timeline's divider names it). */
  id: string;
  title: string;
  document: ClipDocument;
}

export type MontageTransition = 'cut' | 'fade';

export interface MontageOptions {
  /** The montage's shape. Needed when the clips' shapes differ; each clip is refitted to it. */
  ratio?: Ratio;
  transition: MontageTransition;
  /** A 2 second opening title card with this line, or none (null, empty). */
  titleCard?: string | null;
  /**
   * Each video's real picture size, by `ClipVideo` id, so a crop refitted to
   * another shape keeps its true proportions. 16:9 when a video is not here.
   */
  videoSizes?: Readonly<Record<string, VideoSize>>;
}

export type MontageResult =
  | { ok: true; document: ClipDocument }
  | { ok: false; code: MontageRefusal };

/** The title card's background and line colour. */
export const MONTAGE_CARD_BACKGROUND = '#111111';
export const MONTAGE_CARD_COLOUR = '#FFFFFF';

const DEFAULT_VIDEO_SIZE: VideoSize = { width: 1920, height: 1080 };

function refuse(code: MontageRefusal): MontageResult {
  return { ok: false, code };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isBrandPart(segment: Pick<Segment, 'role'>): boolean {
  return segment.role === 'intro' || segment.role === 'outro';
}

/** The shapes of the clips, each once, in the order they first appear. */
export function montageRatios(clips: readonly Pick<MontageClip, 'document'>[]): Ratio[] {
  const seen: Ratio[] = [];
  for (const clip of clips) {
    if (!seen.includes(clip.document.canvas.ratio)) seen.push(clip.document.canvas.ratio);
  }
  return seen;
}

// --- Refitting a clip to the montage's shape -----------------------------------------------

/** A layout refitted from `canvas` to `ratio`, by `setCanvasRatio`'s rules. */
function refitLayout(
  layout: ClipLayout,
  canvas: ClipCanvas,
  ratio: Ratio,
  videoSize: VideoSize,
): ClipLayout {
  if (canvas.ratio === ratio) return clone(layout);
  const stub = { canvas, layout, segments: [], tracks: [] } as unknown as ClipDocument;
  const next = clone(setCanvasRatio(stub, ratio, videoSize).layout);
  if (!layout.follow || !next.follow) {
    // Not followed, or the shape does not offer the layout (it became Blurred, unfollowed).
    if (next.follow) delete next.follow;
    return next;
  }
  // `setCanvasRatio` keeps one keyframe; a followed crop moves, so every keyframe is refitted.
  const va = videoAspectOf(videoSize);
  const fromAspect = canvas.width / canvas.height;
  const toCanvas = CANVASES[ratio];
  const toAspect = toCanvas.width / toCanvas.height;
  const areas = next.areas.map((area, i) => {
    const before = layout.areas[i];
    if (!before || before.crop.length <= 1 || before.fit !== 'cover' || area.fit !== 'cover') {
      return area;
    }
    const from = rectAspect(before.frame, fromAspect);
    const to = rectAspect(area.frame, toAspect);
    return {
      ...area,
      crop: before.crop.map((key) => ({ at: key.at, rect: refitCrop(key.rect, from, to, va) })),
    };
  });
  // The hand fixes are crops of the followed area: refitted the same way.
  const followed = Math.max(
    0,
    layout.areas.findIndex((area) => area.crop.length > 1),
  );
  const beforeArea = layout.areas[followed];
  const afterArea = next.areas[followed];
  const overrides =
    beforeArea && afterArea
      ? layout.follow.overrides.map((fix) => ({
          ...fix,
          rect: refitCrop(
            fix.rect,
            rectAspect(beforeArea.frame, fromAspect),
            rectAspect(afterArea.frame, toAspect),
            va,
          ),
        }))
      : clone(layout.follow.overrides);
  const saved = refitLayout(layout.follow.saved, canvas, ratio, videoSize) as SavedLayout;
  return { ...next, areas, follow: { ...clone(layout.follow), overrides, saved } };
}

/** The clip's video, by the source its main parts play (its first non-brand part's). */
function mainSourceId(doc: ClipDocument): string {
  const main = doc.segments.find((segment) => !isBrandPart(segment)) ?? doc.segments[0];
  return (main as Segment).source;
}

function videoSizeOf(
  doc: ClipDocument,
  sourceId: string,
  sizes: Readonly<Record<string, VideoSize>> | undefined,
): VideoSize {
  const videoId = doc.sources.find((source) => source.id === sourceId)?.videoId;
  return (videoId !== undefined ? sizes?.[videoId] : undefined) ?? DEFAULT_VIDEO_SIZE;
}

// --- The title card --------------------------------------------------------------------

function isHookStyleId(value: string): value is HookStyleId {
  return (HOOK_STYLE_IDS as readonly string[]).includes(value);
}

/** The hook look a hook title is drawn in, or null when its style is no hook look. */
function hookLookOf(doc: ClipDocument): HookStyleId | null {
  const title = hookTitleOf(doc);
  if (!title) return null;
  const wanted = JSON.stringify(title.style);
  const match = HOOK_STYLE_IDS.find(
    (id) => JSON.stringify(copyTextStyle(textStylePreset(id).style)) === wanted,
  );
  return match && isHookStyleId(match) ? match : null;
}

/** The opening card for a title line, or null when nothing is left to show. */
export function montageTitleCard(
  text: string | null | undefined,
  first: ClipDocument,
): ClipCard | null {
  if (typeof text !== 'string') return null;
  const line = stripEmoji(text)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, CARD_TEXT_MAX)
    .trim();
  if (line.length === 0) return null;
  return {
    text: line,
    background: MONTAGE_CARD_BACKGROUND,
    colour: MONTAGE_CARD_COLOUR,
    logo: null,
    look: hookLookOf(first) ?? 'hook-bold',
    durationMs: CARD_MS,
  };
}

// --- The montage -----------------------------------------------------------------------

interface KeptPart {
  clip: number;
  /** The part in its own clip. */
  original: Segment;
  segment: Segment;
}

interface ClipPlan {
  doc: ClipDocument;
  /** Source id in the clip to source id in the montage. */
  sources: Map<string, string>;
  /** Part id in the clip to part id in the montage (kept parts only). */
  parts: Map<string, string>;
  kept: KeptPart[];
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}_${n}`;
  };
}

/**
 * Stitches `clips` (in play order) into one montage document, or refuses
 * with a `MontageRefusal` (see the file comment). Never throws for a
 * refusal; throws only if it would build a document the schema refuses,
 * which is a bug.
 */
export function createMontage(
  clips: readonly MontageClip[],
  options: MontageOptions,
): MontageResult {
  if (clips.length < MONTAGE_MIN_CLIPS) return refuse('montage_too_few');
  if (clips.length > MONTAGE_MAX_CLIPS) return refuse('montage_too_many');
  const ratios = montageRatios(clips);
  if (ratios.length > 1 && options.ratio === undefined) return refuse('montage_shapes_differ');
  const ratio = options.ratio ?? (ratios[0] as Ratio);
  const lastClip = clips.length - 1;

  // Sources, one per video; parts, clip after clip.
  const sourceByVideo = new Map<string, string>();
  const sources: ClipDocument['sources'] = [];
  const nextSource = counter('src');
  const nextSegment = counter('seg');
  const segments: Segment[] = [];
  const joins: ClipJoin[] = [];
  const joined = new Set<string>();
  const plans: ClipPlan[] = [];

  const sourceFor = (videoId: string, brand: boolean): string => {
    const known = sourceByVideo.get(videoId);
    if (known) return known;
    let id = brand ? brandSourceId(videoId) : nextSource();
    if (sources.some((source) => source.id === id)) id = nextSource();
    sourceByVideo.set(videoId, id);
    sources.push({ id, videoId });
    return id;
  };

  for (let k = 0; k < clips.length; k += 1) {
    const doc = (clips[k] as MontageClip).document;
    const mainSource = mainSourceId(doc);
    const mainSize = videoSizeOf(doc, mainSource, options.videoSizes);
    const layout = refitLayout(doc.layout, doc.canvas, ratio, mainSize);
    const plan: ClipPlan = { doc, sources: new Map(), parts: new Map(), kept: [] };
    for (const original of doc.segments) {
      if (original.role === 'hook') continue;
      if (original.role === 'intro' && k !== 0) continue;
      if (original.role === 'outro' && k !== lastClip) continue;
      const video = doc.sources.find((source) => source.id === original.source);
      if (!video) continue;
      let source = plan.sources.get(original.source);
      if (!source) {
        source = sourceFor(
          video.videoId,
          isBrandPart(original) || original.source.startsWith(BRAND_SOURCE_PREFIX),
        );
        plan.sources.set(original.source, source);
      }
      const segment: Segment = {
        id: nextSegment(),
        source,
        sourceIn: original.sourceIn,
        sourceOut: original.sourceOut,
        speed: original.speed,
        volume: original.volume,
      };
      if (original.role === 'intro' || original.role === 'outro') {
        segment.role = original.role;
        // A brand video's own cover layout fits any shape as it is.
        segment.layoutOverride = clone(original.layoutOverride ?? layout);
      } else {
        segment.layoutOverride = original.layoutOverride
          ? refitLayout(
              original.layoutOverride,
              doc.canvas,
              ratio,
              videoSizeOf(doc, original.source, options.videoSizes),
            )
          : clone(layout);
      }
      plan.parts.set(original.id, segment.id);
      plan.kept.push({ clip: k, original, segment });
      segments.push(segment);
    }
    if (plan.kept.length === 0) return refuse('montage_too_many_parts');

    // A Fade before each clip but the first; a montage's own fades inside a clip stay.
    const first = plan.kept[0] as KeptPart;
    if (options.transition === 'fade' && k > 0) {
      joins.push({ beforeSegment: first.segment.id, kind: 'fade', ms: JOIN_FADE_MS });
      joined.add(first.segment.id);
    }
    for (const join of doc.joins ?? []) {
      const id = plan.parts.get(join.beforeSegment);
      if (id && id !== first.segment.id && !joined.has(id)) {
        joins.push({ beforeSegment: id, kind: 'fade', ms: JOIN_FADE_MS });
        joined.add(id);
      }
    }
    plans.push(plan);
  }

  if (segments.length > MAX_SEGMENTS || sources.length > MAX_SOURCES) {
    return refuse('montage_too_many_parts');
  }

  const timed = { segments, joins };
  const total = outputDuration(timed);
  if (total > MONTAGE_MAX_MS) return refuse('montage_too_long');
  if (total < CLIP_MIN_MS) return refuse('montage_too_few');
  const placed = new Map<string, PlacedSegment>(
    placeSegments(timed).map((entry) => [entry.segment.id, entry]),
  );

  // Items, by track place; zooms, bleeps; captions per video.
  const overlayTracks: OverlayItem[][] = [];
  const brandItems: OverlayItem[] = [];
  const audioTracks: AudioItem[][] = [];
  const zooms: Zoom[] = [];
  const bleeps: Bleep[] = [];
  const captions = new Map<string, CaptionsTrack>();
  const captionOrder: string[] = [];
  const nextText = counter('txt');
  const nextSticker = counter('stk');
  const nextSound = counter('snd');
  const nextZoom = counter('zoom');
  const nextBleep = counter('bleep');

  for (const plan of plans) {
    const { doc } = plan;
    const ownTotal = outputDuration(doc);
    const firstKept = placed.get((plan.kept[0] as KeptPart).segment.id) as PlacedSegment;
    const lastKept = placed.get((plan.kept.at(-1) as KeptPart).segment.id) as PlacedSegment;
    const from = firstKept.outStart;
    const to = lastKept.outEnd;
    // Refitted to another shape, overlay items keep their relative place, pulled inside the canvas.
    const reshaped = doc.canvas.ratio !== ratio;

    /** Where an item of this clip goes in the montage, or null when its part was dropped. */
    const place = <T extends OverlayItem | AudioItem>(item: T): T | null => {
      if (item.anchor === 'clip' && item.start === 0 && item.duration === ownTotal) {
        return { ...clone(item), start: from, duration: Math.max(ITEM_MIN_MS, to - from) };
      }
      const at = segmentAt(doc, item.start);
      const id = at ? plan.parts.get(at.segment.id) : undefined;
      const target = id ? placed.get(id) : undefined;
      if (!at || !target) return null;
      // The same offset into the same part: on its moment, whatever played before it.
      let start = target.outStart + (item.start - at.outStart);
      let duration = Math.min(item.duration, to - start);
      if (duration < ITEM_MIN_MS) {
        duration = ITEM_MIN_MS;
        start = Math.max(0, Math.min(start, to - ITEM_MIN_MS));
      }
      return { ...clone(item), start, duration };
    };

    let overlayPlace = 0;
    let audioPlace = 0;
    for (const track of doc.tracks) {
      if (track.kind === 'overlay') {
        const brandTrack = track.id === BRAND_TRACK_ID;
        if (!brandTrack && !overlayTracks[overlayPlace]) overlayTracks[overlayPlace] = [];
        const into = brandTrack ? brandItems : (overlayTracks[overlayPlace] as OverlayItem[]);
        if (!brandTrack) overlayPlace += 1;
        for (const item of track.items) {
          const moved = place(item);
          if (!moved) continue;
          moved.id = moved.type === 'text' ? nextText() : nextSticker();
          if (reshaped) {
            moved.transform.x = Math.min(1, Math.max(0, moved.transform.x));
            moved.transform.y = Math.min(1, Math.max(0, moved.transform.y));
          }
          into.push(moved);
        }
      } else if (track.kind === 'audio') {
        if (!audioTracks[audioPlace]) audioTracks[audioPlace] = [];
        const into = audioTracks[audioPlace] as AudioItem[];
        audioPlace += 1;
        for (const item of track.items) {
          const moved = place(item);
          if (!moved) continue;
          moved.id = nextSound();
          into.push(moved);
        }
      } else {
        // Captions: the track's own video, or (one track, no source) every video its main parts play.
        const targets = track.source
          ? [track.source]
          : [
              ...new Set(
                plan.kept
                  .filter((part) => !isBrandPart(part.original))
                  .map((part) => part.original.source),
              ),
            ];
        for (const ownSource of targets) {
          const source = plan.sources.get(ownSource);
          if (!source) continue;
          const existing = captions.get(source);
          if (!existing) {
            const next = clone(track);
            delete next.source;
            captions.set(source, next);
            captionOrder.push(source);
          } else if (existing.transcriptAssetId === track.transcriptAssetId) {
            for (const [index, edit] of Object.entries(track.edits)) {
              if (!Object.hasOwn(existing.edits, index)) existing.edits[index] = clone(edit);
            }
          }
        }
      }
    }

    for (const zoom of doc.zooms) {
      const source = plan.sources.get(zoom.source);
      if (source) zooms.push({ ...clone(zoom), id: nextZoom(), source });
    }
    for (const bleep of doc.bleeps) {
      const source = plan.sources.get(bleep.source);
      if (source) bleeps.push({ ...clone(bleep), id: nextBleep(), source });
    }
  }

  // The tracks: overlays bottom first, the brand logo on top, then sounds, then captions.
  const tracks: Track[] = [];
  overlayTracks.forEach((items, i) => {
    const track: OverlayTrack = { id: `trk_overlay_${i + 1}`, kind: 'overlay', items };
    tracks.push(track);
  });
  if (brandItems.length > 0) {
    tracks.push({ id: BRAND_TRACK_ID, kind: 'overlay', items: brandItems });
  }
  audioTracks.forEach((items, i) => {
    const track: AudioTrack = { id: `trk_audio_${i + 1}`, kind: 'audio', items };
    tracks.push(track);
  });
  const mainSources = new Set(
    segments.filter((segment) => !isBrandPart(segment)).map((segment) => segment.source),
  );
  const named = mainSources.size > 1 || captionOrder.length > 1;
  captionOrder.forEach((source, i) => {
    const track = captions.get(source) as CaptionsTrack;
    track.id = i === 0 ? CAPTIONS_TRACK_ID : `${CAPTIONS_TRACK_ID}_${i + 1}`;
    if (named) track.source = source;
  });
  const captionTracks = captionOrder.map((source) => captions.get(source) as CaptionsTrack);
  for (const track of captionTracks) {
    tracks.push(
      captionTracks[0] === track ? track : inFirstCaptionsLook({ tracks: captionTracks }, track),
    );
  }

  const items = tracks.reduce(
    (sum, track) => sum + (track.kind === 'captions' ? 0 : track.items.length),
    0,
  );
  const sounds = audioTracks.reduce((sum, list) => sum + list.length, 0);
  const stickers = [...overlayTracks.flat(), ...brandItems].filter(
    (item) => item.type === 'sticker',
  ).length;
  if (
    items > MAX_ITEMS ||
    sounds > MAX_SOUNDS ||
    stickers > MAX_STICKERS ||
    tracks.length > MAX_TRACKS ||
    zooms.length > MAX_ZOOMS ||
    bleeps.length > MAX_BLEEPS ||
    captionTracks.some((track) => Object.keys(track.edits).length > MAX_CAPTION_EDITS)
  ) {
    return refuse('montage_too_many_parts');
  }

  // The document: the first clip's canvas, layout and look; the last clip's fade out and closing card.
  const firstDoc = (plans[0] as ClipPlan).doc;
  const lastDoc = (plans[lastClip] as ClipPlan).doc;
  const size = CANVASES[ratio];
  const layout = refitLayout(
    firstDoc.layout,
    firstDoc.canvas,
    ratio,
    videoSizeOf(firstDoc, mainSourceId(firstDoc), options.videoSizes),
  );
  // Its area ids are the document's own; one a new id took is renamed.
  const taken = new Set<string>([
    ...segments.map((segment) => segment.id),
    ...zooms.map((zoom) => zoom.id),
    ...bleeps.map((bleep) => bleep.id),
    ...tracks.map((track) => track.id),
    ...tracks.flatMap((track) =>
      track.kind === 'captions' ? [] : track.items.map((item) => item.id),
    ),
  ]);
  const nextArea = counter('area_montage');
  for (const area of layout.areas) {
    if (taken.has(area.id)) area.id = nextArea();
    taken.add(area.id);
  }
  const doc: ClipDocument = {
    schemaVersion: 2,
    canvas: { ...firstDoc.canvas, ratio, width: size.width, height: size.height },
    sources,
    segments,
    layout,
    zooms,
    looks: clone(firstDoc.looks),
    fades: { inMs: firstDoc.fades.inMs, outMs: lastDoc.fades.outMs },
    tracks,
    bleeps,
    meta: {
      shapeChosen: true,
      montage: {
        parts: plans.map((plan, k) => ({
          clipId: (clips[k] as MontageClip).id,
          title: (clips[k] as MontageClip).title.slice(0, MONTAGE_PART_TITLE_MAX),
          firstSegment: (plan.kept[0] as KeptPart).segment.id,
        })),
      },
    },
  };
  if (joins.length > 0) doc.joins = joins;
  if (firstDoc.brandKitId !== undefined) doc.brandKitId = firstDoc.brandKitId;
  const opening = montageTitleCard(options.titleCard, firstDoc);
  const closing = lastDoc.cards?.closing;
  if (opening || closing) {
    doc.cards = {};
    if (opening) doc.cards.opening = opening;
    if (closing) doc.cards.closing = clone(closing);
  }

  const parsed = clipDocumentSchema.safeParse(doc);
  if (!parsed.success) {
    throw new Error(
      `createMontage built a document the schema refuses: ${describeIssues(parsed.error).join('; ')}`,
    );
  }
  return { ok: true, document: parsed.data };
}
