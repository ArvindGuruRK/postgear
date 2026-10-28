/**
 * The Definition of Done's "the files pass the composer's Instagram rules",
 * pinned: what Export stores for each format (the media pipeline's JPEG at
 * the Studio's quality, from a slide of the format's exact size) goes through
 * the composer's own validator with the real Instagram rules, the check a
 * Send draft meets once it is scheduled.
 *
 * The slide is noise rather than a rendered template, so the JPEG is as heavy
 * as a busy photo slide gets. That the renderer really draws at these sizes is
 * the opt-in browser specs' job (`design-exporter.browser.spec.ts`).
 */
import { FORMAT_IDS, type FormatId, formatSpec } from '@postgear/design-engine';
import { type ComposedMedia, IntegrationManager, validatePost } from '@postgear/social-core';
import sharp from 'sharp';
import { sniffMedia } from '../media/file-type';
import { processImage } from '../media/image-processor';
import { previewPlatforms } from './preview-platforms';
import { EXPORT_JPEG_QUALITY } from './studio.service';

const PROVIDERS = new IntegrationManager().list();
const INSTAGRAM = PROVIDERS.find((provider) => provider.identifier === 'instagram');

/** A slide of the format's exact size, as the export browser hands it over: a PNG. */
async function slide(format: FormatId): Promise<Buffer> {
  const { width, height } = formatSpec(format);

  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: '#808080',
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .png()
    .toBuffer();
}

/** What Export stores for one slide, described the way the composer sees an attachment. */
async function stored(format: FormatId, prefer: 'jpeg' | 'png'): Promise<ComposedMedia> {
  const png = await slide(format);
  const sniffed = sniffMedia(png);
  if (sniffed?.kind !== 'image') throw new Error('the slide is not an image');

  const result = await processImage(png, sniffed, { prefer, quality: EXPORT_JPEG_QUALITY });

  return {
    type: 'image',
    mimeType: result.mimeType,
    bytes: result.data.length,
    width: result.width,
    height: result.height,
  };
}

function instagramIssues(media: ComposedMedia[]) {
  if (!INSTAGRAM) throw new Error('the Instagram provider is not registered');

  return validatePost(INSTAGRAM.rules, [{ text: 'A caption', media }], {
    providerName: 'Instagram',
  }).map((issue) => issue.code);
}

describe('what Export stores meets the composer rules', () => {
  it.each(FORMAT_IDS)(
    '%s: kept at its exact size, and taken by Instagram exactly when Preview offers it',
    async (format) => {
      const image = await stored(format, 'jpeg');
      const { width, height } = formatSpec(format);
      const offered = previewPlatforms(format, PROVIDERS).some((frame) => frame.id === 'instagram');
      const carousel = Array.from({ length: INSTAGRAM?.rules.media.maxImages ?? 0 }, () => image);

      expect([image.mimeType, image.width, image.height]).toEqual(['image/jpeg', width, height]);
      // Never offered and accepted apart: a frame Preview shows is a post Send can make.
      expect(instagramIssues(carousel)).toEqual(offered ? [] : ['aspect_ratio']);
    },
    30_000,
  );

  it('is refused as PNG, which is why JPEG is the default', async () => {
    const image = await stored('square', 'png');

    expect(image.mimeType).toBe('image/png');
    expect(instagramIssues([image])).toEqual(['image_type']);
  }, 30_000);

  it('leaves a carousel longer than Instagram takes to the composer to explain', async () => {
    const image = await stored('portrait', 'jpeg');
    const tooMany = (INSTAGRAM?.rules.media.maxImages ?? 0) + 1;

    expect(instagramIssues(Array.from({ length: tooMany }, () => image))).toEqual([
      'too_many_images',
    ]);
  }, 30_000);
});
