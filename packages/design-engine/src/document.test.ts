import { ART_STYLES } from './art';
import {
  addSlide,
  applyBrandKit,
  applyCtaDefaults,
  applyPhotoToAllSlides,
  applyTheme,
  BLANK_PRESET_ID,
  blankDocument,
  detachBrandKit,
  documentFromPreset,
  duplicateSlide,
  moveSlide,
  removeSlide,
  resetDocument,
  resetElement,
  resetSlide,
  setArt,
  setBackground,
  setBrandName,
  setCaption,
  setDocumentFonts,
  setElementFont,
  setFormat,
  setHandle,
  setLogoPlacement,
  setSlideLayout,
  slideId,
  updateBrandColors,
  updateElement,
} from './document';
import { findLayout, findSlot, latestLayout, layoutKey, slotPlacement } from './layouts';
import { presetById, SAMPLE_HANDLE } from './presets';
import { designDocumentSchema } from './schema';
import {
  type DesignBrand,
  type DesignDocument,
  type FontId,
  type FormatId,
  MAX_CAPTION_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_SLIDES,
  MAX_TEXT_LENGTH,
  type SlideBackground,
} from './types';

let counter = 0;
const ids = () => `s-${++counter}`;

/** tips-steps-ink: cover, numbered list, content, statistic, closing. */
function fresh(presetId = 'tips-steps-ink'): DesignDocument {
  counter = 0;
  return documentFromPreset({ presetId, format: 'square', newId: ids });
}

function valid(document: DesignDocument): void {
  const result = designDocumentSchema.safeParse(document);
  if (!result.success) throw new Error(result.error.issues[0]?.message);
}

const KIT: DesignBrand = {
  kitId: 'seed-brand-kit-lotus',
  colors: {
    primary: '#0F766E',
    secondary: '#115E59',
    accent: '#F97316',
    background: '#FFFFFF',
    text: '#0A0A0A',
  },
  logoMediaId: 'media-logo-1',
  name: 'Lotus Flow Yoga',
  kitVersion: '2026-10-27T10:00:00.000Z',
  fonts: { heading: 'playfair-display', body: null },
};

/**
 * Runs `body` with one preset's art set to `art`, then puts the preset back.
 * The library has no preset with art until the template batches land, and a
 * test should not depend on which one it is; jest gives each test file its
 * own copy of the library, so the change cannot reach another file.
 */
function withPresetArt<T>(art: string | undefined, body: () => T): T {
  const preset = presetById('tips-steps-ink');
  if (!preset) throw new Error('tips-steps-ink is missing from the library.');

  const before = preset.art;
  preset.art = art;

  try {
    return body();
  } finally {
    if (before === undefined) delete preset.art;
    else preset.art = before;
  }
}

/** Two different art styles from the library, when it has them. */
const [ART, OTHER_ART] = ART_STYLES;

/** ART_STYLES is filled by the art tasks; until they land, the art tests have nothing to set. */
const withArt = ART && OTHER_ART ? it : it.skip;

describe('slideId', () => {
  it('makes ids the schema accepts, and does not repeat them', () => {
    const made = new Set<string>();

    for (let index = 0; index < 2_000; index++) {
      const id = slideId();
      expect(id).toMatch(/^s-[A-Za-z0-9_-]{10}$/);
      made.add(id);
    }

    expect(made.size).toBe(2_000);
  });
});

