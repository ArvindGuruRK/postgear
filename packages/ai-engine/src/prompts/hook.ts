/**
 * Hook stage: the one or two sentences that earn the rest of the post.
 *
 * Written as its own stage, before the body, on purpose: when a model writes
 * hook and body in one go the hook is whatever the first sentence happened
 * to be. Asked for alone, with the category and the research in view, it is
 * a deliberate opening line that the content stage then has to live up to:
 * the content prompt receives it verbatim and must make it the first line of
 * part 1. The rule against copying the brief exists because the laziest
 * possible hook is the brief itself, and models take that shortcut.
 */
import { z } from 'zod';
import type { ResearchSource, Tone } from '../types';
import { block, field } from './fields';
import { toneRules } from './tone';

export const hookSchema = z.object({
  hook: z
    .string()
    .min(8)
    .max(400)
    .describe('One or two sentences that open the post. Never a copy of the brief.'),
});

export type HookOutput = z.infer<typeof hookSchema>;

export interface HookPromptInput {
  topic: string;
  tone: Tone;
  category: string;
  sources: ResearchSource[];
  platforms: string[];
  workspaceName?: string;
}

export function buildHookPrompt(input: HookPromptInput): { system: string; user: string } {
  const system = [
    'You write the opening hook of a social media post: the first one or two sentences.',
    'The hook must make a scrolling reader stop. It is not a title and not a summary.',
    toneRules(input.tone, input.workspaceName),
    'Rules:',
    '- One or two sentences, at most 200 characters in total.',
    '- Do not copy or lightly rephrase the brief; say something the brief implies.',
    '- No hashtags, no emoji, no markdown, no quotation marks around the hook.',
    '- Avoid tired openers: "Discover the secret", "The best", "Are you ready", "In today\'s world".',
    '- Plain, concrete English. Specifics beat adjectives.',
  ].join('\n');

  const user = [
    field('Voice', input.tone),
    field('Category', input.category),
    field('Platforms', input.platforms.length > 0 ? input.platforms.join(', ') : 'generic'),
    field('Workspace', input.workspaceName),
    block('Brief', input.topic),
    block(
      'Research',
      input.sources.map((source) => `- ${source.title} | ${source.snippet}`).join('\n'),
    ),
  ].join('\n');

  return { system, user };
}
