import {
  addSlide,
  type DesignDocument,
  type DesignSlide,
  documentFromPreset,
  findLayout,
  inkOf,
  resetElement,
  SAFE_PHOTO_OVERLAY,
  type SlotDef,
  type SlotId,
  setBackground,
  setLogoPlacement,
  slidePalette,
  updateElement,
} from '@postgear/design-engine';
import type { BrandKitView, StudioMediaRef } from '@/types/studio';
import {
  AUTO_COLOR,
  alignOf,
  alignPatch,
  backgroundChoiceOf,
  backgroundSwatches,
  CUSTOM_COLOR,
  canResetElement,
  characterCount,
  clip,
  colorChoiceOf,
  customColorOf,
  elementPreview,
  elementSwatches,
  findSlide,
  groundOf,
  inkLabel,
  kitSelectValue,
  lengthHint,
  listHint,
  listLimit,
  listRows,
  logoView,
  mediaOf,
  NO_KIT,
  optionalSlots,
  overflowAdvice,
  overlayPercent,
  PHOTO_BACKGROUND,
  shownSlots,
  sizeOf,
  sizePatch,
  textRows,
  withAlign,
  withBackgroundChoice,
  withColorChoice,
  withContrastFixed,
  withCustomBackground,
  withCustomColor,
  withElementReset,
  withItemAdded,
  withItemRemoved,
  withListItem,
  withOverlay,
  withPhotoRemoved,
  withSafeOverlay,
  withShown,
  withSize,
} from './editor-panel-model';

/**
 * Tips Steps (Ink), portrait: s1 cover headline, s2 numbered list (five of
 * six items), s3 point with eyebrow, s4 big number, s5 closing call to action.
 */
function design(): DesignDocument {
  let next = 0;
  return documentFromPreset({
    presetId: 'tips-steps-ink',
    format: 'portrait',
    newId: () => `s${++next}`,
  });
}

/** The design with one more slide on the given layout, under the given id. */
function withSlide(layoutId: string, id: string, base: DesignDocument = design()): DesignDocument {
  return addSlide(base, { layoutId, newId: () => id });
}

function slideOf(document: DesignDocument, slideId: string): DesignSlide {
  const found = findSlide(document, slideId);
  if (!found) throw new Error(`No slide ${slideId}`);
  return found.slide;
}

function slotOf(document: DesignDocument, slideId: string, slotId: SlotId): SlotDef {
  const layout = findLayout(slideOf(document, slideId).layoutId);
  const slot = layout?.slots.find((entry) => entry.id === slotId);
  if (!slot) throw new Error(`No slot ${slotId} on ${slideId}`);
  return slot;
}

function element(document: DesignDocument, slideId: string, slotId: SlotId) {
  return slideOf(document, slideId).elements[slotId];
}

function kit(id: string, updatedAt = '2026-10-01T00:00:00.000Z'): BrandKitView {
  return {
    id,
    name: 'Acme',
    description: null,
    websiteUrl: null,
    logoMediaId: null,
    logoUrl: null,
    colors: {
      primary: '#0F766E',
      secondary: '#115E59',
      accent: '#F97316',
      background: '#FFFFFF',
      text: '#0A0A0A',
    },
    source: 'MANUAL',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt,
  };
}