describe('documentFromPreset', () => {
  it('copies the preset rather than sharing it', () => {
    const first = fresh();
    const second = fresh();

    const edited = updateElement(first, first.slides[0].id, 'headline', { text: 'Changed' });

    expect(edited.slides[0].elements.headline?.text).toBe('Changed');
    expect(second.slides[0].elements.headline?.text).not.toBe('Changed');
    // And the preset itself is untouched for the next design.
    expect(fresh().slides[0].elements.headline?.text).not.toBe('Changed');
  });

  it('remembers which preset slide each slide came from', () => {
    expect(fresh().slides.map((slide) => slide.origin)).toEqual([0, 1, 2, 3, 4]);
  });

  it('starts with the sample handle unless one is given', () => {
    expect(fresh().handle).toBe(SAMPLE_HANDLE);
    expect(
      documentFromPreset({ presetId: 'tips-steps-ink', format: 'square', handle: '@lotus' }).handle,
    ).toBe('@lotus');
  });

  it('never writes text into a slot that shows the design own words', () => {
    for (const slide of fresh().slides) {
      const layout = findLayout(slide.layoutId);

      for (const slot of layout?.slots ?? []) {
        if (slot.bind) expect(slide.elements[slot.id]?.text).toBeUndefined();
      }
    }
  });

  it('copies the brand it is given, sharing nothing with it', () => {
    const brand = structuredClone(KIT);
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square', brand });

    (brand.colors as NonNullable<DesignBrand['colors']>).primary = '#000000';
    expect(document.brand.colors?.primary).toBe('#0F766E');
  });

  it('falls back to a blank design when the preset is gone', () => {
    const document = documentFromPreset({
      presetId: 'retired-in-2027',
      format: 'story',
      newId: ids,
    });

    expect(document.presetId).toBe(BLANK_PRESET_ID);
    expect(document.slides).toHaveLength(1);
    expect(document.handle).toBe('');
    valid(document);
  });

  it('starts a blank design with words, not empty boxes', () => {
    const document = documentFromPreset({
      presetId: BLANK_PRESET_ID,
      format: 'square',
      newId: ids,
    });
    expect(document.slides[0].elements.headline?.text).toBeTruthy();
    valid(document);
  });

  it('starts without art or a font choice of its own, blank or from a preset', () => {
    for (const document of [fresh(), blankDocument({ format: 'story', newId: ids })]) {
      expect(document.art).toBeNull();
      expect(document.fonts).toBeNull();
      expect(document.brand.fonts).toBeNull();
      valid(document);
    }
  });

  withArt('copies the art a preset names', () => {
    withPresetArt(ART.id, () => {
      const document = fresh();

      expect(document.art).toBe(ART.id);
      valid(document);
    });
  });

  it('starts without art when the preset names art the library does not have', () => {
    withPresetArt('retired-art', () => expect(fresh().art).toBeNull());
  });

  it('copies the brand kit fonts with its colours', () => {
    const document = documentFromPreset({
      presetId: 'tips-steps-ink',
      format: 'square',
      brand: KIT,
    });

    expect(document.brand.fonts).toEqual(KIT.fonts);
    expect(document.brand.fonts).not.toBe(KIT.fonts);
    valid(document);
  });
});

describe('updateElement', () => {
  it('clamps an offset on the way in, so no stored position is out of bounds', () => {
    const document = fresh();
    const edited = updateElement(document, document.slides[0].id, 'headline', {
      offset: { x: 500, y: -500 },
    });

    const offset = edited.slides[0].elements.headline?.offset;
    expect(offset?.x).toBeLessThanOrEqual(100);
    expect(offset?.y).toBeGreaterThanOrEqual(-100);
    valid(edited);
  });

  it('leaves every other slide alone', () => {
    const document = fresh();
    const edited = updateElement(document, document.slides[0].id, 'headline', { text: 'One' });

    expect(edited.slides[1]).toBe(document.slides[1]);
  });

  it('clears a value set to undefined', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const coloured = updateElement(document, id, 'headline', { color: '#123456' });
    const cleared = updateElement(coloured, id, 'headline', { color: undefined });

    expect(cleared.slides[0].elements.headline).not.toHaveProperty('color');
  });

  it('refuses to store anything the slot does not allow', () => {
    const document = fresh();
    const id = document.slides[0].id;

    // A size on a slot without sizes, text on a counted slot, hiding a
    // required element: each is dropped, so the next autosave cannot fail.
    const edited = updateElement(
      updateElement(updateElement(document, id, 'eyebrow', { size: 'lg' }), id, 'pageNumber', {
        text: 'typed',
      }),
      id,
      'headline',
      { hidden: true },
    );

    expect(edited.slides[0].elements.eyebrow?.size).toBeUndefined();
    expect(edited.slides[0].elements.pageNumber?.text).toBeUndefined();
    expect(edited.slides[0].elements.headline?.hidden).toBeUndefined();
    valid(edited);
  });

  it('cuts text to the limit without splitting an emoji', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const long = `${'a'.repeat(MAX_TEXT_LENGTH - 1)}\u{1F600}`;

    const edited = updateElement(document, id, 'headline', { text: long });
    const text = edited.slides[0].elements.headline?.text ?? '';

    expect(text.length).toBeLessThanOrEqual(MAX_TEXT_LENGTH);
    expect(text).toBe('a'.repeat(MAX_TEXT_LENGTH - 1));
    valid(edited);
  });

  it('caps a list at the number of items the slot holds', () => {
    const document = fresh();
    const id = document.slides[1].id;
    const edited = updateElement(document, id, 'list', {
      items: Array.from({ length: 12 }, (_, index) => `Item ${index}`),
    });

    const layout = findLayout(edited.slides[1].layoutId);
    const max = layout ? findSlot(layout, 'list')?.maxItems : undefined;
    expect(edited.slides[1].elements.list?.items).toHaveLength(max as number);
    valid(edited);
  });

  it('ignores a slot the slide layout does not have', () => {
    const document = fresh();
    expect(updateElement(document, document.slides[0].id, 'quote', { text: 'x' })).toBe(document);
  });

  it('removes an element that ends up with nothing in it', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const nudged = updateElement(document, id, 'pageNumber', { offset: { x: 0, y: 0 } });
    const back = updateElement(nudged, id, 'pageNumber', { offset: undefined });

    expect(back.slides[0].elements).not.toHaveProperty('pageNumber');
  });
});

