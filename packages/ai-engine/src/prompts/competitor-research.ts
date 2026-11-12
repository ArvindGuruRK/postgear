/**
 * Research This Competitor (Sprint 11 Module 10): a short read of what one
 * competitor has published lately, and where the workspace could answer.
 *
 * The model reads only what Discover already fetched for that competitor
 * (titles, dates, where each was posted), never the open web, so the answer
 * can always be traced back to the posts listed under it. The service holds
 * the answer to the limits below after the call, the way the snippets do.
 */
import { z } from 'zod';
import { block, field } from './fields';

/** The most of each list the answer keeps, whatever the model returns. */
export const RESEARCH_MAX_THEMES = 4;
export const RESEARCH_MAX_OPENINGS = 3;
export const RESEARCH_MAX_CHARS = 220;
/** The posts quoted to the model: the newest, enough to see a pattern. */
export const RESEARCH_MAX_POSTS = 15;

export const competitorResearchSchema = z.object({
  themes: z
    .array(z.string().min(1))
    .describe('What they keep posting about: 2 to 4 short themes, the strongest first.'),
  rhythm: z
    .string()
    .min(1)
    .describe('One sentence on how often and where they post, from the dates and places listed.'),
  openings: z
    .array(z.string().min(1))
    .describe(
      'Two or three things the workspace could post that this competitor does not cover. Each one sentence.',
    ),
});

export type CompetitorResearchOutput = z.infer<typeof competitorResearchSchema>;

export interface ResearchPost {
  title: string;
  /** Where it was posted: Blog, YouTube, Instagram, News and so on. */
  where: string;
  /** ISO 8601, or null when the source gave none. */
  publishedAt: string | null;
}

export interface CompetitorResearchPromptInput {
  competitor: string;
  workspaceName?: string;
  posts: readonly ResearchPost[];
}

/** A post as one line the model and the simulation can both read: `2026-11-10 | Blog | Title`. */
export function researchLine(post: ResearchPost): string {
  const day = post.publishedAt ? post.publishedAt.slice(0, 10) : 'undated';
  return `${day} | ${post.where} | ${post.title.replace(/\s+/g, ' ').trim()}`;
}

export function buildCompetitorResearchPrompt(input: CompetitorResearchPromptInput): {
  system: string;
  user: string;
} {
  const system = [
    'You are a social media strategist. You read a list of what one competitor published lately and say, briefly and concretely, what they focus on and where the reader could stand out.',
    'Rules:',
    '- Use only the posts listed. Do not guess at anything that is not in them.',
    `- At most ${RESEARCH_MAX_THEMES} themes, each 2 to 5 words, in Title Case.`,
    `- At most ${RESEARCH_MAX_OPENINGS} openings, each one plain sentence under ${RESEARCH_MAX_CHARS} characters.`,
    '- An opening is something the reader could post this week, not general advice.',
    '- Plain text: no markdown, no emojis, no quotation marks around answers.',
  ].join('\n');

  const user = [
    field('Competitor', input.competitor),
    field('Workspace', input.workspaceName),
    block('Posts', input.posts.slice(0, RESEARCH_MAX_POSTS).map(researchLine).join('\n')),
  ].join('\n');

  return { system, user };
}