describe('text hints', () => {
  it('counts characters the way a person does', () => {
    expect(lengthHint('Five habits', 60)).toBe('11 of about 60 characters');
    // An emoji is two UTF-16 units but one character.
    expect(characterCount('Hi 👋')).toBe(4);
    expect(lengthHint('', 24)).toBe('0 of about 24 characters');
  });

  it('gives a list its hint per item', () => {
    expect(listHint(72)).toBe('Keep each item to about 72 characters.');
  });

  it('sizes a text field to the length its slot is written for', () => {
    expect(textRows(24)).toBe(2);
    expect(textRows(120)).toBe(4);
    expect(textRows(320)).toBe(6);
    expect(textRows(undefined)).toBe(3);
  });

  it('previews an element by its words, on one line', () => {
    const document = design();
    expect(elementPreview(document, 0, slotOf(document, 's1', 'headline'))).toBe(
      '5 Simple Steps To A Better Morning',
    );
    expect(elementPreview(document, 1, slotOf(document, 's2', 'list'))).toBe(
      'Put your phone across the room tonight',
    );
    expect(elementPreview(document, 0, slotOf(document, 's1', 'logo'))).toBe('');

    const twoLines = updateElement(document, 's1', 'headline', { text: 'One\n  two' });
    expect(elementPreview(twoLines, 0, slotOf(twoLines, 's1', 'headline'))).toBe('One two');
  });

  it('cuts a long preview at a whole character', () => {
    expect(clip('Short', 10)).toBe('Short');
    expect(clip('Five simple habits', 8)).toBe('Five si…');
    expect(clip('Five  habits', 6)).toBe('Five…');
    // Never half an emoji.
    expect(clip('Hi \u{1F44B}\u{1F44B}\u{1F44B}', 5)).toBe('Hi \u{1F44B}…');
  });

  it('suggests a smaller size for words too long only while there is one', () => {
    const document = design();
    const headline = slotOf(document, 's1', 'headline');
    const subheadline = slotOf(document, 's1', 'subheadline');
    const smaller = 'Shorten it or choose a smaller size.';
    const shorter = 'Shorten it so every word shows.';

    expect(overflowAdvice(headline, undefined)).toBe(smaller);
    expect(overflowAdvice(headline, { size: 'lg' })).toBe(smaller);
    // The fit check already shrinks from Small: there is no smaller size to choose.
    expect(overflowAdvice(headline, { size: 'sm' })).toBe(shorter);
    // The cover's subheadline has one size only.
    expect(overflowAdvice(subheadline, undefined)).toBe(shorter);
  });
});

describe('size and alignment', () => {
  it('stores the template size as no size at all', () => {
    expect(sizeOf(undefined)).toBe('md');
    expect(sizeOf({ size: 'lg' })).toBe('lg');
    expect(sizePatch('md')).toEqual({ size: undefined });
    expect(sizePatch('sm')).toEqual({ size: 'sm' });
  });

  it('stores the template alignment as no alignment at all', () => {
    const document = design();
    const centred = slotOf(document, 's5', 'headline');
    const plain = slotOf(document, 's1', 'headline');

    expect(alignOf(centred, undefined)).toBe('center');
    expect(alignOf(centred, { align: 'end' })).toBe('end');
    expect(alignPatch(centred, 'center')).toEqual({ align: undefined });
    expect(alignPatch(centred, 'start')).toEqual({ align: 'start' });
    expect(alignPatch(plain, 'start')).toEqual({ align: undefined });
    expect(alignPatch({ ...plain, align: undefined }, 'start')).toEqual({ align: undefined });
  });

  it('sets a size where the slot offers sizes, medium as none', () => {
    const document = design();

    const large = withSize(document, 's1', 'headline', 'lg');
    expect(element(large, 's1', 'headline')?.size).toBe('lg');

    const back = withSize(large, 's1', 'headline', 'md');
    expect(element(back, 's1', 'headline')?.size).toBeUndefined();
    expect(withSize(back, 's1', 'headline', 'md')).toBe(back);

    // The cover's subheadline has one size only.
    expect(withSize(document, 's1', 'subheadline', 'lg')).toBe(document);
  });

  it('aligns against the slot alignment, storing the template one as none', () => {
    const document = design();

    const left = withAlign(document, 's5', 'headline', 'start');
    expect(element(left, 's5', 'headline')?.align).toBe('start');

    const centred = withAlign(left, 's5', 'headline', 'center');
    expect(element(centred, 's5', 'headline')?.align).toBeUndefined();
    expect(withAlign(centred, 's5', 'headline', 'center')).toBe(centred);
    expect(withAlign(document, 's9', 'headline', 'end')).toBe(document);
  });
});