describe('logo placement', () => {
  const closing = () => {
    const document = fresh();
    return { document, id: document.slides[4].id };
  };

  it('moves the logo to another place the layout offers', () => {
    const { document, id } = closing();
    const moved = setLogoPlacement(document, id, 'header');

    expect(moved.slides[4].elements.logo?.placement).toBe('header');
    valid(moved);
  });

  it('refuses a place the layout did not draw room for', () => {
    const { document, id } = closing();
    expect(setLogoPlacement(document, id, 'footer')).toBe(document);
  });

  it('drops the nudge when the logo moves, because it meant nothing elsewhere', () => {
    const { document, id } = closing();
    const nudged = updateElement(document, id, 'logo', { offset: { x: 5, y: 5 } });
    const moved = setLogoPlacement(nudged, id, 'header');

    expect(moved.slides[4].elements.logo?.offset).toBeUndefined();
  });

  it('clamps a nudge against the spot the logo is in', () => {
    const { document, id } = closing();
    const moved = setLogoPlacement(document, id, 'header');
    const nudged = updateElement(moved, id, 'logo', { offset: { x: 400, y: 400 } });

    const layout = findLayout(nudged.slides[4].layoutId);
    const slot = layout ? findSlot(layout, 'logo') : null;
    const box = slot ? slotPlacement(slot, nudged.slides[4].elements.logo).box : null;
    const offset = nudged.slides[4].elements.logo?.offset;

    expect(box && offset ? box.x + offset.x + box.w : 0).toBeLessThanOrEqual(100.0001);
    expect(box && offset ? box.y + offset.y + box.h : 0).toBeLessThanOrEqual(100.0001);
  });
});

describe('backgrounds and layouts', () => {
  it('copies a background rather than sharing it', () => {
    const document = fresh();
    const background = { kind: 'color' as const, hex: '#123456' };
    const edited = setBackground(document, document.slides[0].id, background);

    background.hex = '#000000';
    expect(edited.slides[0].background).toEqual({ kind: 'color', hex: '#123456' });
  });

  it('keeps the words that fit the new layout and gives new slots sample words', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const typed = updateElement(document, id, 'headline', { text: 'Kept' });
    const target = latestLayout('quote-centre');
    const switched = setSlideLayout(typed, id, target ? layoutKey(target) : '');

    expect(switched.slides[0].layoutId).toBe('quote-centre@1');
    expect(switched.slides[0].elements.quote?.text).toBeTruthy();
    valid(switched);
  });

  it('carries matching slots across', () => {
    const document = fresh();
    const id = document.slides[2].id;
    const typed = updateElement(document, id, 'headline', { text: 'Kept' });
    const target = latestLayout('split-panel');
    const switched = setSlideLayout(typed, id, target ? layoutKey(target) : '');

    expect(switched.slides[2].elements.headline?.text).toBe('Kept');
    valid(switched);
  });

  it('follows the new layout background unless the user changed it', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const target = latestLayout('cover-picture');
    const key = target ? layoutKey(target) : '';

    expect(setSlideLayout(document, id, key).slides[0].background).toEqual(target?.background);

    const painted = setBackground(document, id, { kind: 'color', hex: '#ABCDEF' });
    expect(setSlideLayout(painted, id, key).slides[0].background).toEqual({
      kind: 'color',
      hex: '#ABCDEF',
    });
  });

  it('ignores a layout that is not in the library', () => {
    const document = fresh();
    expect(setSlideLayout(document, document.slides[0].id, 'nope@1')).toBe(document);
  });
});

