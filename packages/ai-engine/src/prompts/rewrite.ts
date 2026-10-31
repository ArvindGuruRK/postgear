/**
 * Rewrite in a voice (Sprint 10, a workflow's Rewrite In Brand Voice step):
 * the same post, said by the person or the brand, sized for a platform.
 *
 * It shares `toneRules` with the hook and content stages, so "Company" means
 * the same "we, as {workspace}" everywhere PostGear writes. The length rule
 * is quoted to the model and enforced afterwards by the caller
 * (`agents/snippets.ts`), like the content stage's guard.
 */
import { z } from 'zod';
import type { Tone } from '../types';
import { block, field } from './fields';
import { toneRules } from './tone';

export const rewriteSchema = z.object({
  rewrite: z.string().min(1).describe('The rewritten post. Plain text, lines separated by \\n.'),
});

export type RewriteOutput = z.infer<typeof rewriteSchema>;

export interface RewritePromptInput {
  text: string;
  /** A provider identifier (`instagram`, `x` ...) or `generic`. */
  platform: string;
  voice: Tone;
  /** The platform's limit for one post, or null for none. */
  maxCharacters: number | null;
  workspaceName?: string;
}

export function buildRewritePrompt(input: RewritePromptInput): { system: string; user: string } {
  const system = [
    'You rewrite a social media post so it says the same thing in the voice below.',
    toneRules(input.voice, input.workspaceName),
    'Rules:',
    '- Keep the meaning, every fact, every link, every @mention and every hashtag.',
    input.maxCharacters !== null
      ? `- At most ${input.maxCharacters} characters. Count carefully; shorter is fine.`
      : '- Keep it about as long as the original.',
    '- Plain text only: no markdown, no quotation marks around the post.',
    '- Put "\\n" between lines. Short lines read better on a phone.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const user = [
    field('Voice', input.voice),
    field('Platform', input.platform),
    field('Max characters', input.maxCharacters),
    field('Workspace', input.workspaceName),
    block('Text', input.text),
  ].join('\n');

  return { system, user };
}
