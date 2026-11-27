/**
 * A Studio logo made into a clips sticker (Sprint 13, Module 10).
 *
 * Studio keeps a kit's logo in the public media library as a PNG, JPG or
 * WebP (an SVG was already drawn to a PNG on upload, `studio/brand-logo.ts`).
 * A clip draws stickers from the private clips space, so the logo is copied
 * there once: drawn to a PNG with its transparency kept, at most
 * `LOGO_STICKER_EDGE` on its longer side (a corner logo is small on every
 * shape), plus the 128 px WebP the Uploaded tab shows, the same two files a
 * checked sticker upload has. Done here with `sharp` rather than by the
 * sticker check workflow: the picture is already a still one Studio
 * accepted, and the kit page needs its size at once.
 */
import sharp from 'sharp';

/** The longest edge the copy is kept at. */
export const LOGO_STICKER_EDGE = 1024;
/** The Uploaded tab's preview size (as the sticker check makes it). */
export const LOGO_PREVIEW_EDGE = 128;

export interface LogoSticker {
  png: Buffer;
  preview: Buffer;
  width: number;
  height: number;
}

/** Throws when the bytes are not a picture `sharp` can read. */
export async function logoSticker(bytes: Buffer): Promise<LogoSticker> {
  const drawn = await sharp(bytes, { animated: false })
    .rotate()
    .resize({
      width: LOGO_STICKER_EDGE,
      height: LOGO_STICKER_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  const preview = await sharp(drawn.data)
    .resize({ width: LOGO_PREVIEW_EDGE, height: LOGO_PREVIEW_EDGE, fit: 'inside' })
    .webp()
    .toBuffer();
  return { png: drawn.data, preview, width: drawn.info.width, height: drawn.info.height };
}