describe('slides', () => {
  it('adds after the current slide and keeps the order', () => {
    const document = fresh();
    const added = addSlide(document, { role: 'quote', after: document.slides[0].id, newId: ids });

    expect(added.slides).toHaveLength(document.slides.length + 1);
    expect(added.slides[1].layoutId).toBe('quote-centre@1');
    expect(added.slides[1].origin).toBeUndefined();
    expect(added.slides[2].id).toBe(document.slides[1].id);
    valid(added);
  });

  it('adds at the end when no slide is named', () => {
    const document = fresh();
    const added = addSlide(document, { role: 'content', newId: ids });

    expect(added.slides.at(-1)?.layoutId).toBe('content-eyebrow@1');
  });

  it('refuses a twenty-first slide', () => {
    let document = fresh();
    while (document.slides.length < MAX_SLIDES) {
      document = addSlide(document, { role: 'content', newId: ids });
    }

    expect(document.slides).toHaveLength(MAX_SLIDES);
    expect(addSlide(document, { role: 'content', newId: ids })).toBe(document);
    expect(duplicateSlide(document, document.slides[0].id, ids)).toBe(document);
    valid(document);
  });

  it('duplicates a slide without sharing its list items', () => {
    const document = fresh();
    const listSlide = document.slides[1];
    const copied = duplicateSlide(document, listSlide.id, ids);

    expect(copied.slides).toHaveLength(document.slides.length + 1);
    expect(copied.slides[2].id).not.toBe(listSlide.id);

    const edited = updateElement(copied, copied.slides[2].id, 'list', { items: ['only one'] });
    expect(edited.slides[1].elements.list?.items).toEqual(listSlide.elements.list?.items);
    valid(edited);
  });

  it('will not remove the last slide', () => {
    const document = documentFromPreset({
      presetId: BLANK_PRESET_ID,
      format: 'square',
      newId: ids,
    });
    expect(removeSlide(document, document.slides[0].id)).toBe(document);
  });

  it('removes a slide by id', () => {
    const document = fresh();
    const removed = removeSlide(document, document.slides[1].id);

    expect(removed.slides.map((slide) => slide.id)).toEqual(
      document.slides.filter((_, index) => index !== 1).map((slide) => slide.id),
    );
  });

  it('reorders by index', () => {
    const document = fresh();
    const moved = moveSlide(document, 0, 2);

    expect(moved.slides[2].id).toBe(document.slides[0].id);
    expect(moved.slides[0].id).toBe(document.slides[1].id);
  });

  it('ignores an out-of-range or fractional reorder', () => {
    const document = fresh();
    expect(moveSlide(document, 0, 99)).toBe(document);
    expect(moveSlide(document, 0.5, 1)).toBe(document);
  });
});

describe('reset', () => {
  it('puts one slide back to the template and leaves the rest', () => {
    const document = fresh();
    const edited = updateElement(
      updateElement(document, document.slides[0].id, 'headline', { text: 'Mine' }),
      document.slides[2].id,
      'headline',
      { text: 'Also mine' },
    );

    const reset = resetSlide(edited, document.slides[0].id);

    expect(reset.slides[0]).toEqual(document.slides[0]);
    expect(reset.slides[2].elements.headline?.text).toBe('Also mine');
  });

  it('resets a moved slide to its own template slide, not the one now in its place', () => {
    const document = fresh();
    const moved = moveSlide(document, 3, 0);
    const edited = updateElement(moved, moved.slides[0].id, 'stat', { text: '99%' });

    const reset = resetSlide(edited, moved.slides[0].id);
    expect(reset.slides[0]).toEqual(document.slides[3]);
  });

  it('resets an added slide to its layout sample words', () => {
    const document = addSlide(fresh(), { role: 'quote', newId: ids });
    const added = document.slides.at(-1);
    const id = added?.id ?? '';
    const edited = updateElement(document, id, 'quote', { text: 'Mine' });

    expect(resetSlide(edited, id).slides.at(-1)).toEqual(added);
  });

  it('puts one element back the way the layout draws it', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const coloured = updateElement(document, id, 'headline', { color: '#123456', size: 'lg' });

    expect(resetElement(coloured, id, 'headline').slides[0].elements.headline).toBeUndefined();
  });

  it('clears an element font with the rest of the element', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const set = setElementFont(document, id, 'headline', 'jetbrains-mono');

    expect(set.slides[0].elements.headline?.font).toBe('jetbrains-mono');
    expect(resetElement(set, id, 'headline').slides[0].elements.headline?.font).toBeUndefined();
  });

  withArt('puts the art back and clears the design fonts, keeping the brand kit fonts', () => {
    withPresetArt(ART.id, () => {
      const document = applyBrandKit(fresh(), KIT);
      const edited = setElementFont(
        setDocumentFonts(setArt(document, OTHER_ART.id), { heading: 'inter', body: 'poppins' }),
        document.slides[0].id,
        'headline',
        'jetbrains-mono',
      );

      const reset = resetDocument(edited);

      expect(reset.art).toBe(ART.id);
      expect(reset.fonts).toBeNull();
      expect(reset.slides[0].elements.headline?.font).toBeUndefined();
      expect(reset.brand.fonts).toEqual(KIT.fonts);
      valid(reset);
    });
  });

  it('puts the art back to none for a preset without any', () => {
    withPresetArt(undefined, () => {
      const document = fresh();
      const edited = ART ? setArt(document, ART.id) : { ...document, art: 'stale' };

      expect(resetDocument(edited).art).toBeNull();
    });
  });

  it('puts the whole design and its theme back, keeping the brand, handle and caption', () => {
    const document = fresh();
    const edited = setCaption(
      setHandle(
        applyBrandKit(
          applyTheme(
            updateElement(
              removeSlide(document, document.slides[1].id),
              document.slides[0].id,
              'headline',
              { text: 'Mine' },
            ),
            'midnight',
          ),
          KIT,
        ),
        '@lotus',
      ),
      'Written in preview',
    );

    const reset = resetDocument(edited);

    expect(reset.themeId).toBe(document.themeId);
    expect(reset.slides).toHaveLength(document.slides.length);
    expect(reset.slides[0].elements.headline?.text).toBe(
      document.slides[0].elements.headline?.text,
    );
    // Ids are reused, so the editor's selection survives.
    expect(reset.slides[0].id).toBe(document.slides[0].id);
    expect(reset.brand).toEqual(KIT);
    expect(reset.handle).toBe('@lotus');
    expect(reset.caption).toBe('Written in preview');
    valid(reset);
  });
});

