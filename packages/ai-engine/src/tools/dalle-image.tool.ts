/**
 * Image generation through the official `openai` SDK (DALL-E 3 by default).
 *
 * The engine asks for base64 rather than a URL: OpenAI's image URLs expire
 * after an hour, and the bytes have to end up in PostGear's media library
 * anyway, where the API's `ImageSink` stores them for good. The size is
 * fixed at 1024×1024: one square hero image works on every platform
 * PostGear supports, and offering a choice would only add a way to pick
 * something a platform rejects.
 *
 * DALL-E rewrites prompts for safety and detail and returns the rewrite as
 * `revised_prompt`; it is kept as the image's alt text because it describes
 * what was actually drawn, which the original prompt often does not.
 *
 * Image calls are slow (20–40 s is normal), so the default deadline is 90 s;
 * the SDK's own retries are off because `resilience.ts` owns that policy.
 */
import OpenAI from 'openai';
import { providerError, withDeadline, withRetry } from '../model/resilience';
import type { GeneratedImage, ImageGenerator } from '../types';

export interface OpenAiImageGeneratorOptions {
  apiKey: string;
  /** e.g. `dall-e-3`. */
  model: string;
  /** Default 90 000 ms. */
  timeoutMs?: number;
}

export const DEFAULT_IMAGE_TIMEOUT_MS = 90_000;
export const IMAGE_SIZE = '1024x1024';

export function createOpenAiImageGenerator(options: OpenAiImageGeneratorOptions): ImageGenerator {
  const timeoutMs = options.timeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS;
  const client = new OpenAI({ apiKey: options.apiKey, timeout: timeoutMs, maxRetries: 0 });

  return {
    name: `openai:${options.model}`,
    generate(prompt, generateOptions): Promise<GeneratedImage> {
      const signal = generateOptions?.signal;
      return withRetry(
        () =>
          withDeadline(
            async (deadlineSignal) => {
              const response = await client.images.generate(
                {
                  model: options.model,
                  prompt,
                  n: 1,
                  size: IMAGE_SIZE,
                  response_format: 'b64_json',
                },
                { signal: deadlineSignal },
              );
              const first = response.data?.[0];
              if (!first?.b64_json) {
                throw providerError('bad_output', {
                  message: 'The image provider returned no image data.',
                });
              }
              return {
                data: Buffer.from(first.b64_json, 'base64'),
                mimeType: 'image/png',
                revisedPrompt: first.revised_prompt ?? null,
              };
            },
            { timeoutMs, signal },
          ),
        { signal },
      );
    },
  };
}
