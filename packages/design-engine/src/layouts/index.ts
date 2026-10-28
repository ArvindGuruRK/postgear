/**
 * Every layout, and the geometry the editor, the renderer and the API ask of
 * them.
 *
 * A slide stores `layoutId` as `"split-picture@1"`: the id and the version it
 * was made against. Old versions stay in this table when a layout changes, so
 * a design made a year ago still renders the way its author saw it, and
 * `upgrade()` in `schema.ts` is what moves a document forward deliberately.
 * `layoutKey()` and `parseLayoutKey()` are the one place that format lives.
 *
 * Everything that turns a slot into a rectangle goes through `slotFrame()`:
 * the canvas, the drag clamp, the keyboard nudge, the schema's offset clamp
 * and the tests. A logo that has moved to its footer spot is therefore in the
 * footer for all of them at once.
 */
import { placeInRegion } from '../constraints';
import { contentBox, nest } from '../formats';
import {
  type Align,
  type DecorDef,
  type ElementState,
  type FormatId,
  LOGO_PLACEMENTS,
  type LogoPlacement,
  REGION_LABELS,
  type Rect,
  type RegionDef,
  type RegionId,
  type SlideLayout,
  type SlideRole,
  type SlotDef,
} from '../types';
import { CLOSING_LAYOUTS } from './closing';
import { CONTENT_LAYOUTS } from './content';
import { COVER_LAYOUTS } from './covers';
import { LIST_LAYOUTS } from './lists';
import { QUOTE_LAYOUTS } from './quotes';
import { SIGNATURE_LAYOUTS } from './signature';
import { STAT_LAYOUTS } from './stats';

export const LAYOUTS: SlideLayout[] = [
  ...COVER_LAYOUTS,
  ...CONTENT_LAYOUTS,
  ...LIST_LAYOUTS,
  ...QUOTE_LAYOUTS,
  ...STAT_LAYOUTS,
  ...CLOSING_LAYOUTS,
  ...SIGNATURE_LAYOUTS,
];

/** The layout Start From Blank and every fallback use. */
export const PLAIN_LAYOUT_ID = 'plain';

/** "split-picture" + 1 -> "split-picture@1". */
export function layoutKey(layout: Pick<SlideLayout, 'id' | 'version'>): string {
  return `${layout.id}@${layout.version}`;
}

export function parseLayoutKey(key: string): { id: string; version: number } | null {
  const at = key.lastIndexOf('@');
  if (at <= 0) return null;

  const version = Number(key.slice(at + 1));
  if (!Number.isInteger(version) || version < 1) return null;

  return { id: key.slice(0, at), version };
}

const BY_KEY: ReadonlyMap<string, SlideLayout> = new Map(
  LAYOUTS.map((layout) => [layoutKey(layout), layout]),
);

export function findLayout(key: string): SlideLayout | null {
  return BY_KEY.get(key) ?? null;
}

/** The current version of a layout, by its bare id. */
export function latestLayout(id: string): SlideLayout | null {
  let best: SlideLayout | null = null;

  for (const layout of LAYOUTS) {
    if (layout.id === id && (!best || layout.version > best.version)) best = layout;
  }

  return best;
}

/** The plain layout. Its absence is a broken library, so it throws. */
export function plainLayout(): SlideLayout {
  const plain = latestLayout(PLAIN_LAYOUT_ID);
  if (!plain) throw new Error('The plain layout is missing from the layout library.');
  return plain;
}

export function layoutsForRole(role: SlideRole, format: FormatId): SlideLayout[] {
  return LAYOUTS.filter(
    (layout) =>
      layout.role === role && layout.formats.includes(format) && latestLayout(layout.id) === layout,
  );
}

export const SLIDE_ROLES: readonly SlideRole[] = [
  'cover',
  'content',
  'list',
  'quote',
  'statistic',
  'closing',
];

export const SLIDE_ROLE_LABELS: Record<SlideRole, string> = {
  cover: 'Cover',
  content: 'Content',
  list: 'List',
  quote: 'Quote',
  statistic: 'Statistic',
  closing: 'Closing CTA',
};

/** The layout Add Slide uses when only a role is chosen. */
const DEFAULT_LAYOUT_FOR_ROLE: Record<SlideRole, string> = {
  cover: 'cover-headline',
  content: 'content-eyebrow',
  list: 'list-numbered',
  quote: 'quote-centre',
  statistic: 'stat-big',
  closing: 'closing-cta',
};