describe('brand and theme', () => {
  it('swaps the theme without touching a word', () => {
    const document = fresh();
    const themed = applyTheme(document, 'bold');

    expect(themed.themeId).toBe('bold');
    expect(themed.slides).toBe(document.slides);
  });

  it('ignores a theme the library does not have', () => {
    const document = fresh();
    expect(applyTheme(document, 'not-a-theme')).toBe(document);
    expect(applyTheme(document, 'toString')).toBe(document);
  });

  it('applies and clears a brand kit', () => {
    const document = fresh();
    const branded = applyBrandKit(document, KIT);

    expect(branded.brand).toEqual(KIT);
    expect(branded.brand).not.toBe(KIT);
    valid(branded);

    expect(applyBrandKit(branded, null).brand).toEqual({
      kitId: null,
      colors: null,
      logoMediaId: null,
      name: null,
      kitVersion: null,
      fonts: null,
    });
  });

  it('copies a kit fonts, sharing nothing, and leaves a family the library lacks to the theme', () => {
    const fonts = { heading: 'inter' as FontId, body: 'retired-family' as FontId };
    const branded = applyBrandKit(fresh(), { ...KIT, fonts });

    expect(branded.brand.fonts).toEqual({ heading: 'inter', body: null });
    fonts.heading = 'poppins';
    expect(branded.brand.fonts?.heading).toBe('inter');
    valid(branded);
  });

  it('stops following a kit, keeping the brand name and logo on the slides', () => {
    const branded = setBrandName(applyBrandKit(fresh(), KIT), 'Lotus');
    const detached = detachBrandKit(branded);

    expect(detached.brand).toEqual({
      kitId: null,
      colors: null,
      logoMediaId: KIT.logoMediaId,
      name: 'Lotus',
      kitVersion: null,
      fonts: null,
    });
    valid(detached);
    // Nothing to detach is no change at all, so no empty undo step.
    expect(detachBrandKit(detached)).toBe(detached);
  });

  it('detaches a design whose only trace of the kit is its fonts', () => {
    const document = fresh();
    const fontsOnly = { ...document, brand: { ...document.brand, fonts: KIT.fonts } };

    expect(detachBrandKit(fontsOnly).brand.fonts).toBeNull();
  });

  it('takes a kit newer colours and nothing else', () => {
    const branded = setBrandName(applyBrandKit(fresh(), KIT), 'Lotus');
    const colors = { ...(KIT.colors as NonNullable<DesignBrand['colors']>), primary: '#111111' };
    const updated = updateBrandColors(branded, colors, '2026-11-01T00:00:00.000Z');

    expect(updated.brand.colors?.primary).toBe('#111111');
    expect(updated.brand.kitVersion).toBe('2026-11-01T00:00:00.000Z');
    expect(updated.brand.name).toBe('Lotus');
    expect(updated.brand.logoMediaId).toBe(KIT.logoMediaId);
    // No fonts given: the ones the design copied from the kit stay.
    expect(updated.brand.fonts).toEqual(KIT.fonts);
  });

  it('takes a kit newer fonts on Update when they are given, and clears them for null', () => {
    const branded = applyBrandKit(fresh(), KIT);
    const colors = KIT.colors as NonNullable<DesignBrand['colors']>;
    const version = '2026-11-01T00:00:00.000Z';

    const newer = updateBrandColors(branded, colors, version, { heading: null, body: 'inter' });
    expect(newer.brand.fonts).toEqual({ heading: null, body: 'inter' });
    valid(newer);

    expect(updateBrandColors(branded, colors, version, null).brand.fonts).toBeNull();
  });
});

