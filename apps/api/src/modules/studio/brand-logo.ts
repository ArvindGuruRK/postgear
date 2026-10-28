/**
 * Turning a logo file into something the media library can store.
 *
 * PNG, JPG and WebP go on to the media service as they are, which sniffs
 * them again, strips their metadata and stores them like any upload. SVG is
 * the one type the stories add and the library refuses everywhere else, for
 * a good reason: an SVG is a document that can carry script, and the library
 * serves files from a public origin. So an SVG never reaches storage as an
 * SVG. It is checked for anything executable or external, drawn to a PNG
 * with its transparency kept, and the PNG is what is stored.
 *
 * The same checks decide which SVGs website extraction offers as candidates,
 * so a logo the review screen showed is always one this file accepts.
 */
import sharp from 'sharp';
import { SNIFF_BYTES, sniffMedia } from '../media/file-type';

/** The stories' limit: "Logos can be PNG, JPG, SVG or WebP, up to 5 MB." */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** An SVG larger than this is a drawing, not a logo. */
export const MAX_SVG_BYTES = 512 * 1024;

/** The longest edge an SVG is drawn at: crisp at any size a slide shows a logo. */
export const SVG_RASTER_EDGE = 1024;

/** The raster types a logo may be. GIF and AVIF are images, but not logo formats the stories name. */
export const LOGO_RASTER_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** How far into a file its root element is looked for. */
const SVG_PROLOGUE_LIMIT = 4_096;

const SPACE = /\s/;

/**
 * Anything that can run or reach out: script, event handlers, foreign HTML,
 * markup declarations (`<!ENTITY>`, `<!ATTLIST>` and the like, which only
 * ever live in a doctype's internal subset), and any reference that is not
 * to the file's own fragments or an inline image. Sanitising was considered
 * and rejected: against a format this large it is a losing game, and a logo
 * that trips this is rare enough to ask for a PNG.
 *
 * Every branch is linear in what it reads. Extraction runs this over files a
 * stranger's website serves, so a pattern that backtracks (a `[^>]*` before
 * something that may never come, two `\s*` either side of an optional quote)
 * would let one crafted SVG stall the server. The lookaheads refuse a space
 * or a quote as well, so backtracking into the whitespace cannot turn
 * `url('#a')` into a false alarm.
 */
const SVG_UNSAFE = new RegExp(
  [
    '<\\s*script',
    '<\\s*foreignObject',
    '<\\s*iframe',
    '<\\s*embed',
    '<\\s*object',
    '\\bon[a-z]+\\s*=',
    'javascript:',
    '<!(?:ENTITY|ATTLIST|ELEMENT|NOTATION)',
    '@import',
    '\\b(?:xlink:)?href\\s*=\\s*["\']\\s*(?![\\s#]|data:image/(?:png|jpeg|gif|webp);base64,)',
    'url\\(\\s*(?:["\']\\s*)?(?![\\s"\']|#|data:image/)',
  ].join('|'),
  'i',
);

/**
 * Whether a file's root element is `<svg>`, after whatever XML furniture may
 * come first: a declaration, comments, a doctype without an internal subset.
 *
 * A scan rather than one regular expression: the obvious pattern backtracks
 * exponentially over a run of comments with no `<svg>` after it.
 */
export function looksLikeSvg(bytes: Buffer): boolean {
  const text = bytes.toString('utf8', 0, Math.min(bytes.length, SVG_PROLOGUE_LIMIT));
  let at = skipSpace(text, 0);

  if (startsWithIgnoringCase(text, at, '<?xml')) {
    const end = text.indexOf('?>', at);
    if (end === -1) return false;

    at = skipSpace(text, end + 2);
  }

  for (;;) {
    if (text.startsWith('<!--', at)) {
      const end = text.indexOf('-->', at + 4);
      if (end === -1) return false;

      at = skipSpace(text, end + 3);
    } else if (startsWithIgnoringCase(text, at, '<!doctype')) {
      const end = text.indexOf('>', at);
      // An internal subset is where declarations live; a logo needs none.
      if (end === -1 || text.slice(at, end).includes('[')) return false;

      at = skipSpace(text, end + 1);
    } else {
      break;
    }
  }

  return startsWithIgnoringCase(text, at, '<svg') && /[\s>]/.test(text.charAt(at + 4));
}