describe('list items', () => {
  it('shows one empty row for a list with no items', () => {
    expect(listRows(undefined)).toEqual(['']);
    expect(listRows({ items: [] })).toEqual(['']);
    expect(listRows({ items: ['One'] })).toEqual(['One']);
  });

  it('edits one item, on one line, and nothing outside the list', () => {
    const document = design();
    const edited = withListItem(document, 's2', 'list', 1, 'Drink\nwater');
    const items = element(edited, 's2', 'list')?.items ?? [];

    expect(items[1]).toBe('Drink water');
    expect(items).toHaveLength(5);
    expect(items[0]).toBe(element(document, 's2', 'list')?.items?.[0]);

    expect(withListItem(document, 's2', 'list', 9, 'Nope')).toBe(document);
    expect(withListItem(document, 's1', 'headline', 0, 'Nope')).toBe(document);
  });

  it('adds items up to the slot limit', () => {
    const document = design();
    const slot = slotOf(document, 's2', 'list');
    expect(listLimit(slot)).toBe(6);

    const six = withItemAdded(document, 's2', 'list');
    expect(element(six, 's2', 'list')?.items).toHaveLength(6);
    expect(element(six, 's2', 'list')?.items?.[5]).toBe('');
    expect(withItemAdded(six, 's2', 'list')).toBe(six);
  });

  it('adds to the empty row a list with no items shows', () => {
    const empty = resetElement(design(), 's2', 'list');
    const added = withItemAdded(empty, 's2', 'list');
    expect(element(added, 's2', 'list')?.items).toEqual(['', '']);
  });

  it('removes items but keeps one', () => {
    let document = design();
    const first = element(document, 's2', 'list')?.items?.[0];

    document = withItemRemoved(document, 's2', 'list', 1);
    expect(element(document, 's2', 'list')?.items).toHaveLength(4);
    expect(element(document, 's2', 'list')?.items?.[0]).toBe(first);

    for (let count = 4; count > 1; count--) document = withItemRemoved(document, 's2', 'list', 0);
    expect(element(document, 's2', 'list')?.items).toHaveLength(1);
    expect(withItemRemoved(document, 's2', 'list', 0)).toBe(document);
  });
});

describe('an element colour', () => {
  it('reads the choice the way the renderer draws it', () => {
    expect(colorChoiceOf(undefined)).toBe(AUTO_COLOR);
    expect(colorChoiceOf({ colorRole: 'accent' })).toBe('accent');
    expect(colorChoiceOf({ colorRole: 'accent', color: '#ff0000' })).toBe(CUSTOM_COLOR);
    // A stored hex the renderer cannot read is ignored there too.
    expect(colorChoiceOf({ colorRole: 'accent', color: 'red' })).toBe('accent');
    expect(customColorOf({ color: '#abc' })).toBe('#AABBCC');
  });

  it('sets a role, clears it back to Auto, and pins the colour on screen for Custom', () => {
    const document = design();

    const accent = withColorChoice(document, 's1', 'headline', 'accent');
    expect(element(accent, 's1', 'headline')).toMatchObject({ colorRole: 'accent' });
    expect(element(accent, 's1', 'headline')?.color).toBeUndefined();

    const auto = withColorChoice(accent, 's1', 'headline', AUTO_COLOR);
    expect(colorChoiceOf(element(auto, 's1', 'headline'))).toBe(AUTO_COLOR);

    const shown = inkOf(accent, slideOf(accent, 's1'), 'headline')?.color;
    const custom = withColorChoice(accent, 's1', 'headline', CUSTOM_COLOR);
    expect(element(custom, 's1', 'headline')?.color).toBe(shown);
    expect(element(custom, 's1', 'headline')?.colorRole).toBeUndefined();
    expect(withColorChoice(custom, 's1', 'headline', CUSTOM_COLOR)).toBe(custom);
  });

  it('takes a typed hex, and ignores anything that is not a colour', () => {
    const document = design();
    const typed = withCustomColor(document, 's1', 'headline', '#c2410c');
    expect(element(typed, 's1', 'headline')?.color).toBe('#C2410C');

    expect(withCustomColor(document, 's1', 'headline', '#C24')).not.toBe(document);
    expect(withCustomColor(document, 's1', 'headline', '#C2')).toBe(document);
    expect(withCustomColor(typed, 's1', 'headline', '#C2410C')).toBe(typed);
  });

  it('leaves an element without a colour choice alone', () => {
    const document = design();
    expect(withColorChoice(document, 's1', 'logo', 'accent')).toBe(document);
    expect(withCustomColor(document, 's1', 'logo', '#000000')).toBe(document);
  });

  it('offers Auto, the five brand roles and Custom, in the slide colours', () => {
    const document = design();
    const slide = slideOf(document, 's1');
    const palette = slidePalette(document, slide);
    const swatches = elementSwatches(document, slide, slotOf(document, 's1', 'headline'));

    expect(swatches.map((swatch) => swatch.value)).toEqual([
      AUTO_COLOR,
      'primary',
      'secondary',
      'accent',
      'background',
      'text',
      CUSTOM_COLOR,
    ]);
    expect(swatches.map((swatch) => swatch.label)).toEqual([
      'Auto',
      'Primary',
      'Secondary',
      'Accent',
      'Background',
      'Text',
      'Custom',
    ]);
    expect(swatches[1]?.color).toBe(palette.primary);
    expect(swatches[0]?.color).toBe(inkOf(document, slide, 'headline')?.color);
    expect(swatches[6]?.color).toBeNull();
  });

  it('follows a brand kit, since a kit recolours the slide', () => {
    const branded = {
      ...design(),
      brand: {
        kitId: 'k1',
        colors: kit('k1').colors,
        logoMediaId: null,
        name: 'Acme',
        kitVersion: null,
      },
    };
    const slide = slideOf(branded, 's1');
    const swatches = elementSwatches(branded, slide, slotOf(branded, 's1', 'headline'));
    expect(swatches.find((swatch) => swatch.value === 'primary')?.color).toBe('#0F766E');
  });
});

