/**
 * Applying a brand kit to a clip (Sprint 13, Module 10). Pure: every part is
 * an ordinary document edit, so the editor makes it one undo step and the
 * export draws it like anything else.
 *
 * - **Logo**: one sticker item of the kit's logo (the workspace's own sticker
 *   asset), `brand: true`, on the clip's clock for the whole clip (intro and
 *   outro included), about 14 percent of the canvas's short side wide in the
 *   picture's own shape, in its corner just inside the margins: the Safe
 *   Area Guide's everyday area on a vertical clip, 4 percent of the short
 *   side from the edges on the other shapes. It sits on a track of its own,
 *   on top.
 * - **Intro**: the kit's intro video as a source of its own (`src_brand_`
 *   and a stable part of its video id, so applying again finds it) and a
 *   first part `role: 'intro'`, the whole video at 1x, with its own
 *   fullscreen cover layout (`layoutOverride`, the whole video cover-fitted,
 *   so it fits any shape the clip is switched to), since the clip's layout
 *   frames another video. Clip items move later by its length, as Add Hook Clip
 *   moves them (`replaceItems`); a hook title moves with them (it stays over
 *   the hook, which now plays after the intro); moment items follow their
 *   video; Whole Clip items stay whole.
 * - **Outro**: a video like the intro, as a last part `role: 'outro'`, or a 2
 *   second card the compiler draws (`doc.cards.closing`) in the kit's
 *   colours, with its logo and its line.
 * - **Captions**: the kit's caption style on the captions track, when the
 *   clip has captions and the style can be read.
 *
 * `removeBrandKit(applyBrandKit(doc, kit, parts))` gives back `doc` exactly,
 * except the caption style, which is a setting the clip keeps (like a
 * recipe's) and which undo takes back. Applying the same kit twice gives the
 * same document.
 */
import { captionsTrackOf } from '../captions/map';
import { builtInCaptionStyle, type CaptionLook } from '../captions/styles';
import { updateCaptionsTrack } from '../captions/track';
import { stripEmoji } from '../document/emoji';
import {
  CLIP_MAX_MS,
  MAX_ITEMS,
  MAX_SEGMENTS,
  MAX_STICKERS,
  MAX_TRACKS,
  SEGMENT_MIN_MS,
  STICKER_SIZE_MAX,
  STICKER_SIZE_MIN,
} from '../document/limits';
import {
  CARD_MS,
  CARD_TEXT_MAX,
  type ClipCard,
  type ClipDocument,
  type SavedLayout,
  type Segment,
  type StickerItem,
  segmentOutputMs,
  type Track,
} from '../document/schema';
import { FULL_RECT, type Rect } from '../geometry';
import { safeAreaGuide } from '../captions/safe-area';
import { replaceItems } from '../time/edits';
import { usedIds } from '../time/items';
import { outputDuration } from '../time/time-map';
import {
  BRAND_VIDEO_MAX_MS,
  type BrandParts,
  type BrandVideo,
  type ClipBrandKit,
  type LogoPosition,
} from './types';

/** What applying a kit may need from the caller. */
export interface BrandContext {
  /** The look of a caption style id (a built-in or the workspace's own), or null when it is gone. */
  captionLook?(id: string): CaptionLook | null;
}

/** The logo's width, a share of the canvas's short side. */
export const BRAND_LOGO_SHARE = 0.14;
/** The margin around the logo on a shape with no Safe Area Guide, a share of the short side. */
export const BRAND_LOGO_MARGIN_SHARE = 0.04;
/** The logo sticker's id when it is free. */
export const BRAND_LOGO_ID = 'stk_brand_logo';
/** The track the logo sits on when it is free. */
export const BRAND_TRACK_ID = 'trk_brand';
/** Brand sources are `src_brand_` and the first 12 hex digits of the video id. */
export const BRAND_SOURCE_PREFIX = 'src_brand_';

export type BrandPart = keyof BrandParts;

const ALL_PARTS: BrandParts = { logo: true, intro: true, outro: true, captions: true };

