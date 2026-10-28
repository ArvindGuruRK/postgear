/**
 * What the renderer draws for Sprint 9b: background art on every slide that
 * is not a photo, between the ground and the layout; a photo's tint; and
 * text set in the fonts the user chose. Rendered with `react-dom/server`, as
 * the exporter renders it.
 *
 * The art expectations are built from `ART_STYLES` at run time, so these
 * tests follow whatever the art library holds; they skip, saying so, while
 * it is empty.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { ART_STYLES, type ArtStyle, artColors, artDataUri, artSvg } from '../art';
import { PHOTO_INK_DARK, paletteForSlide, slideGround } from '../brand';
import {
  applyBrandKit,
  applyTheme,
  documentFromPreset,
  setArt,
  setBackground,
  setDocumentFonts,
  setElementFont,
} from '../document';
import { fontStack, resolveWeight } from '../fonts';
import { FORMAT_IDS, formatSpec } from '../formats';
import { THEMES, themeById } from '../themes';
import type { DesignDocument, FormatId, SlideBackground } from '../types';
import { type SlideMode, SlideView } from './SlideView';

const PICTURE = 'data:image/png;base64,AAAA';
const PHOTO: SlideBackground = { kind: 'media', mediaId: 'media-1', overlay: 0.6 };

function render(
  design: DesignDocument,
  index: number,
  mode: SlideMode = 'export',
  resolveMedia: (mediaId: string) => string | null = () => PICTURE,
): string {
  return renderToStaticMarkup(
    <SlideView design={design} index={index} mode={mode} resolveMedia={resolveMedia} />,
  );
}

/** tips-steps-ink: cover, numbered list, content, statistic, closing. */
function design(format: FormatId = 'portrait'): DesignDocument {
  return documentFromPreset({ presetId: 'tips-steps-ink', format });
}

