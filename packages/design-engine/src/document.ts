/**
 * Building and changing a design document.
 *
 * Every write the editor makes goes through a function here, and every one of
 * them is pure: take a document, return a new one. The editor can then keep
 * the result in `history.ts` and hand it to the autosave without a second
 * code path, and the API can build a document from a preset with the same
 * code the browser would have used.
 *
 * **Creating a design is a copy, always.** `documentFromPreset` reads the
 * preset's sample content and writes it into a fresh document; nothing is
 * shared with the preset afterwards, so editing a design cannot change a
 * template or another design that started from the same one.
 *
 * A function given something it cannot apply (an unknown slide, a layout
 * that does not take this format, a twenty-first slide) returns the document
 * it was given, unchanged and by reference, so the editor can tell "nothing
 * happened" apart from a change with `===`.
 */
import { clampText, singleLine } from './bindings';
import { clampToRegion } from './constraints';
import {
  defaultLayoutFor,
  findLayout,
  findSlot,
  latestLayout,
  layoutKey,
  plainLayout,
  slotPlacement,
} from './layouts';
import { presetById, presetFormats, SAMPLE_HANDLE } from './presets';
import { sampleElements, sampleState } from './samples';
import { DEFAULT_THEME_ID, isThemeId, themeById } from './themes';
import {
  type BrandColors,
  DESIGN_SCHEMA_VERSION,
  type DesignBrand,
  type DesignDocument,
  type DesignSlide,
  type ElementState,
  type FormatId,
  type LogoPlacement,
  MAX_BRAND_NAME_LENGTH,
  MAX_CAPTION_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_LIST_ITEMS,
  MAX_SLIDES,
  MAX_TEXT_LENGTH,
  type PresetSlide,
  type SlideBackground,
  type SlideLayout,
  type SlideRole,
  type SlotDef,
  type SlotId,
} from './types';

export const BLANK_PRESET_ID = 'blank';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A new slide id: `s-` and ten random characters (60 bits) from the browser's
 * or Node's own `crypto`. Ids are made on the client, because a slide exists
 * before it is saved, and the schema checks their shape on the way in.
 */
export function slideId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);

  let suffix = '';
  // 256 is a multiple of 64, so `% 64` keeps every character equally likely.
  for (const byte of bytes) suffix += ID_ALPHABET[byte % 64];

  return `s-${suffix}`;
}

export function emptyBrand(): DesignBrand {
  return { kitId: null, colors: null, logoMediaId: null, name: null, kitVersion: null };
}

function copyBrand(brand: DesignBrand): DesignBrand {
  return { ...brand, colors: brand.colors ? { ...brand.colors } : null };
}

function copyBackground(background: SlideBackground): SlideBackground {
  return { ...background };
}

/** Removes keys set to `undefined`, so "clear this" in a patch really clears it. */
function defined(state: ElementState): ElementState {
  const result: ElementState = {};

  for (const [key, value] of Object.entries(state) as Array<[keyof ElementState, unknown]>) {
    if (value !== undefined) (result as Record<string, unknown>)[key] = value;
  }

  return result;
}

/**
 * Drops whatever a slot does not allow, so no edit made through this file can
 * produce an element the schema would refuse at the next autosave: text on a
 * bound or non-text slot, items past the slot's limit, a size step on a slot
 * without one, and so on. The schema still refuses all of these from a
 * client; this is the engine keeping its own writes valid.
 */
function allowedBy(slot: SlotDef, state: ElementState): ElementState {
  const next = { ...state };

  if (slot.kind !== 'text' || slot.bind) delete next.text;
  else if (next.text !== undefined) next.text = clampText(next.text, MAX_TEXT_LENGTH);
  if (slot.kind !== 'list') delete next.items;
  else if (next.items) {
    next.items = next.items
      .slice(0, Math.min(slot.maxItems ?? MAX_LIST_ITEMS, MAX_LIST_ITEMS))
      .map((item) => clampText(item, MAX_TEXT_LENGTH));
  }
  if (slot.kind !== 'image' && slot.kind !== 'logo') delete next.mediaId;
  if (!slot.optional) delete next.hidden;
  if (!slot.resizable) delete next.size;
  if (!slot.alignable) delete next.align;
  if (!slot.colorable) {
    delete next.colorRole;
    delete next.color;
  }
  if (slot.kind !== 'logo' || !next.placement || !slot.spots?.[next.placement])
    delete next.placement;
  if (next.hidden === false) delete next.hidden;

  return next;
}

export interface CreateDocumentInput {
  presetId: string;
  format: FormatId;
  brand?: DesignBrand | null;
  /** The handle every slide shows. Defaults to the sample one for a preset, none for blank. */
  handle?: string;
  /** Injected so a test gets stable ids. */
  newId?: () => string;
}

