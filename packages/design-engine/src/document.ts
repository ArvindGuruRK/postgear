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
import { isArtId } from './art';
import { clampText, singleLine } from './bindings';
import { clampToRegion } from './constraints';
import { isFormatId } from './formats';
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
  type DesignFonts,
  type DesignSlide,
  type ElementState,
  type FontId,
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
import { isKnownFont } from './typography';

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
  return {
    kitId: null,
    colors: null,
    logoMediaId: null,
    name: null,
    kitVersion: null,
    fonts: null,
  };
}

function copyBrand(brand: DesignBrand): DesignBrand {
  return {
    ...brand,
    colors: brand.colors ? { ...brand.colors } : null,
    fonts: storedFonts(brand.fonts),
  };
}

/**
 * A choice of faces as a design keeps it: a copy, null when it chooses
 * nothing, and a family the library does not have left to the face beneath
 * rather than refused at the next autosave. A brand kit's fonts come through
 * here, and a kit is edited elsewhere (possibly by a later release), so its
 * choice is taken as far as it goes.
 */
function storedFonts(fonts: DesignFonts | null | undefined): DesignFonts | null {
  const heading = fonts?.heading;
  const body = fonts?.body;
  const choice: DesignFonts = {
    heading: isKnownFont(heading) ? heading : null,
    body: isKnownFont(body) ? body : null,
  };

  return choice.heading === null && choice.body === null ? null : choice;
}

