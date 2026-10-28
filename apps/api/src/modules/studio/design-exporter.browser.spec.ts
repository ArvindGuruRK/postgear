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
 *
 * Sprint 9b adds the two things a mock pool cannot prove: a 2x export is
 * the same slide with twice the pixels each way (nothing moves, the text
 * fits as it did), and the PDF Download prints a page per slide at the
 * slide's size with the slide covering all of it.
 */
import { inflateSync } from 'node:zlib';
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
import { pdfPageSize } from './design-pdf';

const enabled = process.env.SEO_BROWSER_TESTS === 'true';
const describeBrowser = enabled ? describe : describe.skip;

const LOGO_ID = 'logo-media-id';

const FORMATS_TO_TRY = ['square', 'portrait', 'story', 'landscape'] as const;

/**
 * Each format's PDF page, in points (3/4 of a CSS pixel). Chromium prints a
 * length whole only at a multiple of 8px, so the pool asks for the nearest
 * one: Portrait's 1350px slide prints on a 1352px page, filling it.
 */
const PAGE_POINTS: Record<FormatId, [number, number]> = {
  square: [810, 810],
  portrait: [810, 1014],
  story: [810, 1440],
  landscape: [1440, 810],
};

/** Two decimals: Skia writes some lengths as floats a hair off whole. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * What a printed PDF holds, read from Chromium's (uncompressed) object
 * dictionaries and its (deflated) page content.
 */
function readPdf(pdf: Buffer): {
  pageCount: number;
  /** Each page's MediaBox width and height, in points. */
  pages: Array<[number, number]>;
  /** Each embedded picture's width and height, in pixels. */
  pictures: Array<[number, number]>;
  /** Each page's picture as drawn on it, width and height, in points. */
  drawn: Array<[number, number]>;
} {
  const text = pdf.toString('latin1');
  const pageCount = Number(/\/Type \/Pages\s*\/Count (\d+)/.exec(text)?.[1] ?? 0);
  const pages = [...text.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(
    (match): [number, number] => [round2(Number(match[1])), round2(Number(match[2]))],
  );
  const pictures = [...text.matchAll(/\/Subtype \/Image\s*\/Width (\d+)\s*\/Height (\d+)/g)].map(
    (match): [number, number] => [Number(match[1]), Number(match[2])],
  );

  // A page's content: the device transform first (Skia draws at 300 dpi,
  // 0.24 points a dot, flipped), and the last transform before the picture
  // is drawn is the picture's own box in those dots.
  const matrix = /(-?[\d.]+) 0 0 (-?[\d.]+) -?[\d.]+ -?[\d.]+ cm/g;
  const drawn: Array<[number, number]> = [];
  for (const stream of text.matchAll(/<<\/Filter \/FlateDecode\s*\/Length (\d+)>> stream\r?\n/g)) {
    const start = (stream.index ?? 0) + stream[0].length;
    const content = inflateSync(pdf.subarray(start, start + Number(stream[1]))).toString('latin1');
    const end = content.search(/\/X\d+ Do/);
    if (end < 0) continue;

    const transforms = [...content.slice(0, end).matchAll(matrix)];
    const device = transforms[0];
    const picture = transforms[transforms.length - 1];
    drawn.push([
      round2(Math.abs(Number(picture[1]) * Number(device[1]))),
      round2(Math.abs(Number(picture[2]) * Number(device[2]))),
    ]);
  }

  return { pageCount, pages, pictures, drawn };
}

function design(format: FormatId): DesignDocument {
  return applyBrandKit(documentFromPreset({ presetId: 'tips-steps-ink', format }), {
    kitId: 'kit-1',
    colors: null,
    logoMediaId: LOGO_ID,
    name: 'Acme',
    kitVersion: null,
    fonts: null,
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

  it.each(FORMATS_TO_TRY)(
    'exports a %s slide at 2x: twice the pixels each way, fitted as at 1x',
    async (format) => {
      const document = design(format);
      const spec = formatSpec(format);
      const signal = new AbortController().signal;
      const loadPicture = async () => logo;

      const at1 = await new DesignExport(document, { pool, loadPicture }).renderSlide(0, signal);
      const at2 = await new DesignExport(document, { pool, loadPicture, scale: 2 }).renderSlide(
        0,
        signal,
      );
      const metadata = await sharp(at2.png).metadata();

      expect([metadata.format, metadata.width, metadata.height]).toEqual([
        'png',
        spec.width * 2,
        spec.height * 2,
      ]);
      expect(at2.overflowing).toEqual(at1.overflowing);
      expect(at2.missingPictures).toEqual([]);
    },
  );

  it('draws the same slide at 2x, only sharper: scaled down, it is the 1x slide', async () => {
    const document = design('portrait');
    const spec = formatSpec('portrait');
    const signal = new AbortController().signal;
    const loadPicture = async () => logo;

    const at1 = await new DesignExport(document, { pool, loadPicture }).renderSlide(0, signal);
    const at2 = await new DesignExport(document, { pool, loadPicture, scale: 2 }).renderSlide(
      0,
      signal,
    );
    const base = await sharp(at1.png).removeAlpha().raw().toBuffer();
    const down = await sharp(at2.png)
      .resize(spec.width, spec.height)
      .removeAlpha()
      .raw()
      .toBuffer();

    // The mean difference per channel: about 0.4 for this slide, 3.7 with the
    // 1x slide moved down 3px, 16 against the next slide: only edges differ.
    let difference = 0;
    for (let at = 0; at < base.length; at++) difference += Math.abs(base[at] - down[at]);

    expect(down.length).toBe(base.length);
    expect(difference / base.length).toBeLessThan(1.5);
  });

  it.each([...FORMATS_TO_TRY.map((format) => [format, 1] as const), ['portrait', 2] as const])(
    'prints a %s export at %ix as a PDF: a page per slide, each covered by its slide',
    async (format, scale) => {
      const document = design(format);
      const spec = formatSpec(format);
      const exporter = new DesignExport(document, { pool, loadPicture: async () => logo, scale });
      const signal = new AbortController().signal;

      // Three slides, as the library keeps them after an export: JPEG.
      const slides: Array<{ bytes: Buffer; mimeType: string }> = [];
      for (let index = 0; index < 3; index++) {
        const slide = await exporter.renderSlide(index, signal);
        slides.push({
          bytes: await sharp(slide.png).jpeg({ quality: 90 }).toBuffer(),
          mimeType: 'image/jpeg',
        });
      }

      const pdf = await pool.printImages({
        images: slides,
        ...pdfPageSize(spec.width * scale, spec.height * scale),
        signal,
      });
      const printed = readPdf(pdf);

      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(printed.pageCount).toBe(3);
      expect(printed.pages).toEqual([
        PAGE_POINTS[format],
        PAGE_POINTS[format],
        PAGE_POINTS[format],
      ]);
      // The slides go in whole: a 2x export keeps its pixels on the same page.
      expect(printed.pictures).toEqual(Array(3).fill([spec.width * scale, spec.height * scale]));
      // And each fills its page to the edge: no hairline of paper at the foot.
      expect(printed.drawn).toEqual([
        PAGE_POINTS[format],
        PAGE_POINTS[format],
        PAGE_POINTS[format],
      ]);
    },
  );
});
