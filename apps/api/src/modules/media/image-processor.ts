/**
 * Compression and resizing, on the server, for every image.
 *
 * ## Why here and not in the browser
 *
 * The reference compresses in its frontend and trusts what arrives; its own
 * LinkedIn provider carries a comment warning that self-hosters who switch that
 * off send full-size images straight to platforms. Server-side, compression
 * cannot be skipped by a different client, an API call, or a browser without
 * the right codec — and stripping location metadata is a privacy guarantee,
 * which only means something if the client cannot opt out of it.
 *
 * ## What every image goes through
 *
 * 1. **Decoded once** at a bounded size. Sharp's pixel limit refuses a
 *    decompression bomb before it allocates.
 * 2. **Rotated upright** from its EXIF orientation, then **stripped of all
 *    metadata** — EXIF, GPS, camera serials. A phone photo's location does not
 *    ride along to four social networks.
 * 3. **Fit within 2048 px** on its long edge, never enlarged. 2048 is one of
 *    Facebook's recommended photo widths, well above the 1080 px Instagram
 *    displays, and inside X's 4096 px maximum — so feeds lose nothing visible,
 *    and only X's full-screen zoom on a very large original would.
 * 4. **Re-encoded** as JPEG (quality 82, mozjpeg) — or as PNG when the image
 *    genuinely uses transparency, since JPEG would paint it black. Every
 *    platform PostGear publishes to accepts both; WebP and AVIF inputs are
 *    converted because several do not.
 * 5. **Thumbnailed** at 480 px WebP for the library grid, so a page of tiles
 *    does not download two dozen full images.
 *
 * Animated GIFs are the exception: re-encoding frame by frame would bloat them
 * or lose the animation, so their bytes are stored as uploaded and only the
 * thumbnail is generated. The GIF format has no EXIF block, so there is no
 * camera location to strip — though an XMP comment packet, if present,
 * survives. That is the trade for keeping the animation.
 */
import { readFile } from 'node:fs/promises';
import sharp, { type Sharp } from 'sharp';
import type { SniffedMedia } from './file-type';
import type { StoredExtension } from './storage/storage-keys';

/** Long-edge cap for stored images. */
export const IMAGE_MAX_EDGE = 2048;

/** Long-edge cap for library thumbnails. */
export const THUMBNAIL_EDGE = 480;

const JPEG_QUALITY = 82;
const THUMBNAIL_QUALITY = 70;

/**
 * Sharp's own default, stated so it cannot change silently under an upgrade.
 * 268 megapixels comfortably admits a 200 MP phone photo and refuses the
 * crafted 50,000 × 50,000 PNG that decompresses to 10 GB.
 */
const MAX_INPUT_PIXELS = 0x3fff * 0x3fff;

/**
 * The format sharp must report for each type the sniffer accepted. The two
 * are independent readings of the same bytes, so a disagreement means a file
 * built to pass one check and not the other.
 */
const DECODED_FORMAT: Record<Extract<SniffedMedia, { kind: 'image' }>['mimeType'], string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'heif',
};

export interface ProcessedImage {
  data: Buffer;
  mimeType: 'image/jpeg' | 'image/png' | 'image/gif';
  extension: StoredExtension;
  width: number;
  height: number;
  thumbnail: Buffer;
}

export class UnreadableImageError extends Error {
  constructor(message = 'The image could not be read') {
    super(message);
    this.name = 'UnreadableImageError';
  }
}

export async function processImage(
  input: Buffer | string,
  sniffed: Extract<SniffedMedia, { kind: 'image' }>,
): Promise<ProcessedImage> {
  const options = { failOn: 'error' as const, limitInputPixels: MAX_INPUT_PIXELS };

  let format: string | undefined;
  let pageHeight: number | undefined;
  let height: number | undefined;
  let width: number | undefined;

  try {
    ({ format, pageHeight, height, width } = await sharp(input, options).metadata());
  } catch {
    throw new UnreadableImageError();
  }

  // The sniffer decided what this is from its first bytes; the decoder must
  // agree. A mismatch is a crafted file, not an unusual photo.
  if (format !== DECODED_FORMAT[sniffed.mimeType]) {
    throw new UnreadableImageError('The file is not the image it claims to be');
  }

  try {
    if (sniffed.mimeType === 'image/gif') {
      const data = typeof input === 'string' ? await readFile(input) : input;

      return {
        data,
        mimeType: 'image/gif',
        extension: 'gif',
        width: width ?? 0,
        // An animated GIF reports the height of all frames stacked; a frame is what shows.
        height: pageHeight ?? height ?? 0,
        thumbnail: await thumbnailOf(sharp(input, { ...options, animated: false })),
      };
    }

    // Decode, orient and resize once, into raw pixels. Both the transparency
    // check and the encode then work from the same small buffer instead of
    // decoding a 50 MP original twice.
    const { data: pixels, info } = await sharp(input, options)
      .rotate()
      .resize({
        width: IMAGE_MAX_EDGE,
        height: IMAGE_MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      // CMYK JPEGs decode to four channels of ink, not RGBA.
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });

    const raw = { raw: { width: info.width, height: info.height, channels: info.channels } };
    const transparent = usesTransparency(pixels, info.channels);

    const encoded = transparent
      ? await sharp(pixels, raw).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
      : await sharp(pixels, raw)
          // An alpha channel that is fully opaque everywhere is dropped rather
          // than kept as a reason to store a PNG.
          .removeAlpha()
          .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
          .toBuffer();

    return {
      data: encoded,
      mimeType: transparent ? 'image/png' : 'image/jpeg',
      extension: transparent ? 'png' : 'jpg',
      width: info.width,
      height: info.height,
      thumbnail: await thumbnailOf(sharp(encoded)),
    };
  } catch (error) {
    if (error instanceof UnreadableImageError) {
      throw error;
    }
    throw new UnreadableImageError();
  }
}

/**
 * True when any pixel is less than fully opaque.
 *
 * Scanned directly rather than via `sharp().stats()`, which measures the
 * *input* and ignores the pipeline — it would decode the full-size original a
 * second time. Grey-plus-alpha (two channels) and RGBA (four) both carry alpha
 * last.
 */
export function usesTransparency(pixels: Buffer, channels: number): boolean {
  if (channels !== 2 && channels !== 4) {
    return false;
  }

  for (let index = channels - 1; index < pixels.length; index += channels) {
    if (pixels[index] < 255) {
      return true;
    }
  }

  return false;
}

async function thumbnailOf(pipeline: Sharp): Promise<Buffer> {
  return pipeline
    .rotate()
    .resize({
      width: THUMBNAIL_EDGE,
      height: THUMBNAIL_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}
