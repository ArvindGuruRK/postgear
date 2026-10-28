/**
 * The logo checks: which files count as an SVG, which SVGs are safe to draw,
 * how a logo file becomes what the library stores, and that no crafted file
 * can make any of it slow (extraction runs these over files a stranger's
 * website serves).
 */
import sharp from 'sharp';
import {
  isSafeSvg,
  LogoRejectedError,
  type LogoRejection,
  looksLikeSvg,
  MAX_LOGO_BYTES,
  MAX_SVG_BYTES,
  prepareLogo,
  rasterizeSvg,
  SVG_RASTER_EDGE,
} from './brand-logo';

/** Generous: the backtracking versions these replace took seconds, or never finished. */
const FAST_MS = 250;

const SQUARE = '<rect width="40" height="20" fill="#1A2B3C"/>';

function svg(body: string, attributes = 'width="40" height="20"'): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`);
}

function raster(format: 'png' | 'jpeg' | 'webp' | 'gif'): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 32, channels: 4, background: '#FF5A1F' } })
    .toFormat(format)
    .toBuffer();
}

function timed(check: () => unknown): number {
  const started = performance.now();
  check();
  return performance.now() - started;
}

async function rejection(buffer: Buffer, originalname = 'logo'): Promise<LogoRejection> {
  try {
    await prepareLogo({ buffer, originalname });
  } catch (error) {
    if (error instanceof LogoRejectedError) return error.reason;
    throw error;
  }

  throw new Error('The logo was accepted.');
}

describe('looksLikeSvg', () => {
  it('finds the root element after the usual XML furniture', () => {
    expect(looksLikeSvg(svg(SQUARE))).toBe(true);
    expect(
      looksLikeSvg(
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: Illustrator -->\n' +
            '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" ' +
            '"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
            '<!-- logo -->\n<svg viewBox="0 0 10 10"></svg>',
        ),
      ),
    ).toBe(true);
  });

  it('skips a byte order mark', () => {
    expect(looksLikeSvg(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), svg(SQUARE)]))).toBe(true);
  });

  it('refuses what is not an SVG', () => {
    expect(looksLikeSvg(Buffer.from('<html><body><svg></svg></body></html>'))).toBe(false);
    expect(looksLikeSvg(Buffer.from('<svgx></svgx>'))).toBe(false);
    expect(looksLikeSvg(Buffer.from('<svg'))).toBe(false);
    expect(looksLikeSvg(Buffer.from('<!-- never closed <svg></svg>'))).toBe(false);
    expect(looksLikeSvg(Buffer.from('<?xml version="1.0"'))).toBe(false);
    expect(looksLikeSvg(Buffer.alloc(0))).toBe(false);
  });

  it('refuses a doctype with an internal subset', () => {
    expect(looksLikeSvg(Buffer.from('<!DOCTYPE svg [ <!ENTITY a "b"> ]><svg></svg>'))).toBe(false);
  });

  it('stays fast on a run of comments with no root after it', () => {
    const comments = Buffer.from(`${'<!---->'.repeat(600)}x`);

    expect(looksLikeSvg(comments)).toBe(false);
    expect(timed(() => looksLikeSvg(comments))).toBeLessThan(FAST_MS);
  });
});

describe('isSafeSvg', () => {
  it('accepts a plain logo, gradients, fragment links and inline pictures', () => {
    expect(isSafeSvg(svg(SQUARE))).toBe(true);
    expect(
      isSafeSvg(
        svg(
          '<defs><linearGradient id="g"><stop offset="0" stop-color="#FFF"/></linearGradient></defs>' +
            '<style>.a { fill: url(\'#g\'); } .b { fill: url( "#g" ); }</style>' +
            '<rect class="a" fill="url(#g)" width="4" height="4"/>' +
            '<use href="#g"/><use xlink:href="#g"/>' +
            '<image href="data:image/png;base64,iVBORw0KGgo="/>',
        ),
      ),
    ).toBe(true);
  });

  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an event handler', '<rect onload="alert(1)"/>'],
    ['foreign HTML', '<foreignObject><div></div></foreignObject>'],
    ['an iframe', '<iframe src="x"></iframe>'],
    ['a javascript link', '<a href="javascript:alert(1)"><rect/></a>'],
    ['an external picture', '<image href="https://example.com/a.png"/>'],
    ['an external xlink', '<use xlink:href="other.svg#a"/>'],
    ['an external stylesheet', '<style>@import "https://example.com/a.css";</style>'],
    ['an external url()', '<rect style="fill: url(https://example.com/a.svg#p)"/>'],
    ['a quoted external url()', '<rect style="fill: url( \'https://example.com/a.svg\' )"/>'],
    ['an entity declaration', '<!ENTITY x "y">'],
    ['an attribute list declaration', '<!ATTLIST svg onload CDATA "alert(1)">'],
  ])('refuses %s', (_label, body) => {
    expect(isSafeSvg(svg(body))).toBe(false);
  });

  it('refuses an empty file and one over the size limit', () => {
    expect(isSafeSvg(Buffer.alloc(0))).toBe(false);
    expect(isSafeSvg(svg(`<!-- ${'a'.repeat(MAX_SVG_BYTES)} -->${SQUARE}`))).toBe(false);
  });

  it('stays fast on crafted files at the size limit', () => {
    const room = MAX_SVG_BYTES - 200;
    const repeated = (unit: string) => svg(unit.repeat(Math.floor(room / unit.length)));
    const crafted = [
      repeated('<!DOCTYPE'),
      repeated('<!'),
      repeated('< '),
      repeated('on'),
      svg(`url(${' '.repeat(room)}#a)`),
      svg(`url("${' '.repeat(room)}#a")`),
      svg(`href=${' '.repeat(room)}`),
      svg(`href="${' '.repeat(room)}#a"`),
      svg(`<${' '.repeat(room)}`),
    ];

    for (const file of crafted) {
      expect(file.length).toBeLessThanOrEqual(MAX_SVG_BYTES);
      expect(timed(() => isSafeSvg(file))).toBeLessThan(FAST_MS);
    }
  });
});