// --- Reading -------------------------------------------------------------------

function isBrandLogo(item: { type: string; brand?: true }): boolean {
  return item.type === 'sticker' && item.brand === true;
}

/** Which of the kit's parts a clip has, and the kit it came from. */
export function brandPartsOf(doc: ClipDocument): {
  kitId: string | null;
  logo: boolean;
  intro: boolean;
  outro: boolean;
} {
  return {
    kitId: doc.brandKitId ?? null,
    logo: doc.tracks.some(
      (track) => track.kind === 'overlay' && track.items.some((item) => isBrandLogo(item)),
    ),
    intro: doc.segments.some((segment) => segment.role === 'intro'),
    outro:
      doc.segments.some((segment) => segment.role === 'outro') || doc.cards?.closing !== undefined,
  };
}

// --- Small helpers -------------------------------------------------------------------

/** The brand source id for a video: stable, so applying again finds the same source. */
export function brandSourceId(videoId: string): string {
  const hex = videoId.toLowerCase().replace(/[^0-9a-f]/g, '');
  return `${BRAND_SOURCE_PREFIX}${hex.slice(0, 12) || 'video'}`;
}

/** `base` when no part of the document uses it, else `base_1`, `base_2`... */
function freeId(doc: ClipDocument, base: string): string {
  const taken = usedIds(doc);
  for (const bleep of doc.bleeps) taken.add(bleep.id);
  if (!taken.has(base)) return base;
  for (let n = 1; ; n += 1) {
    const id = `${base}_${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * A part's own fullscreen cover layout: one area over the whole canvas whose
 * crop is the whole video. Cover fit narrows it to the frame's shape about
 * its centre when it is drawn (`placeArea`), so it is Fullscreen's centred
 * crop on every shape, and a later shape change needs no refit.
 */
export function fullscreenOverride(areaId: string): SavedLayout {
  return {
    kind: 'fullscreen',
    areas: [
      {
        id: areaId,
        name: 'Video',
        frame: { ...FULL_RECT },
        crop: [{ at: 0, rect: { ...FULL_RECT } }],
        fit: 'cover',
      },
    ],
  };
}

function usableVideo(video: BrandVideo | null | undefined): video is BrandVideo {
  return (
    !!video &&
    typeof video.videoId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(video.videoId) &&
    Number.isInteger(video.durationMs) &&
    video.durationMs >= SEGMENT_MIN_MS &&
    video.durationMs <= BRAND_VIDEO_MAX_MS &&
    video.width > 0 &&
    video.height > 0
  );
}

/**
 * Hook titles stay put when `replaceItems` moves clip items (their own rule
 * for Add Hook Clip). A brand intro plays before the hook, so they move
 * with the rest: their place is `before`'s, moved by `shift`, kept inside.
 */
function shiftHookTitles(before: ClipDocument, after: ClipDocument, shift: number): ClipDocument {
  const starts = new Map<string, number>();
  for (const track of before.tracks) {
    if (track.kind !== 'overlay') continue;
    for (const item of track.items) {
      if (item.type === 'text' && item.hookTitle === true) starts.set(item.id, item.start);
    }
  }
  if (starts.size === 0) return after;
  const total = outputDuration(after);
  const tracks = after.tracks.map((track): Track => {
    if (track.kind !== 'overlay') return track;
    return {
      ...track,
      items: track.items.map((item) => {
        const was = starts.get(item.id);
        if (was === undefined || item.type !== 'text') return item;
        const duration = Math.min(item.duration, total);
        const start = Math.min(Math.max(0, was + shift), Math.max(0, total - duration));
        return start === item.start && duration === item.duration
          ? item
          : { ...item, start, duration };
      }),
    };
  });
  return { ...after, tracks };
}

/** The sources no part plays any more, taken out (only brand ones: the clip's own stay). */
function dropUnusedBrandSources(doc: ClipDocument): ClipDocument {
  const used = new Set(doc.segments.map((segment) => segment.source));
  const sources = doc.sources.filter(
    (source) => used.has(source.id) || !source.id.startsWith(BRAND_SOURCE_PREFIX),
  );
  return sources.length === doc.sources.length ? doc : { ...doc, sources };
}

function withBrandSource(doc: ClipDocument, video: BrandVideo): ClipDocument | null {
  const id = brandSourceId(video.videoId);
  const existing = doc.sources.find((source) => source.id === id);
  if (existing) return existing.videoId === video.videoId ? doc : null;
  if (doc.sources.length >= 8) return null;
  if (usedIds(doc).has(id)) return null;
  return { ...doc, sources: [...doc.sources, { id, videoId: video.videoId }] };
}

// --- The parts ---------------------------------------------------------------------

function removeLogo(doc: ClipDocument): ClipDocument {
  let changed = false;
  const tracks: Track[] = [];
  for (const track of doc.tracks) {
    if (track.kind !== 'overlay' || !track.items.some((item) => isBrandLogo(item))) {
      tracks.push(track);
      continue;
    }
    changed = true;
    const items = track.items.filter((item) => !isBrandLogo(item));
    // The logo's own track goes with it; a track a person added things to stays.
    if (items.length > 0 || track.id !== BRAND_TRACK_ID) tracks.push({ ...track, items });
  }
  return changed ? { ...doc, tracks } : doc;
}

/** Where the logo's box goes: its corner of the margins, as fractions of the canvas. */
export function brandLogoBox(
  canvas: { ratio: ClipDocument['canvas']['ratio']; width: number; height: number },
  picture: { width: number; height: number },
  position: LogoPosition,
): Rect {
  const W = canvas.width;
  const H = canvas.height;
  const short = Math.min(W, H);
  const aspect = picture.width > 0 && picture.height > 0 ? picture.height / picture.width : 1;
  let widthPx = BRAND_LOGO_SHARE * short;
  let heightPx = widthPx * aspect;
  // A very tall logo is kept to the same height a square one has.
  if (heightPx > BRAND_LOGO_SHARE * short * 1.5) {
    heightPx = BRAND_LOGO_SHARE * short * 1.5;
    widthPx = heightPx / aspect;
  }
  const guide = safeAreaGuide(canvas.ratio);
  const margin = BRAND_LOGO_MARGIN_SHARE * short;
  const safe: Rect = guide
    ? guide.safe
    : { x: margin / W, y: margin / H, w: 1 - (2 * margin) / W, h: 1 - (2 * margin) / H };
  const w = widthPx / W;
  const h = heightPx / H;
  const left = position === 'top-left' || position === 'bottom-left';
  const top = position === 'top-left' || position === 'top-right';
  return {
    x: left ? safe.x : safe.x + safe.w - w,
    y: top ? safe.y : safe.y + safe.h - h,
    w,
    h,
  };
}

function addLogo(doc: ClipDocument, kit: ClipBrandKit): ClipDocument {
  const logo = kit.logo;
  if (!logo || !kit.logoPosition || !/^[0-9a-f-]{36}$/i.test(logo.assetId)) return doc;
  const items = doc.tracks.reduce(
    (sum, track) => sum + (track.kind === 'captions' ? 0 : track.items.length),
    0,
  );
  const stickers = doc.tracks.reduce(
    (sum, track) =>
      sum +
      (track.kind === 'overlay' ? track.items.filter((item) => item.type === 'sticker').length : 0),
    0,
  );
  if (items >= MAX_ITEMS || stickers >= MAX_STICKERS || doc.tracks.length >= MAX_TRACKS) return doc;

  const box = brandLogoBox(doc.canvas, logo, kit.logoPosition);
  const size = (value: number) =>
    Math.min(STICKER_SIZE_MAX, Math.max(STICKER_SIZE_MIN, Math.round(value)));
  const item: StickerItem = {
    id: freeId(doc, BRAND_LOGO_ID),
    type: 'sticker',
    start: 0,
    duration: outputDuration(doc),
    anchor: 'clip',
    ref: { asset: logo.assetId.toLowerCase() },
    transform: {
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
      scale: 1,
      rotation: 0,
      opacity: 1,
    },
    flipX: false,
    widthPx: size(box.w * doc.canvas.width),
    heightPx: size(box.h * doc.canvas.height),
    loop: true,
    brand: true,
  };
  const trackId = freeId(doc, BRAND_TRACK_ID);
  return { ...doc, tracks: [...doc.tracks, { id: trackId, kind: 'overlay', items: [item] }] };
}

function brandPartMs(doc: ClipDocument, role: 'intro' | 'outro'): number {
  return doc.segments
    .filter((segment) => segment.role === role)
    .reduce((sum, segment) => sum + segmentOutputMs(segment), 0);
}

function removeIntro(doc: ClipDocument): ClipDocument {
  const introMs = brandPartMs(doc, 'intro');
  if (introMs === 0) return doc;
  const segments = doc.segments.filter((segment) => segment.role !== 'intro');
  if (segments.length === 0) return doc;
  const after = replaceItems(doc, { ...doc, segments }, { clipShiftMs: -introMs });
  return dropUnusedBrandSources(shiftHookTitles(doc, after, -introMs));
}

function removeOutro(doc: ClipDocument): ClipDocument {
  let next = doc;
  if (doc.segments.some((segment) => segment.role === 'outro')) {
    const segments = doc.segments.filter((segment) => segment.role !== 'outro');
    if (segments.length > 0) {
      next = dropUnusedBrandSources(replaceItems(doc, { ...doc, segments }));
    }
  }
  if (next.cards?.closing) {
    const { closing: _closing, ...rest } = next.cards;
    const { cards: _cards, ...withoutCards } = next;
    next = Object.keys(rest).length > 0 ? { ...withoutCards, cards: rest } : withoutCards;
  }
  return next;
}

/** The brand part for `video`: the whole video at 1x with its own fullscreen cover layout. */
function brandSegment(
  doc: ClipDocument,
  video: BrandVideo,
  role: 'intro' | 'outro',
): Segment | null {
  if (doc.segments.length >= MAX_SEGMENTS) return null;
  if (outputDuration(doc) + video.durationMs > CLIP_MAX_MS) return null;
  return {
    id: freeId(doc, `seg_brand_${role}`),
    source: brandSourceId(video.videoId),
    sourceIn: 0,
    sourceOut: video.durationMs,
    speed: 1,
    volume: 1,
    role,
    layoutOverride: fullscreenOverride(`area_brand_${role}`),
  };
}

function addIntro(doc: ClipDocument, kit: ClipBrandKit): ClipDocument {
  const video = kit.intro;
  if (!usableVideo(video)) return doc;
  const withSource = withBrandSource(doc, video);
  if (!withSource) return doc;
  const segment = brandSegment(withSource, video, 'intro');
  if (!segment) return doc;
  const after: ClipDocument = { ...withSource, segments: [segment, ...withSource.segments] };
  return shiftHookTitles(
    withSource,
    replaceItems(withSource, after, { clipShiftMs: video.durationMs }),
    video.durationMs,
  );
}

/** A card line as the schema takes it: one plain line, no emoji, at most `CARD_TEXT_MAX`. */
function cardLine(text: string): string {
  return (
    stripEmoji(text)
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it takes out.
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, CARD_TEXT_MAX)
      .trim()
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function addOutro(doc: ClipDocument, kit: ClipBrandKit): ClipDocument {
  const outro = kit.outro;
  if (!outro) return doc;
  if (outro.kind === 'video') {
    const video = outro.video;
    if (!usableVideo(video)) return doc;
    const withSource = withBrandSource(doc, video);
    if (!withSource) return doc;
    const segment = brandSegment(withSource, video, 'outro');
    if (!segment) return doc;
    return replaceItems(withSource, {
      ...withSource,
      segments: [...withSource.segments, segment],
    });
  }
  const text = cardLine(outro.text);
  const logo =
    kit.logo && /^[0-9a-f-]{36}$/i.test(kit.logo.assetId)
      ? { asset: kit.logo.assetId.toLowerCase() }
      : null;
  if (text.length === 0 && !logo) return doc;
  if (!HEX.test(outro.background) || !HEX.test(outro.colour)) return doc;
  const card: ClipCard = {
    text,
    background: outro.background.toUpperCase(),
    colour: outro.colour.toUpperCase(),
    logo,
    look: null,
    durationMs: CARD_MS,
  };
  return { ...doc, cards: { ...(doc.cards ?? {}), closing: card } };
}

function setCaptionStyle(doc: ClipDocument, kit: ClipBrandKit, ctx: BrandContext): ClipDocument {
  const styleId = kit.captionStyleId;
  if (!styleId || !/^[A-Za-z0-9_-]{1,64}$/.test(styleId)) return doc;
  const track = captionsTrackOf(doc);
  if (!track) return doc;
  const look = ctx.captionLook
    ? ctx.captionLook(styleId)
    : (builtInCaptionStyle(styleId)?.look ?? null);
  if (!look) return doc;
  if (
    track.styleId === styleId &&
    track.sizePx === look.sizePx &&
    track.maxWords === look.maxWords
  ) {
    return doc;
  }
  return updateCaptionsTrack(doc, (current) => ({
    ...current,
    styleId,
    sizePx: look.sizePx,
    maxWords: look.maxWords,
  }));
}

function withKitId(doc: ClipDocument, kitId: string): ClipDocument {
  // A Studio kit's id: a uuid, or a readable one for a kit seeded by hand (the document's idSchema).
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(kitId)) return doc;
  return doc.brandKitId === kitId ? doc : { ...doc, brandKitId: kitId };
}

// --- The edits -------------------------------------------------------------------------

/**
 * The clip without anything a kit added: the logo, the intro and outro parts
 * (their sources too), the closing card and `brandKitId`. The caption style
 * stays (see the file comment). The same document when it has no kit.
 */
export function removeBrandKit(doc: ClipDocument): ClipDocument {
  let next = removeLogo(doc);
  next = removeOutro(next);
  next = removeIntro(next);
  if (next.brandKitId !== undefined) {
    const { brandKitId: _brandKitId, ...rest } = next;
    next = rest;
  }
  return next;
}

/**
 * Applies `kit` to the clip: each part `parts` does not switch off (a part
 * left out is on), from a clip without any kit, so applying again (or
 * another kit) replaces what was there. A part the kit lacks, or that does
 * not fit (too many parts, items or tracks, the clip's longest length), is
 * left out; it never throws.
 */
export function applyBrandKit(
  doc: ClipDocument,
  kit: ClipBrandKit,
  parts: Partial<BrandParts> = {},
  ctx: BrandContext = {},
): ClipDocument {
  const on: BrandParts = { ...ALL_PARTS, ...parts };
  let next = removeBrandKit(doc);
  if (on.intro) next = addIntro(next, kit);
  if (on.outro) next = addOutro(next, kit);
  // The logo last, so it covers the whole clip with its intro and outro.
  if (on.logo) next = addLogo(next, kit);
  if (on.captions) next = setCaptionStyle(next, kit, ctx);
  return withKitId(next, kit.id);
}

/**
 * Switches one part of `kit` on or off on a clip (the Layouts tab's
 * toggles), keeping the others as they are. Switching Captions off keeps the
 * style the clip has. Sets `brandKitId` to the kit.
 */
export function setBrandPart(
  doc: ClipDocument,
  kit: ClipBrandKit,
  part: BrandPart,
  on: boolean,
  ctx: BrandContext = {},
): ClipDocument {
  let next = doc;
  if (part === 'logo') {
    next = removeLogo(next);
    if (on) next = addLogo(next, kit);
  } else if (part === 'intro') {
    next = removeIntro(next);
    if (on) next = addIntro(next, kit);
  } else if (part === 'outro') {
    next = removeOutro(next);
    if (on) next = addOutro(next, kit);
  } else if (on) {
    next = setCaptionStyle(next, kit, ctx);
  }
  return withKitId(next, kit.id);
}
