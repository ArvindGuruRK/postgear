/**
 * The legibility promise, checked exhaustively: whatever theme, brand,
 * background and format a design has, the text a template draws reads at
 * WCAG AA on what is actually behind it. Only a colour the user picked may
 * fail, and then the engine says so and knows the fix.
 */
import { photoGround, SAFE_PHOTO_OVERLAY } from './brand';
import { AA_CONTRAST, contrastRatio, meetsAA, rgbToHex } from './color';
import { documentFromPreset, setBackground, updateElement } from './document';
import {
  contrastFixFor,
  fixContrast,
  inkOf,
  legibleInk,
  regionGround,
  slidePalette,
  slotInk,
} from './ink';
import { findLayout, LAYOUTS, latestLayout, slotPlacement } from './layouts';
import { THEMES } from './themes';
import type { BrandColors, DesignBrand, Palette, SlideBackground, SlideLayout } from './types';

const BRANDS: BrandColors[] = [
  // A real one, and the shapes of the ones that go wrong: everything pale,
  // everything dark, everything the same mid-grey, a neon accent on white.
  {
    primary: '#0F766E',
    secondary: '#115E59',
    accent: '#F97316',
    background: '#FFFFFF',
    text: '#0A0A0A',
  },
  {
    primary: '#FDE68A',
    secondary: '#FEF3C7',
    accent: '#FBCFE8',
    background: '#FFFBEB',
    text: '#FFFFFF',
  },
  {
    primary: '#111827',
    secondary: '#1F2937',
    accent: '#312E81',
    background: '#030712',
    text: '#111111',
  },
  {
    primary: '#777777',
    secondary: '#777777',
    accent: '#777777',
    background: '#777777',
    text: '#777777',
  },
  {
    primary: '#39FF14',
    secondary: '#00FFFF',
    accent: '#FF00FF',
    background: '#FFFFFF',
    text: '#39FF14',
  },
];

function brandOf(colors: BrandColors | null): DesignBrand {
  return { kitId: null, colors, logoMediaId: null, name: 'Brand', kitVersion: null };
}

/** Every default ink on one slide that does not read on its ground. */
function failures(
  layout: SlideLayout,
  themeId: string,
  colors: BrandColors | null,
  background: SlideBackground,
): string[] {
  const found: string[] = [];

  for (const format of layout.formats) {
    const design = { themeId, brand: brandOf(colors) };
    const slide = { background };
    const palette = slidePalette(design, slide);

    for (const slot of layout.slots) {
      if (slot.kind !== 'text' && slot.kind !== 'list') continue;

      const ground = regionGround(layout, format, palette, slide, slotPlacement(slot, null).region);
      const ink = slotInk(palette, slot, undefined, ground);

      if (ink.chosen || !ink.readable || contrastRatio(ink.color, ink.ground) < AA_CONTRAST) {
        found.push(`${layout.id} ${format} ${themeId} ${slot.id}: ${ink.color} on ${ink.ground}`);
      }
    }
  }

  return found;
}

describe('a template default ink', () => {
  it('reads on its ground in every theme, layout and format', () => {
    const found = THEMES.flatMap((theme) =>
      LAYOUTS.flatMap((layout) => failures(layout, theme.id, null, layout.background)),
    );
    expect(found).toEqual([]);
  });

  it('reads on its ground with any brand kit', () => {
    const found = BRANDS.flatMap((brand) =>
      LAYOUTS.flatMap((layout) => failures(layout, 'ink', brand, layout.background)),
    );
    expect(found).toEqual([]);
  });

  it('reads on any background colour the user picks', () => {
    const steps = [0x00, 0x55, 0x77, 0x99, 0xcc, 0xff];
    const found: string[] = [];

    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const background: SlideBackground = { kind: 'color', hex: rgbToHex({ r, g, b }) };
          for (const layout of LAYOUTS) found.push(...failures(layout, 'ink', null, background));
        }
      }
    }

    expect(found).toEqual([]);
  });

  it('reads on every role background, for every theme', () => {
    const found: string[] = [];

    for (const theme of THEMES) {
      for (const role of ['background', 'surface', 'primary', 'secondary', 'accent'] as const) {
        for (const layout of LAYOUTS) {
          found.push(...failures(layout, theme.id, null, { kind: 'role', role }));
        }
      }
    }

    expect(found).toEqual([]);
  });

  it('reads on a photo at the safe overlay, whatever the photo is', () => {
    const background: SlideBackground = {
      kind: 'media',
      mediaId: 'media-1',
      overlay: SAFE_PHOTO_OVERLAY,
    };
    const found = THEMES.flatMap((theme) =>
      LAYOUTS.flatMap((layout) => failures(layout, theme.id, BRANDS[1], background)),
    );

    expect(found).toEqual([]);
  });
});

