/**
 * Preview's display logic (Sprint 9: Screen 5, DS-7.1 and DS-7.2, and the
 * share page, DS-9.2), kept pure so it can be tested without a browser:
 * which slides the carousel draws, how a swipe ends, how a caption counts
 * against a platform's limit, what a screen reader hears for a slide, and
 * what the share page says when it has nothing to show.
 */
import {
  type DesignDocument,
  FORMATS,
  type FormatId,
  findLayout,
  MAX_CAPTION_LENGTH,
  slotText,
} from '@postgear/design-engine';
import { measureLength } from '@postgear/social-core/composer';
import type { PreviewPlatform, PreviewPlatformId } from '@/types/studio';

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

/** A slide index inside the design: whole, and never past either end. */
export function clampIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return Math.min(Math.max(0, Math.trunc(index)), count - 1);
}

/**
 * The slides the carousel draws: the one on show and both of its
 * neighbours, so a swipe uncovers a slide that is already drawn, plus every
 * slide drawn before, so going back never draws one twice. Slides far away
 * stay undrawn: each one loads its pictures at full size, and a 20-slide
 * design should not load all of them the moment Preview opens.
 *
 * Returns `drawn` itself when nothing new is needed, so a caller can keep
 * the set in state without looping.
 */
export function drawnAround(
  drawn: ReadonlySet<number>,
  index: number,
  count: number,
): ReadonlySet<number> {
  const wanted = [index - 1, index, index + 1].filter((slide) => slide >= 0 && slide < count);
  if (wanted.every((slide) => drawn.has(slide))) return drawn;
  return new Set([...drawn, ...wanted]);
}

/**
 * True when two versions of a design draw the same slides: everything but
 * the caption is the very same value. Typing the caption then never redraws
 * a slide, which matters because the renderer fits a slide's text again
 * after every render.
 */