describe('contrast', () => {
  it('fixes a colour that does not read with the theme ink', () => {
    const document = withColorChoice(design(), 's1', 'headline', 'background');
    expect(inkOf(document, slideOf(document, 's1'), 'headline')?.readable).toBe(false);

    const fixed = withContrastFixed(document, 's1', 'headline');
    expect(inkOf(fixed, slideOf(fixed, 's1'), 'headline')?.readable).toBe(true);
    expect(element(fixed, 's1', 'headline')?.colorRole).toBe('text');
    expect(withContrastFixed(fixed, 's1', 'headline')).toBe(fixed);
  });

  it('names a theme ink Fix Contrast chose that is not a brand role', () => {
    // A cover block: the headline sits on the primary panel, dark in Ink.
    let document = withSlide('cover-block@1', 'block');
    document = withColorChoice(document, 'block', 'headline', 'text');
    document = withContrastFixed(document, 'block', 'headline');

    expect(element(document, 'block', 'headline')?.colorRole).toBe('onPrimary');
    expect(colorChoiceOf(element(document, 'block', 'headline'))).toBe('onPrimary');

    const swatches = elementSwatches(
      document,
      slideOf(document, 'block'),
      slotOf(document, 'block', 'headline'),
    );
    expect(swatches.find((swatch) => swatch.value === 'onPrimary')).toEqual({
      value: 'onPrimary',
      label: 'Light Text',
      color: '#FFFFFF',
    });
    expect(swatches.at(-1)?.value).toBe(CUSTOM_COLOR);
  });

  it('calls an ink light or dark by how it looks', () => {
    expect(inkLabel('#FFFFFF')).toBe('Light Text');
    expect(inkLabel('#F5F7FA')).toBe('Light Text');
    expect(inkLabel('#111111')).toBe('Dark Text');
  });
});

