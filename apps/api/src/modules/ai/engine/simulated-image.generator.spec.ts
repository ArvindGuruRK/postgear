/**
 * The simulated generator makes a real PNG at DALL-E's size, the same one
 * every time for a prompt and a visibly different one for another.
 */
import sharp from 'sharp';
import {
  createSimulatedImageGenerator,
  paletteFor,
  SIMULATED_IMAGE_SIZE,
} from './simulated-image.generator';

describe('simulated image generator', () => {
  it('derives a palette from the prompt, ignoring case and surrounding space', () => {
    const palette = paletteFor('A sunrise over a city skyline');

    expect(palette.background).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.background).not.toBe(palette.accent);
    expect(paletteFor('  a SUNRISE over a city skyline ')).toEqual(palette);
    expect(paletteFor('A cat on a keyboard')).not.toEqual(palette);
  });

  it('renders a 1024×1024 PNG with the rewritten prompt as its description', async () => {
    const generator = createSimulatedImageGenerator();

    const image = await generator.generate('A sunrise over a city skyline');

    expect(image.mimeType).toBe('image/png');
    expect(image.data.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(image.revisedPrompt).toBe('Simulated image: A sunrise over a city skyline');

    const metadata = await sharp(image.data).metadata();
    expect(metadata).toMatchObject({
      format: 'png',
      width: SIMULATED_IMAGE_SIZE,
      height: SIMULATED_IMAGE_SIZE,
    });
  });

  it('is deterministic per prompt and different across prompts', async () => {
    const generator = createSimulatedImageGenerator();

    const [first, again, other] = await Promise.all([
      generator.generate('A sunrise over a city skyline'),
      generator.generate('A sunrise over a city skyline'),
      generator.generate('A cat asleep on a keyboard'),
    ]);

    expect(first.data.equals(again.data)).toBe(true);
    expect(first.data.equals(other.data)).toBe(false);
  });

  it('refuses to start once the request has been abandoned', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      createSimulatedImageGenerator().generate('anything', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