describe('background art', () => {
  withArt('sets, swaps and clears the art without touching a slide', () => {
    const document = fresh();
    const set = setArt(document, ART.id);

    expect(set.art).toBe(ART.id);
    expect(set.slides).toBe(document.slides);
    valid(set);

    expect(setArt(set, OTHER_ART.id).art).toBe(OTHER_ART.id);
    expect(setArt(set, null).art).toBeNull();
    expect(setArt(set, ART.id)).toBe(set);
  });

  it('ignores art the library does not draw, and none for a design without any', () => {
    const document = fresh();

    for (const id of ['nope', 'toString', '__proto__', '']) {
      expect(setArt(document, id)).toBe(document);
    }
    expect(setArt(document, null)).toBe(document);
  });
});

describe('design fonts', () => {
  it('sets the heading and body faces for the whole design, sharing nothing', () => {
    const document = fresh();
    const fonts = { heading: 'playfair-display' as FontId, body: 'inter' as FontId };
    const set = setDocumentFonts(document, fonts);

    expect(set.fonts).toEqual({ heading: 'playfair-display', body: 'inter' });
    fonts.heading = 'poppins';
    expect(set.fonts?.heading).toBe('playfair-display');
    expect(set.slides).toBe(document.slides);
    valid(set);
  });

  it('keeps one face to the one beneath it, and stores a choice of neither as none', () => {
    const document = fresh();
    const heading = setDocumentFonts(document, { heading: 'poppins', body: null });

    expect(heading.fonts).toEqual({ heading: 'poppins', body: null });
    expect(setDocumentFonts(heading, { heading: null, body: null }).fonts).toBeNull();
    expect(setDocumentFonts(heading, null).fonts).toBeNull();
  });

  it('returns the same design when the faces do not change', () => {
    const document = fresh();
    const set = setDocumentFonts(document, { heading: 'poppins', body: null });

    expect(setDocumentFonts(document, null)).toBe(document);
    expect(setDocumentFonts(document, { heading: null, body: null })).toBe(document);
    expect(setDocumentFonts(set, { heading: 'poppins', body: null })).toBe(set);
  });

  it('refuses a family the library does not have', () => {
    const document = fresh();
    expect(setDocumentFonts(document, { heading: 'wingdings' as FontId, body: 'inter' })).toBe(
      document,
    );
  });
});

describe('element fonts', () => {
  it('sets one element font on a text slot and a list slot, and clears it with null', () => {
    const document = fresh();
    const cover = document.slides[0].id;
    const list = document.slides[1].id;

    const set = setElementFont(
      setElementFont(document, cover, 'headline', 'playfair-display'),
      list,
      'list',
      'inter',
    );

    expect(set.slides[0].elements.headline?.font).toBe('playfair-display');
    // The words stay: a font is a choice on the element, not a new element.
    expect(set.slides[0].elements.headline?.text).toBe(document.slides[0].elements.headline?.text);
    expect(set.slides[1].elements.list?.font).toBe('inter');
    valid(set);

    const cleared = setElementFont(set, cover, 'headline', null);
    expect(cleared.slides[0].elements.headline).not.toHaveProperty('font');
    expect(cleared.slides[0].elements.headline?.text).toBe(
      document.slides[0].elements.headline?.text,
    );
  });

  it('returns the same design for a slot with no words, an unknown family or no change', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const set = setElementFont(document, id, 'headline', 'poppins');

    expect(setElementFont(document, id, 'logo', 'inter')).toBe(document);
    expect(setElementFont(document, id, 'quote', 'inter')).toBe(document);
    expect(setElementFont(document, 'no-such-slide', 'headline', 'inter')).toBe(document);
    expect(setElementFont(document, id, 'headline', 'wingdings' as FontId)).toBe(document);
    expect(setElementFont(document, id, 'headline', null)).toBe(document);
    expect(setElementFont(set, id, 'headline', 'poppins')).toBe(set);
  });

  it('drops a font sent through updateElement to a slot with no words', () => {
    const document = fresh();
    const id = document.slides[0].id;
    const edited = updateElement(document, id, 'logo', { font: 'inter', hidden: true });

    expect(edited.slides[0].elements.logo).toEqual({ hidden: true });
    valid(edited);
  });

  it('carries an element font to the same slot of a new layout', () => {
    const document = fresh();
    const id = document.slides[2].id;
    const typed = setElementFont(document, id, 'headline', 'playfair-display');
    const target = latestLayout('split-panel');
    const switched = setSlideLayout(typed, id, target ? layoutKey(target) : '');

    expect(switched.slides[2].elements.headline?.font).toBe('playfair-display');
    valid(switched);
  });
});