export function defaultLayoutFor(role: SlideRole | undefined): SlideLayout {
  return (role ? latestLayout(DEFAULT_LAYOUT_FOR_ROLE[role]) : null) ?? plainLayout();
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function findRegion(layout: SlideLayout, id: RegionId): RegionDef | null {
  return layout.regions.find((region) => region.id === id) ?? null;
}

/** What the editor calls a region while something is dragged in it. */
export function regionLabel(region: RegionDef): string {
  return region.label ?? REGION_LABELS[region.id];
}

/**
 * A region's rectangle in percentages of the **canvas**, for one format.
 *
 * The layout states the rectangle in percentages of the content box, with an
 * optional per-format override where a shape genuinely needs one. Everything
 * downstream asks this function rather than doing the nesting itself, so
 * there is one answer.
 */
export function regionRect(region: RegionDef, format: FormatId): Rect {
  return nest(contentBox(format), region.byFormat?.[format] ?? region.area);
}

/**
 * A painted shape's rectangle in percentages of the canvas: of its region
 * when it names one, of the canvas itself otherwise. Null for a shape that
 * names a region the layout does not have, which `layouts.test.ts` refuses.
 */
export function decorRect(layout: SlideLayout, decor: DecorDef, format: FormatId): Rect | null {
  if (decor.region === undefined) return decor.box;

  const region = findRegion(layout, decor.region);
  return region ? nest(regionRect(region, format), decor.box) : null;
}

export function findSlot(layout: SlideLayout, slotId: string): SlotDef | null {
  return layout.slots.find((slot) => slot.id === slotId) ?? null;
}

/** The logo placements a slot offers, in the order the panel lists them. */
export function logoPlacements(slot: SlotDef): LogoPlacement[] {
  if (slot.kind !== 'logo' || !slot.spots) return [];
  return LOGO_PLACEMENTS.filter((placement) => slot.spots?.[placement] !== undefined);
}

export interface SlotPlacement {
  region: RegionId;
  /** Percentages of the region, before any nudge. */
  box: Rect;
  align: Align | undefined;
  /** For a logo, the placement this is; null for every other slot. */
  placement: LogoPlacement | null;
}

/**
 * Where a slot sits before it is nudged: its own region and box, or, for a
 * logo, the spot its placement names. A placement the slot does not offer
 * falls back to the one it starts in, so a stale value can never put a logo
 * somewhere the layout did not draw room for.
 */
export function slotPlacement(
  slot: SlotDef,
  state?: Pick<ElementState, 'placement'> | null,
): SlotPlacement {
  if (slot.kind === 'logo' && slot.spots) {
    const requested = state?.placement;
    const placement =
      requested && slot.spots[requested] ? requested : (slot.placement ?? logoPlacements(slot)[0]);
    const spot = placement ? slot.spots[placement] : undefined;

    if (placement && spot) {
      return { region: spot.region, box: spot.box, align: spot.align, placement };
    }
  }

  return { region: slot.region, box: slot.box, align: slot.align, placement: null };
}

export interface SlotFrame {
  region: RegionDef;
  /** The region, in percentages of the canvas. */
  regionRect: Rect;
  /** The slot after its nudge, in percentages of the region. */
  local: Rect;
  /** The slot after its nudge, in percentages of the canvas. */
  rect: Rect;
  align: Align | undefined;
  placement: LogoPlacement | null;
}

/** Everything about where a slot is drawn on one slide, in one format. */
export function slotFrame(
  layout: SlideLayout,
  slot: SlotDef,
  format: FormatId,
  state?: Pick<ElementState, 'placement' | 'offset'> | null,
): SlotFrame | null {
  const placement = slotPlacement(slot, state);
  const region = findRegion(layout, placement.region);
  if (!region) return null;

  const area = regionRect(region, format);
  const local = placeInRegion(placement.box, state?.offset);

  return {
    region,
    regionRect: area,
    local,
    rect: nest(area, local),
    align: placement.align,
    placement: placement.placement,
  };
}

export {
  CLOSING_LAYOUTS,
  CONTENT_LAYOUTS,
  COVER_LAYOUTS,
  LIST_LAYOUTS,
  QUOTE_LAYOUTS,
  SIGNATURE_LAYOUTS,
  STAT_LAYOUTS,
};
