/**
 * Module 11: Generate Text, Generate Image, Generate Hashtags and Rewrite In
 * Brand Voice, through the API's internal step gateway.
 *
 * The worker has no model, no credit ledger and no media storage: the API
 * does (`AutomationAiService`), so each executor sends the step's filled-in
 * settings to `/internal/automation/ai/*` and passes on what comes back.
 * The gateway charges before the model runs and answers with the credits
 * that stayed charged, which the engine adds to the run's total with the
 * step's row.
 *
 * - AI steps are `sideEffect: 'internal'`: they run in test runs too (the
 *   person needs to see real output) and are never dry runs. The Test tab
 *   says so and offers Use Sample Text Instead.
 * - A model call can take a minute or two, so the call waits up to
 *   `GATEWAY_AI_TIMEOUT_MS` and heartbeats meanwhile (the slow timeout
 *   class allows 5 minutes with a 30 s heartbeat).
 * - Out of credits comes back as the `out_of_credits` code, which the
 *   gateway client turns into an `outOfCredits` failure: never retried, and
 *   it stops the run whatever the step's On Error says.
 */
import { toText } from '@postgear/automation';
import { permanent } from '../failures';
import { callGateway, GATEWAY_AI_TIMEOUT_MS } from '../gateway-client';
import type { ExecContext, ExecResult, Executor } from './types';

/** The longest prompt and text an AI step sends; the gateway accepts no more. */
export const AI_PROMPT_MAX = 8_000;
export const AI_TEXT_MAX = 10_000;

function filled(value: unknown, max: number, emptyMessage: string): string {
  const text = toText(value).trim();
  if (!text) throw permanent(emptyMessage, 'missing_text');
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

async function viaGateway(
  ctx: ExecContext<Record<string, unknown>>,
  path: string,
  body: Record<string, unknown>,
): Promise<ExecResult> {
  const { output, credits } = await callGateway(ctx, path, body, {
    timeoutMs: GATEWAY_AI_TIMEOUT_MS,
  });
  // The step's own credits ride on its output too, so the run detail shows
  // the exact number per step (rows have no credits column).
  const withCredits =
    typeof output === 'object' && output !== null && !Array.isArray(output)
      ? { ...(output as Record<string, unknown>), credits }
      : output;
  return { output: withCredits, credits };
}

export const generateTextExecutor: Executor = {
  type: 'ai.generateText',
  async run(ctx) {
    const config = ctx.config;
    return viaGateway(ctx, '/ai/text', {
      prompt: filled(config.prompt, AI_PROMPT_MAX, 'Write what the post should be about.'),
      platform: config.platform,
      voice: config.voice,
      format: config.format,
      research: config.research === true,
      withImage: config.withImage === true,
    });
  },
};

export const generateImageExecutor: Executor = {
  type: 'ai.generateImage',
  async run(ctx) {
    const config = ctx.config;
    return viaGateway(ctx, '/ai/image', {
      prompt: filled(config.prompt, AI_PROMPT_MAX, 'Describe the image to make.'),
      ...(typeof config.style === 'string' ? { style: config.style } : {}),
    });
  },
};

export const generateHashtagsExecutor: Executor = {
  type: 'ai.generateHashtags',
  async run(ctx) {
    const config = ctx.config;
    return viaGateway(ctx, '/ai/hashtags', {
      text: filled(config.text, AI_TEXT_MAX, 'Choose the text to find hashtags for.'),
      platform: config.platform,
      count: config.count,
    });
  },
};

export const rewriteInBrandVoiceExecutor: Executor = {
  type: 'ai.rewriteInBrandVoice',
  async run(ctx) {
    const config = ctx.config;
    return viaGateway(ctx, '/ai/rewrite', {
      text: filled(config.text, AI_TEXT_MAX, 'Choose the text to rewrite.'),
      platform: config.platform,
      voice: config.voice,
    });
  },
};

export const AI_EXECUTORS: Executor[] = [
  generateTextExecutor,
  generateImageExecutor,
  generateHashtagsExecutor,
  rewriteInBrandVoiceExecutor,
];
