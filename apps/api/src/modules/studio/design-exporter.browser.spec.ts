/**
 * The exporter in real Chromium, opt-in like the pool's own browser tests:
 * `SEO_BROWSER_TESTS=true npx jest design-exporter.browser`.
 *
 * What only a real browser can show: every slide of a template comes out at
 * exactly its format's size with its faces loaded from the inline fonts (a
 * missing face fails the slide, so a pass means they all loaded), the pixels
 * are the ones the editor draws (the slide's ground in its corners, the
 * logo's colour where the logo sits), and the text fitter runs and reports
 * a headline that cannot fit.
 */
import {
  applyBrandKit,
  colorDistance,
  type DesignDocument,
  documentFromPreset,
  type FormatId,
  formatSpec,
  paletteForSlide,
  rgbToHex,
  slideGround,
  themeById,
  updateElement,
} from '@postgear/design-engine';
import { type BrowserPool, createBrowserPool } from '@postgear/seo-engine';
import sharp from 'sharp';
import { DesignExport, type ExportPicture } from './design-exporter';

const enabled = process.env.SEO_BROWSER_TESTS === 'true';
const describeBrowser = enabled ? describe : describe.skip;

const LOGO_ID = 'logo-media-id';

function design(format: FormatId): DesignDocument {
  return applyBrandKit(documentFromPreset({ presetId: 'tips-steps-ink', format }), {
    kitId: 'kit-1',
    colors: null,
    logoMediaId: LOGO_ID,
    name: 'Acme',
    kitVersion: null,
  });
}

describeBrowser('DesignExport in real Chromium', () => {
  jest.setTimeout(180_000);

  let pool: BrowserPool;
  let logo: ExportPicture;

  beforeAll(async () => {
    pool = createBrowserPool({ launchTimeoutMs: 60_000 });
    logo = {
      bytes: await sharp({
        create: { width: 200, height: 80, channels: 4, background: '#FF5A1F' },
      })
        .png()
        .toBuffer(),
      mimeType: 'image/png',
    };
  });

  afterAll(async () => {
    await pool.close();
  });

  it.each(['square', 'portrait', 'story', 'landscape'] as const)(
    'exports every slide of a %s template at its exact size',
    async (format) => {
      const document = design(format);
      const exporter = new DesignExport(document, { pool, loadPicture: async () => logo });
      const spec = formatSpec(format);

      for (let index = 0; index < document.slides.length; index++) {
        const slide = await exporter.renderSlide(index, new AbortController().signal);
        const metadata = await sharp(slide.png).metadata();

        expect([metadata.format, metadata.width, metadata.height]).toEqual([
          'png',
          spec.width,
          spec.height,
        ]);
        expect(slide.missingPictures).toEqual([]);
      }
    },
  );

  it('paints the slide ground in the corners and the logo in its colour', async () => {
    const document = design('square');
    const cover = document.slides[0];
    const exporter = new DesignExport(document, { pool, loadPicture: async () => logo });

    const slide = await exporter.renderSlide(0, new AbortController().signal);
    const { data, info } = await sharp(slide.png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => {
      const at = (y * info.width + x) * info.channels;
      return rgbToHex({ r: data[at], g: data[at + 1], b: data[at + 2] });
    };

    const ground = slideGround(
      paletteForSlide(themeById(document.themeId), document.brand.colors, cover),
      cover,
    );
    const corners = [
      pixel(1, 1),
      pixel(info.width - 2, 1),
      pixel(1, info.height - 2),
      pixel(info.width - 2, info.height - 2),
    ];
    for (const corner of corners) expect(colorDistance(corner, ground)).toBeLessThan(0.01);

    // The logo is a flat #FF5A1F block, drawn smaller than its 200 x 80 file.
    let logoPixels = 0;
    for (let y = 0; y < info.height; y += 2) {
      for (let x = 0; x < info.width; x += 2) {
        if (colorDistance(pixel(x, y), '#FF5A1F') < 0.02) logoPixels += 1;
      }
    }
    expect(logoPixels).toBeGreaterThan(100);
  });

  it('reports a headline too long for its space at the smallest size', async () => {
    const base = design('square');
    const document = updateElement(base, base.slides[0].id, 'headline', {
      text: 'Far too many words for one headline. '.repeat(40).trim(),
    });
    const exporter = new DesignExport(document, { pool, loadPicture: async () => logo });

    const slide = await exporter.renderSlide(0, new AbortController().signal);

    expect(slide.overflowing).toContain('headline');
  });
});