/** Whether two choices of faces set the same text. None at all and two nulls are the same. */
function sameFonts(a: DesignFonts | null | undefined, b: DesignFonts | null | undefined): boolean {
  return (a?.heading ?? null) === (b?.heading ?? null) && (a?.body ?? null) === (b?.body ?? null);
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
 * without one, a font on a slot with no words, and so on. The schema still
 * refuses all of these from a client; this is the engine keeping its own
 * writes valid.
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
  if ((slot.kind !== 'text' && slot.kind !== 'list') || !isKnownFont(next.font)) delete next.font;
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
    // Art the library does not have is a bug the preset tests catch; at run
    // time the design simply starts without any.
    art: isArtId(preset.art) ? preset.art : null,
    // No font choice of its own: the brand kit's fonts, then the theme's.
    fonts: null,
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
    art: null,
    fonts: null,
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

/**
 * Puts one element back to how its layout draws it: everything stored on it
 * goes, its own font included.
 */
export function resetElement(document: DesignDocument, id: string, slotId: SlotId): DesignDocument {
  return updateSlide(document, id, (slide) => {
    if (!(slotId in slide.elements)) return slide;

    const elements = { ...slide.elements };
    delete elements[slotId];
    return { ...slide, elements };
  });
}

/**
 * One element's own font over the design's (Element tab, Font), or null for
 * the design's font again. Text and list slots only, since a picture has no
 * words to set; a family the library does not have is ignored.
 */
export function setElementFont(
  document: DesignDocument,
  id: string,
  slotId: SlotId,
  font: FontId | null,
): DesignDocument {
  if (font !== null && !isKnownFont(font)) return document;

  const slide = document.slides.find((entry) => entry.id === id);
  const layout = slide ? findLayout(slide.layoutId) : null;
  const slot = layout ? findSlot(layout, slotId) : null;
  if (!slide || !slot || (slot.kind !== 'text' && slot.kind !== 'list')) return document;
  if ((slide.elements[slotId]?.font ?? null) === font) return document;

  return updateElement(document, id, slotId, { font: font ?? undefined });
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
 * Apply To All Slides: one slide's photo background, with its overlay and
 * its tint, on every slide. A slide that already has exactly that photo is
 * left as it is; a slide whose background is not a photo has none to give,
 * so nothing changes.
 */
export function applyPhotoToAllSlides(document: DesignDocument, id: string): DesignDocument {
  const photo = document.slides.find((slide) => slide.id === id)?.background;
  if (photo?.kind !== 'media') return document;

  let changed = false;
  const slides = document.slides.map((slide) => {
    if (samePhoto(slide.background, photo)) return slide;

    changed = true;
    return { ...slide, background: copyBackground(photo) };
  });

  return changed ? { ...document, slides } : document;
}

/** The same picture, overlay and tint. No tint is the dark one. */
function samePhoto(
  background: SlideBackground,
  photo: Extract<SlideBackground, { kind: 'media' }>,
): boolean {
  return (
    background.kind === 'media' &&
    background.mediaId === photo.mediaId &&
    background.overlay === photo.overlay &&
    (background.tint ?? 'dark') === (photo.tint ?? 'dark')
  );
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
      if ((slot.kind === 'text' || slot.kind === 'list') && old.font) carried.font = old.font;
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
 * The background art every slide that is not a photo draws, or null for
 * None. Like a theme swap it changes no words; an id the library does not
 * have is ignored.
 */
export function setArt(document: DesignDocument, id: string | null): DesignDocument {
  if (id !== null && !isArtId(id)) return document;
  return id === document.art ? document : { ...document, art: id };
}

/**
 * The heading and body faces for the whole design (Design tab, Fonts), over
 * the brand kit's and the theme's, or null to follow those again. A face
 * left null keeps the one beneath it, and a choice of neither is stored as
 * none at all. A family the library does not have is refused, as an unknown
 * theme is.
 */
export function setDocumentFonts(
  document: DesignDocument,
  fonts: DesignFonts | null,
): DesignDocument {
  if (fonts && [fonts.heading, fonts.body].some((face) => face !== null && !isKnownFont(face))) {
    return document;
  }

  const next = storedFonts(fonts);
  return sameFonts(next, document.fonts) ? document : { ...document, fonts: next };
}

/**
 * A new shape for the whole design (Design tab, Format).
 *
 * Refused, by returning the design unchanged, when any slide's layout cannot
 * be drawn in that format. Otherwise every nudge is clamped again, the way
 * the schema clamps it. A nudge and a slot's box are both percentages of the
 * slot's region, so with today's layouts the clamp gives the same answer in
 * every format; it runs anyway, so a design never comes out of a format
 * change holding a position the schema would move at the next save.
 */
export function setFormat(document: DesignDocument, format: FormatId): DesignDocument {
  if (!isFormatId(format) || format === document.format) return document;

  const slides: DesignSlide[] = [];

  for (const slide of document.slides) {
    const layout = findLayout(slide.layoutId);
    if (!layout?.formats.includes(format)) return document;

    slides.push(withNudgesClamped(slide, layout));
  }

  return { ...document, format, slides };
}

/** A slide with every nudge clamped to its slot's region: the same slide when none moved. */
function withNudgesClamped(slide: DesignSlide, layout: SlideLayout): DesignSlide {
  let elements: DesignSlide['elements'] | null = null;

  for (const [id, state] of Object.entries(slide.elements) as Array<
    [SlotId, ElementState | undefined]
  >) {
    const slot = state?.offset ? findSlot(layout, id) : null;
    if (!state?.offset || !slot) continue;

    const offset = clampToRegion(slotPlacement(slot, state).box, state.offset);
    if (offset.x === state.offset.x && offset.y === state.offset.y) continue;

    elements ??= { ...slide.elements };
    elements[id] = { ...state, offset };
  }

  return elements ? { ...slide, elements } : slide;
}

/**
 * Applies a brand kit to a design, or removes one.
 *
 * Only the design's `brand` changes, the kit's fonts with it (a font the user
 * chose for the design or for one element still wins over them). Slots keep
 * their colour *roles*, which is what makes a brand swap instant and
 * reversible; a slot the user gave a custom hex keeps that hex, because they
 * asked for it by name.
 */
export function applyBrandKit(document: DesignDocument, brand: DesignBrand | null): DesignDocument {
  return { ...document, brand: brand ? copyBrand(brand) : emptyBrand() };
}

/**
 * No Brand Kit: the design stops following a kit and takes its theme's own
 * colours and fonts again. The brand name and logo stay, as they do when a
 * kit is deleted: they are on the slides, where the person can see and
 * change them.
 */
export function detachBrandKit(document: DesignDocument): DesignDocument {
  const { brand } = document;
  if (
    brand.kitId === null &&
    brand.colors === null &&
    brand.kitVersion === null &&
    brand.fonts === null
  ) {
    return document;
  }

  return {
    ...document,
    brand: { ...brand, kitId: null, colors: null, kitVersion: null, fonts: null },
  };
}

/**
 * Takes a brand kit's newer colours (DS-2.5, the editor's Update From Kit),
 * and its newer fonts when they are given, and nothing else: the design's
 * brand name and logo stay as the user left them. `fonts` left out keeps the
 * fonts the design copied from the kit before; null clears them.
 */
export function updateBrandColors(
  document: DesignDocument,
  colors: BrandColors,
  kitVersion: string,
  fonts?: DesignFonts | null,
): DesignDocument {
  return {
    ...document,
    brand: {
      ...document.brand,
      colors: { ...colors },
      kitVersion,
      fonts: fonts === undefined ? document.brand.fonts : storedFonts(fonts),
    },
  };
}

/**
 * The label a closing layout gives the text slot that holds a web address
 * (the Signature closing slide's), the same one `samples.ts` reads to give
 * that slot an address rather than a line.
 */
const LINK_LABEL = 'Link';

/** A brand kit's call to action and link, as `applyCtaDefaults` takes them. */
export interface CtaDefaults {
  /** For a closing slide's `cta` slot. Null or blank leaves the slot as it is. */
  text: string | null;
  /** For the text slot a closing layout labels Link. Null or blank leaves it. */
  url: string | null;
}

/**
 * A brand kit's CTA defaults, written into every closing slide: `text` into
 * its `cta` slot and `url` into the slot its layout labels Link. A layout
 * with neither slot is left as it is.
 *
 * The API runs this once, when a design is created with a kit, so what those
 * slots hold at that moment is the template's sample copy ("Book your call",
 * "yourbrand.com"), never anything the person typed. It is replaced rather
 * than kept: the kit's own call to action is the reason the kit has one. A
 * Link slot the template hides is shown, because a kit with a link wants it
 * seen. A blank default leaves its slot alone, so a kit with only a link
 * keeps the template's call to action. Nothing to change returns the same
 * document, by reference.
 */
export function applyCtaDefaults(document: DesignDocument, defaults: CtaDefaults): DesignDocument {
  const text = ctaLine(defaults.text);
  const url = ctaLine(defaults.url);
  if (text === null && url === null) return document;

  let next = document;

  for (const slide of document.slides) {
    const layout = findLayout(slide.layoutId);
    if (layout?.role !== 'closing') continue;

    for (const slot of layout.slots) {
      // Bound slots take their words from the design, never from a slide.
      if (slot.kind !== 'text' || slot.bind) continue;

      const value = slot.label === LINK_LABEL ? url : slot.id === 'cta' ? text : null;
      const state = slide.elements[slot.id];
      if (value === null || (state?.text === value && !state.hidden)) continue;

      next = updateElement(next, slide.id, slot.id, { text: value, hidden: undefined });
    }
  }

  return next;
}

/** One line of a CTA default, cut to what a slot holds, or null when there is nothing to write. */
function ctaLine(value: string | null | undefined): string | null {
  const line = clampText(singleLine(value ?? '').trim(), MAX_TEXT_LENGTH);
  return line === '' ? null : line;
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
 * Restores the whole design to its template: every slide, the theme and the
 * art, with the design's own font choice cleared. The brand (the kit's fonts
 * included), the handle and the caption are the user's, not the template's,
 * so they stay. Slide ids are reused where they can be, so a selection
 * survives.
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
