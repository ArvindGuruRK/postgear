/**
 * The properties panel's logic (Sprint 9, DS-4.2 to DS-4.7, DS-2.5), kept
 * pure so it is tested without a browser: the length hint, which colour or
 * background a choice stands for, list edits within their limits, the logo a
 * slot shows and the small edits the panel's controls make.
 *
 * Every edit here takes the document it is given and finds the slide by id
 * inside it, the way the editor's reducer hands it over (`ApplyChange`): the
 * panel never applies a change to a copy it drew from, so a burst of clicks
 * cannot land on a stale design.
 *
 * Two choices worth knowing:
 *
 * - **Every swatch shows the colour the slide really draws.** An element's
 *   swatches come from the slide's own palette (a brand kit, a coloured
 *   background and a photo all change it), and a background's from what the
 *   slide would be painted, so what is picked is what appears.
 * - **Custom starts from the colour on screen.** Choosing Custom pins the
 *   colour the element or slide shows now and opens the hex field on it, so
 *   the swatch that reads as chosen is always the one the design is on.
 */
import {
  type Align,
  BRAND_COLOR_KEYS,
  type BrandColors,
  COLOR_ROLES,
  type ColorRole,
  contrastFixFor,
  type DesignDocument,
  type DesignSlide,
  type ElementState,
  findLayout,
  findSlot,
  inkOf,
  type LogoPlacement,
  luminance,
  MAX_LIST_ITEMS,
  normalizeHex,
  SAFE_PHOTO_OVERLAY,
  type SizeStep,
  type SlideBackground,
  type SlideLayout,
  type SlotDef,
  type SlotId,
  setBackground,
  singleLine,
  slideGround,
  slidePalette,
  slotInk,
  slotText,
  updateElement,
} from '@postgear/design-engine';
import type { BrandKitView, StudioMediaRef } from '@/types/studio';
import { COLOR_LABELS } from './studio-view-model';

/** The swatch picker's value for "the template's own colour". */
export const AUTO_COLOR = 'auto';
/** The swatch picker's value for a hex of the person's own. */
export const CUSTOM_COLOR = 'custom';
/** The background picker's value for a photo. */
export const PHOTO_BACKGROUND = 'photo';
/** The brand kit picker's value for "no kit". Kit ids are generated, so none can be this. */
export const NO_KIT = 'no-brand-kit';

/** One swatch: the picker's value, its name and the colour it shows (null when it has none). */
export interface Swatch {
  value: string;
  label: string;
  color: string | null;
}

/** The slide with this id, where it sits, and its layout (null for one no longer available). */
export function findSlide(
  document: DesignDocument,
  slideId: string,
): { slide: DesignSlide; index: number; layout: SlideLayout | null } | null {
  const index = document.slides.findIndex((slide) => slide.id === slideId);
  if (index === -1) return null;

  const slide = document.slides[index];
  return { slide, index, layout: findLayout(slide.layoutId) };
}

/** A slot on a slide, found by ids in the document given. */
function slotOn(document: DesignDocument, slideId: string, slotId: SlotId) {
  const found = findSlide(document, slideId);
  const slot = found?.layout ? findSlot(found.layout, slotId) : null;
  return found && slot ? { ...found, slot, state: found.slide.elements[slotId] } : null;
}

/** A picture the design draws, or null for one that was deleted. */
export function mediaOf(
  media: Readonly<Record<string, StudioMediaRef>>,
  mediaId: string | null | undefined,
): StudioMediaRef | null {
  return mediaId && Object.hasOwn(media, mediaId) ? media[mediaId] : null;
}

function isColorRole(value: string): value is ColorRole {
  return (COLOR_ROLES as readonly string[]).includes(value);
}

