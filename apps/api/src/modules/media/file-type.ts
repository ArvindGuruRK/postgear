/**
 * What an upload actually is, read from its first bytes.
 *
 * The filename and the `Content-Type` a browser sends are both chosen by the
 * client, so neither decides anything here. A file called `photo.jpg` that is
 * really HTML, stored and then served from the API's own origin, is a stored
 * XSS; a file that is really SVG is the same thing wearing an image extension.
 * Only the magic numbers below are trusted, and only this allowlist is stored.
 *
 * Hand-rolled rather than the `file-type` package: its current major is
 * ESM-only, which this CommonJS Nest app cannot `require`, and the handful of
 * signatures PostGear accepts fit on one screen.
 */

export type SniffedMedia =
  | {
      kind: 'image';
      mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'image/avif';
    }
  | { kind: 'video'; mimeType: 'video/mp4' | 'video/quicktime' };

/** Recognised, but deliberately refused — each with its own explanation. */
export type RefusedMedia = { kind: 'refused'; reason: 'heic' | 'webm' };

/** How many leading bytes `sniffMedia` needs. */
export const SNIFF_BYTES = 32;

/**
 * ISO base media `ftyp` brands that are ordinary MP4 video. Anything else in an
 * `ftyp` box — audio-only `M4A `, 3GPP, the HEIF image brands — is not accepted
 * as video just because it shares the container.
 */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'dash',
  'mmp4',
]);

const AVIF_BRANDS = new Set(['avif', 'avis']);
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

export function sniffMedia(head: Buffer): SniffedMedia | RefusedMedia | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mimeType: 'image/jpeg' };
  }

  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png' };
  }

  const ascii = head.toString('latin1');

  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) {
    return { kind: 'image', mimeType: 'image/gif' };
  }

  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') {
    return { kind: 'image', mimeType: 'image/webp' };
  }

  // WebM and Matroska share the EBML header.
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'refused', reason: 'webm' };
  }

  if (ascii.slice(4, 8) === 'ftyp') {
    const brand = ascii.slice(8, 12);

    if (brand === 'qt  ') {
      return { kind: 'video', mimeType: 'video/quicktime' };
    }
    if (AVIF_BRANDS.has(brand)) {
      return { kind: 'image', mimeType: 'image/avif' };
    }
    if (HEIC_BRANDS.has(brand)) {
      return { kind: 'refused', reason: 'heic' };
    }
    if (MP4_BRANDS.has(brand)) {
      return { kind: 'video', mimeType: 'video/mp4' };
    }
  }

  return null;
}

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return (
    buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte)
  );
}