/** Undoes React's attribute escaping, so a value compares with the string it was built from. */
function unescapeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** The source of every art layer in one slide's markup. */
function artSources(markup: string): string[] {
  return [...markup.matchAll(/<img data-art="[^"]*" src="([^"]*)"/g)].map((match) =>
    unescapeAttribute(match[1]),
  );
}

/** One slot's inline style. */
function slotStyle(markup: string, slot: string): string {
  const match = new RegExp(`<div data-slot="${slot}"[^>]*style="([^"]*)"`).exec(markup);
  if (!match) throw new Error(`The markup has no ${slot} slot.`);
  return unescapeAttribute(match[1]);
}

/**
 * The art a slide should carry, by the rule in the brief: drawn at the
 * format's size from the slide's ground, its accent and the theme's pinned
 * colours (left out when `pin` is false, to see what the art derives alone).
 */
function expectedArt(document: DesignDocument, index: number, art: ArtStyle, pin = true): string {
  const theme = themeById(document.themeId);
  const slide = document.slides[index];
  const palette = paletteForSlide(theme, document.brand.colors, slide);
  const { width, height } = formatSpec(document.format);
  const svg = artSvg(
    art.id,
    artColors({
      ground: slideGround(palette, slide),
      accent: palette.accent,
      pinned: pin && theme.art ? { background: theme.colors.background, ...theme.art } : null,
      home: art.home ?? null,
    }),
    width,
    height,
  );

  if (svg === null) throw new Error(`${art.id} drew nothing.`);
  return artDataUri(svg);
}

/** A pattern, which has no home colours of its own, so the theme and the kit decide its colours. */
const ART = ART_STYLES.find((art) => art.kind === 'pattern') ?? ART_STYLES[0];

/** A theme whose pinned art colours differ from the ones the art would derive on its ground. */
const PINNED_THEME = THEMES.find((theme) => {
  if (!theme.art) return false;

  const ground = theme.colors.background;
  const accent = theme.colors.accent;
  const pinned = artColors({ ground, accent, pinned: { background: ground, ...theme.art } });
  const derived = artColors({ ground, accent });

  return pinned.mid !== derived.mid || pinned.highlight !== derived.highlight;
});

/** ART_STYLES is filled by the art tasks; until they land there is no art to draw. */
const withArt = ART ? it : it.skip;
const withPinnedArt = ART && PINNED_THEME ? it : it.skip;

describe('background art', () => {
  withArt('is drawn once on every slide that is not a photo, as an SVG image', () => {
    const plain = design();
    const withPhoto = setBackground(setArt(plain, ART.id), plain.slides[1].id, PHOTO);

    for (const [index, slide] of withPhoto.slides.entries()) {
      const sources = artSources(render(withPhoto, index));

      if (slide.background.kind === 'media') {
        expect(sources).toEqual([]);
      } else {
        expect(sources).toHaveLength(1);
        expect(sources[0].startsWith('data:image/svg+xml')).toBe(true);
      }
    }
  });

  withArt('stays off a photo slide even when the photo cannot be drawn', () => {
    const plain = design();
    const withPhoto = setBackground(setArt(plain, ART.id), plain.slides[0].id, PHOTO);

    expect(artSources(render(withPhoto, 0, 'export', () => null))).toEqual([]);
  });

  it('is not drawn when the design has none', () => {
    const document = design();

    expect(document.art).toBeNull();
    for (const index of document.slides.keys()) {
      expect(render(document, index)).not.toContain('data-art=');
    }
  });

  withArt('sits on the ground, before the layout paints a block or sets any text', () => {
    const markup = render(setArt(design(), ART.id), 0);

    expect(markup).toMatch(/^<div data-slide="[^"]*" style="[^"]*"><img data-art="/);
  });

  withArt('is drawn in every mode, the editor and the thumbnails as well as the export', () => {
    const document = setArt(design(), ART.id);

    for (const mode of ['edit', 'preview', 'export'] as const) {
      expect(artSources(render(document, 0, mode))).toEqual([expectedArt(document, 0, ART)]);
    }
  });

  withArt('is drawn at the native size of every format, in the slide own colours', () => {
    for (const format of FORMAT_IDS) {
      const document = setArt(design(format), ART.id);

      for (const index of document.slides.keys()) {
        expect(artSources(render(document, index))).toEqual([expectedArt(document, index, ART)]);
      }
    }
  });

  withPinnedArt(
    'takes the theme pinned colours on its own ground, and a brand kit recolours it',
    () => {
      const pinned = applyTheme(setArt(design(), ART.id), PINNED_THEME?.id ?? '');
      const theme = themeById(pinned.themeId);
      const [source] = artSources(render(pinned, 0));

      expect(theme.id).toBe(PINNED_THEME?.id);
      expect(source).toBe(expectedArt(pinned, 0, ART));
      // Not the colours the art would derive from the same ground on its own.
      expect(source).not.toBe(expectedArt(pinned, 0, ART, false));

      // A ground no theme is likely to use, checked rather than assumed.
      const ground = '#13294B';
      expect(theme.colors.background).not.toBe(ground);

      const kitted = applyBrandKit(pinned, {
        kitId: 'kit-1',
        colors: {
          primary: '#0F766E',
          secondary: '#115E59',
          accent: '#F97316',
          background: ground,
          text: '#FFFFFF',
        },
        logoMediaId: null,
        name: 'Brand',
        kitVersion: null,
        fonts: null,
      });
      const [recoloured] = artSources(render(kitted, 0));

      expect(recoloured).toBe(expectedArt(kitted, 0, ART));
      expect(recoloured).not.toBe(source);
    },
  );
});

describe('photo tints', () => {
  it('lays a dark tint in black and a light tint in white, with inks to match', () => {
    const document = design('square');
    const id = document.slides[0].id;
    const dark = render(setBackground(document, id, PHOTO), 0);
    const light = render(setBackground(document, id, { ...PHOTO, tint: 'light' }), 0);

    expect(dark).toContain('background:rgba(0, 0, 0, 0.6)');
    expect(dark).not.toContain('background:rgba(255, 255, 255, 0.6)');
    expect(light).toContain('background:rgba(255, 255, 255, 0.6)');
    expect(slotStyle(light, 'headline')).toContain(`color:${PHOTO_INK_DARK}`);
  });

  it('shows the ground a light tint promises when the photo cannot be drawn', () => {
    const document = design('square');
    const light = setBackground(document, document.slides[0].id, { ...PHOTO, tint: 'light' });

    expect(render(light, 0, 'export', () => null)).toMatch(
      /^<div data-slide="[^"]*" style="[^"]*background:#999999/,
    );
  });
});

describe('fonts', () => {
  it('sets a text slot in its own font, and the slots beside it in the theme', () => {
    const document = design('square');
    const theme = themeById(document.themeId);
    const set = setElementFont(document, document.slides[0].id, 'headline', 'playfair-display');
    const markup = render(set, 0);

    expect(slotStyle(markup, 'headline')).toContain(
      `font-family:${fontStack('playfair-display')};`,
    );
    expect(slotStyle(markup, 'subheadline')).toContain(
      `font-family:${fontStack(theme.type.subheadline.font)};`,
    );
  });

  it('sets the slots of a face in the design font, below an element own font', () => {
    const fonts = setDocumentFonts(design('square'), { heading: 'dm-serif-display', body: null });
    const set = setElementFont(fonts, fonts.slides[0].id, 'headline', 'playfair-display');

    expect(slotStyle(render(set, 0), 'headline')).toContain(
      `font-family:${fontStack('playfair-display')};`,
    );
    expect(slotStyle(render(set, 2), 'headline')).toContain(
      `font-family:${fontStack('dm-serif-display')};`,
    );
  });

  it('snaps the theme weight to the weights the chosen family has', () => {
    const document = design('square');
    const theme = themeById(document.themeId);
    const set = setElementFont(document, document.slides[0].id, 'headline', 'dm-serif-display');
    const weight = resolveWeight('dm-serif-display', theme.type.headline.weight);

    expect(weight).not.toBe(theme.type.headline.weight);
    expect(slotStyle(render(set, 0), 'headline')).toMatch(new RegExp(`font-weight:${weight}(;|$)`));
  });
});
