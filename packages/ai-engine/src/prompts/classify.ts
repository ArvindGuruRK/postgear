/**
 * Classify stage — which of PostGear's categories the brief belongs to.
 *
 * The category is cheap to get and worth having early: the hook and content
 * prompts use it ("this is an announcement, lead with the news") and the UI
 * shows it as a badge. The schema is a `z.enum` over {@link AI_CATEGORIES},
 * so a model cannot invent a category; a value outside the list fails
 * validation and goes through the structured-output repair path.
 */
import { z } from 'zod';
import { AI_CATEGORIES, type ResearchSource } from '../types';
import { block, field } from './fields';

export const classifySchema = z.object({
  category: z.enum(AI_CATEGORIES).describe('The single best category for the post'),
});

export type ClassifyOutput = z.infer<typeof classifySchema>;

export interface ClassifyPromptInput {
  topic: string;
  sources: ResearchSource[];
}

export function buildClassifyPrompt(input: ClassifyPromptInput): { system: string; user: string } {
  const system = [
    'You classify briefs for social media posts into exactly one category.',
    `Categories: ${AI_CATEGORIES.join(', ')}.`,
    'Pick the category that best describes what the finished post will be, not what it mentions.',
    'Answer with the category only, in the structured format requested.',
  ].join('\n');

  const user = [
    block('Brief', input.topic),
    field('Research sources', input.sources.length),
    ...input.sources.slice(0, 5).map((source) => `- ${source.title} | ${source.snippet}`),
  ].join('\n');

  return { system, user };
}