describe('prepareLogo', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('passes a %s through as it is, named after the file', async (format, mimeType) => {
    const buffer = await raster(format);
    const prepared = await prepareLogo({
      buffer,
      originalname: `C:\\fakepath\\Acme Logo.${format}`,
    });

    expect(prepared).toEqual({ data: buffer, mimeType, name: `Acme Logo.${format}` });
  });

  it('draws an SVG to a transparent PNG at the raster edge', async () => {
    const prepared = await prepareLogo({ buffer: svg(SQUARE), originalname: 'acme.svg' });
    const metadata = await sharp(prepared.data).metadata();

    expect(prepared.mimeType).toBe('image/png');
    expect(prepared.name).toBe('acme.png');
    expect(metadata.format).toBe('png');
    expect([metadata.width, metadata.height]).toEqual([SVG_RASTER_EDGE, SVG_RASTER_EDGE / 2]);
    expect(metadata.hasAlpha).toBe(true);
  });

  it('names a logo without a file name "Brand logo"', async () => {
    const prepared = await prepareLogo({ buffer: svg(SQUARE), originalname: '' });

    expect(prepared.name).toBe('Brand logo.png');
  });

  it('names each refusal', async () => {
    expect(await rejection(Buffer.alloc(0))).toBe('empty');
    expect(await rejection(Buffer.alloc(MAX_LOGO_BYTES + 1))).toBe('too_large');
    expect(await rejection(await raster('gif'))).toBe('type');
    expect(await rejection(Buffer.from('%PDF-1.7\n'))).toBe('type');
    expect(await rejection(Buffer.from('<html><body>Hello</body></html>'))).toBe('type');
    expect(await rejection(svg('<script>alert(1)</script>'))).toBe('unsafe_svg');
    expect(
      await rejection(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>')),
    ).toBe('unreadable');
  });
});

describe('rasterizeSvg', () => {
  it('draws a small icon at the full raster edge', async () => {
    const png = await rasterizeSvg(svg(SQUARE, 'width="24" height="24" viewBox="0 0 24 24"'));
    const metadata = await sharp(png).metadata();

    expect([metadata.width, metadata.height]).toEqual([SVG_RASTER_EDGE, SVG_RASTER_EDGE]);
  });
});