describe('a slide background', () => {
  it('reads the choice a slide is on', () => {
    expect(backgroundChoiceOf({ kind: 'role', role: 'primary' })).toBe('primary');
    expect(backgroundChoiceOf({ kind: 'color', hex: '#123456' })).toBe(CUSTOM_COLOR);
    expect(backgroundChoiceOf({ kind: 'media', mediaId: 'm1', overlay: 0.6 })).toBe(
      PHOTO_BACKGROUND,
    );
  });

  it('shows each role as the slide would be painted', () => {
    const document = design();
    const swatches = backgroundSwatches(document, slideOf(document, 's1'));

    expect(swatches.map((swatch) => swatch.value)).toEqual([
      'primary',
      'secondary',
      'accent',
      'background',
      'text',
      CUSTOM_COLOR,
    ]);
    expect(swatches[0]?.color).toBe('#111111');
    expect(swatches[3]?.color).toBe('#FFFFFF');
    for (const swatch of swatches.slice(0, 5)) {
      expect(swatch.color).toBe(
        groundOf(document, { kind: 'role', role: swatch.value as 'primary' }),
      );
    }
  });

  it('names a theme colour the slide is on that is not a brand role', () => {
    const document = setBackground(design(), 's1', { kind: 'role', role: 'surface' });
    const swatches = backgroundSwatches(document, slideOf(document, 's1'));

    expect(swatches.find((swatch) => swatch.value === 'surface')).toEqual({
      value: 'surface',
      label: 'Theme Colour',
      color: groundOf(document, { kind: 'role', role: 'surface' }),
    });
    expect(swatches.at(-1)?.value).toBe(CUSTOM_COLOR);
  });

  it('shows the custom hex once a slide has one', () => {
    const document = setBackground(design(), 's1', { kind: 'color', hex: '#abcdef' });
    expect(backgroundSwatches(document, slideOf(document, 's1')).at(-1)).toEqual({
      value: CUSTOM_COLOR,
      label: 'Custom',
      color: '#ABCDEF',
    });
  });

  it('sets a role, and pins the colour on screen for Custom', () => {
    const document = design();

    const primary = withBackgroundChoice(document, 's1', 'primary');
    expect(slideOf(primary, 's1').background).toEqual({ kind: 'role', role: 'primary' });
    expect(withBackgroundChoice(primary, 's1', 'primary')).toBe(primary);

    const custom = withBackgroundChoice(primary, 's1', CUSTOM_COLOR);
    expect(slideOf(custom, 's1').background).toEqual({ kind: 'color', hex: '#111111' });
    expect(withBackgroundChoice(custom, 's1', CUSTOM_COLOR)).toBe(custom);
    expect(withBackgroundChoice(document, 's1', 'nonsense')).toBe(document);
  });

  it('takes a typed hex for the background', () => {
    const document = design();
    const typed = withCustomBackground(document, 's1', 'ff8800');
    expect(slideOf(typed, 's1').background).toEqual({ kind: 'color', hex: '#FF8800' });
    expect(withCustomBackground(typed, 's1', '#FF8800')).toBe(typed);
    expect(withCustomBackground(document, 's1', 'orange')).toBe(document);
  });

  it('removes a photo back to the layout background', () => {
    const base = withSlide('cover-picture@1', 'photo');
    const document = setBackground(base, 'photo', { kind: 'media', mediaId: 'm1', overlay: 0.6 });

    const removed = withPhotoRemoved(document, 'photo');
    expect(slideOf(removed, 'photo').background).toEqual({ kind: 'role', role: 'primary' });
    expect(withPhotoRemoved(removed, 'photo')).toBe(removed);
  });

  it('keeps the darkening between 0 and 1, to two decimals', () => {
    const document = setBackground(design(), 's1', { kind: 'media', mediaId: 'm1', overlay: 0.6 });

    const darker = withOverlay(document, 's1', 0.456);
    expect(slideOf(darker, 's1').background).toEqual({
      kind: 'media',
      mediaId: 'm1',
      overlay: 0.46,
    });
    expect(slideOf(withOverlay(document, 's1', 3), 's1').background).toMatchObject({ overlay: 1 });
    expect(withOverlay(document, 's1', SAFE_PHOTO_OVERLAY)).toBe(document);

    const plain = design();
    expect(withOverlay(plain, 's1', 0.8)).toBe(plain);
    expect(overlayPercent(0.6)).toBe(60);
    expect(overlayPercent(1.4)).toBe(100);
  });

  it('darkens a light photo to the safe level, and never lightens one', () => {
    const light = setBackground(design(), 's1', { kind: 'media', mediaId: 'm1', overlay: 0.2 });

    const darkened = withSafeOverlay(light, 's1');
    expect(slideOf(darkened, 's1').background).toEqual({
      kind: 'media',
      mediaId: 'm1',
      overlay: SAFE_PHOTO_OVERLAY,
    });
    expect(withSafeOverlay(darkened, 's1')).toBe(darkened);

    const dark = setBackground(design(), 's1', { kind: 'media', mediaId: 'm1', overlay: 0.85 });
    expect(withSafeOverlay(dark, 's1')).toBe(dark);

    const plain = design();
    expect(withSafeOverlay(plain, 's1')).toBe(plain);
  });
});

describe('elements on a slide', () => {
  it('lists what the slide shows and what it may hide', () => {
    const document = withShown(design(), 's1', 'eyebrow', false);
    const slide = slideOf(document, 's1');
    const layout = findLayout(slide.layoutId);
    if (!layout) throw new Error('No layout');

    expect(element(document, 's1', 'eyebrow')?.hidden).toBe(true);
    expect(shownSlots(layout, slide).map((slot) => slot.id)).not.toContain('eyebrow');
    expect(shownSlots(layout, slide).map((slot) => slot.id)).toContain('headline');
    expect(optionalSlots(layout).map((slot) => slot.id)).toEqual(
      expect.arrayContaining(['eyebrow', 'subheadline', 'logo', 'brandName', 'handle']),
    );
    expect(optionalSlots(layout).map((slot) => slot.id)).not.toContain('headline');

    const shown = withShown(document, 's1', 'eyebrow', true);
    expect(element(shown, 's1', 'eyebrow')?.hidden).toBeUndefined();
  });
});