/**
 * A design from a preset, or the blank one.
 *
 * A preset the library no longer has (an id from an old link, a template
 * retired between releases), or one that cannot be drawn in this format,
 * falls back to blank rather than failing: the user asked for a design, and
 * an editor with one plain slide is a better answer than an error page. The
 * API checks both before it gets here, so the fallback is a safety net.
 */
export function documentFromPreset(input: CreateDocumentInput): DesignDocument {
  const newId = input.newId ?? slideId;
  const preset = input.presetId === BLANK_PRESET_ID ? null : presetById(input.presetId);

  if (!preset || !presetFormats(preset).includes(input.format)) {
    return blankDocument({
      format: input.format,
      brand: input.brand,
      handle: input.handle,
      newId,
    });
  }

  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    format: input.format,
    presetId: preset.id,
    themeId: themeById(preset.themeId).id,
    brand: copyBrand(input.brand ?? emptyBrand()),
    handle: input.handle ?? SAMPLE_HANDLE,
    caption: '',
    slides: preset.slides.map((entry, index) => slideFromPreset(entry, newId(), index)),
  };
}

/**
 * One slide of a preset, copied. `origin` is its index in the preset, which
 * is what Reset Slide restores later wherever the slide has moved.
 */
function slideFromPreset(entry: PresetSlide, id: string, origin: number): DesignSlide {
  // A preset naming a layout that no longer exists is a bug in the library,
  // caught by `presets.test.ts`; at runtime it becomes a plain slide rather
  // than a crash halfway through building a document.
  const layout = latestLayout(entry.layoutId);
  if (!layout) return { ...freshSlide(plainLayout(), id), origin };

  const elements: DesignSlide['elements'] = {};

  for (const slot of layout.slots) {
    const state: ElementState = {};
    const text = entry.text?.[slot.id];
    const items = entry.items?.[slot.id];

    // Bound slots take their words from the design, never from a slide.
    if (slot.kind === 'text' && !slot.bind && text !== undefined) state.text = text;
    if (slot.kind === 'list' && items !== undefined) {
      state.items = items.slice(0, slot.maxItems ?? MAX_LIST_ITEMS);
    }
    if (slot.optional && (slot.defaultHidden || entry.hidden?.includes(slot.id)))
      state.hidden = true;

    if (Object.keys(state).length > 0) elements[slot.id] = state;
  }

  return {
    id,
    layoutId: layoutKey(layout),
    background: copyBackground(layout.background),
    elements,
    origin,
  };
}

/** A slide on a layout with the generic sample words, not from any preset. */
function freshSlide(layout: SlideLayout, id: string): DesignSlide {
  return {
    id,
    layoutId: layoutKey(layout),
    background: copyBackground(layout.background),
    elements: sampleElements(layout),
  };
}

export function blankDocument(input: {
  format: FormatId;
  brand?: DesignBrand | null;
  handle?: string;
  newId?: () => string;
}): DesignDocument {
  const newId = input.newId ?? slideId;

  return {
    schemaVersion: DESIGN_SCHEMA_VERSION,
    format: input.format,
    presetId: BLANK_PRESET_ID,
    themeId: DEFAULT_THEME_ID,
    brand: copyBrand(input.brand ?? emptyBrand()),
    handle: input.handle ?? '',
    caption: '',
    slides: [freshSlide(plainLayout(), newId())],
  };
}

// ---------------------------------------------------------------------------
// Editing a slide
// ---------------------------------------------------------------------------

export function updateSlide(
  document: DesignDocument,
  id: string,
  change: (slide: DesignSlide) => DesignSlide,
): DesignDocument {
  const index = document.slides.findIndex((slide) => slide.id === id);
  if (index === -1) return document;

  const before = document.slides[index];
  const after = change(before);
  if (after === before) return document;

  const slides = [...document.slides];
  slides[index] = after;

  return { ...document, slides };
}

/**
 * Merges a patch into one element. A key set to `undefined` is removed, which
 * is how the panel clears a colour or a nudge.
 *
 * The nudge is clamped on the way in, against wherever the element sits after
 * the patch: the stored document never holds a position the renderer would
 * move. Moving a logo to another placement drops its nudge, because a nudge
 * means something only in the spot it was made in.
 */
export function updateElement(
  document: DesignDocument,
  id: string,
  slotId: SlotId,
  patch: Partial<ElementState>,
): DesignDocument {
  return updateSlide(document, id, (slide) => {
    const layout = findLayout(slide.layoutId);
    const slot = layout ? findSlot(layout, slotId) : null;
    if (!slot) return slide;

    const previous = slide.elements[slotId];
    const next = allowedBy(slot, defined({ ...previous, ...patch }));

    if ('placement' in patch && patch.placement !== previous?.placement && !('offset' in patch)) {
      delete next.offset;
    }

    if (next.offset) next.offset = clampToRegion(slotPlacement(slot, next).box, next.offset);

    const elements = { ...slide.elements };
    if (Object.keys(next).length === 0) delete elements[slotId];
    else elements[slotId] = next;

    return { ...slide, elements };
  });
}