function skipSpace(text: string, from: number): number {
  let at = from;
  while (SPACE.test(text.charAt(at))) at++;

  return at;
}

function startsWithIgnoringCase(text: string, at: number, prefix: string): boolean {
  return text.slice(at, at + prefix.length).toLowerCase() === prefix;
}

/** An SVG small enough to be a logo, with nothing in it that can run or fetch. */
export function isSafeSvg(bytes: Buffer): boolean {
  if (bytes.length === 0 || bytes.length > MAX_SVG_BYTES) return false;
  if (!looksLikeSvg(bytes)) return false;

  return !SVG_UNSAFE.test(bytes.toString('utf8'));
}

export type LogoRejection = 'empty' | 'too_large' | 'type' | 'unsafe_svg' | 'unreadable';

export class LogoRejectedError extends Error {
  constructor(readonly reason: LogoRejection) {
    super(`The logo was refused: ${reason}`);
    this.name = 'LogoRejectedError';
  }
}

export interface LogoFile {
  buffer: Buffer;
  originalname: string;
}

export interface PreparedLogo {
  data: Buffer;
  mimeType: string;
  name: string;
}

/**
 * Checks a logo file and, for an SVG, draws it.
 *
 * Throws `LogoRejectedError` with the reason, which the service records and
 * turns into the stories' one sentence about types and size.
 */
export async function prepareLogo(file: LogoFile): Promise<PreparedLogo> {
  const bytes = file.buffer;

  if (bytes.length === 0) throw new LogoRejectedError('empty');
  if (bytes.length > MAX_LOGO_BYTES) throw new LogoRejectedError('too_large');

  const sniffed = sniffMedia(bytes.subarray(0, SNIFF_BYTES));

  if (sniffed?.kind === 'image') {
    if (!LOGO_RASTER_TYPES.has(sniffed.mimeType)) throw new LogoRejectedError('type');
    return { data: bytes, mimeType: sniffed.mimeType, name: logoName(file.originalname) };
  }

  if (!looksLikeSvg(bytes)) throw new LogoRejectedError('type');
  if (!isSafeSvg(bytes)) throw new LogoRejectedError('unsafe_svg');

  try {
    return {
      data: await rasterizeSvg(bytes),
      mimeType: 'image/png',
      name: logoName(file.originalname, 'png'),
    };
  } catch {
    throw new LogoRejectedError('unreadable');
  }
}

/**
 * Draws an SVG to a PNG whose longest edge is `SVG_RASTER_EDGE`.
 *
 * The density is chosen from the SVG's own size, so a tiny 24 px icon is
 * drawn sharp rather than enlarged from 24 pixels, and a huge 5000 px
 * artboard is not drawn at 5000 px only to be shrunk again.
 */
export async function rasterizeSvg(svg: Buffer): Promise<Buffer> {
  const options = { failOn: 'error' as const, limitInputPixels: 64_000_000 };
  const { width, height } = await sharp(svg, options).metadata();
  const longest = Math.max(width ?? 0, height ?? 0);

  if (!longest) throw new Error('The SVG has no size.');

  // librsvg reads an SVG at 72 dpi; this scales it to the target edge.
  const density = Math.min(2_400, Math.max(1, (72 * SVG_RASTER_EDGE) / longest));

  return sharp(svg, { ...options, density })
    .resize({ width: SVG_RASTER_EDGE, height: SVG_RASTER_EDGE, fit: 'inside' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** The library name for a logo: its own file name, or "Brand logo", with the right extension. */
function logoName(originalName: string, extension?: string): string {
  const base = originalName.replace(/\\/g, '/').split('/').pop()?.trim() || 'Brand logo';
  if (!extension) return base;

  return `${base.replace(/\.[A-Za-z0-9]{1,5}$/, '')}.${extension}`;
}
