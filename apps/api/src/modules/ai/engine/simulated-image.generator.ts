/**
 * The image generator simulation mode uses instead of DALL-E.
 *
 * Lives in the API rather than the engine because it needs `sharp`, which the
 * media library already depends on and the engine (a pure library) must not.
 * It is handed to the engine through the same `ImageGenerator` seam as the
 * real one, so the pipeline cannot tell them apart — which is the point: the
 * image stage, the media save, the hero tile in the UI and the credit refund
 * on failure are all exercised for real with no key and no bill.
 *
 * ## Why a picture, and why a different one per prompt
 *
 * A fixed placeholder would pass every test and still hide a bug where two
 * generations show each other's image. Deriving the colours and the shape
 * from a hash of the prompt makes every image visibly its own — and the same
 * prompt always produces the same bytes, so a test can assert on it. The look
 * is the design system's comic register: a flat colour field, a bold
 * contrasting shape, a thick black outline.
 */
import { createHash } from 'node:crypto';
import type { GeneratedImage, ImageGenerator } from '@postgear/ai-engine';
import sharp from 'sharp';

/** DALL-E 3's smallest output, so simulated and real images are the same shape. */
export const SIMULATED_IMAGE_SIZE = 1024;

export interface SimulatedPalette {
  /** The colour field. */
  background: string;
  /** The contrasting shape. */
  accent: string;
  shape: 'circle' | 'band';
  /** 0–1: where the shape sits. */
  offset: number;
}

/** The look of a prompt's image, as hex colours and a shape. Pure. */
export function paletteFor(prompt: string): SimulatedPalette {
  const digest = createHash('sha1').update(prompt.trim().toLowerCase()).digest();
  const hue = ((digest[0] << 8) | digest[1]) % 360;

  return {
    background: hslToHex(hue, 0.68, 0.56),
    // Opposite on the wheel, a little darker, so it reads against the field.
    accent: hslToHex((hue + 180) % 360, 0.78, 0.42),
    shape: digest[2] % 2 === 0 ? 'circle' : 'band',
    offset: digest[3] / 255,
  };
}

export function createSimulatedImageGenerator(): ImageGenerator {
  return {
    name: 'simulation',

    async generate(prompt, options): Promise<GeneratedImage> {
      options?.signal?.throwIfAborted();

      const palette = paletteFor(prompt);
      const data = await sharp({
        create: {
          width: SIMULATED_IMAGE_SIZE,
          height: SIMULATED_IMAGE_SIZE,
          channels: 3,
          background: palette.background,
        },
      })
        .composite([{ input: Buffer.from(shapeSvg(palette)) }])
        .png({ compressionLevel: 6 })
        .toBuffer();

      return { data, mimeType: 'image/png', revisedPrompt: `Simulated image: ${prompt.trim()}` };
    },
  };
}

/** The accent shape, outlined like an inked panel. */
function shapeSvg(palette: SimulatedPalette): string {
  const size = SIMULATED_IMAGE_SIZE;
  const stroke = 'stroke="#111111" stroke-width="28"';

  if (palette.shape === 'circle') {
    const radius = Math.round(size * 0.24);
    // Kept clear of the edges, so the outline is always whole.
    const cx = Math.round(radius + 60 + palette.offset * (size - 2 * radius - 120));
    const cy = Math.round(size * 0.52);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${cx}" cy="${cy}" r="${radius}" fill="${palette.accent}" ${stroke}/></svg>`;
  }

  const height = Math.round(size * 0.22);
  const y = Math.round(80 + palette.offset * (size - height - 160));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="-40" y="${y}" width="${size + 80}" height="${height}" fill="${palette.accent}" ${stroke} transform="rotate(-6 ${size / 2} ${size / 2})"/></svg>`;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector];

  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}