/** Puts one element back to how its layout draws it. */
export function resetElement(document: DesignDocument, id: string, slotId: SlotId): DesignDocument {
  return updateSlide(document, id, (slide) => {
    if (!(slotId in slide.elements)) return slide;

    const elements = { ...slide.elements };
    delete elements[slotId];
    return { ...slide, elements };
  });
}

/** Moves a logo to another place its layout offers. */
export function setLogoPlacement(
  document: DesignDocument,
  id: string,
  placement: LogoPlacement,
): DesignDocument {
  const slide = document.slides.find((entry) => entry.id === id);
  const layout = slide ? findLayout(slide.layoutId) : null;
  const logo = layout ? findSlot(layout, 'logo') : null;
  if (!logo?.spots?.[placement]) return document;

  return updateElement(document, id, 'logo', { placement });
}

export function setBackground(
  document: DesignDocument,
  id: string,
  background: SlideBackground,
): DesignDocument {
  return updateSlide(document, id, (slide) => ({
    ...slide,
    background: copyBackground(background),
  }));
}

/**
 * Switches a slide to another layout, keeping what carries over.
 *
 * An element keeps its words, items, picture and choices when the new layout
 * has a slot of the same name and kind that allows them; slots the old
 * layout did not have start with sample words; positions are dropped, since
 * a nudge means nothing in a different arrangement. A background the user
 * never changed follows the new layout's own.
 */
