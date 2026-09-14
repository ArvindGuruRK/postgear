/**
 * The image pipeline, against real images and the real `sharp`.
 *
 * Not mocked, because the claims being made are about bytes: that a large
 * photo really is resized and recompressed, that location metadata really is
 * gone from the output, that transparency survives and opacity does not keep a
 * PNG alive. A mock would only prove the pipeline asks for those things.
 */
import sharp from 'sharp';
import { sniffMedia } from './file-type';
import {
  IMAGE_MAX_EDGE,
  processImage,
  THUMBNAIL_EDGE,
  UnreadableImageError,
  usesTransparency,
} from './image-processor';

type ImageSniff = Parameters<typeof processImage>[1];

function sniffImage(buffer: Buffer): ImageSniff {
  const sniffed = sniffMedia(buffer);

  if (sniffed?.kind !== 'image') {
    throw new Error('fixture is not an image');
  }

  return sniffed;
}

/** A noisy photo-like image. Noise defeats compression, so sizes are realistic. */
async function photo(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe('processImage', () => {
  it('fits a large photo inside 2048 px, as a smaller JPEG', async () => {
    const original = await photo(4000, 3000);
    const result = await processImage(original, sniffImage(original));

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
    expect([result.width, result.height]).toEqual([IMAGE_MAX_EDGE, 1536]);
    expect(result.data.length).toBeLessThan(original.length);

    const stored = await sharp(result.data).metadata();
    expect([stored.format, stored.width, stored.height]).toEqual(['jpeg', 2048, 1536]);
  });

  it('never enlarges a small image', async () => {
    const original = await photo(640, 480);
    const result = await processImage(original, sniffImage(original));

    expect([result.width, result.height]).toEqual([640, 480]);
  });

  it('applies EXIF orientation, then strips every metadata block', async () => {
    // A 40×20 image tagged "rotate 90°", carrying an EXIF block.
    const original = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#fff' },
    })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'GPS 51.5N 0.1W' } } })
      .toBuffer();

    expect((await sharp(original).metadata()).exif).toBeDefined();

    const result = await processImage(original, sniffImage(original));
    const stored = await sharp(result.data).metadata();

    // Upright: the rotation was applied to the pixels, not left as a tag.
    expect([result.width, result.height]).toEqual([20, 40]);
    expect(stored.exif).toBeUndefined();
    expect(stored.orientation).toBeUndefined();
    expect(result.data.includes(Buffer.from('GPS 51.5N'))).toBe(false);
  });

  it('keeps a PNG that really uses transparency as PNG', async () => {
    const original = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 0.4 },
      },
    })
      .png()
      .toBuffer();

    const result = await processImage(original, sniffImage(original));

    expect(result.mimeType).toBe('image/png');
    expect((await sharp(result.data).metadata()).hasAlpha).toBe(true);
  });

  it('turns a PNG with an unused alpha channel into a JPEG', async () => {
    const original = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 255, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const result = await processImage(original, sniffImage(original));

    expect(result.mimeType).toBe('image/jpeg');
  });

  it('converts WebP, which several platforms refuse, to JPEG', async () => {
    const original = await sharp({
      create: { width: 80, height: 60, channels: 3, background: '#0a0' },
    })
      .webp()
      .toBuffer();

    expect((await processImage(original, sniffImage(original))).mimeType).toBe('image/jpeg');
  });

  it('converts a CMYK JPEG to sRGB rather than storing ink channels', async () => {
    const original = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#c33' },
    })
      .toColourspace('cmyk')
      .jpeg()
      .toBuffer();

    expect((await sharp(original).metadata()).space).toBe('cmyk');

    const result = await processImage(original, sniffImage(original));
    const stored = await sharp(result.data).metadata();

    expect(stored.space).toBe('srgb');
    expect(stored.channels).toBe(3);
  });

  it('stores a GIF byte-for-byte, so an animation is never flattened', async () => {
    const original = await sharp({
      create: { width: 30, height: 20, channels: 4, background: '#0f0' },
    })
      .gif()
      .toBuffer();

    const result = await processImage(original, sniffImage(original));

    expect(result.mimeType).toBe('image/gif');
    expect(result.data.equals(original)).toBe(true);
    expect([result.width, result.height]).toEqual([30, 20]);
  });

  it('makes a WebP thumbnail no larger than the grid needs', async () => {
    const original = await photo(3000, 1000);
    const result = await processImage(original, sniffImage(original));
    const thumbnail = await sharp(result.thumbnail).metadata();

    expect(thumbnail.format).toBe('webp');
    expect(Math.max(thumbnail.width ?? 0, thumbnail.height ?? 0)).toBe(THUMBNAIL_EDGE);
  });

  it('refuses a file whose decoded format disagrees with its signature', async () => {
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
      .png()
      .toBuffer();

    await expect(
      processImage(png, { kind: 'image', mimeType: 'image/jpeg' }),
    ).rejects.toBeInstanceOf(UnreadableImageError);
  });

  it('refuses a truncated image rather than storing half of it', async () => {
    const original = await photo(400, 400);
    const truncated = original.subarray(0, Math.floor(original.length * 0.5));

    await expect(processImage(truncated, sniffImage(truncated))).rejects.toBeInstanceOf(
      UnreadableImageError,
    );
  });
});

describe('usesTransparency', () => {
  it('reads the alpha channel for grey-alpha and RGBA, and ignores opaque layouts', () => {
    expect(usesTransparency(Buffer.from([10, 20, 30, 255, 1, 2, 3, 254]), 4)).toBe(true);
    expect(usesTransparency(Buffer.from([10, 20, 30, 255, 1, 2, 3, 255]), 4)).toBe(false);
    expect(usesTransparency(Buffer.from([128, 0]), 2)).toBe(true);
    expect(usesTransparency(Buffer.from([0, 0, 0]), 3)).toBe(false);
  });
});
