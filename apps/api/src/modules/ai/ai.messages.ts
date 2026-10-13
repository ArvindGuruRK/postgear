/**
 * User-facing strings for the AI engine and copilot.
 *
 * Specific, for the reason `channels.messages.ts` gives: the caller is an
 * authenticated member of the workspace, so there is nothing to hide behind
 * "something went wrong". What *is* hidden is the provider. An OpenAI error
 * body can quote the request that caused it, name the model, or echo part of a
 * key; a Tavily one can include the query. None of that reaches a response —
 * every provider failure is mapped to one of the strings below by its `kind`,
 * and the original goes to the server log.
 */
import type { AiErrorKind } from '@postgear/ai-engine';

/** How a reset date reads inside a sentence: "November 13". */
const RESET_DATE = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

export const AI_MESSAGES = {
  NOT_CONFIGURED:
    'AI features are not set up on this PostGear instance. Set OPENAI_API_KEY, or AI_SIMULATION="true" for local development.',
  CHANNEL_UNAVAILABLE:
    'One of the selected channels is not connected to this workspace. Choose another and try again.',
  WORKSPACE_NOT_FOUND: 'Workspace not found',
  /** Formatted by the credits service with the cycle's reset date. */
  outOfCredits: (resetsAt: Date): string =>
    `You've used this cycle's AI credits. They refresh on ${RESET_DATE.format(resetsAt)}.`,
  INVALID_KEY:
    'The AI provider rejected this instance’s API key. Ask whoever runs PostGear to check OPENAI_API_KEY.',
  RATE_LIMITED: 'The AI provider is busy right now. Wait a moment and try again.',
  UNAVAILABLE: 'The AI provider could not be reached. Try again in a minute.',
  TIMEOUT: 'The AI provider took too long to answer. Try again.',
  BAD_OUTPUT:
    'The model returned something PostGear could not use. Try again, or rephrase the topic.',
  CONTENT_POLICY: 'The AI provider declined this request. Rephrase it and try again.',
  ABORTED: 'Stopped.',
  UNEXPECTED: 'Something went wrong while generating. Please try again.',
  TOOL_IMAGE_FAILED: 'The image could not be generated. The image credits were returned.',
} as const;

/** The copy shown for an engine error, chosen by its kind — never by its text. */
export function messageForKind(kind: AiErrorKind): string {
  switch (kind) {
    case 'not_configured':
      return AI_MESSAGES.NOT_CONFIGURED;
    case 'invalid_key':
      return AI_MESSAGES.INVALID_KEY;
    case 'rate_limited':
      return AI_MESSAGES.RATE_LIMITED;
    case 'unavailable':
      return AI_MESSAGES.UNAVAILABLE;
    case 'timeout':
      return AI_MESSAGES.TIMEOUT;
    case 'bad_output':
      return AI_MESSAGES.BAD_OUTPUT;
    case 'content_policy':
      return AI_MESSAGES.CONTENT_POLICY;
    case 'aborted':
      return AI_MESSAGES.ABORTED;
  }
}
