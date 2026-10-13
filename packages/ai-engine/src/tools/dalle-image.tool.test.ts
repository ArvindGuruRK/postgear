const generate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ images: { generate } })),
}));

import OpenAI from 'openai';
import { createOpenAiImageGenerator } from './dalle-image.tool';

describe('createOpenAiImageGenerator', () => {
  beforeEach(() => {
    generate.mockReset();
  });

  it('asks for one square base64 PNG and returns bytes plus the revised prompt', async () => {
    const png = Buffer.from('fake-png-bytes');
    generate.mockResolvedValue({
      data: [{ b64_json: png.toString('base64'), revised_prompt: 'A clearer prompt' }],
    });
    const generator = createOpenAiImageGenerator({ apiKey: 'sk-test', model: 'dall-e-3' });

    const image = await generator.generate('a sunrise');

    expect(generator.name).toBe('openai:dall-e-3');
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-test', maxRetries: 0 }),
    );
    expect(generate).toHaveBeenCalledWith(
      {
        model: 'dall-e-3',
        prompt: 'a sunrise',
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(image.data.equals(png)).toBe(true);
    expect(image.mimeType).toBe('image/png');
    expect(image.revisedPrompt).toBe('A clearer prompt');
  });

  it('reports a missing image as bad_output without retrying', async () => {
    generate.mockResolvedValue({ data: [] });
    const generator = createOpenAiImageGenerator({ apiKey: 'sk-test', model: 'dall-e-3' });
    await expect(generator.generate('x')).rejects.toMatchObject({ kind: 'bad_output' });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('maps a content policy refusal and does not retry it', async () => {
    generate.mockRejectedValue({ status: 400, code: 'content_policy_violation', message: 'no' });
    const generator = createOpenAiImageGenerator({ apiKey: 'sk-test', model: 'dall-e-3' });
    await expect(generator.generate('x')).rejects.toMatchObject({
      kind: 'content_policy',
      retryable: false,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('maps an invalid key without retrying', async () => {
    generate.mockRejectedValue({ status: 401, message: 'Incorrect API key sk-abcdefgh12345' });
    const generator = createOpenAiImageGenerator({ apiKey: 'sk-test', model: 'dall-e-3' });
    const error = await generator.generate('x').catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'invalid_key' });
    expect((error as Error).message).not.toContain('sk-abcdefgh12345');
  });
});
