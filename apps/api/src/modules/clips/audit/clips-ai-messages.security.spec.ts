/**
 * Security sweep, Messages, over Sprint 13's AI code (Module 16, re-running
 * Sprint 12's row): no sentence a person reads names a path, an address, a
 * key, a tool, the media service's programs or a model provider, and an AI
 * failure answers our sentence, never what the provider or the model said.
 *
 * Sprint 12's half (`clips-messages.security.spec.ts`, "has no path,
 * address, key or tool name in any sentence") already scans the shared
 * error table `CLIP_ERROR_MESSAGES`, which holds the AI codes too; this file
 * adds the AI sentence files and the provider and program names.
 */
import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import { createSnippetWriter, type ModelClient } from '@postgear/ai-engine';
import { CLIP_ERROR_MESSAGES } from '@postgear/video-engine';
import { CLIP_CAPTION_STYLES_MESSAGES } from '../captions/clip-caption-styles.messages';
import { CLIP_HOOK_TITLES_MESSAGES } from '../hook-titles/clip-hook-titles.messages';
import { CLIP_RECIPES_MESSAGES } from '../recipes/clip-recipes.messages';
import { CLIP_VOICE_MESSAGES } from '../voice/clip-voice.messages';

const FILES: Record<string, Record<string, unknown>> = {
  CLIP_ERROR_MESSAGES,
  CLIP_HOOK_TITLES_MESSAGES,
  CLIP_VOICE_MESSAGES,
  CLIP_RECIPES_MESSAGES,
  CLIP_CAPTION_STYLES_MESSAGES,
};

/** A sentence maker called with a count and with a name: whichever it takes. */
function callAll(make: (arg: unknown) => unknown): string[] {
  return [1, 3, 'A Name'].flatMap((arg) => {
    try {
      const text = make(arg);
      return typeof text === 'string' ? [text] : [];
    } catch {
      return [];
    }
  });
}

const sentences = Object.entries(FILES).flatMap(([file, messages]) =>
  Object.entries(messages).flatMap(([name, value]) => {
    const texts =
      typeof value === 'function' ? callAll(value as (arg: unknown) => unknown) : [value];
    return texts
      .filter((text): text is string => typeof text === 'string')
      .map((text) => [`${file}.${name}`, text] as const);
  }),
);

/** Paths, addresses, tools, the media service's programs and every model provider we use. */
const NAMES =
  /\/|\\|https?:|ffmpeg|ffprobe|yt-dlp|stderr|stdout|traceback|exception|errno|undefined|null|\$\{|openai|gpt|groq|whisper|kokoro|mediapipe|blaze|onnx|python|temporal|langchain|tavily|prompt|token\b/i;

describe('the AI sentence files', () => {
  it('name no path, address, tool, program or model provider', () => {
    expect(sentences.length).toBeGreaterThan(60);
    const bad = sentences.filter(([, text]) => NAMES.test(text));
    expect(bad).toEqual([]);
  });
});

describe('a model failure reaches the person as our sentence only', () => {
  const SAID = 'Purple elephants dance at midnight beside the river';

  /** A model whose failure quotes what it was sent and what it answered. */
  const failing = {
    name: 'failing',
    async structured(): Promise<never> {
      const error = new Error(`Failed to parse. Text: "${SAID}". sk-live-secret-key-0123456789`);
      error.name = 'OutputParserException';
      throw error;
    },
    // biome-ignore lint/correctness/useYield: never called here.
    async *chat() {
      throw new Error('not used');
    },
  } as unknown as ModelClient;

  it('hook titles: 502 with our sentence, the log names the kind only', async () => {
    const printed: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(' '));
      });
    }
    const { ClipHookTitlesService } = await import('../hook-titles/clip-hook-titles.service');
    const words = SAID.split(' ').map((text, index) => ({
      i: index,
      start: index * 500,
      end: index * 500 + 400,
      text: index === SAID.split(' ').length - 1 ? `${text}.` : text,
      sure: 0.9,
    }));
    const captions = {
      words: async () => ({
        transcript: { language: 'en', words },
        ranges: [{ fromMs: 0, toMs: 10_000 }],
      }),
    };
    const redis = { incrementWithTtl: async () => 1 };
    const ai = { createSnippetWriter: () => createSnippetWriter(failing) };
    const service = new ClipHookTitlesService(captions as never, redis as never, ai as never);
    let caught: unknown;
    try {
      await service.suggest('org-1', 'user-1', '11111111-1111-4111-8111-111111111111', 0);
    } catch (error) {
      caught = error;
    }
    jest.restoreAllMocks();
    expect(caught).toBeInstanceOf(HttpException);
    const answer = JSON.stringify((caught as HttpException).getResponse());
    const status = (caught as HttpException).getStatus();
    expect(status).toBe(HttpStatus.BAD_GATEWAY);
    expect(answer).toContain(CLIP_HOOK_TITLES_MESSAGES.FAILED);
    expect(printed.join('\n')).toContain('clips.hook_titles.failed');
    for (const text of [answer, printed.join('\n')]) {
      expect(text).not.toContain('Purple elephants');
      expect(text).not.toContain('sk-live');
    }
  });
});