export function sameSlides(a: DesignDocument, b: DesignDocument): boolean {
  if (a === b) return true;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof DesignDocument>;
  for (const key of keys) {
    if (key !== 'caption' && a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * How wide a platform frame is drawn: about a phone feed's width (a little
 * more for a landscape slide), and narrow enough that the slide's height
 * stays within two thirds of the screen, so a tall slide is seen whole
 * while it is swiped.
 */
export function frameWidth(format: FormatId): string {
  const { width, height } = FORMATS[format];
  const ratio = width / height;
  const cap = ratio > 1.2 ? 36 : 30;
  return `min(100%, ${cap}rem, ${Number((ratio * 65).toFixed(2))}svh)`;
}

/**
 * The words a slide shows, in its layout's order, for a screen reader: the
 * slide itself is drawn as a picture, so this is how its text is heard.
 * Hidden elements are left out, and so is the counted slide number, which
 * the carousel already says.
 */
export function slideWords(design: DesignDocument, index: number): string[] {
  const slide = design.slides[index];
  const layout = slide ? findLayout(slide.layoutId) : null;
  if (!slide || !layout) return [];

  const words: string[] = [];
  for (const slot of layout.slots) {
    const state = slide.elements[slot.id];
    if (state?.hidden) continue;

    if (slot.kind === 'list') {
      for (const item of state?.items ?? []) {
        if (item.trim()) words.push(item.trim());
      }
    } else if (slot.kind === 'text' && slot.bind !== 'slideNumber') {
      const text = slotText(design, index, slot).trim();
      if (text) words.push(text);
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// Swiping
// ---------------------------------------------------------------------------

/** How far a pointer moves, in CSS pixels, before a drag counts as sideways or as a scroll. */
export const AXIS_LOCK_PX = 8;
/** A drag past this share of the slide's width turns the slide... */
export const SWIPE_SHARE = 0.2;
/** ...as long as that is at least this many pixels. */
export const SWIPE_MIN_PX = 40;
/** A flick this fast turns the slide however short it is, in pixels per millisecond... */
export const FLICK_SPEED = 0.4;
/** ...once it has moved this far, so a tap that wobbles is not a flick. */
export const FLICK_MIN_PX = 16;
/** Past the first or the last slide, a drag follows the finger only this much. */
export const EDGE_RESISTANCE = 0.3;

export type SwipeAxis = 'x' | 'y';

/**
 * Which way a drag is going, once it has moved far enough to tell: sideways
 * turns slides, up and down is left to the page to scroll.
 */
export function swipeAxis(dx: number, dy: number): SwipeAxis | null {
  if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/**
 * Where the slides sit while a finger drags them: under it, except past
 * either end, where they give way slowly so it is clear there is nothing
 * more; and never more than a slide's width either way.
 */
export function dragOffset(dx: number, index: number, count: number, width: number): number {
  const pastEdge = (index <= 0 && dx > 0) || (index >= count - 1 && dx < 0);
  const moved = pastEdge ? dx * EDGE_RESISTANCE : dx;
  const limit = Math.max(width, 0);
  return Math.max(-limit, Math.min(limit, moved));
}

/**
 * The slide a swipe ends on: the next one (dragged left) or the previous one
 * (dragged right) after a long enough drag or a quick flick, else the same
 * one. Never past either end.
 */
export function swipeTarget(
  index: number,
  count: number,
  dx: number,
  elapsedMs: number,
  width: number,
): number {
  const distance = Math.abs(dx);
  const far = distance >= Math.max(SWIPE_MIN_PX, width * SWIPE_SHARE);
  const flick = distance >= FLICK_MIN_PX && elapsedMs > 0 && distance / elapsedMs >= FLICK_SPEED;

  if (!far && !flick) return clampIndex(index, count);
  return clampIndex(index + (dx < 0 ? 1 : -1), count);
}

// ---------------------------------------------------------------------------
// The caption
// ---------------------------------------------------------------------------

export interface CaptionCount {
  /** Characters used, counted the way the platform counts them. */
  used: number;
  /** The platform's limit, or Studio's own when that is lower. */
  limit: number;
  over: boolean;
  /** "120 / 2,200" */
  text: string;
}

/**
 * The caption against the platform's limit, counted its way (X weighs links
 * and some characters differently). A platform that allows more than Studio
 * keeps is shown Studio's limit: the field cannot hold more, so a count
 * against the platform's would promise room that is not there. With no
 * platform, the count is against Studio's limit alone.
 */
export function captionCount(
  caption: string,
  platform: Pick<PreviewPlatform, 'maxLength' | 'lengthMethod'> | null,
): CaptionCount {
  const limit = Math.min(platform?.maxLength ?? MAX_CAPTION_LENGTH, MAX_CAPTION_LENGTH);
  const used = measureLength(caption, platform?.lengthMethod ?? 'utf16');
  return { used, limit, over: used > limit, text: `${grouped(used)} / ${grouped(limit)}` };
}

/** Said under the caption once it is longer than the platform takes. */
export function captionTooLong(platformName: string, limit: number): string {
  return `This caption is too long for ${platformName}, which takes up to ${grouped(limit)} characters. Shorten it before you post there.`;
}

/** Said under the caption while it fits (DS-7.2). */
export const CAPTION_HINT = 'Saved with the design, and added to the post when you send it.';

/**
 * Where a feed folds a long caption behind its "more", the composer
 * previews' values, for the share page's read-only caption.
 */
export const CAPTION_FOLDS: Partial<Record<PreviewPlatformId, { after: number; more: string }>> = {
  instagram: { after: 125, more: '… more' },
  facebook: { after: 480, more: '… See more' },
  linkedin: { after: 210, more: '…see more' },
};

/** Said in place of the platform switch when no platform takes the design's shape. */
export const NO_FRAME_MESSAGE =
  "No platform preview fits this design's shape, so the slides are shown on their own.";

// ---------------------------------------------------------------------------
// The share page
// ---------------------------------------------------------------------------

/** What a dead share link shows, and all it shows (DS-9.2). */
export const SHARE_UNAVAILABLE = 'This link is no longer available.';

/** What the share page shows when the design could not be fetched. */
export const SHARE_FAILED =
  'This design could not be loaded just now. Please try again in a moment.';

export type ShareProblem = 'gone' | 'failed';

/**
 * Why the share page has nothing to show, from the API's status. Expired,
 * revoked, deleted and never-existed links all answer one 404 (on purpose:
 * telling them apart would say whether a design exists at a guessed token),
 * and a link that is not a token at all can never work either. Anything
 * else, the API being away included, is worth trying again.
 */
export function shareProblem(status: number | null): ShareProblem {
  return status === 400 || status === 404 || status === 410 ? 'gone' : 'failed';
}

/**
 * "This link expires on 3 November 2026.", by the calendar of `timeZone`, or
 * of the reader's own zone when it is left out. The server, whose zone is not
 * the reader's, writes the UTC date; the browser then writes the reader's, so
 * a link that stops at 5 pm in California on the 3rd is not promised for the
 * 4th.
 */
export function expiryLine(iso: string, timeZone?: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const date = at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  });
  return `This link expires on ${date}.`;
}

function grouped(value: number): string {
  return value.toLocaleString('en-US');
}