describe('setFormat', () => {
  it('changes the shape of the whole design, keeping every slide', () => {
    const document = fresh();
    const story = setFormat(document, 'story');

    expect(story.format).toBe('story');
    expect(story.slides).toHaveLength(document.slides.length);
    // No nudge to move, so every slide is the one it was.
    for (const [index, slide] of story.slides.entries()) {
      expect(slide).toBe(document.slides[index]);
    }
    valid(story);
  });

  it('returns the same design for its own format or one that does not exist', () => {
    const document = fresh();

    expect(setFormat(document, 'square')).toBe(document);
    expect(setFormat(document, 'toString' as FormatId)).toBe(document);
    expect(setFormat(document, 'banner' as FormatId)).toBe(document);
  });

  it('refuses a format one slide layout does not take', () => {
    const document = fresh();
    const layout = findLayout(document.slides[3].layoutId);
    if (!layout) throw new Error('The statistic slide has no layout.');

    const formats = layout.formats;
    layout.formats = formats.filter((format) => format !== 'landscape');

    try {
      expect(setFormat(document, 'landscape')).toBe(document);
      expect(setFormat(document, 'story').format).toBe('story');
    } finally {
      layout.formats = formats;
    }
  });

  it('clamps every nudge again, the way the schema does', () => {
    const document = fresh();
    const [cover, ...rest] = document.slides;
    // Past the region on purpose, as only a document made by hand can be.
    const headline = { ...cover.elements.headline, offset: { x: 150, y: -150 } };
    const raw: DesignDocument = {
      ...document,
      slides: [{ ...cover, elements: { ...cover.elements, headline } }, ...rest],
    };

    const moved = setFormat(raw, 'portrait');
    const offset = moved.slides[0].elements.headline?.offset;

    expect(offset).toEqual(designDocumentSchema.parse(raw).slides[0].elements.headline?.offset);
    expect(offset).not.toEqual({ x: 150, y: -150 });
    expect(moved.slides[0].elements.headline?.text).toBe(headline.text);
    expect(moved.slides[1]).toBe(raw.slides[1]);
    valid(moved);
  });
});

describe('applyPhotoToAllSlides', () => {
  const PHOTO: SlideBackground = { kind: 'media', mediaId: 'media-1', overlay: 0.7, tint: 'light' };

  it('puts one slide photo, overlay and tint on every slide, sharing nothing', () => {
    const document = fresh();
    const photo = setBackground(document, document.slides[1].id, PHOTO);
    const all = applyPhotoToAllSlides(photo, photo.slides[1].id);

    for (const slide of all.slides) expect(slide.background).toEqual(PHOTO);
    expect(all.slides[0].background).not.toBe(all.slides[1].background);
    // The slide it came from already had it.
    expect(all.slides[1]).toBe(photo.slides[1]);
    valid(all);
  });

  it('returns the same design when every slide already has that photo', () => {
    const document = fresh();
    const once = applyPhotoToAllSlides(
      setBackground(document, document.slides[0].id, PHOTO),
      document.slides[0].id,
    );

    expect(applyPhotoToAllSlides(once, once.slides[3].id)).toBe(once);
  });

  it('treats a photo with no tint as the dark one', () => {
    const document = fresh();
    const dark = setBackground(document, document.slides[0].id, {
      kind: 'media',
      mediaId: 'media-1',
      overlay: 0.6,
    });
    const darkTinted = setBackground(dark, dark.slides[1].id, {
      kind: 'media',
      mediaId: 'media-1',
      overlay: 0.6,
      tint: 'dark',
    });
    const all = applyPhotoToAllSlides(darkTinted, darkTinted.slides[0].id);

    expect(all.slides[1]).toBe(darkTinted.slides[1]);
    expect(all.slides[2].background).toEqual({ kind: 'media', mediaId: 'media-1', overlay: 0.6 });
  });

  it('does nothing for a slide without a photo, or one that does not exist', () => {
    const document = fresh();

    expect(applyPhotoToAllSlides(document, document.slides[0].id)).toBe(document);
    expect(applyPhotoToAllSlides(document, 'no-such-slide')).toBe(document);
  });
});

