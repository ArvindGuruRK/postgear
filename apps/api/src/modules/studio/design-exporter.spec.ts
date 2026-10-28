/**
 * The exporter against a fake browser pool: what the export page carries
 * (the slide, its pictures and its faces, all inline), what the page's
 * report turns into, which failures name which reason, and cancelling.
 * `design-exporter.browser.spec.ts` runs the same code in real Chromium.
 */
import {
  applyBrandKit,
  type DesignDocument,
  documentFromPreset,
  formatSpec,
  slideMediaIds,
} from '@postgear/design-engine';
import type { BrowserPool, RenderOptions } from '@postgear/seo-engine';
import sharp from 'sharp';
import {
  DesignExport,
  ExportCancelledError,
  type ExportPicture,
  SlideRenderError,
} from './design-exporter';

const LOGO_ID = 'logo-media-id';

/** tips-steps-ink with a kit logo, which every slide with a logo slot draws. */
function design(): DesignDocument {
  return applyBrandKit(documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' }), {
    kitId: 'kit-1',
    colors: null,
    logoMediaId: LOGO_ID,
    name: 'Acme',
    kitVersion: null,
  });
}

const CLEAN_REPORT = { overflow: [], fontsMissing: [], fitError: null };

function fakePool(
  render: (options: RenderOptions) => Promise<unknown> | unknown = () => CLEAN_REPORT,
) {
  const calls: RenderOptions[] = [];
  const pool: BrowserPool = {
    acquire: jest.fn(),
    release: jest.fn(),
    available: jest.fn(async () => true),
    close: jest.fn(),
    render: jest.fn(async (options: RenderOptions) => {
      calls.push(options);
      return { image: Buffer.from('a png'), value: await render(options) };
    }),
  };

  return { pool, calls };
}

let logo: ExportPicture;

beforeAll(async () => {
  logo = {
    bytes: await sharp({ create: { width: 8, height: 8, channels: 4, background: '#FF5A1F' } })
      .png()
      .toBuffer(),
    mimeType: 'image/png',
  };
});

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function failure(promise: Promise<unknown>): Promise<SlideRenderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof SlideRenderError) return error;
    throw error;
  }

  throw new Error('The slide rendered.');
}

describe('DesignExport', () => {
  it('renders a slide at the format size once its text is fitted, everything inline', async () => {
    const document = design();
    const { pool, calls } = fakePool();
    const exporter = new DesignExport(document, { pool, loadPicture: async () => logo });

    const slide = await exporter.renderSlide(0, signal());
    const spec = formatSpec('square');

    expect(slide).toEqual({
      index: 0,
      png: Buffer.from('a png'),
      overflowing: [],
      missingPictures: [],
    });
    expect(calls[0]).toMatchObject({
      width: spec.width,
      height: spec.height,
      type: 'png',
      waitForFunction: 'window.__pgFitDone === true',
    });
    expect(calls[0].html).toContain(`data:image/png;base64,${logo.bytes.toString('base64')}`);
    expect(calls[0].html).toContain('data:font/woff2;base64,');
    expect(calls[0].html).not.toMatch(/(?:src|href)="https?:/);
  });

  it('reads each picture once for the whole export', async () => {
    const document = design();
    const { pool } = fakePool();
    const loadPicture = jest.fn(async () => logo);
    const exporter = new DesignExport(document, { pool, loadPicture });

    const drawn = document.slides.filter((_, index) => slideMediaIds(document, index).length > 0);
    expect(drawn.length).toBeGreaterThan(1);

    for (let index = 0; index < document.slides.length; index++) {
      await exporter.renderSlide(index, signal());
    }

    expect(loadPicture).toHaveBeenCalledTimes(1);
    expect(loadPicture).toHaveBeenCalledWith(LOGO_ID);
  });

  it('names the slots still too long, ignoring anything it does not know', async () => {
    const { pool } = fakePool(() => ({ ...CLEAN_REPORT, overflow: ['headline', 'bogus', 7] }));
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => logo });

    expect((await exporter.renderSlide(0, signal())).overflowing).toEqual(['headline']);
  });

  it.each([
    ['no longer in the library', null],
    ['of a type a page cannot inline', { bytes: Buffer.from('<svg/>'), mimeType: 'image/svg+xml' }],
  ])('draws a picture %s as missing rather than failing', async (_label, picture) => {
    const { pool, calls } = fakePool();
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => picture });

    const slide = await exporter.renderSlide(0, signal());

    expect(slide.missingPictures).toEqual([LOGO_ID]);
    expect(calls[0].html).not.toContain('data:image/');
  });

  it('fails the slide when storage cannot be read', async () => {
    const { pool } = fakePool();
    const exporter = new DesignExport(design(), {
      pool,
      loadPicture: async () => {
        throw new Error('The bucket did not answer.');
      },
    });

    expect(await failure(exporter.renderSlide(0, signal()))).toMatchObject({
      slideIndex: 0,
      reason: 'picture',
      noBrowser: false,
    });
  });

  it('fails the slide when a face did not load, rather than shipping the fallback', async () => {
    const { pool } = fakePool(() => ({ ...CLEAN_REPORT, fontsMissing: ['700 64px Sora'] }));
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => logo });

    expect((await failure(exporter.renderSlide(1, signal()))).reason).toBe('fonts');
  });

  it.each([
    ['threw', { ...CLEAN_REPORT, fitError: 'TypeError: boom' }],
    ['did not report', {}],
    ['answered nonsense', 'nonsense'],
  ])('fails the slide when the text fitter %s', async (_label, report) => {
    const { pool } = fakePool(() => report);
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => logo });

    expect((await failure(exporter.renderSlide(0, signal()))).reason).toBe('unknown');
  });

  it.each([
    [
      'a timeout',
      Object.assign(new Error('page.waitForFunction: Timeout 30000ms exceeded.'), {
        name: 'TimeoutError',
      }),
      'timeout',
      false,
    ],
    [
      'a closed browser',
      new Error('Target page, context or browser has been closed'),
      'browser',
      false,
    ],
    [
      'a browser that is not installed',
      new Error("browserType.launch: Executable doesn't exist at C:\\ms-playwright\\chromium"),
      'browser',
      true,
    ],
    ['anything else', new Error('Protocol error (Page.captureScreenshot)'), 'unknown', false],
  ])('tells %s apart', async (_label, error, reason, noBrowser) => {
    const { pool } = fakePool(() => {
      throw error;
    });
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => logo });

    expect(await failure(exporter.renderSlide(2, signal()))).toMatchObject({
      slideIndex: 2,
      reason,
      noBrowser,
    });
  });

  it('stops without rendering when the export was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { pool } = fakePool();
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => logo });

    await expect(exporter.renderSlide(0, controller.signal)).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
    expect(pool.render).not.toHaveBeenCalled();
  });

  it('calls a render that failed because of the cancel a cancel', async () => {
    const controller = new AbortController();
    const { pool } = fakePool(() => {
      controller.abort();
      throw new Error('Target page, context or browser has been closed');
    });
    const exporter = new DesignExport(design(), { pool, loadPicture: async () => logo });

    await expect(exporter.renderSlide(0, controller.signal)).rejects.toBeInstanceOf(
      ExportCancelledError,
    );
  });
});