describe('reset element', () => {
  it('puts back the look and keeps the words', () => {
    let document = design();
    document = withSize(document, 's1', 'headline', 'lg');
    document = withAlign(document, 's1', 'headline', 'center');
    document = withCustomColor(document, 's1', 'headline', '#C2410C');
    document = updateElement(document, 's1', 'headline', { offset: { x: 0, y: 2 } });
    expect(canResetElement(element(document, 's1', 'headline'))).toBe(true);

    const reset = withElementReset(document, 's1', 'headline');
    expect(element(reset, 's1', 'headline')).toEqual({
      text: '5 Simple Steps To A Better Morning',
    });
    expect(canResetElement(element(reset, 's1', 'headline'))).toBe(false);
    expect(withElementReset(reset, 's1', 'headline')).toBe(reset);
  });

  it('keeps the items of a list and a logo the person chose', () => {
    const list = withColorChoice(design(), 's2', 'list', 'accent');
    const items = element(list, 's2', 'list')?.items;
    expect(element(withElementReset(list, 's2', 'list'), 's2', 'list')).toEqual({ items });

    const logo = updateElement(setLogoPlacement(design(), 's1', 'footer'), 's1', 'logo', {
      mediaId: 'm1',
    });
    expect(element(withElementReset(logo, 's1', 'logo'), 's1', 'logo')).toEqual({
      mediaId: 'm1',
    });
  });

  it('drops an element whose look was all it had', () => {
    const document = setLogoPlacement(design(), 's1', 'footer');
    expect(element(document, 's1', 'logo')).toEqual({ placement: 'footer' });
    expect(element(withElementReset(document, 's1', 'logo'), 's1', 'logo')).toBeUndefined();
  });

  it('changes nothing for an element its template already draws', () => {
    const document = design();
    expect(canResetElement(undefined)).toBe(false);
    expect(canResetElement(element(document, 's1', 'headline'))).toBe(false);
    expect(withElementReset(document, 's1', 'headline')).toBe(document);
    expect(withElementReset(document, 's1', 'logo')).toBe(document);
    expect(withElementReset(document, 's9', 'headline')).toBe(document);
  });
});

describe('the logo', () => {
  const brand = (logoMediaId: string | null) => ({
    ...design(),
    brand: { kitId: null, colors: null, logoMediaId, name: null, kitVersion: null },
  });

  it('shows the brand logo when the slot has none of its own', () => {
    expect(logoView(brand('kit-logo'), undefined)).toEqual({
      mediaId: 'kit-logo',
      fromBrand: true,
      canUseBrand: false,
    });
    expect(logoView(brand(null), undefined)).toEqual({
      mediaId: null,
      fromBrand: false,
      canUseBrand: false,
    });
  });

  it('offers the brand logo back only when another one is chosen', () => {
    expect(logoView(brand('kit-logo'), { mediaId: 'other' })).toEqual({
      mediaId: 'other',
      fromBrand: false,
      canUseBrand: true,
    });
    expect(logoView(brand('kit-logo'), { mediaId: 'kit-logo' })).toEqual({
      mediaId: 'kit-logo',
      fromBrand: true,
      canUseBrand: false,
    });
    expect(logoView(brand(null), { mediaId: 'other' }).canUseBrand).toBe(false);
  });
});

describe('the brand kit picker', () => {
  it('shows no kit, the design kit, or nothing for a deleted one', () => {
    const kits = [kit('k1'), kit('k2')];
    expect(kitSelectValue({ kitId: null }, kits)).toBe(NO_KIT);
    expect(kitSelectValue({ kitId: 'k2' }, kits)).toBe('k2');
    expect(kitSelectValue({ kitId: 'gone' }, kits)).toBe('');
  });
});

describe('mediaOf', () => {
  it('finds a picture, and treats a missing one as deleted', () => {
    const ref: StudioMediaRef = {
      url: 'https://cdn.example/a.png',
      thumbnailUrl: null,
      name: 'Photo',
      width: 10,
      height: 10,
    };
    const media = { m1: ref };

    expect(mediaOf(media, 'm1')).toBe(ref);
    expect(mediaOf(media, 'm2')).toBeNull();
    expect(mediaOf(media, null)).toBeNull();
    expect(mediaOf(media, 'toString')).toBeNull();
  });
});