describe('the design own words', () => {
  it('keeps a handle on one line and inside the limit', () => {
    const document = setHandle(fresh(), `@a\nb${'c'.repeat(100)}`);

    expect(document.handle).not.toContain('\n');
    expect(document.handle.length).toBeLessThanOrEqual(MAX_HANDLE_LENGTH);
    valid(document);
  });

  it('treats an empty brand name as none', () => {
    const document = setBrandName(applyBrandKit(fresh(), KIT), '   ');
    expect(document.brand.name).toBeNull();
  });

  it('returns the same document when nothing changed', () => {
    const document = fresh();
    expect(setHandle(document, document.handle)).toBe(document);
    expect(setCaption(document, document.caption)).toBe(document);
  });

  it('caps the caption', () => {
    const document = setCaption(fresh(), 'x'.repeat(MAX_CAPTION_LENGTH + 50));
    expect(document.caption).toHaveLength(MAX_CAPTION_LENGTH);
    valid(document);
  });
});

describe('applyCtaDefaults', () => {
  const DEFAULTS = { text: 'Book a free call', url: 'acme.example/offer' };

  /** tips-steps-ink (its closing slide is the fifth) with a Signature closing slide after it. */
  function withSignatureClosing(): DesignDocument {
    const layout = latestLayout('signature-closing');
    if (!layout) throw new Error('The Signature closing layout is missing.');

    return addSlide(fresh(), { layoutId: layoutKey(layout), newId: ids });
  }

  it('writes the call to action and the link into every closing slide, and nowhere else', () => {
    const document = withSignatureClosing();
    const next = applyCtaDefaults(document, DEFAULTS);
    const [template, signature] = [next.slides[4], next.slides[5]];

    expect(findLayout(template.layoutId)?.role).toBe('closing');
    expect(template.elements).toEqual({
      ...document.slides[4].elements,
      cta: { ...document.slides[4].elements.cta, text: 'Book a free call' },
    });
    expect(signature.elements.cta?.text).toBe('Book a free call');
    expect(signature.elements.footer?.text).toBe('acme.example/offer');
    for (let index = 0; index < 4; index++) expect(next.slides[index]).toBe(document.slides[index]);
    valid(next);
  });

  it('shows a Link slot the template hid', () => {
    const base = withSignatureClosing();
    const hidden = updateElement(base, base.slides[5].id, 'footer', { hidden: true });
    expect(hidden.slides[5].elements.footer?.hidden).toBe(true);

    const next = applyCtaDefaults(hidden, { text: null, url: 'acme.example' });

    expect(next.slides[5].elements.footer).toEqual({ text: 'acme.example' });
    expect(next.slides[4]).toBe(hidden.slides[4]);
    valid(next);
  });

  it('leaves a slot alone for a blank default, and changes nothing the second time', () => {
    const document = withSignatureClosing();

    expect(applyCtaDefaults(document, { text: null, url: null })).toBe(document);
    expect(applyCtaDefaults(document, { text: '  ', url: '\n' })).toBe(document);

    const once = applyCtaDefaults(document, DEFAULTS);
    expect(applyCtaDefaults(once, DEFAULTS)).toBe(once);

    const linkOnly = applyCtaDefaults(document, { text: null, url: 'acme.example' });
    expect(linkOnly.slides[5].elements.cta).toEqual(document.slides[5].elements.cta);
    expect(linkOnly.slides[4]).toBe(document.slides[4]);
  });

  it('keeps a default on one line and inside the limit', () => {
    const next = applyCtaDefaults(fresh(), {
      text: `Book\na call ${'x'.repeat(MAX_TEXT_LENGTH)}`,
      url: null,
    });
    const cta = next.slides[4].elements.cta?.text ?? '';

    expect(cta.startsWith('Book a call x')).toBe(true);
    expect(cta).toHaveLength(MAX_TEXT_LENGTH);
    valid(next);
  });

  it('does nothing to a design without a closing slide', () => {
    const document = blankDocument({ format: 'square', newId: ids });
    expect(applyCtaDefaults(document, DEFAULTS)).toBe(document);
  });
});