function isBrandRole(role: ColorRole): role is keyof BrandColors {
  return (BRAND_COLOR_KEYS as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Characters as a person counts them: an emoji is one, not the two units it is stored as. */
export function characterCount(text: string): number {
  return Array.from(text).length;
}

/**
 * The hint under a text field (DS-4.2): "42 of about 60 characters". A hint,
 * never a limit: whether the words fit is the fit check's answer.
 */
export function lengthHint(text: string, recommended: number): string {
  return `${characterCount(text)} of about ${recommended} characters`;
}

/** The same hint for a list, whose recommended length is per item. */
export function listHint(recommended: number): string {
  return `Keep each item to about ${recommended} characters.`;
}

/** How many rows a text field starts with, from the length its slot is written for. */
export function textRows(recommended: number | undefined): number {
  if (!recommended) return 3;
  if (recommended >= 200) return 6;
  if (recommended >= 80) return 4;
  return 2;
}

/**
 * The second line of the "too long for this space" warning (DS-4.4). The fit
 * check shrinks from the size chosen, so a smaller size helps only where the
 * slot offers sizes and one is left: at Small there is none to suggest.
 */
export function overflowAdvice(slot: SlotDef, state: ElementState | undefined): string {
  return slot.resizable && sizeOf(state) !== 'sm'
    ? 'Shorten it or choose a smaller size.'
    : 'Shorten it so every word shows.';
}

/**
 * The words a slot shows, on one line, for the panel's element list: a
 * screen reader hears "Headline, 5 Simple Steps" rather than a bare name.
 * Pictures and logos have no words, so nothing.
 */
export function elementPreview(
  document: DesignDocument,
  slideIndex: number,
  slot: SlotDef,
): string {
  const flat = (value: string) => value.replace(/\s+/g, ' ').trim();

  if (slot.kind === 'text') return flat(slotText(document, slideIndex, slot));
  if (slot.kind === 'list') {
    const items = document.slides[slideIndex]?.elements[slot.id]?.items ?? [];
    return flat(items.find((item) => item.trim() !== '') ?? '');
  }
  return '';
}

/** A preview cut to a length at a whole character, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  const characters = Array.from(text);
  if (characters.length <= max) return text;

  return `${characters
    .slice(0, Math.max(0, max - 1))
    .join('')
    .trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Size and alignment
// ---------------------------------------------------------------------------

export function sizeOf(state: ElementState | undefined): SizeStep {
  return state?.size ?? 'md';
}

/** Medium is the template's own size, so it is stored as no size at all. */
export function sizePatch(size: SizeStep): Pick<ElementState, 'size'> {
  return { size: size === 'md' ? undefined : size };
}

export function alignOf(slot: SlotDef, state: ElementState | undefined): Align {
  return state?.align ?? slot.align ?? 'start';
}

/** The template's own alignment is stored as none, so a later layout change can follow it. */
export function alignPatch(slot: SlotDef, align: Align): Pick<ElementState, 'align'> {
  return { align: align === (slot.align ?? 'start') ? undefined : align };
}

/** S, M or L chosen for an element (DS-4.7), where its slot offers sizes. */
export function withSize(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  size: SizeStep,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (!found?.slot.resizable || sizeOf(found.state) === size) return document;

  return updateElement(document, slideId, slotId, sizePatch(size));
}

/** Left, centre or right chosen for an element, against its slot's own alignment. */
export function withAlign(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  align: Align,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (!found?.slot.alignable || alignOf(found.slot, found.state) === align) return document;

  return updateElement(document, slideId, slotId, alignPatch(found.slot, align));
}

/** The placements' names, in the order the panel offers them. */
export const PLACEMENT_LABELS: Record<LogoPlacement, string> = {
  header: 'Header',
  centre: 'Centre',
  footer: 'Footer',
};

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

/** The most items a list slot takes: its own limit, within the design's. */
export function listLimit(slot: SlotDef): number {
  return Math.min(slot.maxItems ?? MAX_LIST_ITEMS, MAX_LIST_ITEMS);
}

/** The rows the panel shows: the items, or one empty row to type into for a list with none. */
export function listRows(state: ElementState | undefined): string[] {
  const items = state?.items ?? [];
  return items.length > 0 ? items : [''];
}

/** Typing into one row. An item is one line: a pasted line break becomes a space. */
export function withListItem(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  index: number,
  text: string,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (found?.slot.kind !== 'list') return document;

  const rows = listRows(found.state);
  const value = singleLine(text);
  if (index < 0 || index >= rows.length || rows[index] === value) return document;

  return updateElement(document, slideId, slotId, {
    items: rows.map((row, at) => (at === index ? value : row)),
  });
}

/** Add Item: an empty row at the end, while the list has room. */
export function withItemAdded(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (found?.slot.kind !== 'list') return document;

  const rows = listRows(found.state);
  if (rows.length >= listLimit(found.slot)) return document;

  return updateElement(document, slideId, slotId, { items: [...rows, ''] });
}

/** Removes one row. A list keeps at least one, so the last row stays. */
export function withItemRemoved(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  index: number,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (found?.slot.kind !== 'list') return document;

  const rows = listRows(found.state);
  if (rows.length <= 1 || index < 0 || index >= rows.length) return document;

  return updateElement(document, slideId, slotId, { items: rows.filter((_, at) => at !== index) });
}

// ---------------------------------------------------------------------------
// An element's colour
// ---------------------------------------------------------------------------

/**
 * The colour choice an element is on: `auto` (the template's own colour), a
 * role, or `custom`. A valid custom hex wins over a role, as the renderer
 * draws it; an unreadable stored hex is ignored there, and here.
 */
export function colorChoiceOf(state: ElementState | undefined): string {
  if (state?.color && normalizeHex(state.color)) return CUSTOM_COLOR;
  return state?.colorRole ?? AUTO_COLOR;
}

/** The custom hex an element is drawn in, or null when it has none. */
export function customColorOf(state: ElementState | undefined): string | null {
  return state?.color ? normalizeHex(state.color) : null;
}

/**
 * What a role that is not one of the brand's five is called on an element's swatch.
 * Fix Contrast can choose one of the theme's other inks (the light text that
 * reads on a primary panel, say); the stories call those "the theme's light
 * or dark text", so that is the name.
 */
export function inkLabel(color: string): string {
  return luminance(color) > 0.18 ? 'Light Text' : 'Dark Text';
}

/**
 * The swatches an element offers, in the colours the slide really draws:
 * Auto (the template's own colour), the five brand roles, any other role the
 * element is on, then Custom with its hex once it has one.
 */
export function elementSwatches(
  document: DesignDocument,
  slide: DesignSlide,
  slot: SlotDef,
): Swatch[] {
  const palette = slidePalette(document, slide);
  const state = slide.elements[slot.id];
  const ink = inkOf(document, slide, slot.id);
  const auto = ink
    ? slotInk(palette, slot, undefined, ink.ground).color
    : palette[slot.colorRole ?? 'text'];

  const swatches: Swatch[] = [
    { value: AUTO_COLOR, label: 'Auto', color: auto },
    ...BRAND_COLOR_KEYS.map((role) => ({
      value: role,
      label: COLOR_LABELS[role],
      color: palette[role],
    })),
  ];

  const choice = colorChoiceOf(state);
  if (isColorRole(choice) && !isBrandRole(choice)) {
    swatches.push({ value: choice, label: inkLabel(palette[choice]), color: palette[choice] });
  }

  swatches.push({ value: CUSTOM_COLOR, label: 'Custom', color: customColorOf(state) });
  return swatches;
}

/**
 * A swatch chosen for an element. Custom pins the colour it shows now; the
 * hex field then changes it (`withCustomColor`).
 */
export function withColorChoice(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  choice: string,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (!found?.slot.colorable) return document;

  if (choice === AUTO_COLOR) {
    return updateElement(document, slideId, slotId, { colorRole: undefined, color: undefined });
  }
  if (choice === CUSTOM_COLOR) {
    if (customColorOf(found.state)) return document;
    const ink = inkOf(document, found.slide, slotId);
    return ink ? withCustomColor(document, slideId, slotId, ink.color) : document;
  }
  if (isColorRole(choice)) {
    return updateElement(document, slideId, slotId, { colorRole: choice, color: undefined });
  }
  return document;
}

/** A hex typed or picked for an element. Anything that is not a colour changes nothing. */
export function withCustomColor(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  hex: string,
): DesignDocument {
  const color = normalizeHex(hex);
  if (!color) return document;

  const found = slotOn(document, slideId, slotId);
  if (!found?.slot.colorable || customColorOf(found.state) === color) return document;

  return updateElement(document, slideId, slotId, { color, colorRole: undefined });
}

/**
 * Fix Contrast (DS-4.5): the theme's first ink that reads where the text
 * sits, worked out on the design as it is when the click lands.
 */
export function withContrastFixed(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
): DesignDocument {
  const found = findSlide(document, slideId);
  const fix = found ? contrastFixFor(document, found.slide, slotId) : null;
  return fix ? updateElement(document, slideId, slotId, fix) : document;
}

// ---------------------------------------------------------------------------
// A slide's background
// ---------------------------------------------------------------------------

/** The background choice a slide is on: a role, `custom` or `photo`. */
export function backgroundChoiceOf(background: SlideBackground): string {
  switch (background.kind) {
    case 'role':
      return background.role;
    case 'color':
      return CUSTOM_COLOR;
    case 'media':
      return PHOTO_BACKGROUND;
  }
}

/** The colour a slide is painted with this background, as the renderer paints it. */
export function groundOf(
  document: Pick<DesignDocument, 'themeId' | 'brand'>,
  background: SlideBackground,
): string {
  const slide = { background };
  return slideGround(slidePalette(document, slide), slide);
}

/**
 * The background swatches: the five brand roles as the slide would really be
 * painted, any other role the slide is on (called Theme Colour: the light and
 * dark text names fit an ink, not a ground), then Custom with its hex once it
 * has one. Photo is drawn by the panel, from the picture itself.
 */
export function backgroundSwatches(document: DesignDocument, slide: DesignSlide): Swatch[] {
  const swatches: Swatch[] = BRAND_COLOR_KEYS.map((role) => ({
    value: role,
    label: COLOR_LABELS[role],
    color: groundOf(document, { kind: 'role', role }),
  }));

  const { background } = slide;
  if (background.kind === 'role' && !isBrandRole(background.role)) {
    const color = groundOf(document, background);
    swatches.push({ value: background.role, label: 'Theme Colour', color });
  }

  swatches.push({
    value: CUSTOM_COLOR,
    label: 'Custom',
    color: background.kind === 'color' ? normalizeHex(background.hex) : null,
  });
  return swatches;
}

/** A role or Custom chosen for a slide's background. Custom pins the colour it is painted now. */
export function withBackgroundChoice(
  document: DesignDocument,
  slideId: string,
  choice: string,
): DesignDocument {
  const found = findSlide(document, slideId);
  if (!found) return document;

  const { background } = found.slide;

  if (choice === CUSTOM_COLOR) {
    if (background.kind === 'color') return document;
    return setBackground(document, slideId, {
      kind: 'color',
      hex: groundOf(document, background),
    });
  }

  if (!isColorRole(choice)) return document;
  if (background.kind === 'role' && background.role === choice) return document;

  return setBackground(document, slideId, { kind: 'role', role: choice });
}

/** A hex typed or picked for a slide's background. */
export function withCustomBackground(
  document: DesignDocument,
  slideId: string,
  hex: string,
): DesignDocument {
  const color = normalizeHex(hex);
  const found = findSlide(document, slideId);
  if (!color || !found) return document;

  const { background } = found.slide;
  if (background.kind === 'color' && normalizeHex(background.hex) === color) return document;

  return setBackground(document, slideId, { kind: 'color', hex: color });
}

/** Remove Photo: back to the background the slide's layout starts with. */
export function withPhotoRemoved(document: DesignDocument, slideId: string): DesignDocument {
  const found = findSlide(document, slideId);
  if (found?.slide.background.kind !== 'media') return document;

  return setBackground(
    document,
    slideId,
    found.layout?.background ?? { kind: 'role', role: 'background' },
  );
}

/** The photo's darkening, 0 to 1, kept to two decimals. Only a photo has one. */
export function withOverlay(
  document: DesignDocument,
  slideId: string,
  overlay: number,
): DesignDocument {
  const found = findSlide(document, slideId);
  const background = found?.slide.background;
  if (background?.kind !== 'media') return document;

  const next = Math.round(Math.min(1, Math.max(0, overlay)) * 100) / 100;
  if (next === background.overlay) return document;

  return setBackground(document, slideId, { ...background, overlay: next });
}

/**
 * Darken Photo: the darkening raised to the level white text reads at on any
 * photo. A photo already darker than that stays as it is.
 */
export function withSafeOverlay(document: DesignDocument, slideId: string): DesignDocument {
  const background = findSlide(document, slideId)?.slide.background;
  if (background?.kind !== 'media' || background.overlay >= SAFE_PHOTO_OVERLAY) return document;

  return withOverlay(document, slideId, SAFE_PHOTO_OVERLAY);
}

/** The darkening as the slider shows it, 0 to 100. */
export function overlayPercent(overlay: number): number {
  return Math.round(Math.min(1, Math.max(0, overlay)) * 100);
}

// ---------------------------------------------------------------------------
// Elements on a slide, and the logo
// ---------------------------------------------------------------------------

/** The elements a slide shows: its layout's slots, less the ones hidden. */
export function shownSlots(layout: SlideLayout, slide: DesignSlide): SlotDef[] {
  return layout.slots.filter((slot) => !slide.elements[slot.id]?.hidden);
}

/** The elements a slide may hide or show: its layout's optional slots. */
export function optionalSlots(layout: SlideLayout): SlotDef[] {
  return layout.slots.filter((slot) => slot.optional);
}

/** Shows or hides an optional element. */
export function withShown(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
  shown: boolean,
): DesignDocument {
  return updateElement(document, slideId, slotId, { hidden: shown ? undefined : true });
}

/**
 * What Reset Style puts back: how the element looks (its size, alignment,
 * colour, nudge and a logo's placement). Its words, items and picture are the
 * person's own, so they stay; Reset Slide is the way back to the template's.
 */
const LOOK_KEYS = [
  'size',
  'align',
  'colorRole',
  'color',
  'offset',
  'placement',
] as const satisfies readonly (keyof ElementState)[];

/** True when an element looks other than its template draws it, so Reset Style has work to do. */
export function canResetElement(state: ElementState | undefined): boolean {
  return LOOK_KEYS.some((key) => state?.[key] !== undefined);
}

/** Reset Style: the element as its template draws it, with its words and picture kept. */
export function withElementReset(
  document: DesignDocument,
  slideId: string,
  slotId: SlotId,
): DesignDocument {
  const found = slotOn(document, slideId, slotId);
  if (!found || !canResetElement(found.state)) return document;

  const patch: Partial<ElementState> = {};
  for (const key of LOOK_KEYS) patch[key] = undefined;
  return updateElement(document, slideId, slotId, patch);
}

export interface LogoView {
  /** The picture the slot draws: its own, or the design's brand logo. Null when there is none. */
  mediaId: string | null;
  /** True when that picture is the brand logo. */
  fromBrand: boolean;
  /** True when Use Brand Logo would change it: there is a brand logo and another is chosen. */
  canUseBrand: boolean;
}

/**
 * The logo a slot shows (DS-4.6). A slot with no picture of its own shows
 * the design's brand logo, which is what lets a brand kit put its logo on
 * every slide at once.
 */
export function logoView(document: DesignDocument, state: ElementState | undefined): LogoView {
  const own = state?.mediaId ?? null;
  const brand = document.brand.logoMediaId;

  return {
    mediaId: own ?? brand,
    fromBrand: brand !== null && (own === null || own === brand),
    canUseBrand: brand !== null && own !== null && own !== brand,
  };
}

// ---------------------------------------------------------------------------
// The brand kit picker
// ---------------------------------------------------------------------------

/**
 * What the brand kit picker shows: no kit, the design's kit, or nothing at
 * all ('', its placeholder) for a kit that has been deleted, which the alert
 * above it explains.
 */
export function kitSelectValue(
  brand: Pick<DesignDocument['brand'], 'kitId'>,
  kits: readonly BrandKitView[],
): string {
  if (!brand.kitId) return NO_KIT;
  return kits.some((kit) => kit.id === brand.kitId) ? brand.kitId : '';
}
