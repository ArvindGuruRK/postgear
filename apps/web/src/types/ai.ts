/**
 * AI shapes, mirroring what `/ai/*` returns (Sprint 6).
 *
 * Declared here rather than imported from `@postgear/ai-engine`, for the
 * reason `channel.ts` gives: that package pulls LangChain and the OpenAI SDK
 * into whatever imports it, and none of that belongs in a browser bundle. The
 * engine's `types.ts` is the source; keep the two in step.
 */

export type Tone = 'personal' | 'company';

export type PostFormat = 'one_short' | 'one_long' | 'thread_short' | 'thread_long';

export type GenerateStage = 'research' | 'classify' | 'hook' | 'content' | 'image';

export const GENERATE_STAGES: readonly GenerateStage[] = [
  'research',
  'classify',
  'hook',
  'content',
  'image',
] as const;

export type StageStatus = 'started' | 'done' | 'skipped' | 'failed';

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface SavedImage {
  mediaId: string;
  url: string;
  thumbnailUrl: string | null;
}

export interface GeneratedPart {
  text: string;
  imagePrompt: string | null;
  image: SavedImage | null;
}

export interface GenerateResult {
  tone: Tone;
  format: PostFormat;
  category: string;
  hook: string;
  parts: GeneratedPart[];
  sources: ResearchSource[];
  researched: boolean;
}

/** `POST /ai/generate` body. */
export interface GenerateRequestBody {
  topic: string;
  tone: Tone;
  format: PostFormat;
  withImage: boolean;
  channelIds: string[];
}

export type AiErrorKind =
  | 'not_configured'
  | 'invalid_key'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'bad_output'
  | 'content_policy'
  | 'aborted'
  | 'out_of_credits'
  | 'unexpected';

/** Everything `POST /ai/generate` streams. `credits` rides on the terminal events. */
export type GenerateStreamEvent =
  | { type: 'stage'; stage: GenerateStage; status: StageStatus; detail?: string }
  | { type: 'research'; sources: ResearchSource[] }
  | { type: 'category'; category: string }
  | { type: 'hook'; hook: string }
  | { type: 'content'; parts: GeneratedPart[] }
  | { type: 'image'; index: number; image: SavedImage }
  | { type: 'done'; result: GenerateResult; credits: AiCredits }
  | { type: 'error'; kind: AiErrorKind; message: string; retryable: boolean; credits: AiCredits };

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** `POST /ai/copilot/chat` body. The client holds the history. */
export interface CopilotChatBody {
  messages: CopilotMessage[];
}

export type CopilotToolName = 'list_channels' | 'generate_post' | 'draft_post' | 'generate_image';

export type CopilotStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; id: string; name: CopilotToolName; input: unknown }
  | {
      type: 'tool_result';
      id: string;
      name: CopilotToolName;
      ok: boolean;
      output: unknown;
      summary: string;
    }
  | { type: 'done'; message: string; toolCalls: number; credits: AiCredits }
  | { type: 'error'; kind: AiErrorKind; message: string; retryable: boolean; credits: AiCredits };

/** What the copilot's `draft_post` tool returns: the UI turns `group` into a composer link. */
export interface DraftPostToolOutput {
  group: string;
  channelNames: string[];
  parts: number;
}

/** What the copilot's `generate_image` tool returns. */
export interface GenerateImageToolOutput extends SavedImage {
  prompt: string;
}

export type AiTier = 'NONE' | 'STANDARD' | 'PRO' | 'TEAM' | 'ULTIMATE';

/** `GET /ai/credits`. */
export interface AiCredits {
  allowance: number;
  used: number;
  remaining: number;
  /** ISO time the cycle restarts and `used` returns to zero. */
  resetsAt: string;
  tier: AiTier;
  /** Remaining is under 20% of the allowance (user story 5.5's warning). */
  low: boolean;
  costs: {
    generate_post: number;
    generate_image: number;
    copilot_message: number;
    /** Sprint 7: AI advice on an SEO audit. */
    seo_advice: number;
    /** Sprint 10: a workflow's Generate Hashtags or Rewrite In Brand Voice step. */
    generate_snippet: number;
  };
}

export type AiMode = 'openai' | 'simulation' | 'unconfigured';

/** `GET /ai/status`. */
export interface AiStatus {
  /** False when `mode` is `unconfigured`: generation endpoints answer 503. */
  configured: boolean;
  mode: AiMode;
  /** The model's name ("openai:gpt-4.1-mini", "simulation"), or null. */
  model: string | null;
  /** Web research is available (Tavily key, or simulation). */
  research: boolean;
  /** Image generation is available (OpenAI key, or simulation). */
  images: boolean;
}