describe('regionGround', () => {
  const palette = (themeId = 'ink'): Palette =>
    slidePalette(
      { themeId, brand: brandOf(null) },
      { background: { kind: 'role', role: 'background' } },
    );

  it('is the painted panel for a region the panel covers', () => {
    const layout = latestLayout('list-steps') as SlideLayout;
    const colors = palette();
    const slide = { background: layout.background };

    expect(regionGround(layout, 'square', colors, slide, 'aside')).toBe(colors.surface);
    expect(regionGround(layout, 'square', colors, slide, 'body')).toBe(colors.background);
  });

  it('is the band for the footer of a banded closing slide, in every format', () => {
    const layout = latestLayout('closing-band') as SlideLayout;
    const colors = palette();

    for (const format of layout.formats) {
      expect(
        regionGround(layout, format, colors, { background: layout.background }, 'footer'),
      ).toBe(colors.accent);
    }
  });

  it('is the darkest a photo can promise, never lighter than the safe overlay allows', () => {
    const layout = latestLayout('cover-headline') as SlideLayout;
    const colors = palette();
    const at = (overlay: number) =>
      regionGround(
        layout,
        'square',
        colors,
        { background: { kind: 'media', mediaId: 'm', overlay } },
        'body',
      );

    expect(at(0)).toBe(photoGround(SAFE_PHOTO_OVERLAY));
    expect(at(0.8)).toBe(photoGround(0.8));
  });
});

describe('legibleInk', () => {
  const colors = slidePalette(
    { themeId: 'ink', brand: brandOf(null) },
    { background: { kind: 'role', role: 'background' } },
  );

  it('keeps the colour the template asked for when it reads', () => {
    expect(legibleInk(colors, '#FFFFFF', '#C2410C')).toBe('#C2410C');
  });

  it('falls back to the text ink, then to black or white', () => {
    expect(legibleInk(colors, '#FFFFFF', '#FFE94A')).toBe(colors.text);
    expect(meetsAA(legibleInk(colors, '#111111', '#222222'), '#111111')).toBe(true);
  });
});

describe('a colour the user picked', () => {
  const design = () => documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });

  it('is drawn as picked, and reported when it does not read', () => {
    const document = design();
    const id = document.slides[0].id;
    const edited = updateElement(document, id, 'headline', { color: '#FFFFFF' });
    const ink = inkOf(edited, edited.slides[0], 'headline');

    expect(ink).toMatchObject({ color: '#FFFFFF', chosen: true, readable: false });
  });

  it('is fixed in one step by Fix Contrast, as a theme role where one reads', () => {
    const document = design();
    const id = document.slides[0].id;
    const edited = updateElement(document, id, 'headline', { color: '#FFFFFF' });

    const fix = contrastFixFor(edited, edited.slides[0], 'headline');
    expect(fix).toEqual({ colorRole: 'text', color: undefined });

    const fixed = updateElement(edited, id, 'headline', fix ?? {});
    expect(inkOf(fixed, fixed.slides[0], 'headline')?.readable).toBe(true);
    expect(fixed.slides[0].elements.headline).not.toHaveProperty('color');
  });

  it('offers no fix for text that already reads', () => {
    const document = design();
    expect(contrastFixFor(document, document.slides[0], 'headline')).toBeNull();
  });

  it('is fixed with black or white when no theme ink reads', () => {
    const grey = '#777777';
    const flat: Palette = {
      background: grey,
      surface: grey,
      primary: grey,
      secondary: grey,
      accent: grey,
      text: grey,
      textMuted: grey,
      onPrimary: grey,
      onAccent: grey,
      onSurface: grey,
    };

    const fix = fixContrast(flat, grey);
    expect(fix.colorRole).toBeUndefined();
    expect(meetsAA(fix.color as string, grey)).toBe(true);
  });

  it('is judged against the slide it is on, including a photo', () => {
    const document = design();
    const id = document.slides[0].id;
    const onPhoto = setBackground(document, id, { kind: 'media', mediaId: 'm', overlay: 0.6 });
    const dark = updateElement(onPhoto, id, 'headline', { color: '#111111' });

    expect(inkOf(dark, dark.slides[0], 'headline')?.readable).toBe(false);
  });

  it('has no ink for a slot that draws no text', () => {
    const document = design();
    expect(inkOf(document, document.slides[0], 'logo')).toBeNull();
    expect(inkOf(document, document.slides[0], 'quote')).toBeNull();
    expect(findLayout(document.slides[0].layoutId)).not.toBeNull();
  });
});