export function setSlideLayout(
  document: DesignDocument,
  id: string,
  layoutId: string,
): DesignDocument {
  const target = findLayout(layoutId);
  if (!target?.formats.includes(document.format)) return document;

  return updateSlide(document, id, (slide) => {
    if (slide.layoutId === layoutId) return slide;

    const source = findLayout(slide.layoutId);
    const elements: DesignSlide['elements'] = {};

    for (const slot of target.slots) {
      const old = slide.elements[slot.id];
      const oldSlot = source ? findSlot(source, slot.id) : null;

      if (!old || !oldSlot || oldSlot.kind !== slot.kind) {
        const sample = sampleState(target, slot.id);
        if (sample) elements[slot.id] = sample;
        continue;
      }

      const carried: ElementState = {};
      if (slot.kind === 'text' && !slot.bind && old.text !== undefined) carried.text = old.text;
      if (slot.kind === 'list' && old.items) {
        carried.items = old.items.slice(0, slot.maxItems ?? MAX_LIST_ITEMS);
      }
      if ((slot.kind === 'image' || slot.kind === 'logo') && old.mediaId !== undefined) {
        carried.mediaId = old.mediaId;
      }
      if (slot.colorable && old.colorRole) carried.colorRole = old.colorRole;
      if (slot.colorable && old.color) carried.color = old.color;
      if (slot.resizable && old.size) carried.size = old.size;
      if (slot.alignable && old.align) carried.align = old.align;
      if (slot.optional && old.hidden) carried.hidden = true;
      if (old.placement && slot.spots?.[old.placement]) carried.placement = old.placement;

      if (Object.keys(carried).length > 0) elements[slot.id] = carried;
    }

    const untouched =
      source !== null && JSON.stringify(slide.background) === JSON.stringify(source.background);

    return {
      ...slide,
      layoutId,
      background: untouched ? copyBackground(target.background) : slide.background,
      elements,
    };
  });
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

/**
 * Adds a slide after `after` (or at the end), on the given layout or the
 * default one for a role, with sample words to replace.
 */
export function addSlide(
  document: DesignDocument,
  options: { role?: SlideRole; layoutId?: string; after?: string; newId?: () => string },
): DesignDocument {
  if (document.slides.length >= MAX_SLIDES) return document;

  const layout = options.layoutId ? findLayout(options.layoutId) : defaultLayoutFor(options.role);
  if (!layout?.formats.includes(document.format)) return document;

  const slide = freshSlide(layout, (options.newId ?? slideId)());
  const at = options.after ? document.slides.findIndex((entry) => entry.id === options.after) : -1;
  const index = at === -1 ? document.slides.length : at + 1;

  const slides = [...document.slides];
  slides.splice(index, 0, slide);

  return { ...document, slides };
}

/** A copy of a slide, right after it. Shares nothing with the original. */
export function duplicateSlide(
  document: DesignDocument,
  id: string,
  newId: () => string = slideId,
): DesignDocument {
  if (document.slides.length >= MAX_SLIDES) return document;

  const index = document.slides.findIndex((slide) => slide.id === id);
  if (index === -1) return document;

  const copy: DesignSlide = { ...structuredClone(document.slides[index]), id: newId() };
  const slides = [...document.slides];
  slides.splice(index + 1, 0, copy);

  return { ...document, slides };
}

/** The last slide cannot be removed: a design with no slides is not a design. */
export function removeSlide(document: DesignDocument, id: string): DesignDocument {
  if (document.slides.length <= 1) return document;
  if (!document.slides.some((slide) => slide.id === id)) return document;

  return { ...document, slides: document.slides.filter((slide) => slide.id !== id) };
}

export function moveSlide(document: DesignDocument, from: number, to: number): DesignDocument {
  const count = document.slides.length;
  const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < count;

  if (from === to || !valid(from) || !valid(to)) return document;

  const slides = [...document.slides];
  const [moved] = slides.splice(from, 1);
  slides.splice(to, 0, moved);

  return { ...document, slides };
}

// ---------------------------------------------------------------------------
// The design as a whole
// ---------------------------------------------------------------------------

/** Theme swap: the colours and fonts change, the words do not. */
export function applyTheme(document: DesignDocument, themeId: string): DesignDocument {
  if (!isThemeId(themeId) || themeId === document.themeId) return document;
  return { ...document, themeId };
}

/**
 * Applies a brand kit to a design, or removes one.
 *
 * Only the design's `brand` changes. Slots keep their colour *roles*, which is
 * what makes a brand swap instant and reversible; a slot the user gave a
 * custom hex keeps that hex, because they asked for it by name.
 */
export function applyBrandKit(document: DesignDocument, brand: DesignBrand | null): DesignDocument {
  return { ...document, brand: brand ? copyBrand(brand) : emptyBrand() };
}

/**
 * No Brand Kit: the design stops following a kit and takes its theme's own
 * colours again. The brand name and logo stay, as they do when a kit is
 * deleted: they are on the slides, where the person can see and change them.
 */
export function detachBrandKit(document: DesignDocument): DesignDocument {
  const { brand } = document;
  if (brand.kitId === null && brand.colors === null && brand.kitVersion === null) return document;

  return { ...document, brand: { ...brand, kitId: null, colors: null, kitVersion: null } };
}

/**
 * Takes a brand kit's newer colours (DS-2.5's Update Colours) and nothing
 * else: the design's brand name and logo stay as the user left them.
 */
export function updateBrandColors(
  document: DesignDocument,
  colors: BrandColors,
  kitVersion: string,
): DesignDocument {
  return { ...document, brand: { ...document.brand, colors: { ...colors }, kitVersion } };
}

/** The handle every handle slot shows. One line, trimmed to the limit. */
export function setHandle(document: DesignDocument, handle: string): DesignDocument {
  const next = clampText(singleLine(handle), MAX_HANDLE_LENGTH);
  return next === document.handle ? document : { ...document, handle: next };
}

/** The brand name every brand-name slot shows. Empty means none. */
export function setBrandName(document: DesignDocument, name: string): DesignDocument {
  const trimmed = clampText(singleLine(name), MAX_BRAND_NAME_LENGTH);
  const next = trimmed.trim() === '' ? null : trimmed;

  return next === document.brand.name
    ? document
    : { ...document, brand: { ...document.brand, name: next } };
}

export function setCaption(document: DesignDocument, caption: string): DesignDocument {
  const next = clampText(caption, MAX_CAPTION_LENGTH);
  return next === document.caption ? document : { ...document, caption: next };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

/**
 * Restores one slide to the template: the preset slide it was made from,
 * wherever it has moved since, or its layout's sample words for a slide that
 * was added in the editor. Its id stays, so the editor keeps it selected.
 */
export function resetSlide(document: DesignDocument, id: string): DesignDocument {
  return updateSlide(document, id, (slide) => {
    const preset = presetById(document.presetId);
    const source = slide.origin !== undefined ? preset?.slides[slide.origin] : undefined;

    if (source) return slideFromPreset(source, slide.id, slide.origin as number);

    const layout = findLayout(slide.layoutId) ?? plainLayout();
    return freshSlide(layout, slide.id);
  });
}

/**
 * Restores the whole design to its template: every slide and the theme. The
 * brand, the handle and the caption are the user's, not the template's, so
 * they stay. Slide ids are reused where they can be, so a selection survives.
 */
export function resetDocument(document: DesignDocument): DesignDocument {
  const ids = document.slides.map((slide) => slide.id);
  let next = 0;

  const fresh = documentFromPreset({
    presetId: document.presetId,
    format: document.format,
    brand: document.brand,
    handle: document.handle,
    newId: () => ids[next++] ?? slideId(),
  });

  return { ...fresh, caption: document.caption };
}
