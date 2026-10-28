/**
 * The colour each piece of text is drawn in, and the ground it is read against.
 *
 * `brand.ts` guarantees the palette's inks read on the fills they belong to.
 * This file makes the same promise for what a *template* puts on a slide,
 * wherever it ends up:
 *
 * - **The ground is the region's, not the slide's.** Text in the panel of a
 *   split slide is read against the panel. A layout's painted block covers a
 *   region completely or not at all (`layouts.test.ts` holds every layout to
 *   that), so "which colour is behind this text" has one answer per region
 *   however far the text is nudged inside it.
 * - **A template's own colour always reads.** A slot asks for a role (an
 *   accent eyebrow, a number in the primary colour); if that role does not
 *   read on its ground with this theme, this brand and this background, it is
 *   drawn in the slide's text ink instead, or failing that in black or white.
 *   The user did not choose it, so they are never shown a broken pairing for
 *   it.
 * - **A colour the user chose is drawn as chosen**, and when it does not read
 *   the panel says so and offers Fix Contrast (DS-4.5). Changing what they
 *   picked behind their back would make the colour control feel broken.
 */
import { paletteForSlide, photoGround, slideGround } from './brand';
import { meetsAA, mix, normalizeHex, readableInk } from './color';
import { coversRect } from './formats';
import { decorRect, findLayout, findRegion, findSlot, regionRect, slotPlacement } from './layouts';
import { themeById } from './themes';
import type {
  ColorRole,
  DesignDocument,
  DesignSlide,
  ElementState,
  FormatId,
  Palette,
  RegionId,
  SlideLayout,
  SlotDef,
  SlotId,
} from './types';

/** The palette one slide of a design is drawn with. */
export function slidePalette(
  document: Pick<DesignDocument, 'themeId' | 'brand'>,
  slide: Pick<DesignSlide, 'background'>,
): Palette {
  return paletteForSlide(themeById(document.themeId), document.brand.colors, slide);
}

/**
 * The colour text in `region` is read against: the slide's ground, with any
 * painted block that covers the region laid over it. On a photo the ground is
 * the lightest the photo can be under its overlay.
 */
export function regionGround(
  layout: SlideLayout,
  format: FormatId,
  palette: Palette,
  slide: Pick<DesignSlide, 'background'>,
  regionId: RegionId,
): string {
  let ground =
    slide.background.kind === 'media'
      ? photoGround(slide.background.overlay)
      : slideGround(palette, slide);

  const region = findRegion(layout, regionId);
  if (!region) return ground;

  const area = regionRect(region, format);

  for (const decor of layout.decor ?? []) {
    if (decor.kind !== 'block') continue;

    const box = decorRect(layout, decor, format);
    if (box && coversRect(box, area)) {
      ground = mix(ground, palette[decor.colorRole], decor.opacity ?? 1);
    }
  }

  return ground;
}

/**
 * `preferred` if it reads on `ground`, the palette's text ink if that does,
 * and black or white otherwise. Always readable.
 */
export function legibleInk(palette: Palette, ground: string, preferred: string): string {
  if (meetsAA(preferred, ground)) return preferred;
  if (meetsAA(palette.text, ground)) return palette.text;
  return readableInk(ground);
}

export interface SlotInk {
  /** What the text is drawn in. */
  color: string;
  /** What it is read against. */
  ground: string;
  /** True when the user picked the colour (a role or a hex) rather than the template. */
  chosen: boolean;
  /** False only for a colour the user picked that does not read on the ground. */
  readable: boolean;
}

export function slotInk(
  palette: Palette,
  slot: SlotDef,
  state: ElementState | undefined,
  ground: string,
): SlotInk {
  const custom = state?.color ? normalizeHex(state.color) : null;

  if (custom) {
    return { color: custom, ground, chosen: true, readable: meetsAA(custom, ground) };
  }

  if (state?.colorRole) {
    const color = palette[state.colorRole];
    return { color, ground, chosen: true, readable: meetsAA(color, ground) };
  }

  return {
    color: legibleInk(palette, ground, palette[slot.colorRole ?? 'text']),
    ground,
    chosen: false,
    readable: true,
  };
}

/**
 * The theme's own inks, in the order Fix Contrast tries them. `text` and
 * `onPrimary` are a theme's dark and light ink (or light and dark, on a dark
 * theme), which is what the stories mean by "the theme's light or dark text".
 */
const FIX_ROLES: readonly ColorRole[] = ['text', 'onPrimary', 'onSurface', 'onAccent', 'textMuted'];

/**
 * What Fix Contrast applies: the first of the theme's inks that reads on the
 * ground, as a role so a later theme or brand change still recolours it.
 * Only when none of them reads does it fall back to plain black or white.
 */
export function fixContrast(
  palette: Palette,
  ground: string,
): Pick<ElementState, 'colorRole' | 'color'> {
  for (const role of FIX_ROLES) {
    if (meetsAA(palette[role], ground)) return { colorRole: role, color: undefined };
  }

  return { colorRole: undefined, color: readableInk(ground) };
}

/**
 * The ink of one slot on one slide of a design, as the panel needs it: null
 * for a slot that draws no text (a picture, a logo) or that does not exist.
 */
export function inkOf(
  document: DesignDocument,
  slide: DesignSlide,
  slotId: SlotId,
): SlotInk | null {
  const layout = findLayout(slide.layoutId);
  const slot = layout ? findSlot(layout, slotId) : null;
  if (!layout || !slot || (slot.kind !== 'text' && slot.kind !== 'list')) return null;

  const palette = slidePalette(document, slide);
  const state = slide.elements[slotId];
  const ground = regionGround(
    layout,
    document.format,
    palette,
    slide,
    slotPlacement(slot, state).region,
  );

  return slotInk(palette, slot, state, ground);
}

/** Fix Contrast's patch for one slot, or null when it already reads. */
export function contrastFixFor(
  document: DesignDocument,
  slide: DesignSlide,
  slotId: SlotId,
): Pick<ElementState, 'colorRole' | 'color'> | null {
  const ink = inkOf(document, slide, slotId);
  if (!ink || ink.readable) return null;

  return fixContrast(slidePalette(document, slide), ink.ground);
}
